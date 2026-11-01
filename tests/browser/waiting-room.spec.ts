import { test, expect } from '@playwright/test';

test('waiting room holds the door until the room is ready, then steps inside', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const room = page.locator('.waiting-room');
  await expect(room).toBeVisible();
  await expect(
    room.getByRole('link', { name: 'Source on GitHub' }),
  ).toHaveAttribute('href', /github\.com\/White-Lotus-Labs/);

  const enter = room.getByRole('button', { name: 'Enter Teashop' });
  // Headless WebGL compiles the scene slowly.
  await expect(enter).toBeEnabled({ timeout: 90_000 });
  await expect(room.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
  await expect(room.getByRole('status')).toHaveText('The tea is ready.');

  await enter.click();
  await expect(page.locator('main')).toHaveAttribute('data-station', 'Counter');
  // Leaving waits on a timer; software WebGL can starve it for seconds.
  await expect(room).toHaveCount(0, { timeout: 20_000 });
  await expect(
    page.getByRole('navigation', { name: 'Tea room stations' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
