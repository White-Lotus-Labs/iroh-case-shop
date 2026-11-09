import { expect, test } from '@playwright/test';
import testnet from '../../config/contracts.testnet.json' with { type: 'json' };
import { waitForRoomReady, waitForDockReady } from './room-helpers';
import { FAKE_WALLET } from './wallet-fixture';

test.beforeEach(async ({ page }) => {
  await page.route('**/repository/manifest.json', (route) =>
    route.fulfill({ json: { version: '1.0.0', wallets: [] } }),
  );
  await page.route(testnet.rpcUrl + '/', (route) =>
    route.fulfill({
      status: 503,
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
});

test('cases with unavailable RPC show no invented data and cannot request signatures', async ({
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
    page.getByRole('alert').filter({ hasText: 'Could not read pool data.' }),
  ).toHaveText('Could not read pool data. Testnet RPC unavailable (HTTP 503).');
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
  ).toBeEnabled();
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
  await page.setViewportSize({ width: 320, height: 844 });
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
        throw new Error('No signing expected when the RPC is unavailable');
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
  const connectedBounds = await page.getByTestId('wallet-entry').boundingBox();
  if (!connectedBounds)
    throw new Error('Connected wallet has no visible bounds');
  expect(connectedBounds.x + connectedBounds.width).toBeLessThanOrEqual(320);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
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
    const cases = page.getByRole('button', { name: 'Dragon Tea Cases' });
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
      page.getByRole('heading', { name: 'The Tea Collection', exact: true }),
    ).toBeVisible({ timeout: 45000 });
    expect(new URL(page.url()).pathname).toBe('/');
  });
}

test('standalone Cases scrolls and receives input before and after wallet authorization', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(FAKE_WALLET);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/cases');
  const wallet = page.getByTestId('wallet-entry');
  const popup = page.locator('.hot-connector-popup');
  const refresh = page.getByRole('button', { name: 'Refresh chain state' });

  async function expectUsablePage() {
    await expect(popup).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(150, 450);
    await page.mouse.wheel(0, 450);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    await refresh.click();
    await expect(refresh).toBeEnabled();
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  await expectUsablePage();
  await page.evaluate(() =>
    localStorage.setItem('fake-near-wallet-mode', 'reject'),
  );
  await wallet.click();
  await popup.locator('.connect-item').click();
  await expect(wallet).toBeEnabled();
  await expectUsablePage();

  await page.evaluate(() =>
    localStorage.setItem('fake-near-wallet-mode', 'delay'),
  );
  await wallet.click();
  await popup.locator('.connect-item').click();
  await expect(wallet).toBeDisabled();
  await expect(wallet).toContainText('tea-guest.testnet');
  await expectUsablePage();

  await page.reload();
  await expect(wallet).toContainText('tea-guest.testnet');
  await expectUsablePage();
  await wallet.click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(wallet).toBeFocused();
  await expectUsablePage();
  expect(errors).toEqual([]);
});

test('standalone Cases accepts keyboard scroll when no wallet is available', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/cases');
  const wallet = page.getByTestId('wallet-entry');
  await wallet.click();
  await expect(
    page.getByText(/Could not reach the NEAR wallet picker/),
  ).toBeVisible();
  await expect(page.locator('.hot-connector-popup')).toHaveCount(0);
  await page.locator('h1').click();
  await page.keyboard.press('PageDown');
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Refresh chain state' }).click();
});
