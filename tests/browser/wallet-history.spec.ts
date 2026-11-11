import { expect, test, type Page } from '@playwright/test';
import testnet from '../../config/contracts.testnet.json' with { type: 'json' };
import { mockCaseTestnet } from './case-fixture';

const account = 'tea-guest.testnet';
const hash = '3'.repeat(32),
  secondHash = '4'.repeat(32),
  receiptId = '5'.repeat(32),
  blockHash = '6'.repeat(32);
const reference = (txHash = hash) => ({
  hash: txHash,
  signerId: account,
  receiverId: testnet.tokenContractId,
  actions: ['ft_transfer_call'],
  blockHeight: '201',
  timestamp: '1794251526278507638',
  indexerStatus: 'success',
  source: 'Indexer reference, not receipt-verified',
});
async function shelf(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?collection=dragon-tea');
  await page
    .getByRole('button', { name: 'Connect Wallet', exact: true })
    .click();
  await page.locator('.hot-connector-popup .connect-item').click();
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Shelf/ })
    .click();
  await page.getByRole('button', { name: 'Open the Activity Ledger' }).click();
  return page.getByRole('region', { name: 'Indexed wallet history' });
}

test('Shelf separates indexed references, loads more and verifies receipts on demand', async ({
  page,
}) => {
  test.setTimeout(60000);
  const { chain, calls } = await mockCaseTestnet(page);
  chain.claimed = true;
  chain.stage = 'paid';
  const cursors: (string | null)[] = [];
  await page.route('**/api/case-history?**', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    cursors.push(cursor);
    await route.fulfill({
      json: {
        accountId: account,
        transactions: [reference(cursor ? secondHash : hash)],
        nextCursor: cursor ? null : 'next-page',
        source: 'Indexer reference, not receipt-verified',
      },
    });
  });
  let verifications = 0;
  await page.route(testnet.rpcUrl + '/', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const { method, params } = route.request().postDataJSON();
    if (method === 'tx' && params.tx_hash === hash) {
      verifications++;
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: {
          result: {
            final_execution_status: 'FINAL',
            transaction: {
              hash,
              signer_id: account,
              receiver_id: testnet.tokenContractId,
              actions: [
                {
                  FunctionCall: {
                    method_name: 'ft_transfer_call',
                    args: 'e30=',
                    gas: 1,
                    deposit: '1',
                  },
                },
              ],
            },
            status: { SuccessValue: '' },
            transaction_outcome: {
              id: hash,
              block_hash: blockHash,
              outcome: {
                executor_id: account,
                status: { SuccessReceiptId: receiptId },
                receipt_ids: [receiptId],
                logs: [],
              },
            },
            receipts_outcome: [
              {
                id: receiptId,
                outcome: {
                  executor_id: testnet.tokenContractId,
                  status: { SuccessValue: '' },
                  receipt_ids: [],
                  logs: [
                    'EVENT_JSON:' +
                      JSON.stringify({
                        standard: 'nep141',
                        version: '1.0.0',
                        event: 'ft_transfer',
                        data: [
                          {
                            old_owner_id: account,
                            new_owner_id: testnet.caseContractId,
                            amount: '1000000',
                            memo: null,
                          },
                        ],
                      }),
                  ],
                },
              },
            ],
          },
        },
      });
      return;
    }
    if (method === 'block' && params.block_id === blockHash) {
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: {
          result: {
            header: {
              hash: blockHash,
              height: 201,
              timestamp_nanosec: '1794251526278507638',
            },
          },
        },
      });
      return;
    }
    return route.fallback();
  });
  const region = await shelf(page);
  await expect(region).toContainText('Not receipt-verified.');
  expect(verifications).toBe(0);
  await expect(page.locator('.shelf-activity-rows > li')).toHaveCount(2);
  await region
    .getByRole('button', { name: 'Load more wallet references' })
    .click();
  await expect(region.locator('.shelf-indexer-rows > li')).toHaveCount(2);
  expect(cursors[0]).toBeNull();
  expect(cursors.filter((cursor) => cursor === 'next-page')).toHaveLength(1);
  await region
    .getByRole('button', { name: `Details for wallet transaction ${hash}` })
    .click();
  await expect(
    region.getByRole('heading', { name: 'Wallet transaction details' }),
  ).toBeFocused();
  await expect(region).toContainText('Finalized receipt verification: success');
  await expect(region).toContainText('1000000 raw token units');
  await expect(region).toContainText('Finalized RPC receipt verification');
  expect(verifications).toBe(1);
  expect(calls).toEqual([]);
  await expect(
    page.getByRole('button', { name: 'See the top traders' }),
  ).toBeVisible();
});

test('indexer and receipt failures do not hide finalized case activity', async ({
  page,
}) => {
  test.setTimeout(60000);
  const { chain, calls } = await mockCaseTestnet(page);
  chain.claimed = true;
  chain.stage = 'paid';
  let fail = true;
  await page.route('https://archival-rpc.testnet.near.org/**', (route) =>
    route.fulfill({
      status: 503,
      headers: { 'access-control-allow-origin': '*' },
      json: { error: 'Fixture archived receipt unavailable' },
    }),
  );
  await page.route('**/api/case-history?**', async (route) => {
    if (fail)
      return route.fulfill({
        status: 502,
        json: { error: 'Fixture indexer unavailable' },
      });
    return route.fulfill({
      json: {
        accountId: account,
        transactions: [reference()],
        nextCursor: null,
        source: 'Indexer reference, not receipt-verified',
      },
    });
  });
  await page.route(testnet.rpcUrl + '/', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON().method === 'tx'
    )
      return route.fulfill({
        status: 503,
        headers: { 'access-control-allow-origin': '*' },
        json: { error: 'Fixture archived receipt unavailable' },
      });
    return route.fallback();
  });
  const region = await shelf(page);
  await expect(region).toContainText('Indexer history unavailable.');
  await expect(page.locator('.shelf-activity-rows > li')).toHaveCount(2);
  fail = false;
  await region
    .getByRole('button', { name: 'Retry indexed wallet history' })
    .click();
  await region
    .getByRole('button', { name: `Details for wallet transaction ${hash}` })
    .click();
  await expect(region).toContainText('Receipt verification unavailable.');
  await expect(region).toContainText(
    'It has not been added to the verified case ledger.',
  );
  await expect(page.locator('.shelf-activity-rows > li')).toHaveCount(2);
  expect(calls).toEqual([]);
});

test('switching wallets cancels old indexed history and ignores a late response', async ({
  page,
}) => {
  test.setTimeout(60000);
  const { chain } = await mockCaseTestnet(page);
  chain.claimed = true;
  let started = false,
    finished = false,
    release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const other = 'other-guest.testnet';
  await page.route('**/api/case-history?**', async (route) => {
    const requested = new URL(route.request().url()).searchParams.get(
      'account',
    );
    if (requested === account) {
      started = true;
      await hold;
    }
    await route
      .fulfill({
        json: {
          accountId: requested,
          transactions: [
            {
              ...reference(requested === account ? hash : secondHash),
              signerId: requested,
            },
          ],
          nextCursor: null,
          source: 'Indexer reference, not receipt-verified',
        },
      })
      .catch(() => {});
    if (requested === account) finished = true;
  });
  const region = await shelf(page);
  try {
    await expect.poll(() => started).toBe(true);
    await page.getByTestId('wallet-entry').click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(region).toHaveCount(0);
    await page.evaluate(
      (id) => localStorage.setItem('fake-near-wallet-account', id),
      other,
    );
    await page.getByTestId('wallet-entry').click();
    await page.locator('.hot-connector-popup .connect-item').click();
    await expect(region).toContainText(other);
    release();
    await expect.poll(() => finished).toBe(true);
    await expect(
      region.getByRole('button', {
        name: `Details for wallet transaction ${secondHash}`,
      }),
    ).toBeVisible();
    await expect(
      region.getByRole('button', {
        name: `Details for wallet transaction ${hash}`,
      }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});
