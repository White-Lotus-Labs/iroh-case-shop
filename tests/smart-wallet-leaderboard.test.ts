import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  boardCacheKey,
  DEFAULT_LEADERBOARD_CACHE_KEY,
  leaderboardRefreshTargets,
  parseMetric,
} from '../src/leaderboard/boards';
import {
  normalizeLeaderboard,
  formatMoney,
  formatRoi,
} from '../src/leaderboard/model';
import { fetchNansenLeaderboard } from '../src/leaderboard/provider';

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const row = (n: number, overrides: Record<string, unknown> = {}) => ({
  trader_address: address(n),
  trader_address_label: n === 1 ? 'Alpha Trader' : null,
  total_pnl: 1_000_000 - n * 1000,
  roi: 0.274,
  account_value: 4_600_000,
  ...overrides,
});

describe('leaderboard boards', () => {
  test('saves 15 Hyperliquid rows and 2 meme rows under stable keys', () => {
    const targets = leaderboardRefreshTargets();
    expect(targets).toHaveLength(17);
    expect(targets[0]!.key).toBe(DEFAULT_LEADERBOARD_CACHE_KEY);
    expect(boardCacheKey('whales', 'holdings')).toBe(
      'smart-wallet-leaderboard:hl:whales:account:30d:top-10',
    );
    expect(targets.filter((target) => target.board === 'meme')).toEqual([
      {
        board: 'meme',
        metric: 'wins',
        key: 'smart-wallet-leaderboard:meme:wins:30d:top-10',
      },
      {
        board: 'meme',
        metric: 'roi',
        key: 'smart-wallet-leaderboard:meme:roi:30d:top-10',
      },
    ]);
  });

  test('a sort the board does not have falls back to biggest wins', () => {
    expect(parseMetric('account', 'perps')).toBe('account');
    expect(parseMetric('account', 'meme')).toBe('wins');
    expect(parseMetric('roi', 'meme')).toBe('roi');
    expect(parseMetric(null, 'meme')).toBe('wins');
    expect(parseMetric('nonsense', 'whales')).toBe('wins');
  });
});

describe('Nansen leaderboard provider', () => {
  afterEach(() => vi.restoreAllMocks());

  test('requests the real endpoint with server auth and the 30-day Smart HL query', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ data: [row(1)] }));
    const now = Date.parse('2026-09-25T12:34:00Z');
    const entries = await fetchNansenLeaderboard('private-key', now, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.nansen.ai/api/v1/perp-leaderboard');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      apikey: 'private-key',
      'content-type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      date: { from: '2026-08-26', to: '2026-09-25' },
      pagination: { page: 1, per_page: 10 },
      filters: { include_smart_money_labels: ['Smart HL Perps Trader'] },
      premium_labels: false,
      order_by: [{ field: 'total_pnl', direction: 'DESC' }],
    });
    expect(entries[0]).toMatchObject({ rank: 1, displayName: 'Alpha Trader' });
  });

  test('asks Nansen for Smart Money labels and the whale account floor', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => Response.json({ data: [row(1)] }));
    const now = Date.parse('2026-09-25T12:34:00Z');
    await fetchNansenLeaderboard(
      'private-key',
      now,
      fetcher,
      'smart-money',
      'roi',
    );
    await fetchNansenLeaderboard(
      'private-key',
      now,
      fetcher,
      'whales',
      'losses',
    );
    const bodies = fetcher.mock.calls.map((call) =>
      JSON.parse((call as [string, RequestInit])[1].body as string),
    );
    expect(bodies[0].filters.include_smart_money_labels).toEqual([
      'Fund',
      'Smart Trader',
      '30D Smart Trader',
      '90D Smart Trader',
      '180D Smart Trader',
    ]);
    expect(bodies[0].order_by).toEqual([{ field: 'roi', direction: 'DESC' }]);
    expect(bodies[1].filters).toEqual({
      account_value: { min: 10_000_000 },
    });
    expect(bodies[1].order_by).toEqual([
      { field: 'total_pnl', direction: 'ASC' },
    ]);
  });

  test('normalizes Top 10, address fallback, missing values and fractional ROI', () => {
    const records = Array.from({ length: 12 }, (_, i) => row(i + 1));
    records[1] = row(2, {
      trader_address_label: 'Smart HL Perps Trader',
      total_pnl: null,
      roi: -0.082,
      account_value: null,
    });
    const entries = normalizeLeaderboard({ data: records });
    expect(entries).toHaveLength(10);
    expect(entries.map((entry) => entry.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(entries[0].displayName).toBe('Alpha Trader');
    expect(entries[1].displayName).toBe('0x0000...0002');
    expect(entries[1]).toMatchObject({
      pnl: null,
      roi: -0.082,
      accountValue: null,
    });
    expect(formatMoney(1_820_000, true)).toBe('+$1.82M');
    expect(formatMoney(-482_000, true)).toBe('-$482K');
    expect(formatMoney(4_600_000)).toBe('$4.60M');
    expect(formatMoney(null)).toBe('—');
    // Rounding can cross a unit or a decimals boundary.
    expect(formatMoney(999_600)).toBe('$1.00M');
    expect(formatMoney(999_700_000)).toBe('$1.00B');
    expect(formatMoney(9_999_999)).toBe('$10.0M');
    expect(formatMoney(9_995)).toBe('$10.0K');
    expect(formatMoney(-9_995_000_000)).toBe('-$10.0B');
    expect(formatMoney(999_500)).toBe('$1.00M');
    expect(formatMoney(99_960)).toBe('$100K');
    expect(formatMoney(999.6)).toBe('$1.00K');
    expect(formatMoney(412)).toBe('$412');
    expect(formatMoney(2_500_000_000_000)).toBe('$2,500B');
    expect(formatRoi(0.274)).toBe('+27.4%');
    expect(formatRoi(-0.082)).toBe('-8.2%');
    expect(formatRoi(null)).toBe('—');
    expect(normalizeLeaderboard({ data: [] })).toEqual([]);
  });

  test('keeps trading detail and the three largest open positions', () => {
    const position = (coin: unknown, side: unknown) => ({
      coin,
      side,
      position_value_usd: 9_627_600,
      unrealized_pnl_usd: -416_477,
    });
    const [entry] = normalizeLeaderboard({
      data: [
        row(1, {
          realized_pnl_usd: 7_411_990,
          unrealized_pnl_usd: 1_305_889,
          volume_usd: 176_761_142,
          total_trades: 57_013,
          top_positions: [
            position('xyz:MU', 'long'),
            position(42, 'long'),
            position('SOL', 'sideways'),
            position('ZEC', 'short'),
            position('BTC', 'long'),
            position('ETH', 'long'),
          ],
        }),
      ],
    });
    expect(entry).toMatchObject({
      realizedPnl: 7_411_990,
      unrealizedPnl: 1_305_889,
      volume: 176_761_142,
      trades: 57_013,
    });
    expect(entry.positions).toEqual([
      {
        coin: 'MU',
        side: 'long',
        valueUsd: 9_627_600,
        unrealizedPnl: -416_477,
      },
      expect.objectContaining({ coin: 'ZEC', side: 'short' }),
      expect.objectContaining({ coin: 'BTC' }),
    ]);
    expect(normalizeLeaderboard({ data: [row(2)] })[0]).toMatchObject({
      volume: null,
      trades: null,
      positions: [],
    });
  });

  test('reports safe errors for absent key and failed Nansen calls', async () => {
    const fetcher = vi.fn();
    await expect(
      fetchNansenLeaderboard('', Date.now(), fetcher),
    ).rejects.toMatchObject({
      message: 'Nansen API is not configured.',
      status: 503,
    });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(
      new Response('secret upstream body', {
        status: 429,
        headers: { 'retry-after': '120' },
      }),
    );
    await expect(
      fetchNansenLeaderboard('key', Date.now(), fetcher),
    ).rejects.toMatchObject({
      message: 'Too many requests. Please try again shortly.',
      status: 429,
      retryAfterMs: 120_000,
    });
  });
});
