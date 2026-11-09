import { expect, test, type Page } from '@playwright/test';
import testnet from '../../config/contracts.testnet.json' with { type: 'json' };
import { mockCaseTestnet } from './case-fixture';

test('shows balance, claim eligibility and pool while opening history is slow', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { chain } = await mockCaseTestnet(page);
  chain.claimed = true;
  let releaseHistory = () => {};
  const slowHistory = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  let historyStarted = false;
  await page.route(testnet.rpcUrl + '/', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON().params?.method_name === 'get_history'
    ) {
      historyStarted = true;
      await slowHistory;
    }
    await route.fallback();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?collection=dragon-tea');
  const detail = page.getByRole('region', { name: 'Case inspection' });
  try {
    await detail
      .getByRole('button', { name: 'Connect Wallet', exact: true })
      .click();
    await page.locator('.hot-connector-popup .connect-item').click();
    await expect.poll(() => historyStarted).toBe(true);
    await expect(
      detail.getByText('tea-guest.testnet', { exact: true }),
    ).toBeVisible();
    await expect(detail.locator('.tea-catalog-wallet-head strong')).toHaveText(
      '1000 USDI',
    );
    await expect(
      detail.getByText('Starter USDI already claimed.'),
    ).toBeVisible();
    await expect(detail.getByText('1000 USDI available')).toBeVisible();
    await expect(detail.getByText('Reading opening history…')).toBeVisible();
  } finally {
    releaseHistory();
  }
  await expect(
    detail.getByText('No finalized openings found for this account.'),
  ).toBeVisible();
});

async function openInspection(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?collection=dragon-tea');
  return page.getByRole('region', { name: 'Case inspection' });
}

async function connectWallet(page: Page) {
  await page
    .getByRole('button', { name: 'Connect Wallet', exact: true })
    .click();
  await page.locator('.hot-connector-popup .connect-item').click();
}

test('backs off a failed balance read and retries without hiding claim or pool data', async ({
  page,
}) => {
  await mockCaseTestnet(page);
  let attempts = 0;
  let rateLimited = true;
  await page.route(testnet.rpcUrl + '/', async (route) => {
    if (
      route.request().method() !== 'POST' ||
      route.request().postDataJSON().params?.method_name !== 'ft_balance_of'
    ) {
      await route.fallback();
      return;
    }
    attempts++;
    if (!rateLimited) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 429,
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  const detail = await openInspection(page);
  await connectWallet(page);
  const retry = detail.getByRole('button', { name: 'Retry USDI balance' });
  await expect(retry).toBeVisible();
  await expect(detail.getByRole('alert')).toContainText('HTTP 429');
  await expect(detail.getByText('1000 USDI available')).toBeVisible();
  await expect(
    detail.getByRole('button', { name: 'Claim 1,000 USDI' }),
  ).toBeEnabled();
  expect(attempts).toBe(2);
  rateLimited = false;
  await retry.click();
  await expect(detail.locator('.tea-catalog-wallet-head strong')).toHaveText(
    '0 USDI',
  );
  await expect(retry).toHaveCount(0);
  expect(attempts).toBe(3);
});

test('a hanging view times out, and rapid refreshes do not restart it', async ({
  page,
}) => {
  test.setTimeout(45000);
  await mockCaseTestnet(page);
  let attempts = 0;
  const held: Array<() => void> = [];
  await page.route(testnet.rpcUrl + '/', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON().params?.method_name === 'get_history'
    ) {
      attempts++;
      await new Promise<void>((resolve) => held.push(resolve));
      // End an intercepted request even when the browser already timed it out.
      await route.abort().catch(() => {});
    } else await route.fallback();
  });
  const detail = await openInspection(page);
  try {
    await connectWallet(page);
    await expect(detail.getByText('Reading opening history…')).toBeVisible();
    await expect.poll(() => attempts).toBe(1);
    const refresh = detail.getByRole('button', { name: 'Refresh chain state' });
    await refresh.evaluate((button: HTMLButtonElement) => {
      for (let i = 0; i < 15; i++) button.click();
    });
    await expect(detail.locator('.tea-catalog-wallet-head strong')).toHaveText(
      '0 USDI',
    );
    await expect(
      detail.getByText(
        'Could not read opening history. Testnet RPC request timed out.',
      ),
    ).toBeVisible({ timeout: 22000 });
    expect(attempts).toBeLessThanOrEqual(3);
    await expect(detail.getByText('Reading opening history…')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close Host menu' }).click();
    await expect(detail).toHaveCount(0);
  } finally {
    for (const release of held) release();
  }
});

test('disconnect and a new account ignore a slow balance from the previous wallet', async ({
  page,
}) => {
  const { chain, calls } = await mockCaseTestnet(page);
  chain.claimed = true;
  let oldStarted = false;
  let oldFinished = false;
  let releaseOld = () => {};
  const holdOld = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  await page.route(testnet.rpcUrl + '/', async (route) => {
    if (route.request().method() === 'POST') {
      const { params } = route.request().postDataJSON();
      if (params?.method_name === 'ft_balance_of') {
        const { account_id } = JSON.parse(
          Buffer.from(params.args_base64, 'base64').toString(),
        );
        if (account_id === 'tea-guest.testnet') {
          oldStarted = true;
          await holdOld;
          await route.fallback().catch(() => {});
          oldFinished = true;
          return;
        }
        await route.fulfill({
          headers: { 'access-control-allow-origin': '*' },
          json: {
            jsonrpc: '2.0',
            id: 'iroh-cases',
            result: { result: [...Buffer.from('"23000000"')] },
          },
        });
        return;
      }
    }
    await route.fallback();
  });
  const detail = await openInspection(page);
  try {
    await connectWallet(page);
    await expect.poll(() => oldStarted).toBe(true);
    await page.getByTestId('wallet-entry').click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(
      detail.getByText('tea-guest.testnet', { exact: true }),
    ).toHaveCount(0);
    await expect(detail.getByText('1000 USDI available')).toBeVisible();
    await page.evaluate(() =>
      localStorage.setItem('fake-near-wallet-account', 'other-guest.testnet'),
    );
    await connectWallet(page);
    await expect(
      detail.getByText('other-guest.testnet', { exact: true }),
    ).toBeVisible();
    await expect(detail.locator('.tea-catalog-wallet-head strong')).toHaveText(
      '23 USDI',
    );
    releaseOld();
    await expect.poll(() => oldFinished).toBe(true);
    await expect(
      detail.getByRole('button', { name: 'Refresh chain state' }),
    ).toBeEnabled();
    await expect(detail.locator('.tea-catalog-wallet-head strong')).toHaveText(
      '23 USDI',
    );
    expect(calls).toHaveLength(0);
  } finally {
    releaseOld();
  }
});

test('recovers a redirected claim receipt and never sends a second claim', async ({
  page,
}) => {
  const { chain, calls } = await mockCaseTestnet(page);
  chain.claimFinal = false;
  chain.redirectClaim = true;
  const detail = await openInspection(page);
  await connectWallet(page);
  const claim = detail.getByRole('button', { name: 'Claim 1,000 USDI' });
  await expect(claim).toBeEnabled();
  await claim.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page).toHaveURL(/transactionHashes=/);
  await expect(
    detail.getByText(/Could not confirm the transaction yet/),
  ).toBeVisible();
  await expect(detail.locator('.tea-catalog-wallet-head strong')).toHaveText(
    '0 USDI',
  );
  await expect(claim).toBeDisabled();
  expect(calls).toHaveLength(1);
  chain.claimFinal = true;
  await detail.getByRole('button', { name: 'Refresh chain state' }).click();
  await expect(detail.getByText('Starter USDI already claimed.')).toBeVisible();
  await expect(detail.locator('.tea-catalog-wallet-head strong')).toHaveText(
    '1000 USDI',
  );
  await expect(
    detail.getByText('Transaction finalized successfully on Testnet.'),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/transactionHashes=/);
  expect(calls).toHaveLength(1);
});

test('unmount cancels an in-flight wallet read and reopening starts a fresh read', async ({
  page,
}) => {
  const { chain } = await mockCaseTestnet(page);
  chain.claimed = true;
  let reads = 0;
  let cancelled = false;
  page.on('requestfailed', (request) => {
    if (
      request.method() === 'POST' &&
      request.url() === testnet.rpcUrl + '/' &&
      request.postDataJSON().params?.method_name === 'ft_balance_of'
    )
      cancelled = true;
  });
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(testnet.rpcUrl + '/', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON().params?.method_name === 'ft_balance_of' &&
      ++reads === 1
    ) {
      await hold;
      await route.fallback().catch(() => {});
    } else await route.fallback();
  });
  const detail = await openInspection(page);
  try {
    await connectWallet(page);
    await expect.poll(() => reads).toBe(1);
    await expect(detail.getByText('Reading USDI balance…')).toBeVisible();
    await page.getByRole('button', { name: 'Close Host menu' }).click();
    await expect(detail).toHaveCount(0);
    await expect.poll(() => cancelled).toBe(true);
    await page
      .getByRole('button', { name: 'Explore the Tea Collection' })
      .click();
    await page.getByRole('button', { name: 'Inspect Dragon Tea Case' }).click();
    await expect(detail.locator('.tea-catalog-wallet-head strong')).toHaveText(
      '1000 USDI',
    );
    expect(reads).toBe(2);
  } finally {
    release();
  }
});
