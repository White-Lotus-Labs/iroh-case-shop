#!/usr/bin/env node
// Captures fixed art-review shots of the tea room. See docs/visual-rubric.md.
//
//   node scripts/visual-shots.mjs [outDir] [--gpu=metal|swiftshader]
//     [--shots=room-wide,host-face] [--base=http://127.0.0.1:3106]
//     [--motion=reduce|full] [--size=1600x900] [--dpr=2] [--ui] [--headed]
//     [--query=irohPose=sip:2]   (extra URL query, e.g. to hold a host pose)
//
// The dev server must already run (`npm run dev -- --port 3106`); the shot
// camera is dev-only. Default outDir: ../_scratch/shots/round-N (next free N).
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALL_SHOTS = [
  'room-wide',
  'counter',
  'tea-table',
  'host-full',
  'host-face',
  'host-hands',
  'tea-set',
  'observatorium',
  'shelf',
  'brazier',
  'entrance',
  'counter-shelves',
];
// Steam is hidden under reduced motion, so the tea-set shot runs with full motion.
const FULL_MOTION_SHOTS = new Set(['tea-set', 'brazier']);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gpu = flag('gpu', 'metal');
const base = flag('base', 'http://127.0.0.1:3106');
const motion = flag('motion', 'reduce');
const query = flag('query', '');
const [width, height] = flag('size', '1600x900').split('x').map(Number);
// Metal shots default to a Retina-like 2x, which the Canvas caps at its own dpr range.
const dpr = Number(flag('dpr', gpu === 'metal' ? '2' : '1'));
const shots = flag('shots', ALL_SHOTS.join(',')).split(',');
const unknown = shots.filter((shot) => !ALL_SHOTS.includes(shot));
if (unknown.length) {
  console.error(`Unknown shot(s): ${unknown.join(', ')}`);
  process.exit(1);
}

function nextRoundDir() {
  const root = resolve(repoRoot, '../_scratch/shots');
  mkdirSync(root, { recursive: true });
  const rounds = readdirSync(root)
    .map((name) => /^round-(\d+)$/.exec(name)?.[1])
    .filter(Boolean)
    .map(Number);
  return join(root, `round-${rounds.length ? Math.max(...rounds) + 1 : 0}`);
}
const outDir = resolve(
  args.find((arg) => !arg.startsWith('--')) ?? nextRoundDir(),
);
mkdirSync(outDir, { recursive: true });

const gpuArgs = {
  // Uncapped frame rate, so the sampler shows headroom above the display refresh.
  // ANGLE Metal on macOS; elsewhere Chromium's default GPU backend (D3D11 on Windows).
  metal: [
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
  ],
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
}[gpu];
if (!gpuArgs) {
  console.error(`Unknown --gpu=${gpu}; use metal or swiftshader.`);
  process.exit(1);
}

// Never show a window on the user's screen. Metal runs use Chrome's new headless
// mode (channel 'chromium') with the GPU on; --headed is a fallback that stays off-screen.
const headed = has('headed');
const browser = await chromium.launch({
  headless: !headed,
  channel: gpu === 'metal' && !headed ? 'chromium' : undefined,
  args: [
    ...gpuArgs,
    ...(gpu === 'metal' ? ['--enable-gpu'] : []),
    ...(headed
      ? [
          '--window-position=-32000,-32000',
          '--window-size=1440,900',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-background-timer-throttling',
        ]
      : []),
  ],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: dpr,
  reducedMotion: motion === 'full' ? 'no-preference' : 'reduce',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', (response) => {
  if (response.status() >= 400)
    errors.push(`${response.status()} ${response.url()}`);
});

async function open(shot) {
  await context.clearCookies();
  await page.emulateMedia({
    reducedMotion:
      motion === 'full' || FULL_MOTION_SHOTS.has(shot)
        ? 'no-preference'
        : 'reduce',
  });
  await page.goto(`${base}/?shot=${shot}${query && `&${query}`}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('main[aria-busy="false"]').waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Enter Teashop' }).click();
  await page
    .locator('main[data-station="Counter"][data-camera-at="Counter"]')
    .waitFor({ timeout: 30_000 });
  await page
    .locator('canvas[data-iroh-host="model"]')
    .waitFor({ timeout: 30_000 });
  if (!has('ui'))
    await page.addStyleTag({
      content: `.topbar,.reading-panel,.station-dock,.shelf-approach,.scene-caption{visibility:hidden!important}`,
    });
}

async function sampleFrames(windowMs = 3000) {
  return page.evaluate(
    (duration) =>
      new Promise((done) => {
        const times = [];
        let first = 0;
        let last = 0;
        const tick = (now) => {
          if (last) times.push(now - last);
          else first = now;
          last = now;
          if (now - first < duration || times.length < 5)
            requestAnimationFrame(tick);
          else done(times);
        };
        requestAnimationFrame(tick);
      }),
    windowMs,
  );
}

function summarize(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return {
    meanMs: +mean.toFixed(2),
    p95Ms: +p95.toFixed(2),
    fps: +(1000 / mean).toFixed(1),
  };
}

const report = {
  gpu,
  base,
  size: `${width}x${height}@${dpr}x`,
  motion,
  shots: {},
};
for (const shot of shots) {
  await open(shot);
  if (!report.renderer)
    report.renderer = await page.evaluate(() => {
      const gl = document.querySelector('canvas')?.getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
  // Let shadows, contact shadows, and the PMREM environment settle.
  await page.waitForTimeout(FULL_MOTION_SHOTS.has(shot) ? 2600 : 1400);
  const frames = summarize(await sampleFrames());
  const file = join(outDir, `${shot}.png`);
  await page.screenshot({ path: file, timeout: 120_000 });
  report.shots[shot] = frames;
  console.log(
    `${shot.padEnd(14)} ${frames.fps} fps (p95 ${frames.p95Ms} ms) -> ${file}`,
  );
}
report.errors = errors;
const all = Object.values(report.shots);
report.meanFps = +(
  all.reduce((sum, shot) => sum + shot.fps, 0) / all.length
).toFixed(1);
writeFileSync(
  join(outDir, `frames-${gpu}.json`),
  JSON.stringify(report, null, 2),
);
console.log(`renderer: ${report.renderer}`);
console.log(`mean fps: ${report.meanFps}`);
if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
await browser.close();
