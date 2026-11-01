import { expect, type Page } from '@playwright/test';

/**
 * Wait until the waiting room reports the 3D room is ready, or until a deep
 * link has already left the entrance. SceneLoader is not mounted.
 */
export async function waitForRoomReady(page: Page) {
  await expect
    .poll(
      async () => {
        const station = await page.locator('main').getAttribute('data-station');
        // Deep links leave Entrance without enabling Enter Teashop.
        if (station && station !== 'Entrance') return 'inside';
        const enter = page.getByRole('button', { name: 'Enter Teashop' });
        if ((await enter.count()) === 0) return 'gone';
        if (await enter.isEnabled()) return 'ready';
        return 'loading';
      },
      { timeout: 90_000 },
    )
    .not.toBe('loading');
}

/** Wait for the dock unroll animation so rollers stop intercepting clicks. */
export async function waitForDockReady(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Tea room stations' });
  await expect(nav).toBeVisible();
  await expect
    .poll(
      () =>
        nav.evaluate(
          (el) =>
            el
              .getAnimations({ subtree: true })
              .filter(
                (a) =>
                  a.playState === 'running' &&
                  a.effect?.getTiming().iterations !== Infinity,
              ).length,
        ),
      { timeout: 30000 },
    )
    .toBe(0);
}

/** Leave the waiting room and show the station dock. */
export async function beginVisit(page: Page) {
  await waitForRoomReady(page);
  const enter = page.getByRole('button', { name: 'Enter Teashop' });
  const station = await page.locator('main').getAttribute('data-station');
  if (station === 'Entrance' && (await enter.count())) {
    await expect(enter).toBeEnabled({ timeout: 90_000 });
    await enter.click();
    await expect(page.locator('.waiting-room')).toHaveCount(0, {
      timeout: 20_000,
    });
    await waitForDockReady(page);
  }
}

/** Dock to a panel station, wait for arrival, then open the panel. */
export async function openStationPanel(
  page: Page,
  station: 'Counter' | 'Host',
) {
  await beginVisit(page);
  const label = station === 'Host' ? /Host/ : /Counter/;
  const nav = page.getByRole('navigation', { name: 'Tea room stations' });
  await nav.getByRole('button', { name: label }).click();
  // exact: Host dock caption is also "Ask Uncle", so a substring match hits both.
  const open =
    station === 'Host'
      ? page.getByRole('button', { name: 'Ask Uncle', exact: true })
      : page.getByRole('button', { name: 'Open the Thesis Desk' });
  await expect(open).toBeVisible({ timeout: 45000 });
  await open.click();
}
