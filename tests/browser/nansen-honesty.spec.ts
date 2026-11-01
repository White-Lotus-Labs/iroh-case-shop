import { expect, test, type Page } from '@playwright/test';
import { beginVisit, openStationPanel } from './room-helpers';

async function openShelf(page: Page) {
  await beginVisit(page);
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Shelf/ })
    .click();
  await page.getByRole('button', { name: 'See the top traders' }).click();
}

test('unconfigured Nansen stays honest on status, Host, and Shelf', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/nansen-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nansen: 'unavailable' }),
    }),
  );
  await page.route('**/api/smart-wallet-leaderboard', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Nansen API is not configured.' }),
    }),
  );

  await page.goto('/');
  await beginVisit(page);
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-nansen',
    'unavailable',
  );

  const status = page.getByRole('button', { name: 'Data source status' });
  await status.hover();
  const popup = page.locator('.status-popup');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Thesis');
  await expect(popup).toContainText('Offline');
  await expect(popup).toContainText('Uncle');
  await expect(popup).not.toContainText('Demo data');
  await expect(popup).not.toContainText('Live');
  await expect(popup).not.toContainText('Nansen Research');
  await expect(popup).not.toContainText('Live Nansen');

  await openStationPanel(page, 'Host');
  const chat = page.locator('.iroh-chat');
  await expect(chat).toContainText('Nansen research is offline');
  await expect(chat).not.toContainText('Powered by Nansen');
  await expect(chat).not.toContainText('Fast mode');
  await expect(chat).not.toContainText('consult Nansen');
  await expect(chat).not.toContainText('I’ll consult');
  await expect(chat).not.toContainText('Live');

  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Counter/ })
    .click();
  await page.getByRole('button', { name: 'Open the Thesis Desk' }).click({
    timeout: 20000,
  });
  await expect(
    page.getByRole('heading', { name: 'Thesis Desk' }),
  ).toBeVisible();

  await openShelf(page);
  const parchment = page.getByTestId('leaderboard-parchment');
  await expect(parchment).toContainText('Nansen research is offline.');
  await expect(
    page.getByRole('button', { name: 'Try again', exact: true }),
  ).toBeVisible();
  await expect(parchment).not.toContainText('Top 10 Smart Wallets');
  await expect(parchment).not.toContainText('Illustrated ranks');
  await expect(parchment).not.toContainText('refreshes every 30 min');
  await expect(parchment).not.toContainText('Reading the Nansen');
});

test('a configured Nansen status keeps the live Host, status, and Shelf framing', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/nansen-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nansen: 'configured' }),
    }),
  );
  await page.route('**/api/smart-wallet-leaderboard', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: [
          {
            rank: 1,
            address: `0x${'a'.repeat(40)}`,
            displayName: 'Observed Trader',
            pnl: 1_820_000,
            roi: 0.274,
            accountValue: 4_600_000,
          },
        ],
        fetchedAt: '2026-09-25T12:00:00.000Z',
        expiresAt: '2099-09-25T12:30:00.000Z',
        source: 'nansen',
        stale: false,
      }),
    }),
  );

  await page.goto('/');
  await beginVisit(page);
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-nansen',
    'configured',
  );
  await page.getByRole('button', { name: 'Data source status' }).hover();
  const popup = page.locator('.status-popup');
  await expect(popup).toContainText('Thesis');
  await expect(popup).toContainText('Saved hourly');
  await expect(popup).toContainText('Uncle');
  await expect(popup).toContainText('Live · Nansen Research');
  await expect(popup).not.toContainText('Demo data');
  await expect(popup).not.toContainText('Offline');

  await openStationPanel(page, 'Host');
  const chat = page.locator('.iroh-chat');
  await expect(chat).toContainText('Live Nansen research · Fast mode');
  await expect(chat).toContainText('I’ll consult Nansen’s Research Agent');

  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Counter/ })
    .click();
  await page.getByRole('button', { name: 'Open the Thesis Desk' }).click({
    timeout: 20000,
  });
  await expect(
    page.getByRole('heading', { name: 'Thesis Desk' }),
  ).toBeVisible();

  await openShelf(page);
  const parchment = page.getByTestId('leaderboard-parchment');
  await expect(
    page.getByRole('heading', {
      name: /Top Hyperliquid Traders by 30-Day PnL/,
    }),
  ).toBeVisible();
  await expect(parchment).toContainText('Illustrated ranks');
  await expect(parchment).not.toContainText('Nansen research is offline.');
});
