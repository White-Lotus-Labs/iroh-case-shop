import { expect, test, type Page } from '@playwright/test';
import { mockCaseTestnet } from './case-fixture';
import testnet from '../../config/contracts.testnet.json' with { type: 'json' };

async function openShelf(page: Page) {
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Shelf/ })
    .click();
  await page.getByRole('button', { name: 'Open the Activity Ledger' }).click();
  return page.getByTestId('shelf-activity');
}

test('Host waits for a verified draw and the Shelf retains the purchase receipt', async ({
  page,
}) => {
  test.setTimeout(60000);
  const { chain, calls } = await mockCaseTestnet(page);
  chain.bonuses = true;
  chain.claimed = true;
  chain.stored = true;
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?collection=dragon-tea');
  const host = page.getByRole('region', { name: 'Case inspection' });
  const rewards = host.getByRole('region', { name: 'Testnet bonus rewards' });
  await expect(rewards).toContainText('50 SHITZU');
  await expect(rewards).toContainText('5 RHEA');
  await expect(rewards).toContainText('1 AURORA');
  await expect(host.locator('.tea-reel')).toHaveCount(0);
  await host
    .getByRole('button', { name: 'Connect Wallet', exact: true })
    .click();
  await page.locator('.hot-connector-popup .connect-item').click();
  await expect(host.locator('.tea-catalog-wallet-head strong')).toHaveText(
    '1000 USDI',
  );
  await host.getByRole('button', { name: 'Open Case · 1 USDI' }).click();
  await expect(
    host.getByText('Transaction submitted, awaiting finalized confirmation.'),
  ).toBeVisible();
  await expect(host.locator('.tea-reel')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  chain.stage = 'drawn';
  chain.openFinal = true;
  await host.getByRole('button', { name: 'Refresh chain state' }).click();
  const reel = host.locator('.tea-reel');
  await expect(reel).toHaveAttribute(
    'aria-label',
    'Reward reel landed on AURORA',
  );
  await expect(reel.locator('[data-winner]')).toHaveAttribute(
    'data-winner',
    'AURORA',
  );
  await expect(reel.locator('.tea-reel-track')).toHaveCSS(
    'animation-name',
    'tea-reel-land',
  );
  await expect(host.locator('.tea-bonus-reward')).toContainText(
    '1 AURORA bonus · Reserved',
  );
  chain.stage = 'paid';
  await host.getByRole('button', { name: 'Refresh chain state' }).click();
  await expect(host.locator('.tea-bonus-reward')).toContainText(
    '1 AURORA bonus · Paid',
  );
  await expect(
    host.getByText('Transaction finalized successfully on Testnet.'),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(host.locator('.tea-catalog-wallet-head strong')).toHaveText(
    '1004 USDI',
  );
  const shelf = await openShelf(page);
  await expect(shelf.getByText('1 AURORA', { exact: true })).toBeVisible();
  await shelf
    .getByRole('button', { name: 'Details for Case purchase' })
    .click();
  await expect(
    shelf.getByRole('heading', { name: 'Case purchase details' }),
  ).toBeFocused();
  await expect(shelf.getByText('ft_transfer_call')).toBeVisible();
  await expect(shelf.getByRole('link', { name: /NearBlocks/ })).toHaveAttribute(
    'href',
    /11111111111111111111111111111112$/,
  );
  expect(calls).toHaveLength(1);
});

test('mobile reel skips motion and Shelf prompts a disconnected wallet', async ({
  page,
}) => {
  test.setTimeout(60000);
  const { chain } = await mockCaseTestnet(page);
  chain.bonuses = true;
  chain.claimed = true;
  chain.stage = 'paid';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?collection=dragon-tea');
  const host = page.getByRole('region', { name: 'Case inspection' });
  await expect(
    host.getByRole('region', { name: 'Testnet bonus rewards' }),
  ).toBeVisible();
  const shelf = await openShelf(page);
  await expect(
    shelf.getByText('Connect a NEAR Testnet wallet to see your activity.'),
  ).toBeVisible();
  await page.getByTestId('wallet-entry').click();
  await page.locator('.hot-connector-popup .connect-item').click();
  await expect(shelf.getByText('1 AURORA', { exact: true })).toBeVisible();
  const bonus = shelf.locator('li').filter({ hasText: '1 AURORA' });
  await bonus.getByRole('button', { name: /Details/ }).click();
  await expect(shelf.getByText('iroh-test-aurora.testnet')).toBeVisible();
  await expect(shelf.getByText('Legendary', { exact: true })).toBeVisible();
  await expect(shelf.getByRole('link', { name: /NearBlocks/ })).toHaveCount(0);
  const bounds = await shelf.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.getByRole('button', { name: 'Tea Cases' }).click();
  await page.getByRole('button', { name: /Inspect Dragon Tea Case/ }).click();
  await expect(host.locator('.tea-reel-track')).toHaveCSS(
    'animation-name',
    'none',
  );
  await expect(host.locator('[data-winner]')).toHaveAttribute(
    'data-winner',
    'AURORA',
  );
});

test('Shelf loads older finalized case history and retains the legacy fallback', async ({
  page,
}) => {
  test.setTimeout(60000);
  const { chain } = await mockCaseTestnet(page);
  chain.claimed = true;
  const cursors: unknown[] = [];
  await page.route(testnet.rpcUrl + '/', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const { params } = route.request().postDataJSON();
    if (params.account_id !== testnet.caseContractId) return route.fallback();
    if (
      params.method_name !== 'get_case' &&
      params.method_name !== 'get_history_page'
    )
      return route.fallback();
    let value: unknown;
    if (params.method_name === 'get_case')
      value = {
        case_id: 'dragon-tea',
        name: 'Dragon Tea Case',
        token_id: testnet.tokenContractId,
        price: '1000000',
        pool_contribution: '950000',
        platform_fee: '50000',
        probability_denominator: 1000000,
        randomness: 'NEAR protocol randomness',
        quote_policy: 'Exact revision',
        rewards: [
          { tier: 'Common', amount: '100000' },
          { tier: 'Rare', amount: '1000000' },
          { tier: 'Legendary', amount: '5000000' },
        ],
        bonus_rewards: [],
        history_pagination: true,
      };
    else {
      const args = JSON.parse(
        Buffer.from(params.args_base64, 'base64').toString(),
      );
      cursors.push(args.before_opening_id);
      const ids =
        args.before_opening_id === null
          ? Array.from({ length: 20 }, (_, index) => 20 - index)
          : [0];
      value = {
        openings: ids.map((id) => ({
          opening_id: String(id),
          account_id: 'tea-guest.testnet',
          nonce: String(id),
          accepted_height: String(201 + id),
          accepted_revision: '1',
          common: 700000,
          rare: 250000,
          legendary: 50000,
          denominator: 1000000,
          status: 'Completed',
          reward: '1000000',
          draw: 800000,
          attempt: '1',
          reserved: '0',
        })),
        next_cursor: args.before_opening_id === null ? '0' : null,
      };
    }
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: {
        result: { result: [...Buffer.from(JSON.stringify(value))], logs: [] },
      },
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?collection=dragon-tea');
  await page
    .getByRole('button', { name: 'Connect Wallet', exact: true })
    .click();
  await page.locator('.hot-connector-popup .connect-item').click();
  const shelf = await openShelf(page);
  await expect(shelf.locator('.shelf-activity-rows > li')).toHaveCount(40);
  await shelf
    .getByRole('button', { name: 'Load older Dragon Tea Case openings' })
    .click();
  await expect(shelf.locator('.shelf-activity-rows > li')).toHaveCount(42);
  await expect(shelf).toContainText('All opening records loaded.');
  expect(cursors).toEqual([null, '0']);
});
