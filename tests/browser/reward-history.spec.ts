import { expect, test, type Page } from '@playwright/test';
import { mockCaseTestnet } from './case-fixture';

async function openShelf(page: Page) {
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Shelf/ })
    .click();
  await page.getByRole('button', { name: 'Open the Activity Ledger' }).click();
  return page.getByTestId('shelf-activity');
}

test('Host waits for a verified draw and the Shelf retains the purchase receipt', async ({
  page,
}) => {
  test.setTimeout(60000);
  const { chain, calls } = await mockCaseTestnet(page);
  chain.bonuses = true;
  chain.claimed = true;
  chain.stored = true;
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?collection=dragon-tea');
  const host = page.getByRole('region', { name: 'Case inspection' });
  const rewards = host.getByRole('region', { name: 'Testnet bonus rewards' });
  await expect(rewards).toContainText('50 SHITZU');
  await expect(rewards).toContainText('5 RHEA');
  await expect(rewards).toContainText('1 AURORA');
  await expect(host.locator('.tea-reel')).toHaveCount(0);
  await host
    .getByRole('button', { name: 'Connect Wallet', exact: true })
    .click();
  await page.locator('.hot-connector-popup .connect-item').click();
  await expect(host.locator('.tea-catalog-wallet-head strong')).toHaveText(
    '1000 USDI',
  );
  await host.getByRole('button', { name: 'Open Case · 1 USDI' }).click();
  await expect(
    host.getByText('Transaction submitted, awaiting finalized confirmation.'),
  ).toBeVisible();
  await expect(host.locator('.tea-reel')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  chain.stage = 'drawn';
  chain.openFinal = true;
  await host.getByRole('button', { name: 'Refresh chain state' }).click();
  const reel = host.locator('.tea-reel');
  await expect(reel).toHaveAttribute(
    'aria-label',
    'Reward reel landed on AURORA',
  );
  await expect(reel.locator('[data-winner]')).toHaveAttribute(
    'data-winner',
    'AURORA',
  );
  await expect(reel.locator('.tea-reel-track')).toHaveCSS(
    'animation-name',
    'tea-reel-land',
  );
  await expect(host.locator('.tea-bonus-reward')).toContainText(
    '1 AURORA bonus · Reserved',
  );
  chain.stage = 'paid';
  await host.getByRole('button', { name: 'Refresh chain state' }).click();
  await expect(host.locator('.tea-bonus-reward')).toContainText(
    '1 AURORA bonus · Paid',
  );
  await expect(
    host.getByText('Transaction finalized successfully on Testnet.'),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(host.locator('.tea-catalog-wallet-head strong')).toHaveText(
    '1004 USDI',
  );
  const shelf = await openShelf(page);
  await expect(shelf.getByText('1 AURORA', { exact: true })).toBeVisible();
  await shelf
    .getByRole('button', { name: 'Details for Case purchase' })
    .click();
  await expect(
    shelf.getByRole('heading', { name: 'Case purchase details' }),
  ).toBeFocused();
  await expect(shelf.getByText('ft_transfer_call')).toBeVisible();
  await expect(shelf.getByRole('link', { name: /NearBlocks/ })).toHaveAttribute(
    'href',
    /11111111111111111111111111111112$/,
  );
  expect(calls).toHaveLength(1);
});

test('mobile reel skips motion and Shelf prompts a disconnected wallet', async ({
  page,
}) => {
  test.setTimeout(60000);
  const { chain } = await mockCaseTestnet(page);
  chain.bonuses = true;
  chain.claimed = true;
  chain.stage = 'paid';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?collection=dragon-tea');
  const host = page.getByRole('region', { name: 'Case inspection' });
  await expect(
    host.getByRole('region', { name: 'Testnet bonus rewards' }),
  ).toBeVisible();
  const shelf = await openShelf(page);
  await expect(
    shelf.getByText('Connect a NEAR Testnet wallet to see your activity.'),
  ).toBeVisible();
  await page.getByTestId('wallet-entry').click();
  await page.locator('.hot-connector-popup .connect-item').click();
  await expect(shelf.getByText('1 AURORA', { exact: true })).toBeVisible();
  const bonus = shelf.locator('li').filter({ hasText: '1 AURORA' });
  await bonus.getByRole('button', { name: /Details/ }).click();
  await expect(shelf.getByText('mock-aurora.testnet')).toBeVisible();
  await expect(shelf.getByText('Legendary', { exact: true })).toBeVisible();
  await expect(shelf.getByRole('link', { name: /NearBlocks/ })).toHaveCount(0);
  const bounds = await shelf.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.getByRole('button', { name: 'Dragon Tea Cases' }).click();
  await page.getByRole('button', { name: /Inspect Dragon Tea Case/ }).click();
  await expect(host.locator('.tea-reel-track')).toHaveCSS(
    'animation-name',
    'none',
  );
  await expect(host.locator('[data-winner]')).toHaveAttribute(
    'data-winner',
    'AURORA',
  );
});
