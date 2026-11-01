import { test, expect } from '@playwright/test';
import { beginVisit } from './room-helpers';

test('the open hint keeps its name, describes the teaser, and gets focus back after the roll-up', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await beginVisit(page);
  const hint = page.getByRole('button', {
    name: 'Open the Thesis Desk',
    exact: true,
  });
  await expect(hint).toBeVisible({ timeout: 45000 });
  await expect(hint).toHaveAccessibleDescription(
    'Choose a thesis. See whether smart money supports it.',
  );
  await expect(page.locator('.halo-label')).toBeAttached({ timeout: 15000 });
  // The teaser stays in the hint while the in-world label shows (e2d8f8b).
  await expect(page.locator('.panel-open-hint-teaser')).toBeVisible();
  await hint.click();
  await expect(
    page.getByRole('heading', { name: 'Thesis Desk' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close Counter menu' }).click();
  await expect(page.locator('.reading-panel')).toHaveClass(/is-rolling-up/);
  await expect(hint).toBeFocused({ timeout: 5000 });
  await expect(page.locator('.reading-panel')).toHaveCount(0);

  // Re-clicking the current dock station must not hide the open hint.
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Counter/ })
    .click();
  await expect(hint).toBeVisible();
});
