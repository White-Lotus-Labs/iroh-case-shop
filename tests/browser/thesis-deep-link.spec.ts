import { test, expect } from '@playwright/test';
import { DECK_FIXTURE } from '../../src/thesis/fixtures';
import { waitForRoomReady, waitForDockReady } from './room-helpers';

test('?thesis=ai lands on Counter, opens the panel, and scrolls the AI thesis', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/nansen-status', (route) =>
    route.fulfill({ json: { nansen: 'configured' } }),
  );
  await page.route('**/api/theses', (route) =>
    route.fulfill({ json: DECK_FIXTURE }),
  );
  await page.route('**/api/theses/*/*', (route) =>
    route.fulfill({
      json: {
        thesisId: 'ai',
        symbol: 'NVDA',
        fetchedAt: '2026-09-27T06:00:00.000Z',
        stale: false,
        movements: { status: 'empty' },
        holders: { status: 'empty' },
        supply: { status: 'empty' },
        perps: { status: 'not-applicable' },
      },
    }),
  );

  await page.goto('/?thesis=ai');
  await waitForRoomReady(page);
  // Deep link skips the entrance hero and docks at Counter.
  await expect(page.locator('main')).toHaveAttribute('data-station', 'Counter');
  await waitForDockReady(page);

  await expect(page.getByRole('heading', { name: 'Thesis Desk' })).toBeVisible({
    timeout: 45000,
  });
  const scroll = page.getByRole('dialog', {
    name: 'AI Taking Over the World',
  });
  await expect(scroll).toBeVisible({ timeout: 45000 });
  // Skipping the waiting room still loads the 3D host.
  await expect(page.locator('canvas[data-iroh-host="model"]')).toHaveCount(1, {
    timeout: 45000,
  });
});
