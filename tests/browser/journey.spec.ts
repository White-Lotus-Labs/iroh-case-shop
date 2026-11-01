import { test, expect } from '@playwright/test';
import { DECK_FIXTURE } from '../../src/thesis/fixtures';
import { registerBrowserAccount } from './auth-helper';
import { beginVisit, openStationPanel } from './room-helpers';

test.beforeEach(async ({ page }) => {
  await registerBrowserAccount(page);
  await page.route('**/api/smart-wallet-leaderboard', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: [],
        fetchedAt: '2026-09-25T12:00:00.000Z',
        expiresAt: '2099-09-25T12:30:00.000Z',
        source: 'nansen',
        stale: false,
      }),
    }),
  );
});

test('Entrance to Counter shows the thesis desk placeholder', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute(
    'data-station',
    'Entrance',
  );
  await beginVisit(page);
  await expect(page.locator('main')).toHaveAttribute('data-station', 'Counter');
  await page.getByRole('button', { name: 'Open the Thesis Desk' }).click({
    timeout: 20000,
  });
  await expect(
    page.getByRole('heading', { name: 'Thesis Desk' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Robinhood Chain Tokenization' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Ask Uncle about your own thesis' })
    .click();
  await expect(page.locator('main')).toHaveAttribute(
    'data-station',
    'AvatarSeat',
  );
  await expect(page.getByRole('heading', { name: 'Ask Uncle' })).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Ask an onchain research question' }),
  ).toHaveValue('Uncle, test my thesis: ');
  expect(errors).toEqual([]);
});

test('dock navigation keeps panels closed until Open is used', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await beginVisit(page);
  const nav = page.getByRole('navigation', { name: 'Tea room stations' });
  for (const name of ['Observatorium', 'Host', 'Shelf', 'Counter']) {
    await nav.getByRole('button', { name: new RegExp(name) }).click();
    await expect(
      nav.getByRole('button', { name: new RegExp(name) }),
    ).toHaveAttribute('aria-current', 'step');
    if (name === 'Observatorium') {
      const modelButton = page.getByRole('button', {
        name: 'Open the planetary model',
      });
      await expect(modelButton).toBeVisible({ timeout: 45000 });
      // The camera-settled halo adds its own label, but must not remove the
      // explanatory line from the persistent dock button.
      await expect(modelButton.locator('.panel-open-hint-teaser')).toBeVisible({
        timeout: 45000,
      });
    }
  }
  await expect(page.getByRole('heading', { name: 'Thesis Desk' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Open the Thesis Desk' }).click({
    timeout: 20000,
  });
  await expect(
    page.getByRole('heading', { name: 'Thesis Desk' }),
  ).toBeVisible();
});

test('Host panel stays open after an explicit open', async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openStationPanel(page, 'Host');
  await expect(page.getByRole('heading', { name: 'Ask Uncle' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole('heading', { name: 'Ask Uncle' })).toBeVisible();
});

test('mobile layout remains readable and the WebGL fallback preserves the journey', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      id: string,
      ...args: unknown[]
    ) {
      if (id.startsWith('webgl')) return null;
      return getContext.apply(this, [id, ...args] as Parameters<
        typeof getContext
      >);
    } as typeof getContext;
  });
  await page.goto('/');
  await expect(page.getByText('The room is resting.')).toBeVisible();
  // Nothing behind the waiting room is reachable or read out.
  await expect(page.getByText('is only the beginning.')).toHaveCount(0);
  await expect(page.locator('.topbar')).toHaveAttribute('inert', '');
  await beginVisit(page);
  await expect(
    page.getByRole('button', { name: 'Open the Thesis Desk' }),
  ).toBeFocused();
  await expect(page.locator('.topbar')).not.toHaveAttribute('inert');

  // The desk fetches even without a key, and Try again recovers it.
  let deckStatus = 503;
  await page.route('**/api/theses', (route) =>
    deckStatus === 200
      ? route.fulfill({ json: DECK_FIXTURE })
      : route.fulfill({
          status: 503,
          json: { error: 'Nansen is unavailable right now.' },
        }),
  );
  await page.keyboard.press('Enter');
  const status = page.locator('.deck-status');
  await expect(status).toHaveText(/^Nansen is unavailable right now\./);
  deckStatus = 200;
  await status.getByRole('button', { name: 'Try again' }).click();
  await expect(status).toContainText('Saved Nansen readings');

  // Asking Uncle about a thesis, then docking back, reopens that thesis.
  await page
    .getByRole('button', { name: /Open The Crypto Bull Market/ })
    .click();
  await page
    .getByRole('button', { name: 'Ask Uncle about this thesis' })
    .click();
  await expect(page.locator('main')).toHaveAttribute(
    'data-station',
    'AvatarSeat',
  );
  // Keyboard: the dev overlay badge can sit over this dock button.
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Counter/ })
    .press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'The Crypto Bull Market' }),
  ).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Shelf/ })
    .click();
  await page.getByRole('button', { name: 'See the top traders' }).click();
  await expect(
    page.getByRole('heading', {
      name: /Top Hyperliquid Traders by 30-Day PnL/,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator('.reading-panel')).toBeFocused();

  // Closing the Shelf leaves a keyboard way back in.
  const approach = page.getByRole('button', { name: 'See the top traders' });
  await page.getByRole('button', { name: 'Close Shelf menu' }).click();
  await expect(page.getByTestId('leaderboard-parchment')).toHaveCount(0);
  await expect(approach).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('leaderboard-parchment')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('leaderboard-parchment')).toHaveCount(0);
  await expect(approach).toBeFocused();

  // Escape with the Uncle field focused closes Host and keeps the draft.
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Host/ })
    .click();
  const askUncle = page.getByRole('button', { name: 'Ask Uncle', exact: true });
  await askUncle.click();
  const box = page.getByRole('textbox', {
    name: 'Ask an onchain research question',
  });
  await box.fill('Is SOL');
  await expect(box).toBeFocused();
  await box.press('Escape');
  await expect(box).toHaveCount(0);
  await askUncle.click();
  await expect(box).toHaveValue('Is SOL');
  // × still closes. An empty focused composer closes too.
  await page.getByRole('button', { name: 'Close Host menu' }).click();
  await expect(box).toHaveCount(0);
  await askUncle.click();
  await box.fill('');
  await expect(box).toBeFocused();
  await box.press('Escape');
  await expect(box).toHaveCount(0);
});
