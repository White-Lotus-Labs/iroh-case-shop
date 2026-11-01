#!/usr/bin/env node
// Captures the README screenshots into docs/screenshots/ as WebP.
//
//   node scripts/readme-shots.mjs [--base=https://iroh-tea-shop.up.railway.app]
//     [--only=host,shelf] [--size=1440x900] [--out=docs/screenshots]
//
// Defaults to the live site because it has real saved Nansen readings. A local
// server works too (--base=http://127.0.0.1:3000) once its first save is done.
// Read-only: it opens the Host panel but never sends a message to Uncle.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = flag('base', 'https://iroh-tea-shop.up.railway.app');
const out = resolve(repoRoot, flag('out', 'docs/screenshots'));
const only = flag('only', '').split(',').filter(Boolean);
const [width, height] = flag('size', '1440x900').split('x').map(Number);
mkdirSync(out, { recursive: true });

// Chromium encodes the WebP on a blank page, so no image library is needed.
let encoder;
async function shot(page, name) {
  if (only.length && !only.includes(name)) return;
  const png = await page.screenshot({ type: 'png' });
  encoder ??= await page.context().browser().newPage();
  const webp = await encoder.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.82).split(',')[1];
  }, png.toString('base64'));
  writeFileSync(join(out, `${name}.webp`), Buffer.from(webp, 'base64'));
  console.log('saved', name);
}

// Wait for the dock unroll so its rollers stop catching clicks.
async function settleDock(page) {
  const nav = page.getByRole('navigation', { name: 'Tea room stations' });
  await nav.waitFor({ state: 'visible', timeout: 30000 });
  for (let i = 0; i < 60; i++) {
    const running = await nav.evaluate(
      (el) =>
        el
          .getAnimations({ subtree: true })
          .filter(
            (a) =>
              a.playState === 'running' &&
              a.effect?.getTiming().iterations !== Infinity,
          ).length,
    );
    if (!running) return nav;
    await page.waitForTimeout(500);
  }
  return nav;
}

async function dock(page, station) {
  const nav = await settleDock(page);
  await nav.getByRole('button', { name: new RegExp(station) }).click();
  await page.waitForTimeout(3500); // camera travel
}

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: [
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});

await page.goto(base, { waitUntil: 'domcontentloaded' });
const enter = page.getByRole('button', { name: 'Enter Teashop' });
await enter.waitFor({ state: 'visible', timeout: 60000 });
for (let i = 0; i < 240 && !(await enter.isEnabled()); i++) {
  await page.waitForTimeout(500);
}
await page.waitForTimeout(2500);
await shot(page, 'waiting-room');

await enter.click();
await page
  .locator('.waiting-room')
  .waitFor({ state: 'detached', timeout: 30000 });
await settleDock(page);
await page.waitForTimeout(5000);
await shot(page, 'room');

await page
  .getByRole('button', { name: 'Open the Thesis Desk' })
  .click({ timeout: 30000 });
await page.locator('.deck-book').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(4000);
await shot(page, 'thesis-desk');

await page.getByRole('button', { name: /Open The Crypto Bull Market/ }).click();
const book = page.getByRole('dialog', { name: 'The Crypto Bull Market' });
await book.waitFor({ timeout: 20000 });
await page.waitForTimeout(2000);
await shot(page, 'thesis-book');
const asset = book.getByRole('button', { name: /HYPE/ }).first();
await asset.click();
await page.waitForTimeout(5000);
await asset.evaluate((el) => el.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(1500);
await shot(page, 'thesis-asset');
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);

await dock(page, 'Host');
await page
  .getByRole('button', { name: 'Ask Uncle', exact: true })
  .click({ timeout: 45000 });
await page.getByRole('heading', { name: 'Ask Uncle' }).waitFor();
await page.waitForTimeout(3000);
await shot(page, 'host');
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);

await dock(page, 'Shelf');
await page
  .getByRole('button', { name: 'See the top traders' })
  .click({ timeout: 45000 });
await page.getByTestId('rank-grid').waitFor({ timeout: 45000 });
await page.waitForTimeout(5000);
await shot(page, 'shelf');
await page.getByRole('tab', { name: 'Meme Traders' }).click();
await page.waitForTimeout(4000);
await shot(page, 'shelf-meme');
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);

await dock(page, 'Observatorium');
await page.waitForTimeout(3000);
await shot(page, 'observatorium');

await browser.close();
