import { expect, test } from '@playwright/test';
import { mockCaseTestnet } from './case-fixture';
import { openStationPanel } from './room-helpers';

const shots = process.env.HOST_CATALOG_SCREENSHOTS;

for (const [width, height] of [
  [320, 700],
  [390, 844],
  [820, 1000],
  [1366, 900],
  [1920, 1080],
]) {
  test(`Host catalog and inspection fit a ${width}px viewport`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await mockCaseTestnet(page);
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const fromRoom = width === 1366;
    await page.goto(fromRoom ? '/' : '/?collection=tea');
    if (fromRoom) await openStationPanel(page, 'Host');
    const catalog = page.getByRole('heading', { name: 'The Tea Collection' });
    await expect(catalog).toBeVisible({ timeout: 45000 });
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.getByText('1 USDI', { exact: true })).toBeVisible();
    await expect(
      page
        .locator('[data-case="dragon-tea"]')
        .getByText('Bonus upgrade awaiting approval'),
    ).toHaveCount(1);
    const panel = page.locator('.reading-panel[data-host-collection]');
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThan(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if (shots && [390, 1366, 1920].includes(width)) {
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
      await page.screenshot({ path: `${shots}/catalog-${width}.png` });
    }

    await page
      .getByRole('button', { name: 'Inspect Dragon Tea Case' })
      .press('Enter');
    const detail = page.getByRole('heading', {
      name: 'Dragon Tea Case',
      exact: true,
    });
    await expect(detail).toBeFocused();
    const odds = page.locator('.tea-catalog-odds');
    for (const text of [
      '27.7778%',
      '67.2222%',
      '5%',
      '0.1 USDI',
      '1 USDI',
      '5 USDI',
      'Healthy',
      '1000 USDI available',
    ]) {
      await expect(odds.getByText(text, { exact: true })).toBeVisible();
    }
    const scroll = page.getByRole('region', { name: 'Case inspection' });
    const box = await scroll.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 420);
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(page.locator('main')).toHaveAttribute(
      'data-camera-at',
      'AvatarSeat',
    );
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    if (width === 390) {
      await scroll.evaluate((element) => {
        element.scrollTop = 0;
      });
      const touch = await page.context().newCDPSession(page);
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      const x = Math.round(box!.x + box!.width / 2);
      const y = Math.round(box!.y + box!.height * 0.76);
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (const dy of [25, 50, 95, 150]) {
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: y - dy }],
        });
      }
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await expect
        .poll(() => scroll.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await touch.send('Emulation.setTouchEmulationEnabled', {
        enabled: false,
      });
      await touch.detach();
    }
    await expect(async () => {
      await scroll.press('Home');
      await expect
        .poll(() => scroll.evaluate((element) => element.scrollTop), {
          timeout: 800,
        })
        .toBe(0);
    }).toPass({ timeout: 6500 });
    if (shots && [390, 1366, 1920].includes(width)) {
      await page.screenshot({ path: `${shots}/details-${width}.png` });
    }
    await expect(
      page.getByRole('button', { name: 'Open Case · 1 USDI' }),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'Back to Collection' })
      .press('Enter');
    await expect(catalog).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    const invitation = page.getByRole('button', {
      name: 'Explore the Tea Collection',
    });
    await expect(invitation).toBeFocused();
    await invitation.press('Enter');
    await expect(catalog).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });
}

test('Host verifies claim, pending opening recovery, draw, and payment through the wallet lifecycle', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { calls, chain } = await mockCaseTestnet(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?collection=dragon-tea');
  const detail = page.getByRole('region', { name: 'Case inspection' });
  await expect(detail).toBeVisible({ timeout: 45000 });
  const connect = detail.getByRole('button', {
    name: 'Connect Wallet',
    exact: true,
  });
  await connect.click();
  const picker = page.locator('.hot-connector-popup');
  await expect(picker.locator('.modal-content')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(detail).toBeVisible();
  await connect.click();
  await picker.locator('.connect-item').click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('wallet-entry')).toContainText(
    'tea-guest.testnet',
  );
  await page.getByTestId('wallet-entry').click();
  await expect(page.getByTestId('wallet-account')).toHaveText(
    'tea-guest.testnet',
  );
  await page.keyboard.press('Escape');
  await expect(detail).toBeVisible();
  const claim = detail.getByRole('button', { name: 'Claim 1,000 USDI' });
  await expect(claim).toBeEnabled();
  expect(calls).toHaveLength(0);
  chain.reject = true;
  await claim.click();
  await expect(
    detail.getByText('Wallet confirmation cancelled.'),
  ).toBeVisible();
  await expect(claim).toBeEnabled();
  chain.reject = false;
  await claim.click();
  await expect(detail.getByText('Starter USDI already claimed.')).toBeVisible();
  await expect(detail.locator('.tea-catalog-wallet-head strong')).toHaveText(
    '1000 USDI',
  );
  await expect(claim).toHaveCount(0);
  await detail.getByRole('button', { name: 'Prepay opening storage' }).click();
  const open = detail.getByRole('button', { name: 'Open Case · 1 USDI' });
  await expect(open).toBeEnabled();
  await open.click();
  await expect(
    detail.getByText('Transaction submitted, awaiting finalized confirmation.'),
  ).toBeVisible();
  await expect(detail.locator('.tea-coffer')).toHaveAttribute(
    'data-revealed',
    'false',
  );
  await page.reload();
  await expect(
    detail.getByText('Transaction submitted, awaiting finalized confirmation.'),
  ).toBeVisible({ timeout: 45000 });
  await expect(open).toBeDisabled();
  expect(calls.map(({ actions }) => actions[0].params.methodName)).toEqual([
    'claim_starter',
    'claim_starter',
    'storage_deposit',
    'ft_transfer_call',
  ]);
  expect(calls[3]).toMatchObject({
    network: 'testnet',
    signerId: 'tea-guest.testnet',
    receiverId: 'usdi-needmore-1-near.testnet',
    actions: [
      {
        type: 'FunctionCall',
        params: {
          methodName: 'ft_transfer_call',
          deposit: '1',
          args: {
            amount: '1000000',
            receiver_id: 'cases-needmore-1-near.testnet',
          },
        },
      },
    ],
  });
  const refresh = detail.getByRole('button', { name: 'Refresh chain state' });
  chain.openFinal = true;
  chain.stage = 'drawn';
  await refresh.click();
  await expect(detail.locator('.tea-catalog-reveal')).toContainText(
    'Payment pending',
  );
  await expect(detail.locator('.tea-catalog-reveal')).toContainText(
    'Legendary · 5 USDI',
  );
  await expect(open).toBeDisabled();
  await expect(detail.locator('.tea-coffer')).toHaveAttribute(
    'data-revealed',
    'true',
  );
  await expect(detail.locator('.tea-coffer-lid')).toHaveCSS(
    'animation-name',
    'none',
  );
  chain.stage = 'paid';
  await refresh.click();
  await expect(detail.locator('.tea-catalog-reveal')).toContainText(
    'Payout confirmed',
  );
  await expect(detail.getByText('4.9595%', { exact: true })).toBeVisible();
  await expect(detail.getByText('995.95 USDI available')).toBeVisible();
  await expect(detail.locator('.tea-catalog-wallet-head strong')).toHaveText(
    '1004 USDI',
  );
  await expect(
    detail.getByRole('button', { name: 'Open Another Case · 1 USDI' }),
  ).toBeVisible();
  if (shots) {
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(detail.locator('.tea-coffer-lid')).toHaveCSS(
      'animation-name',
      'tea-lid-open',
    );
    await detail.locator('.tea-catalog-heading').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${shots}/reward-1366.png`,
      animations: 'disabled',
    });
  }
  expect(calls).toHaveLength(4);
});

for (const result of ['refund', 'fail'] as const) {
  test(`Host reports a finalized ${result} without revealing a reward`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { chain, calls } = await mockCaseTestnet(page);
    chain.claimed = true;
    chain.stored = true;
    chain.openFinal = true;
    chain[result] = true;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?collection=dragon-tea');
    const detail = page.getByRole('region', { name: 'Case inspection' });
    await detail
      .getByRole('button', { name: 'Connect Wallet', exact: true })
      .click({ timeout: 45000 });
    await page.locator('.hot-connector-popup .connect-item').click();
    const open = detail.getByRole('button', { name: 'Open Case · 1 USDI' });
    await open.click();
    await expect(
      detail.getByText(
        result === 'refund'
          ? 'The opening was refunded in full. No draw was accepted.'
          : /Transaction failed on chain/,
      ),
    ).toBeVisible();
    await expect(detail.locator('.tea-coffer')).toHaveAttribute(
      'data-revealed',
      'false',
    );
    await expect(detail.locator('.tea-catalog-wallet-head strong')).toHaveText(
      '1000 USDI',
    );
    expect(calls).toHaveLength(1);
  });
}

for (const [name, price] of [
  ['Bamboo Mist Case', '0.5'],
  ['Moon Spirit Case', '2'],
  ['Phoenix Flame Case', '5'],
  ["Uncle's Secret Reserve", '10'],
]) {
  test(`collection previews ${name} without authorizing an undeployed opening`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    const { calls } = await mockCaseTestnet(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?collection=tea');
    await expect(page.locator('.tea-catalog-card')).toHaveCount(5);
    await page.getByRole('button', { name: `Inspect ${name}` }).click();
    const panel = page.getByRole('region', { name: 'Case inspection' });
    await expect(
      panel.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole('heading', {
        name: 'Awaiting verified Testnet deployment',
      }),
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: `Open Case · ${price} USDI` }),
    ).toBeDisabled();
    await expect(
      panel.getByText('Planned USDI rewards', { exact: true }),
    ).toBeVisible();
    await expect(panel).toContainText('unofficial Iroh Testnet mocks');
    expect(calls).toEqual([]);
    await panel.getByRole('button', { name: 'Back to Collection' }).click();
    await page.getByRole('button', { name: 'Inspect Dragon Tea Case' }).click();
    await expect(page.locator('.tea-catalog-odds')).toContainText('27.7778%');
    expect(calls).toEqual([]);
  });
}

test('a case-specific deep link and refresh retain the selected planned case', async ({
  page,
}) => {
  test.setTimeout(60000);
  const { calls } = await mockCaseTestnet(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?collection=moon-spirit');
  const heading = page.getByRole('heading', {
    name: 'Moon Spirit Case',
    exact: true,
  });
  await expect(heading).toBeVisible();
  await page.reload();
  await expect(heading).toBeVisible();
  expect(calls).toEqual([]);
});

test('switching cases preserves the original pending receipt and never resubmits it', async ({
  page,
}) => {
  test.setTimeout(60000);
  const { chain, calls } = await mockCaseTestnet(page);
  chain.claimed = true;
  chain.stored = true;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?collection=dragon-tea');
  const detail = page.getByRole('region', { name: 'Case inspection' });
  await detail
    .getByRole('button', { name: 'Connect Wallet', exact: true })
    .click();
  await page.locator('.hot-connector-popup .connect-item').click();
  await detail.getByRole('button', { name: 'Open Case · 1 USDI' }).click();
  await expect(detail).toContainText(
    'Transaction submitted, awaiting finalized confirmation.',
  );
  await detail.getByRole('button', { name: 'Back to Collection' }).click();
  await page.getByRole('button', { name: 'Inspect Bamboo Mist Case' }).click();
  await expect(
    detail.getByRole('button', { name: 'Open Case · 0.5 USDI' }),
  ).toBeDisabled();
  await expect(detail.locator('.tea-reel')).toHaveCount(0);
  chain.stage = 'drawn';
  chain.openFinal = true;
  await detail.getByRole('button', { name: 'Back to Collection' }).click();
  await page.getByRole('button', { name: 'Inspect Dragon Tea Case' }).click();
  await expect(detail).toContainText(
    'Transaction finalized successfully on Testnet.',
  );
  await expect(detail.locator('.tea-reel')).toHaveAttribute(
    'aria-label',
    'Reward reel landed on USDI',
  );
  expect(calls).toHaveLength(1);
});
