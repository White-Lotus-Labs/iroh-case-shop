import { expect, test, type Page } from '@playwright/test';
import { registerBrowserAccount } from './auth-helper';
import { beginVisit } from './room-helpers';

test.beforeEach(async ({ page }) => registerBrowserAccount(page));

type CameraPose = {
  position: [number, number, number];
  target: [number, number, number];
  moving: boolean;
};
const cameraPose = (page: Page) =>
  page.evaluate(() =>
    (
      window as typeof window & {
        __teaCamera: { pose(): CameraPose };
      }
    ).__teaCamera.pose(),
  );
const centerPortrait = (page: Page) =>
  page.evaluate(() => {
    const [x, y] = (
      window as typeof window & {
        __teaCamera: {
          project(point: [number, number, number]): [number, number, number];
        };
      }
    ).__teaCamera.project([3.21, 1.67, -4.55]);
    return [x, y] as [number, number];
  });

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const snapshot = {
  entries: Array.from({ length: 10 }, (_, i) => ({
    rank: i + 1,
    address: address(i + 1),
    displayName:
      i === 0
        ? 'Uses "SANTOCHAN" HL Referral Code'
        : i === 1
          ? 'HL Perps Whale'
          : i === 9
            ? 'Uses "TEAHOUSE" HL Referral Code'
            : `Trader ${i + 1}`,
    pnl: i === 1 ? -482_000 : 1_820_000 - i * 10_000,
    roi: i === 1 ? -0.082 : 0.274,
    accountValue: i === 9 ? null : 4_600_000,
  })),
  fetchedAt: '2026-09-25T12:00:00.000Z',
  expiresAt: '2099-09-25T12:30:00.000Z',
  source: 'nansen',
  stale: false,
};

const solanaWallet = 'AEtL29wgARtujVynpgoDtUMLvM7NmZ6WALcjD2NjU8Dk';
// Rank 1 is a combined entity, rank 2 a Solana wallet, the rest EVM wallets.
const memeSnapshot = {
  ...snapshot,
  entries: Array.from({ length: 10 }, (_, i) => ({
    rank: i + 1,
    address: i === 1 ? solanaWallet : address(i + 1),
    displayName:
      i === 0 ? 'ogle' : i === 1 ? '"AEtL29" on pump.fun' : `Trader ${i + 1}`,
    pnl: 3_000_000 - i * 100_000,
    roi: 0.64,
    accountValue: null,
    realizedPnl: 3_000_000 - i * 100_000,
    unrealizedPnl: 20_000,
    volume: null,
    trades: 390,
    positions: [],
    chains:
      i === 0
        ? ['robinhood', 'solana']
        : i === 1
          ? ['solana']
          : ['bsc', 'robinhood'],
    winRate: 0.53,
    tokens: 12,
    topTokens: [{ symbol: 'PONS', chain: 'robinhood', pnl: 2_336_425 }],
    ...(i === 0
      ? {
          entity: 'ogle',
          entityTotal: {
            realizedPnl: 2_381_278,
            trades: 3787,
            tokens: 163,
            topTokens: [{ symbol: 'STONK', chain: 'solana', pnl: 101_000 }],
          },
        }
      : {}),
  })),
};

async function focusShelf(page: Page) {
  await beginVisit(page);
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Shelf/ })
    .click();
  await page.getByRole('button', { name: 'See the top traders' }).click();
}

test('the Shelf stays in the room until opened, then reveals ranked wallets without moving again', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/smart-wallet-leaderboard*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(snapshot),
    }),
  );
  await page.goto('/');
  await beginVisit(page);
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-motion',
    'reduce',
  );
  await expect(page.getByTestId('leaderboard-parchment')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Shelf/ })
    .click();
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-station',
    'Shelf',
  );
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-shelf-view',
    'browse',
  );
  await expect(page.getByTestId('leaderboard-parchment')).toHaveCount(0);
  const approach = page.getByRole('button', { name: 'See the top traders' });
  await expect(approach).toBeVisible();
  const approachBox = await approach.boundingBox();
  const dockBox = await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .boundingBox();
  expect(
    Math.abs(
      approachBox!.x +
        approachBox!.width / 2 -
        (dockBox!.x + dockBox!.width / 2),
    ),
  ).toBeLessThan(2);
  expect(approachBox!.y + approachBox!.height).toBeLessThan(dockBox!.y);
  await page.evaluate(() => {
    const shell = document.querySelector('.app-shell')!;
    const transitions: { view: string | null; parchment: boolean }[] = [];
    (
      window as typeof window & { shelfTransitions: typeof transitions }
    ).shelfTransitions = transitions;
    new MutationObserver(() => {
      transitions.push({
        view: shell.getAttribute('data-shelf-view'),
        parchment: Boolean(
          document.querySelector('[data-testid="leaderboard-parchment"]'),
        ),
      });
    }).observe(shell, {
      attributes: true,
      attributeFilter: ['data-shelf-view'],
    });
  });
  const beforeOpen = await cameraPose(page);
  await approach.click();
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-shelf-view',
    'open',
  );
  const afterOpen = await cameraPose(page);
  expect(afterOpen).toEqual(beforeOpen);
  const transitions = await page.evaluate(
    () =>
      (
        window as typeof window & {
          shelfTransitions: { view: string | null; parchment: boolean }[];
        }
      ).shelfTransitions,
  );
  expect(transitions).not.toContainEqual({
    view: 'focusing',
    parchment: false,
  });
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-camera-at',
    'Shelf',
  );
  await expect(page.getByTestId('leaderboard-parchment')).toBeVisible();
  await expect(page.getByTestId('top-wallet')).toContainText('Azure Dragon');
  await expect(page.getByTestId('top-wallet')).toContainText('santochan');
  await expect(page.locator('[data-rank="2"] .wallet-label')).toHaveText(
    'Whale',
  );
  await expect(page.locator('[data-rank="10"] .wallet-label')).toHaveText(
    'teahouse',
  );
  await expect(page.locator('.wallet-label')).toHaveCount(10);
  await expect(page.getByTestId('top-wallet')).toContainText('+$1.82M');
  await expect(page.locator('[data-rank="2"]')).toContainText('-$482K');
  await expect(page.getByTestId('leaderboard-parchment')).not.toContainText(
    'HL Referral',
  );
  // Spirit names must not borrow Avatar names. Studio credit may say White Lotus Labs.
  await expect(page.getByTestId('leaderboard-parchment')).not.toContainText(
    /Iroh|Bumi|Pakku|Roku|Avatar/,
  );
  await expect(page.getByTestId('leaderboard-parchment')).toContainText(
    'Smart HL Perps Traders · last 30 days',
  );
  await expect(
    page.getByTestId('rank-grid').locator('[data-rank]'),
  ).toHaveCount(10);
});

test('clicking the Shelf in the room starts the focus journey', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await beginVisit(page);
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Shelf/ })
    .click();
  await expect(
    page.getByRole('button', { name: 'See the top traders' }),
  ).toBeVisible();
  // Click the middle of the shelf where the camera draws it; a fixed pixel
  // can fall in a gap between the uprights and the tins.
  type Camera = {
    pose(): { moving: boolean };
    project(point: [number, number, number]): [number, number, number];
  };
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { __teaCamera?: Camera }
          ).__teaCamera?.pose().moving,
      ),
    )
    .toBe(false);
  const [x, y] = await page.evaluate(() =>
    (window as typeof window & { __teaCamera: Camera }).__teaCamera.project([
      3.6, 1.7, -4.55,
    ]),
  );
  await page.mouse.click(x, y);
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-shelf-view',
    'open',
  );
});

test('a hanging spirit paper answers hover and opens the Shelf', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await beginVisit(page);
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Shelf/ })
    .click();
  await expect(
    page.getByRole('button', { name: 'See the top traders' }),
  ).toBeVisible();
  // The rank 1 sheet hangs above the rolled scroll in the middle bay.
  const portrait = await centerPortrait(page);
  await page.mouse.move(...portrait);
  await expect
    .poll(() => page.evaluate(() => document.body.style.cursor))
    .toBe('pointer');
  const beforeOpen = await cameraPose(page);
  await page.mouse.click(...portrait);
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-shelf-view',
    'open',
  );
  expect(await cameraPose(page)).toEqual(beforeOpen);

  await page.getByRole('button', { name: 'Close Shelf menu' }).click();
  await expect(page.getByTestId('leaderboard-parchment')).toHaveCount(0);
  const approach = page.getByRole('button', { name: 'See the top traders' });
  await expect(approach).toBeFocused();
  await page.mouse.click(...portrait);
  await expect(page.getByTestId('leaderboard-parchment')).toBeVisible();
  expect(await cameraPose(page)).toEqual(beforeOpen);

  // Keyboard: Escape closes the parchment, Enter on the hint reopens it.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('leaderboard-parchment')).toHaveCount(0);
  await expect(approach).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('leaderboard-parchment')).toBeVisible();
  await expect(page.locator('.reading-panel')).toBeFocused();
  expect(await cameraPose(page)).toEqual(beforeOpen);
});

test('Shelf presents one leader above a ranked list of nine spirits', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/smart-wallet-leaderboard*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(snapshot),
    }),
  );
  await page.goto('/');
  await focusShelf(page);
  await expect(
    page.getByRole('heading', {
      name: /Top Hyperliquid Traders by 30-Day PnL/,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Smart Wallets', exact: true })
    .click();
  await expect(
    page.getByText('Fund and Smart Trader wallets · last 30 days').first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Whales', exact: true }).click();
  await expect(
    page.getByText('Accounts worth $10M or more · last 30 days').first(),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Perps Traders', exact: true })
    .click();
  await page.getByLabel('Rank by').selectOption('roi');
  await expect(
    page.getByRole('heading', { name: /Highest ROI/ }),
  ).toBeVisible();
  await page.getByLabel('Rank by').selectOption('wins');
  await expect(page.getByText(/Powered by\s+Nansen/).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Explain data freshness' }).first(),
  ).toBeVisible();
  await expect(page.getByTestId('top-wallet')).toContainText('Azure Dragon', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('top-wallet')).toContainText('+27.4%');
  await expect(page.locator('[data-rank="1"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(page.locator('[data-rank="10"]')).toContainText('Jade Rabbit');
  await expect(
    page.getByTestId('rank-grid').locator('[data-rank]'),
  ).toHaveCount(10);
  const second = page.locator('[data-rank="2"]');
  await expect(second.locator('.wallet-roi')).toHaveClass(/wallet-roi-down/);
  await expect(second.locator('.wallet-bar > span')).toHaveAttribute(
    'style',
    /width: 26\.5%/,
  );
  await expect(
    second.getByRole('link', {
      name: 'Research this wallet in Nansen (new tab)',
    }),
  ).toHaveAttribute(
    'href',
    `https://app.nansen.ai/profiler?address=${address(2)}&chain=hyperliquid`,
  );
  // Opening a row moves the full card to that spirit and folds rank 1 back into a row.
  await second.getByRole('button', { expanded: false }).click();
  await expect(second).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('top-wallet')).toContainText(
    'Vermilion Phoenix',
  );
  await expect(page.getByTestId('top-wallet')).toContainText(
    '#2 by 30-day PnL',
  );
  await expect(page.getByTestId('top-wallet')).toBeFocused();
  await expect(
    page.locator('[data-rank="1"]').getByRole('button', { expanded: false }),
  ).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await second
    .getByRole('button', { name: `Copy wallet address ${address(2)}` })
    .click();
  await expect(second.getByRole('status')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    address(2),
  );
  await expect(page.locator('[data-rank="10"]')).toBeVisible();
  await expect(page.locator('[data-rank="10"]')).toContainText('—');
  await page.locator('[data-rank="10"]').scrollIntoViewIfNeeded();
  const parchment = await page
    .getByTestId('leaderboard-parchment')
    .boundingBox();
  const last = await page.locator('[data-rank="10"]').boundingBox();
  expect(last!.y + last!.height).toBeLessThanOrEqual(
    parchment!.y + parchment!.height + 1,
  );
  expect(errors).toEqual([]);
});

test('Meme Traders has its own sorts, win rate, chains and profiler links', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/smart-wallet-leaderboard*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        route.request().url().includes('board=meme') ? memeSnapshot : snapshot,
      ),
    }),
  );
  await page.goto('/');
  await focusShelf(page);
  const rankBy = page.getByLabel('Rank by');
  await rankBy.selectOption('account');
  await page.getByRole('button', { name: 'Meme Traders', exact: true }).click();
  await expect(rankBy).toHaveValue('wins');
  await expect(rankBy.locator('option')).toHaveCount(2);
  await expect(
    page
      .getByText(
        'Smart Money wallets trading mostly memecoins · realized PnL · last 30 days',
      )
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Top Meme Traders by 30-Day PnL/ }),
  ).toBeVisible();
  await expect(page.locator('.wallet-list-head')).toContainText('Win rate');
  const top = page.getByTestId('top-wallet');
  await expect(top).toContainText('Win rate');
  await expect(top.locator('.wallet-chain')).toHaveText([
    'Robinhood',
    'Solana',
    /^Entity that trades on Solana and EVM/,
  ]);
  await expect(top).toContainText('Top tokens traded');
  await expect(top).toContainText('PONS');
  // The row ranks on the wallet; the card adds the entity's cross-chain total.
  await expect(top).toContainText('53%');
  await expect(top).toContainText('ogle · all wallets and chains');
  await expect(top).toContainText('+$2.38M');
  await expect(top).toContainText('STONK');
  const research = { name: 'Research this wallet in Nansen (new tab)' };
  await expect(top.getByRole('link', research)).toHaveAttribute(
    'href',
    `https://app.nansen.ai/profiler?address=${address(1)}&chain=all`,
  );
  const second = page.locator('[data-rank="2"]');
  await expect(second.locator('.wallet-value')).toContainText('53%');
  await expect(second.getByRole('link', research)).toHaveAttribute(
    'href',
    `https://app.nansen.ai/profiler?address=${solanaWallet}&chain=solana`,
  );
  await second.getByRole('button', { expanded: false }).click();
  await expect(
    page.getByTestId('top-wallet').locator('.wallet-chain'),
  ).toHaveText(['Solana']);
  await expect(page.locator('[data-rank="3"]')).toBeVisible();
  await rankBy.selectOption('roi');
  await expect(
    page.getByRole('heading', { name: /Highest ROI/ }),
  ).toBeVisible();
  await expect(page.getByText(/ROI ranks only the top 100/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('Shelf keeps its parchment for a safe error and exposes a keyboard retry', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Keep Nansen "configured" so the Shelf shows the route error, not the
  // unconfigured offline empty state.
  await page.route('**/api/nansen-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nansen: 'configured' }),
    }),
  );
  await page.route('**/api/smart-wallet-leaderboard*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Nansen API is not configured.' }),
    }),
  );
  await page.goto('/');
  await focusShelf(page);
  await expect(page.getByTestId('leaderboard-parchment')).toContainText(
    'Nansen API is not configured.',
  );
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('an invalid server response shows a safe parchment error', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/nansen-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nansen: 'configured' }),
    }),
  );
  await page.route('**/api/smart-wallet-leaderboard*', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'text/html',
      body: '<h1>internal details</h1>',
    }),
  );
  await page.goto('/');
  await focusShelf(page);
  await expect(page.getByTestId('leaderboard-parchment')).toContainText(
    'Smart Wallet leaderboard is temporarily unavailable.',
  );
  await expect(page.getByTestId('leaderboard-parchment')).not.toContainText(
    'internal details',
  );
});

test('rank ten remains visible at 1280 by 720', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/smart-wallet-leaderboard*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(snapshot),
    }),
  );
  await page.goto('/');
  await focusShelf(page);
  await expect(page.locator('[data-rank="10"]')).toBeVisible();
  const panel = await page.getByTestId('leaderboard-parchment').boundingBox();
  const heading = await page
    .getByRole('heading', {
      name: /Top Hyperliquid Traders by 30-Day PnL/,
    })
    .boundingBox();
  expect(panel!.y).toBeGreaterThanOrEqual(78);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(720 - 80);
  expect(heading!.y).toBeGreaterThanOrEqual(panel!.y);
  await page.locator('[data-rank="10"]').scrollIntoViewIfNeeded();
  const paper = await page.locator('.leaderboard-parchment').boundingBox();
  const rank = await page.locator('[data-rank="10"]').boundingBox();
  expect(rank!.y + rank!.height).toBeLessThanOrEqual(
    paper!.y + paper!.height + 1,
  );
});

test('a stale real snapshot is labelled and small screens keep values readable', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/smart-wallet-leaderboard*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...(route.request().url().includes('board=meme')
          ? memeSnapshot
          : snapshot),
        stale: true,
        refreshError: 'Provider unavailable.',
      }),
    }),
  );
  await page.goto('/');
  await focusShelf(page);
  await expect(page.getByText(/showing the last saved copy/)).toBeVisible();
  // A server-stale row has nothing newer to fetch, so no retry is offered.
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator('[data-rank="10"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-rank="10"]')).toContainText('—');
  const rank = await page.locator('[data-rank="10"]').boundingBox();
  const footer = await page.locator('.leaderboard-foot').boundingBox();
  expect(rank!.y + rank!.height).toBeLessThanOrEqual(footer!.y);

  // Four board buttons, the chain chips and the top tokens still fit at phone width.
  await page.getByRole('button', { name: 'Meme Traders', exact: true }).click();
  const chains = page.getByTestId('top-wallet').locator('.wallet-chains');
  await expect(chains).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const card = await page.getByTestId('top-wallet').boundingBox();
  const chips = await chains.boundingBox();
  expect(chips!.x + chips!.width).toBeLessThanOrEqual(card!.x + card!.width);
});
