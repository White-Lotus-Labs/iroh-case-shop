import { expect, test } from '@playwright/test';
import { waitForRoomReady, waitForDockReady } from './room-helpers';

test.beforeEach(async ({ page }) => {
  await page.route('**/repository/manifest.json', (route) =>
    route.fulfill({ json: { version: '1.0.0', wallets: [] } }),
  );
});

test('undeployed cases show no invented chain data and cannot request signatures', async ({
  page,
}) => {
  const walletRequests: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('CASE_TEST_SIGN'))
      walletRequests.push(message.text());
  });
  await page.goto('/cases');
  await expect(
    page.getByRole('heading', { name: 'Let the tea leaves decide.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Testnet contracts are not deployed' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open Dragon Tea · 1 USDI' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Claim 1,000 starter USDI' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: "Prepay one opening's storage" }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Refresh chain state' }),
  ).toBeDisabled();
  await expect(page.locator('.cases-balance')).toHaveText('— USDI');
  await expect(page.locator('.cases-tier b')).toHaveText(['—', '—', '—']);
  await expect(
    page.getByText(
      'USDI is a Testnet currency with no USD backing and no real monetary value.',
    ),
  ).toBeVisible();
  await expect(page.getByText(/not production-grade VRF/)).toBeVisible();
  await expect(page.getByTestId('wallet-entry')).toBeEnabled();
  expect(walletRequests).toEqual([]);
});

test('cases reuse the root Testnet wallet session through reload and disconnect', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const id = 'cases-browser-wallet';
    if (sessionStorage.getItem('cases-test-initialized') !== 'yes') {
      localStorage.setItem('selected-wallet', id);
      localStorage.setItem('cases-test-session', 'connected');
      sessionStorage.setItem('cases-test-initialized', 'yes');
    }
    const accounts = () =>
      localStorage.getItem('cases-test-session') === 'connected'
        ? [{ accountId: 'tea-guest.testnet' }]
        : [];
    const wallet = {
      manifest: {
        id,
        name: 'Cases browser wallet',
        icon: '',
        description: 'Browser test',
        website: 'https://example.test',
        version: '1',
        executor: '',
        type: 'injected',
        platform: {},
        permissions: {},
        features: {
          signMessage: false,
          signTransaction: false,
          signAndSendTransaction: true,
          signAndSendTransactions: false,
          signInWithoutAddKey: true,
          signInAndSignMessage: false,
          signInWithFunctionCallKey: false,
          signDelegateActions: false,
          mainnet: false,
          testnet: true,
        },
      },
      async getAccounts({ network }: { network: string }) {
        if (network !== 'testnet') throw new Error('Wrong network');
        return accounts();
      },
      async signIn() {
        return accounts();
      },
      async signOut() {
        localStorage.removeItem('cases-test-session');
      },
      async signAndSendTransaction() {
        console.log('CASE_TEST_SIGN');
        throw new Error('No signing expected while undeployed');
      },
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent('near-wallet-injected', { detail: wallet }),
      );
    window.addEventListener('near-selector-ready', announce);
    document.addEventListener('near-selector-ready', announce);
  });
  await page.goto('/cases');
  await expect(page.getByTestId('wallet-entry')).toContainText(
    'tea-guest.testnet',
  );
  await expect(
    page.getByRole('button', { name: 'Claim 1,000 starter USDI' }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId('wallet-entry')).toContainText(
    'tea-guest.testnet',
  );
  await page.getByTestId('wallet-entry').click();
  await expect(page.getByTestId('wallet-account')).toHaveText(
    'tea-guest.testnet',
  );
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByTestId('wallet-entry')).toContainText(
    'Connect Wallet',
  );
  await expect(
    page.getByRole('button', { name: 'Open Dragon Tea · 1 USDI' }),
  ).toBeDisabled();
});

for (const width of [390, 320]) {
  test(`cases keep branding and the wallet within a ${width}px viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/cases');
    await expect(
      page.getByRole('link', { name: "Iroh's Case Shop" }),
    ).toBeVisible();
    const wallet = page.getByTestId('wallet-entry');
    await expect(wallet).toBeVisible();
    await expect(wallet).toBeEnabled();
    const bounds = await wallet.boundingBox();
    if (!bounds) throw new Error('Wallet has no visible bounds');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

for (const width of [390, 320]) {
  test(`tea room keeps Cases navigation and the wallet visible at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?thesis=ai');
    await waitForRoomReady(page);
    await waitForDockReady(page);
    const cases = page.getByRole('link', { name: 'Dragon Tea Cases' });
    const wallet = page.getByTestId('wallet-entry');
    await expect(cases).toBeVisible();
    await expect(wallet).toBeEnabled();
    for (const control of [cases, wallet]) {
      const bounds = await control.boundingBox();
      if (!bounds) throw new Error('Header control has no visible bounds');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await cases.click();
    await expect(
      page.getByRole('heading', { name: 'Dragon Tea Case', exact: true }),
    ).toBeVisible();
  });
}
