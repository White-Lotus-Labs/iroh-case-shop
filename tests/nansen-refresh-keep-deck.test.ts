import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NANSEN_REFRESH_MS } from '../src/nansen/snapshot-store';
import type { ThesisSummary } from '../src/thesis/types';
import { stubNansenLimits } from './nansen-mock';
import { openTempDb } from './temp-sqlite';

beforeEach(() => {
  vi.resetModules();
  stubNansenLimits();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('a refresh with more ticker errors keeps the saved deck and marks it stale', async () => {
  const temp = openTempDb();
  let failFlow = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace('https://api.nansen.ai/api/v1/', '');
      if (path === 'tgm/flow-intelligence') {
        if (failFlow) return new Response('fail', { status: 502 });
        return Response.json({
          data: [
            {
              smart_trader_net_flow_usd: 1000,
              whale_net_flow_usd: 100,
              exchange_net_flow_usd: -50,
              smart_trader_wallet_count: 3,
            },
          ],
        });
      }
      if (path === 'tgm/position-intelligence')
        return Response.json({
          data: [
            {
              smart_trader_longs_usd: 5000,
              smart_trader_shorts_usd: 2000,
              smart_trader_total_usd: 7000,
            },
          ],
        });
      return Response.json({ data: [] });
    }),
  );
  try {
    const { refreshSavedNansenData } = await import('../src/nansen/refresh');
    const { readNansenSnapshot } = await import('../src/nansen/snapshot-store');
    const { DECK_CACHE_KEY } = await import('../src/thesis/nansen');
    const now = Date.parse('2026-09-27T12:00:00Z');
    const first = await refreshSavedNansenData(temp.db, 'key', now);
    expect(first.saved).toContain(DECK_CACHE_KEY);
    failFlow = true;
    const later = now + NANSEN_REFRESH_MS;
    const again = await refreshSavedNansenData(temp.db, 'key', later);
    expect(again.kept).toContain(DECK_CACHE_KEY);
    const deck = await readNansenSnapshot<{ theses: ThesisSummary[] }>(
      temp.db,
      DECK_CACHE_KEY,
      later,
    );
    expect(deck?.stale).toBe(true);
    expect(deck?.refreshError).toMatch(/more ticker errors/);
    expect(deck?.fetchedAt).toBe('2026-09-27T12:00:00.000Z');
    const tickers = deck?.theses.flatMap((thesis) => thesis.tickers) ?? [];
    expect(tickers.length).toBeGreaterThan(0);
    expect(tickers.every((ticker) => ticker.status === 'ok')).toBe(true);
  } finally {
    await temp.close();
  }
});
