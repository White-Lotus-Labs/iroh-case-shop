import { test, expect } from '@playwright/test';
import { registerBrowserAccount } from './auth-helper';
import { beginVisit } from './room-helpers';

test.beforeEach(async ({ page }) => {
  await registerBrowserAccount(page);
  await page.route('**/api/smart-wallet-leaderboard', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Nansen API is not configured.' }),
    }),
  );
});

const stations = ['Counter', 'Observatorium', 'Host', 'Shelf'];

test('all directed station transitions and rapid interruptions preserve navigation', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await beginVisit(page);
  await page.locator('canvas').waitFor();
  const nav = page.getByRole('navigation', { name: 'Tea room stations' });
  for (const from of stations)
    for (const to of stations) {
      if (from === to) continue;
      await nav.getByRole('button', { name: new RegExp(from) }).click();
      await page.waitForTimeout(150);
      await nav.getByRole('button', { name: new RegExp(to) }).click();
      await page.waitForTimeout(150);
      await expect(
        nav.getByRole('button', { name: new RegExp(to) }),
      ).toHaveAttribute('aria-current', 'step');
    }
  for (const station of [
    'Shelf',
    'Counter',
    'Host',
    'Observatorium',
    'Shelf',
    'Counter',
  ]) {
    await nav.getByRole('button', { name: new RegExp(station) }).click();
    await page.waitForTimeout(70);
  }
  await expect(page.locator('main')).toHaveAttribute('data-station', 'Counter');
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('OS reduced motion sets data-motion reduce; full motion restores panel animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await beginVisit(page);
  await expect(page.locator('main')).toHaveAttribute('data-motion', 'reduce');
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Host/ })
    .click();
  await page
    .getByRole('button', { name: 'Ask Uncle', exact: true })
    .click({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Ask Uncle' })).toBeVisible();
  expect(
    await page
      .locator('.reading-panel')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
});

test('system full motion keeps paper-arrive on the Host panel', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await beginVisit(page);
  await expect(page.locator('main')).toHaveAttribute('data-motion', 'full');
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Host/ })
    .click();
  await page
    .getByRole('button', { name: 'Ask Uncle', exact: true })
    .click({ timeout: 45000 });
  expect(
    await page
      .locator('.reading-panel')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('paper-arrive');
});
