import { test, expect, type Page } from '@playwright/test';
import { DECK_FIXTURE, TICKER_DETAIL_FIXTURE } from '../../src/thesis/fixtures';
import { registerBrowserAccount } from './auth-helper';
import { beginVisit } from './room-helpers';

// Begin lands on the Counter; re-clicking its dock button would reset the
// camera and hide the Open the Thesis Desk hint, so open the panel directly.
async function openCounter(page: Page) {
  await page.goto('/');
  await beginVisit(page);
  const hint = page.getByRole('button', { name: 'Open the Thesis Desk' });
  await expect(hint).toBeVisible({ timeout: 45000 });
  // The hint idles with a gentle motion, so skip the stability wait.
  await hint.click({ force: true });
}

async function mockNansen(page: Page, deckStatus = 200) {
  await page.route('**/api/nansen-status', (route) =>
    route.fulfill({ json: { nansen: 'configured' } }),
  );
  await page.route('**/api/theses', (route) =>
    deckStatus === 200
      ? route.fulfill({ json: DECK_FIXTURE })
      : route.fulfill({
          status: deckStatus,
          json: { error: 'Nansen is not configured.' },
        }),
  );
  await page.route('**/api/theses/*/*', (route) =>
    route.fulfill({ json: TICKER_DETAIL_FIXTURE }),
  );
}

test.beforeEach(async ({ page }) => {
  await registerBrowserAccount(page);
});

test('Counter deck opens a thesis in the panel, expands a leaf, and hands off to Uncle', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockNansen(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A saved chat makes the Host restore it; the hand-off prefill must survive.
  await page.request.post('/api/iroh/chats');
  await openCounter(page);

  const books = page.locator('.deck-book');
  await expect(books).toHaveCount(3);
  await expect(
    page.getByRole('button', {
      name: /Open The Crypto Bull Market.*Strong conviction, 4 of 4 accumulating/,
    }),
  ).toBeVisible();
  await expect(page.locator('.deck-status')).toContainText(
    'Saved Nansen readings',
  );

  const aiBook = page.getByRole('button', {
    name: /Open AI Taking Over the World/,
  });
  await aiBook.click();
  const scroll = page.getByRole('dialog', { name: 'AI Taking Over the World' });
  await expect(scroll).toBeVisible();
  await expect(scroll).toContainText(
    'Smart money is accumulating 1 of 4 assets (3 with data).',
  );

  const nvda = scroll.getByRole('button', { name: /NVDA/ });
  await expect(nvda).toHaveAttribute('aria-expanded', 'false');
  await nvda.click();
  await expect(nvda).toHaveAttribute('aria-expanded', 'true');
  await expect(scroll.getByText('Who is buying and selling')).toBeVisible();
  await expect(scroll.getByText('4,812')).toBeVisible();
  await expect(scroll.getByText('Perpetuals positioning')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(scroll).toHaveCount(0);
  await expect(aiBook).toBeFocused();
  await expect(
    page.getByRole('heading', { name: 'Thesis Desk' }),
  ).toBeVisible();

  await aiBook.click();
  await page
    .getByRole('dialog', { name: 'AI Taking Over the World' })
    .getByRole('button', { name: 'Ask Uncle about this thesis' })
    .click();
  await expect(page.locator('main')).toHaveAttribute(
    'data-station',
    'AvatarSeat',
  );
  const composer = page.getByRole('textbox', {
    name: 'Ask an onchain research question',
  });
  // Enabled means the saved-chat restore ran, so the prefill survived it.
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue(
    'Uncle, conviction on “AI Taking Over the World” is weak. What could disprove it?',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('deck shows an honest offline state when Nansen answers 503', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockNansen(page, 503);
  await openCounter(page);
  await expect(page.locator('.deck-status')).toContainText(
    'Nansen is not configured.',
  );
  await expect(
    page.locator('.deck-status').getByRole('button', { name: 'Try again' }),
  ).toBeVisible();
  await expect(
    page.locator('.plaque-level', { hasText: 'Offline' }),
  ).toHaveCount(3);
  await page
    .getByRole('button', { name: /Open The Crypto Bull Market/ })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'The Crypto Bull Market' }),
  ).toContainText('Conviction offline');
});

test('a counter card opens the Thesis Desk on all scrolls, and each thesis opens in the same panel', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockNansen(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await beginVisit(page);
  await expect(
    page.getByRole('button', { name: 'Open the Thesis Desk' }),
  ).toBeVisible({
    timeout: 45000,
  });

  // Click the middle 3D card (The Crypto Bull Market) where the camera draws it.
  type Camera = {
    pose(): { moving: boolean };
    project(point: [number, number, number]): [number, number, number];
  };
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          // The dev probe appears once the camera rig mounts.
          (
            window as typeof window & { __teaCamera?: Camera }
          ).__teaCamera?.pose().moving,
      ),
    )
    .toBe(false);
  const [x, y] = await page.evaluate(() =>
    (window as typeof window & { __teaCamera: Camera }).__teaCamera.project([
      -1.36, 1.345, 6.416,
    ]),
  );
  await page.mouse.click(x, y);

  const panel = page.locator('.reading-panel');
  const main = page.locator('main');
  await expect(page.locator('.deck-book')).toHaveCount(3);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(main).toHaveAttribute('data-mood', 'waiting');

  await panel.evaluate((el) => {
    el.dataset.probe = 'one-window';
  });
  await page
    .getByRole('button', { name: /Open The Crypto Bull Market/ })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'The Crypto Bull Market' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Open The Crypto Bull Market/ }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(main).toHaveAttribute('data-mood', 'supported');

  await page
    .getByRole('button', { name: /Open AI Taking Over the World/ })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(
    page.getByRole('dialog', { name: 'AI Taking Over the World' }),
  ).toBeVisible();
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveAttribute('data-probe', 'one-window');
  await expect(main).toHaveAttribute('data-mood', 'challenged');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.deck-book')).toHaveCount(3);
  await expect(panel).toHaveAttribute('data-probe', 'one-window');
  await expect(main).toHaveAttribute('data-mood', 'waiting');
  expect(errors).toEqual([]);
});

test('full motion reading switches theses in place and returns focus to the book', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mockNansen(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The first open must mount the scroll with its deck at its final size;
  // an empty paper that resizes mid-unroll reads as a second opening.
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      const panel = document.querySelector('.reading-panel');
      if (!panel) return;
      observer.disconnect();
      const { left, width } = panel.getBoundingClientRect();
      Object.assign(window, {
        firstPanel: {
          deck: Boolean(panel.querySelector('.thesis-deck')),
          left: Math.round(left),
          width: Math.round(width),
        },
      });
    }).observe(document, { childList: true, subtree: true });
  });
  await openCounter(page);
  const panel = page.locator('.reading-panel');
  await expect(panel).toBeFocused();
  await page.waitForFunction(() =>
    document
      .querySelector('.reading-panel')
      ?.getAnimations()
      .every((a) => a.playState === 'finished'),
  );
  const box = await panel.boundingBox();
  expect(
    await page.evaluate(() => (window as { firstPanel?: unknown }).firstPanel),
  ).toEqual({
    deck: true,
    left: Math.round(box!.x),
    width: Math.round(box!.width),
  });
  const robinhood = page.getByRole('button', { name: /Open Robinhood Chain/ });
  await robinhood.click();
  const scroll = page.getByRole('dialog', {
    name: 'Robinhood Chain Tokenization',
  });
  await expect(scroll).toBeVisible();
  await expect(
    scroll.getByRole('heading', { name: 'Robinhood Chain Tokenization' }),
  ).toBeFocused();
  const platforms = scroll.getByRole('button', {
    name: 'Follow this thesis',
  });
  await platforms.click();
  const trading = page.getByRole('dialog', { name: 'Follow this thesis' });
  await expect(trading).toBeVisible();
  await expect(
    trading.getByRole('button', { name: 'Close trading platforms' }),
  ).toBeFocused();
  await expect(
    trading.getByRole('link', { name: /Open Arcus/ }),
  ).toHaveAttribute('href', 'https://app.arcus.xyz/ref/IROH');
  await expect(
    trading.getByRole('link', { name: /Open FOMO/ }),
  ).toHaveAttribute('href', 'https://fomo.family/r/0x_iroh');
  await expect(
    trading.getByRole('link', { name: /Open Omni/ }),
  ).toHaveAttribute('href', 'https://omni.variational.io/?ref=OMNIIROH');
  await expect(
    trading.getByRole('link', { name: /Open Hyperliquid/ }),
  ).toHaveAttribute('href', 'https://app.hyperliquid.xyz/join/0XIROH');
  await page.keyboard.press('Shift+Tab');
  await expect(trading.getByRole('link', { name: /Open Omni/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trading).not.toBeVisible();
  await expect(scroll).toBeVisible();
  await expect(platforms).toBeFocused();

  // Each switch runs inside a view transition, which waits for a rendered
  // frame; software WebGL under a full suite can take seconds per frame.
  const ai = page.getByRole('button', {
    name: /Open AI Taking Over the World/,
  });
  await ai.click();
  await expect(
    page.getByRole('dialog', { name: 'AI Taking Over the World' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(ai).toBeFocused();

  await page.getByRole('button', { name: 'All scrolls' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
  await expect(ai).toBeFocused();
  expect(errors).toEqual([]);
});

test('blocked site storage does not crash the page', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    }),
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const music = page.getByRole('button', { name: 'Background music' });
  await expect(music).toBeVisible({ timeout: 45000 });
  await music.click();
  expect(errors).toEqual([]);
});
