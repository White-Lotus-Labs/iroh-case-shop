import { expect, test, type Page } from '@playwright/test';
import { waitForRoomReady, waitForDockReady } from './room-helpers';

import { FAKE_WALLET } from './wallet-fixture';

async function openRoom(page: Page) {
  // The wallet manifest is fetched from GitHub; serve it locally so the test
  // never depends on the network.
  await page.route('**/repository/manifest.json', (route) =>
    route.fulfill({ json: { version: '1.0.0', wallets: [] } }),
  );
  await page.addInitScript(FAKE_WALLET);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // A deep link skips the waiting room, which covers and disables the top bar.
  await page.goto('/?thesis=ai');
  await waitForRoomReady(page);
  await waitForDockReady(page);
}

test.beforeEach(async ({ page }) => {
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !/Failed to load resource:.*503/.test(message.text())
    ) {
      throw new Error(`Unexpected browser console error: ${message.text()}`);
    }
  });
});

test('shows Connect Wallet by default and opens the wallet picker once', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openRoom(page);

  const button = page.getByTestId('wallet-entry');
  await expect(button).toBeVisible();
  await expect(button).toContainText('Connect Wallet');

  await button.click();
  const popup = page.locator('.hot-connector-popup .modal-content');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Select wallet');
  await expect(popup).toContainText('Fake Testnet Wallet');
  await expect(popup).toHaveCount(1);

  // A second press while the picker is open must not open a second modal.
  await button.click({ force: true });
  await expect(page.locator('.hot-connector-popup')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('.hot-connector-popup')).toHaveCount(0);
  await expect(page.getByText('Wallet connection cancelled.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('connects, restores after refresh, then disconnects for good', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openRoom(page);

  const button = page.getByTestId('wallet-entry');
  await button.click();
  await page.locator('.hot-connector-popup .connect-item').click();

  // The account id replaces the connect label.
  await expect(button).toContainText('tea-guest.testnet');
  await expect(page.getByText('Connect Wallet')).toHaveCount(0);

  // The full id stays readable in the slip, not just the abbreviated one.
  await button.click();
  await expect(page.getByTestId('wallet-account')).toHaveText(
    'tea-guest.testnet',
  );
  await page.keyboard.press('Escape');

  // A reload restores the wallet session without opening the picker.
  await page.reload();
  await waitForRoomReady(page);
  await expect(page.getByTestId('wallet-entry')).toContainText(
    'tea-guest.testnet',
  );
  await expect(page.locator('.hot-connector-popup')).toHaveCount(0);

  await page.getByTestId('wallet-entry').click();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByTestId('wallet-entry')).toContainText(
    'Connect Wallet',
  );

  await expect(page.getByTestId('wallet-entry')).toBeFocused();

  // The disconnect persists: a refresh shows the guest state again.
  await page.reload();
  await waitForRoomReady(page);
  await expect(page.getByTestId('wallet-entry')).toContainText(
    'Connect Wallet',
  );
  expect(errors).toEqual([]);
});

test('keeps the header usable on a narrow screen', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoom(page);

  const button = page.getByTestId('wallet-entry');
  await expect(button).toBeVisible();
  // Below 760px the label collapses to an icon button like its neighbours.
  await expect(button).toHaveCSS('width', '44px');
  await expect(button.locator('span').first()).toBeHidden();
  const box = await button.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});

test('disables connection while authorization is pending', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() =>
    localStorage.setItem('fake-near-wallet-mode', 'delay'),
  );
  const button = page.getByTestId('wallet-entry');
  await button.click();
  await page.locator('.hot-connector-popup .connect-item').click();
  await expect(button).toBeDisabled();
  await expect(button).toContainText('Connecting');
  await expect(button).toContainText('tea-guest.testnet', { timeout: 10_000 });
  await expect(button).toBeEnabled();
});

test('returns to the guest state when wallet authorization is rejected', async ({
  page,
}) => {
  await openRoom(page);
  await page.evaluate(() =>
    localStorage.setItem('fake-near-wallet-mode', 'reject'),
  );
  const button = page.getByTestId('wallet-entry');
  await button.click();
  await page.locator('.hot-connector-popup .connect-item').click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Wallet connection cancelled.' }),
  ).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).toContainText('Connect Wallet');
});
