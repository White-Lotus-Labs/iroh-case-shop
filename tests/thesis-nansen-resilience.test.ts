import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  countErroredTickers,
  loadDeckSnapshot,
  mapPool,
  preferExistingDeck,
} from '../src/thesis/nansen';
import type { ThesisSummary } from '../src/thesis/types';

beforeEach(() => {
  vi.stubEnv('NANSEN_API_KEY', 'test-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('mapPool concurrency', () => {
  test('never runs more than the concurrency cap at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const started: number[] = [];
    await mapPool([1, 2, 3, 4, 5, 6, 7, 8], 4, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      started.push(item);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return item * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(started).toHaveLength(8);
  });
});

describe('preferExistingDeck', () => {
  const ok = (symbol: string) => ({
    symbol,
    status: 'ok' as const,
    source: 'flow-intelligence' as const,
    smartMoneyNetFlowUsd: 1,
    whaleNetFlowUsd: null,
    exchangeNetFlowUsd: null,
    smartMoneyWallets: 1,
  });
  const err = (symbol: string) => ({
    symbol,
    status: 'error' as const,
    source: 'flow-intelligence' as const,
    smartMoneyNetFlowUsd: null,
    whaleNetFlowUsd: null,
    exchangeNetFlowUsd: null,
    smartMoneyWallets: null,
  });

  test('keeps the cached snapshot when a refresh is worse', () => {
    const existing: ThesisSummary[] = [
      {
        id: 'ai',
        conviction: {
          level: 'strong',
          accumulating: 1,
          measured: 1,
          netFlowUsd: 1,
        },
        tickers: [ok('VVV'), ok('NVDA')],
      },
    ];
    const fresh: ThesisSummary[] = [
      {
        id: 'ai',
        conviction: {
          level: 'unknown',
          accumulating: 0,
          measured: 0,
          netFlowUsd: 0,
        },
        tickers: [err('VVV'), err('NVDA')],
      },
    ];
    expect(countErroredTickers(fresh)).toBe(2);
    expect(countErroredTickers(existing)).toBe(0);
    expect(preferExistingDeck({ theses: fresh }, { theses: existing })).toMatch(
      /more ticker errors/,
    );
  });
});

describe('loadDeckSnapshot resilience', () => {
  test('retries a failing ticker once and caps concurrent upstream calls', async () => {
    let inFlight = 0;
    let peak = 0;
    const attempts = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const path = String(url);
        attempts.set(path, (attempts.get(path) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        if (
          path.includes('flow-intelligence') &&
          (attempts.get(path) ?? 0) === 1
        ) {
          return new Response('rate', {
            status: 429,
            headers: { 'retry-after': '1' },
          });
        }
        if (path.includes('position-intelligence')) {
          return Response.json({
            data: [
              {
                smart_trader_longs_usd: 5,
                smart_trader_shorts_usd: 1,
                smart_trader_wallet_count: 2,
              },
            ],
          });
        }
        return Response.json({
          data: [
            {
              smart_trader_net_flow_usd: 10,
              whale_net_flow_usd: 1,
              exchange_net_flow_usd: -1,
              smart_trader_wallet_count: 2,
            },
          ],
        });
      }),
    );

    const deck = await loadDeckSnapshot('test-key', {
      concurrency: 4,
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(deck.theses).toHaveLength(3);
    expect(
      deck.theses.every((thesis) =>
        thesis.tickers.every((ticker) => ticker.status === 'ok'),
      ),
    ).toBe(true);
    expect([...attempts.values()].some((count) => count >= 2)).toBe(true);
  });
});
