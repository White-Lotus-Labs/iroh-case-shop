#!/usr/bin/env node
/**
 * Live smoke against a running Next dev server (default http://127.0.0.1:3102).
 * Exits non-zero on any 5xx.
 */
const base = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3102';

const tickers = [
  ['robinhood', 'NET'],
  ['robinhood', 'SHROOM'],
  ['robinhood', 'ARB'],
  ['robinhood', 'UNI'],
  ['bullrun', 'BTC'],
  ['bullrun', 'ETH'],
  ['bullrun', 'HYPE'],
  ['bullrun', 'SOL'],
  ['ai', 'VVV'],
  ['ai', 'SNDK'],
  ['ai', 'NVDA'],
  ['ai', 'MU'],
];

function sectionStatus(section) {
  return section?.status ?? '?';
}

async function hit(path) {
  const started = Date.now();
  const response = await fetch(`${base}${path}`, { cache: 'no-store' });
  const ms = Date.now() - started;
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { path, status: response.status, ms, body };
}

function row(label, status, ms, extra = '') {
  return `${label.padEnd(28)} ${String(status).padStart(3)}  ${String(ms).padStart(5)}ms  ${extra}`;
}

let failed = false;
const lines = [];

const deck = await hit('/api/theses');
if (deck.status >= 500) failed = true;
const thesisExtra = deck.body?.theses
  ? deck.body.theses
      .map(
        (thesis) =>
          `${thesis.id}:${thesis.conviction?.level ?? '?'}(${thesis.tickers?.map((t) => t.status).join(',')})`,
      )
      .join(' | ')
  : deck.body?.error ?? '';
lines.push(row('GET /api/theses', deck.status, deck.ms, thesisExtra));

for (const [thesisId, symbol] of tickers) {
  const result = await hit(`/api/theses/${thesisId}/${symbol}`);
  if (result.status >= 500) failed = true;
  const extra =
    result.status === 200 && result.body
      ? `mov=${sectionStatus(result.body.movements)} hold=${sectionStatus(result.body.holders)} sup=${sectionStatus(result.body.supply)} perp=${sectionStatus(result.body.perps)}${result.body.stale ? ' stale' : ''}`
      : result.body?.error ?? '';
  lines.push(
    row(`GET /api/theses/${thesisId}/${symbol}`, result.status, result.ms, extra),
  );
}

console.log(`nansen-smoke base=${base}`);
console.log(lines.join('\n'));
if (failed) {
  console.error('smoke failed: one or more 5xx responses');
  process.exit(1);
}
console.log('smoke ok');
