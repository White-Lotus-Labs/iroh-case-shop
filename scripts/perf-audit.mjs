#!/usr/bin/env node
// Production load audit: headless Chromium against `next start`.
//
//   node scripts/perf-audit.mjs [--port=3161] [--profiles=desktop,mobile]
//       [--runs=3] [--step=1] [--out=docs/perf-runs/latest.json]
//
// Expects `npm run build` already. Starts `next start` itself unless
// PERF_AUDIT_EXTERNAL=1 (then only --base / --port is used).
//
// Bytes are wire bytes from CDP `Network.loadingFinished.encodedDataLength`
// (compressed body plus headers), so a gzip chunk counts at its gzip size.
// "Ready" is the first moment `.app-shell` drops aria-busy with Enter Teashop
// enabled. "Sketchbook" is the first moment the first spread is baked
// (`data-bake` >= 2) with Next page enabled; the audit then turns six pages,
// 2 s apart, and records each turn's longest frame gap. "First-load JS" is every script the server HTML asks for, minus
// `noModule` polyfills. With --step=1 the audit then clicks Enter Teashop and
// records what loads after it and the longest frame gap while the room opens.
//
// Does not rewrite docs/perf-budget.md. Prints a markdown table and writes JSON.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const port = flag('port', '3161');
const base = flag('base', `http://127.0.0.1:${port}`);
const external = process.env.PERF_AUDIT_EXTERNAL === '1';
const outPath = resolve(repoRoot, flag('out', 'docs/perf-runs/latest.json'));
const runsPerProfile = Number(flag('runs', '3'));
const step = flag('step', '1') === '1';
const profiles = flag('profiles', 'desktop,mobile')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

// Chrome DevTools "Fast 4G": ~1.6 Mbps down, 750 Kbps up, 150 ms RTT.
const FAST_4G = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};

const PRESETS = {
  desktop: {
    label: 'desktop-1440x900',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    throttle: null,
    cpuRate: 1,
    settleMs: 3000,
    stepMs: 6000,
  },
  mobile: {
    label: 'mobile-390x844-fast4g',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    throttle: FAST_4G,
    cpuRate: 4,
    settleMs: 6000,
    stepMs: 12000,
  },
};

const TYPES = ['document', 'js', 'css', 'image', 'font', 'media', 'other'];

function classify(type, url) {
  if (type === 'Document') return 'document';
  if (type === 'Script' || /\.m?js(\?|$)/.test(url)) return 'js';
  if (type === 'Stylesheet' || /\.css(\?|$)/.test(url)) return 'css';
  if (type === 'Image' || /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(url))
    return 'image';
  if (type === 'Font' || /\.(woff2?|ttf|otf)(\?|$)/i.test(url)) return 'font';
  if (type === 'Media' || /\.(mp3|m4a|aac|ogg|opus|webm)(\?|$)/i.test(url))
    return 'media';
  return 'other';
}

function sumByType(requests) {
  const out = Object.fromEntries(TYPES.map((type) => [type, 0]));
  let total = 0;
  for (const request of requests) {
    out[request.kind] += request.bytes;
    total += request.bytes;
  }
  return { ...out, total };
}

async function waitForServer(url, ms = 120000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server did not become ready at ${url}`);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const median = (values) => {
  const sorted = values
    .filter((v) => typeof v === 'number')
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Runs in the page before any app code.
function probe() {
  const audit = (window.__audit = {
    ready: null,
    sketch: null,
    reading: null,
    fcp: null,
    lcp: null,
    longTasks: [],
    frames: null,
  });
  const observe = (type, fn) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({
        type,
        buffered: true,
      });
    } catch {
      /* unsupported entry type */
    }
  };
  observe('paint', (entry) => {
    if (entry.name === 'first-contentful-paint') audit.fcp = entry.startTime;
  });
  observe('largest-contentful-paint', (entry) => {
    audit.lcp = entry.startTime;
  });
  observe('longtask', (entry) => {
    audit.longTasks.push([entry.startTime, entry.duration]);
  });
  const check = () => {
    if (audit.sketch === null) {
      // First spread baked (pages 0 and 1 snapshotted for the curl) and turnable.
      const bake = document
        .querySelector('[data-bake]')
        ?.getAttribute('data-bake');
      const next = document.querySelector('button[aria-label="Next page"]');
      if (Number(bake) >= 2 && next && !next.disabled) {
        audit.sketch = performance.now();
        // Every frame from here to ready: long gaps are frozen reading.
        const gaps = (audit.reading = []);
        let last = audit.sketch;
        const tick = (now) => {
          if (now - last > 100)
            gaps.push([Math.round(last), Math.round(now - last)]);
          last = now;
          if (audit.ready === null) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }
    if (audit.ready !== null) return;
    const shell = document.querySelector('.app-shell');
    if (shell?.getAttribute('aria-busy') !== 'false') return;
    const enter = [...document.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Enter Teashop'),
    );
    if (enter && !enter.disabled) audit.ready = performance.now();
  };
  new MutationObserver(check).observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-busy', 'disabled', 'data-bake'],
  });
  // Frame gaps after Enter Teashop: a long gap is a visible hitch.
  audit.watchFrames = (ms) => {
    const start = performance.now();
    const frames = (audit.frames = { start, gaps: [] });
    let last = start;
    const tick = (now) => {
      frames.gaps.push(now - last);
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
}

async function measure(browser, preset) {
  const context = await browser.newContext({
    viewport: preset.viewport,
    deviceScaleFactor: preset.deviceScaleFactor,
    isMobile: preset.isMobile ?? false,
    hasTouch: preset.hasTouch ?? false,
  });
  await context.addInitScript(probe);
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  // A fresh context is a first visit; keep the cache so a repeat URL in the
  // same visit costs what it costs a real guest.
  await client.send('Network.enable');
  if (preset.throttle)
    await client.send('Network.emulateNetworkConditions', preset.throttle);
  if (preset.cpuRate > 1)
    await client.send('Emulation.setCPUThrottlingRate', {
      rate: preset.cpuRate,
    });

  const requests = new Map();
  let documentId = null;
  let origin = null;
  client.on('Network.requestWillBeSent', (event) => {
    if (!event.request.url.startsWith('http')) return;
    if (event.type === 'Document' && !documentId) {
      documentId = event.requestId;
      origin = event.timestamp;
    }
    requests.set(event.requestId, {
      url: event.request.url.replace(base, ''),
      type: event.type,
      start: event.timestamp,
      end: null,
      bytes: 0,
    });
  });
  client.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    request.end = event.timestamp;
    request.bytes = event.encodedDataLength;
  });

  await page.goto(base, { waitUntil: 'commit', timeout: 120000 });
  const sketchMs = await page
    .waitForFunction(() => window.__audit.sketch, null, {
      timeout: 120000,
      polling: 100,
    })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  // Read like a guest while the room loads: turn a page every 2 s, six times.
  // Each turn records its longest frame gap; a gap over 100 ms is a visible stutter.
  const turns = [];
  if (sketchMs !== null) {
    const next = page.getByRole('button', { name: 'Next page' });
    for (let i = 0; i < 6; i++) {
      const from = await page.evaluate(() => {
        window.__audit.watchFrames(1200);
        return performance.now();
      });
      await next.click({ timeout: 3000 }).catch(() => null);
      await page.waitForTimeout(1400);
      turns.push(
        await page.evaluate((from) => {
          const gaps = window.__audit.frames?.gaps.slice(1) ?? [];
          const tasks = window.__audit.longTasks.filter(
            ([start]) => start >= from && start < from + 1200,
          );
          return {
            atMs: Math.round(from),
            maxGapMs: gaps.length ? Math.round(Math.max(...gaps)) : null,
            longTaskMaxMs: tasks.length
              ? Math.round(Math.max(...tasks.map(([, d]) => d)))
              : 0,
          };
        }, from),
      );
      await page.waitForTimeout(600);
    }
  }
  const turn = turns.length
    ? {
        maxGapMs: Math.max(...turns.map((t) => t.maxGapMs ?? 0)),
        stutters: turns.filter((t) => t.maxGapMs > 100).length,
        turns,
      }
    : null;
  const readyMs = await page
    .waitForFunction(() => window.__audit.ready, null, {
      timeout: 120000,
      polling: 250,
    })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  await page.waitForTimeout(preset.settleMs);

  const body = documentId
    ? await client
        .send('Network.getResponseBody', { requestId: documentId })
        .then((r) => r.body)
        .catch(() => '')
    : '';
  const nomodule = new Set(
    [...body.matchAll(/<script[^>]*src="([^"]+)"[^>]*noModule/g)].map(
      (m) => m[1],
    ),
  );
  const firstLoadUrls = new Set(
    [...body.matchAll(/\/_next\/static\/chunks\/[\w.~-]+\.js/g)]
      .map((m) => m[0])
      .filter((url) => !nomodule.has(url)),
  );

  const at = (seconds) => (seconds - origin) * 1000;
  const finished = () =>
    [...requests.entries()]
      .filter(([, r]) => r.end !== null)
      .map(([id, r]) => ({
        id,
        url: r.url,
        kind: classify(r.type, r.url),
        bytes: r.bytes,
        startMs: Math.round(at(r.start)),
        endMs: Math.round(at(r.end)),
      }));

  const settledList = finished();
  const beforeSketch = settledList.filter(
    (r) => sketchMs !== null && r.endMs <= sketchMs,
  );
  const beforeReady = settledList.filter(
    (r) => readyMs !== null && r.endMs <= readyMs,
  );
  const firstLoad = settledList.filter(
    (r) => r.kind === 'js' && firstLoadUrls.has(r.url),
  );
  let threeChunk = null;
  for (const r of settledList.filter((x) => x.kind === 'js')) {
    const source = await client
      .send('Network.getResponseBody', { requestId: r.id })
      .then((x) => x.body)
      .catch(() => '');
    if (source.includes('THREE.WebGLRenderer')) {
      threeChunk = {
        url: r.url,
        bytes: r.bytes,
        endMs: r.endMs,
        inFirstLoad: firstLoadUrls.has(r.url),
      };
      break;
    }
  }

  const audit = await page.evaluate(() => ({
    reading: window.__audit.reading,
    fcp: window.__audit.fcp,
    lcp: window.__audit.lcp,
    longTasks: window.__audit.longTasks,
  }));

  let afterStep = null;
  if (step && readyMs !== null) {
    const enter = page.getByRole('button', { name: 'Enter Teashop' });
    const clickAt = await page.evaluate((ms) => {
      window.__audit.watchFrames(ms);
      return performance.now();
    }, preset.stepMs);
    await enter.click({ timeout: 10000 }).catch(() => null);
    await page.waitForTimeout(preset.stepMs + 500);
    const list = finished().filter((r) => r.startMs >= clickAt);
    const after = await page.evaluate((from) => {
      const { frames, longTasks } = window.__audit;
      // Skip the first gap: it spans the click itself.
      const gaps = frames?.gaps.slice(1) ?? [];
      const tasks = longTasks.filter(([start]) => start >= from);
      return {
        frames: gaps.length,
        maxGapMs: gaps.length ? Math.round(Math.max(...gaps)) : null,
        gapsOver100: gaps.filter((g) => g > 100).length,
        longTaskMaxMs: tasks.length
          ? Math.round(Math.max(...tasks.map(([, d]) => d)))
          : 0,
        longTaskTotalMs: Math.round(tasks.reduce((s, [, d]) => s + d, 0)),
      };
    }, clickAt);
    afterStep = {
      ...after,
      bytes: sumByType(list),
      requests: list.map(({ url, kind, bytes, endMs }) => ({
        url,
        kind,
        bytes,
        msAfterClick: Math.round(endMs - clickAt),
      })),
    };
  }

  const result = {
    profile: preset.label,
    viewport: preset.viewport,
    deviceScaleFactor: preset.deviceScaleFactor,
    throttle: preset.throttle ? 'fast4g' : 'none',
    cpuRate: preset.cpuRate,
    sketchMs: sketchMs === null ? null : Math.round(sketchMs),
    atSketch: sumByType(beforeSketch),
    turn,
    frozen: audit.reading && {
      over100: audit.reading.length,
      totalMs: audit.reading.reduce((sum, [, gap]) => sum + gap, 0),
      maxMs: Math.max(0, ...audit.reading.map(([, gap]) => gap)),
      gaps: audit.reading,
    },
    readyMs: readyMs === null ? null : Math.round(readyMs),
    fcpMs: audit.fcp === null ? null : Math.round(audit.fcp),
    lcpMs: audit.lcp === null ? null : Math.round(audit.lcp),
    longTaskBeforeReadyMs: Math.round(
      audit.longTasks
        .filter(([start]) => readyMs === null || start < readyMs)
        .reduce((s, [, d]) => s + d, 0),
    ),
    firstLoadJs: sumByType(firstLoad).js,
    firstLoadScripts: firstLoad.length,
    threeChunk,
    atReady: sumByType(beforeReady),
    settled: sumByType(settledList),
    afterStep,
    top: [...settledList]
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 20)
      .map(({ url, kind, bytes, startMs, endMs }) => ({
        url,
        kind,
        bytes,
        startMs,
        endMs,
      })),
  };
  await context.close();
  return result;
}

for (const name of profiles)
  if (!PRESETS[name]) throw new Error(`Unknown profile ${name}`);

let server = null;
if (!external) {
  // Node plus the next entry directly, not npx or the .bin shim (a POSIX
  // script that Windows cannot spawn), so the kill below reaches the server.
  const next = resolve(repoRoot, 'node_modules/next/dist/bin/next');
  server = spawn(
    process.execPath,
    [next, 'start', '--hostname', '127.0.0.1', '-p', port],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: port },
    },
  );
  server.stdout.on('data', (chunk) => process.stderr.write(chunk));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));
}

const runs = [];
let browser = null;
try {
  await waitForServer(base);
  browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: [
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
    ],
  });
  for (const name of profiles) {
    const preset = PRESETS[name];
    for (let i = 0; i < runsPerProfile; i++) {
      process.stderr.write(`Measuring ${preset.label} run ${i + 1}…\n`);
      runs.push(await measure(browser, preset));
    }
  }
} finally {
  // A throw above must not leave `next start` holding the port.
  await browser?.close().catch(() => {});
  if (server) {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    try {
      server.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }
}

const summary = profiles.map((name) => {
  const label = PRESETS[name].label;
  const mine = runs.filter((run) => run.profile === label);
  const pick = (fn) => median(mine.map(fn));
  return {
    profile: label,
    runs: mine.length,
    sketchMs: pick((r) => r.sketchMs),
    sketchRuns: mine.map((r) => r.sketchMs),
    atSketch: pick((r) => r.atSketch.total),
    turnMaxGapMs: pick((r) => r.turn?.maxGapMs),
    turnStutters: pick((r) => r.turn?.stutters),
    frozenTotalMs: pick((r) => r.frozen?.totalMs),
    frozenMaxMs: pick((r) => r.frozen?.maxMs),
    readyMs: pick((r) => r.readyMs),
    readyRuns: mine.map((r) => r.readyMs),
    fcpMs: pick((r) => r.fcpMs),
    lcpMs: pick((r) => r.lcpMs),
    firstLoadJs: pick((r) => r.firstLoadJs),
    threeInFirstLoad: mine.some((r) => r.threeChunk?.inFirstLoad),
    atReady: Object.fromEntries(
      [...TYPES, 'total'].map((t) => [t, pick((r) => r.atReady[t])]),
    ),
    settled: Object.fromEntries(
      [...TYPES, 'total'].map((t) => [t, pick((r) => r.settled[t])]),
    ),
    afterStep: step
      ? {
          bytes: pick((r) => r.afterStep?.bytes.total),
          maxGapMs: pick((r) => r.afterStep?.maxGapMs),
          gapsOver100: pick((r) => r.afterStep?.gapsOver100),
          longTaskMaxMs: pick((r) => r.afterStep?.longTaskMaxMs),
        }
      : null,
  };
});

const report = { measuredAt: new Date().toISOString(), base, summary, runs };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  `Measured ${report.measuredAt} against \`${base}\` (medians).`,
  '',
];
for (const s of summary) {
  lines.push(
    `### ${s.profile} (${s.runs} runs)`,
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Sketchbook first spread turnable | ${s.sketchMs ?? 'timeout'} ms (${s.sketchRuns.join(', ')}) |`,
    `| Wire before first spread | ${kb(s.atSketch ?? 0)} |`,
    `| Six page turns while the room loads: longest frame gap | ${s.turnMaxGapMs} ms (${s.turnStutters} turns over 100 ms) |`,
    `| Frozen frames, first spread to ready (gaps over 100 ms) | ${s.frozenTotalMs} ms total, longest ${s.frozenMaxMs} ms |`,
    `| Ready (Enter Teashop enabled) | ${s.readyMs ?? 'timeout'} ms (${s.readyRuns.join(', ')}) |`,
    `| FCP / LCP | ${s.fcpMs} / ${s.lcpMs} ms |`,
    `| First-load JS | ${kb(s.firstLoadJs ?? 0)} |`,
    `| three.js in first load | ${s.threeInFirstLoad} |`,
    `| Wire at ready | ${kb(s.atReady.total ?? 0)} |`,
    `| Wire after settle | ${kb(s.settled.total ?? 0)} |`,
    ...TYPES.map((t) => `| · ${t} (settled) | ${kb(s.settled[t] ?? 0)} |`),
    ...(s.afterStep
      ? [
          `| Wire after Enter Teashop | ${kb(s.afterStep.bytes ?? 0)} |`,
          `| Longest frame gap after Enter Teashop | ${s.afterStep.maxGapMs} ms |`,
          `| Frames over 100 ms after Enter Teashop | ${s.afterStep.gapsOver100} |`,
          `| Longest task after Enter Teashop | ${s.afterStep.longTaskMaxMs} ms |`,
        ]
      : []),
    '',
  );
}
console.log(lines.join('\n'));
console.log(`Wrote ${outPath}`);
process.exit(0);
