import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NANSEN_WARMING_MESSAGE } from '../src/nansen/snapshot-store';
import { THESES } from '../src/thesis/deck';
import { mockNansen, stubNansenLimits } from './nansen-mock';
import { openTempDb } from './temp-sqlite';

const flowOk = {
  data: [
    {
      smart_trader_net_flow_usd: 1000,
      whale_net_flow_usd: 100,
      exchange_net_flow_usd: -50,
      smart_trader_wallet_count: 3,
    },
  ],
};

const positionOk = {
  data: [
    {
      smart_trader_longs_usd: 5000,
      smart_trader_shorts_usd: 2000,
      smart_trader_total_usd: 7000,
    },
  ],
};

let temp: ReturnType<typeof openTempDb>;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NANSEN_API_KEY', 'server-only-secret');
  stubNansenLimits();
  temp = openTempDb();
  const db: PrismaClient = temp.db;
  vi.doMock('../src/auth/db', () => ({ db }));
});

afterEach(async () => {
  vi.doUnmock('../src/auth/db');
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await temp.close();
});

describe('GET /api/theses', () => {
  test('returns a saved deck and does not call Nansen while reading', async () => {
    mockNansen((path) => {
      if (path === 'tgm/position-intelligence') return positionOk;
      if (path === 'tgm/flow-intelligence') return flowOk;
      if (path === 'tgm/token-information') return { data: {} };
      if (path === 'perp-leaderboard')
        return {
          data: [
            {
              trader_address: `0x${'c'.repeat(40)}`,
              total_pnl: 1,
              roi: 0.1,
              account_value: 2,
            },
          ],
        };
      return { data: [] };
    });
    const { refreshSavedNansenData } = await import('../src/nansen/refresh');
    await refreshSavedNansenData(temp.db, 'server-only-secret');
    const upstream = vi.mocked(fetch);
    const callsBeforeRead = upstream.mock.calls.length;
    const { GET } = await import('../src/app/api/theses/route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.source).toBe('nansen');
    expect(body.stale).toBe(false);
    expect(body.theses).toHaveLength(3);
    expect(body.theses[0].tickers).toHaveLength(4);
    expect(JSON.stringify(body)).not.toContain('server-only-secret');
    const symbols = body.theses.flatMap(
      (thesis: { tickers: { symbol: string }[] }) =>
        thesis.tickers.map((ticker) => ticker.symbol),
    );
    expect(symbols).toContain('BTC');
    expect(symbols).toContain('SHROOM');
    expect(upstream.mock.calls).toHaveLength(callsBeforeRead);
  });

  test('keeps the deck when one ticker upstream fails', async () => {
    mockNansen((path, body) => {
      const record = body as { token_address?: string };
      if (
        path === 'tgm/flow-intelligence' &&
        record.token_address === '0xCA9c78Dd337A67F6e0077F65F5E9218719d30eDf'
      )
        throw new Error('HTTP:502');
      if (path === 'tgm/position-intelligence') return positionOk;
      if (path === 'tgm/flow-intelligence') return flowOk;
      if (path === 'tgm/token-information') return { data: {} };
      if (path === 'perp-leaderboard') return { data: [] };
      return { data: [] };
    });
    const { refreshSavedNansenData } = await import('../src/nansen/refresh');
    await refreshSavedNansenData(temp.db, 'server-only-secret');
    const { GET } = await import('../src/app/api/theses/route');
    const body = await (await GET()).json();
    const net = body.theses
      .find((thesis: { id: string }) => thesis.id === 'robinhood')
      .tickers.find((ticker: { symbol: string }) => ticker.symbol === 'NET');
    expect(net.status).toBe('error');
    expect(
      body.theses[0].tickers.some((t: { status: string }) => t.status === 'ok'),
    ).toBe(true);
  });

  test('returns 503 when Nansen is not configured and nothing is saved', async () => {
    vi.stubEnv('NANSEN_API_KEY', '');
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('../src/app/api/theses/route');
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Nansen is not configured.',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  test('says the shop is still saving readings when the key exists and the database is empty', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('../src/app/api/theses/route');
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: NANSEN_WARMING_MESSAGE });
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('GET /api/theses/[thesisId]/[symbol]', () => {
  test('returns 404 for unknown ids without calling Nansen', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import(
      '../src/app/api/theses/[thesisId]/[symbol]/route'
    );
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ thesisId: 'nope', symbol: 'BTC' }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Unknown thesis or symbol.',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  test('returns a saved ticker detail and does not call Nansen while reading', async () => {
    mockNansen((path) => {
      if (path === 'tgm/who-bought-sold')
        return {
          data: [
            {
              address: '0xabc',
              address_label: 'Smart Trader',
              bought_volume_usd: 10,
              sold_volume_usd: 0,
            },
          ],
        };
      if (path === 'tgm/dex-trades')
        return {
          data: [
            {
              trader_address: '0xabc',
              trader_address_label: 'Smart Trader',
              action: 'BUY',
              estimated_value_usd: 10,
              block_timestamp: '2026-09-26T00:00:00Z',
              transaction_hash: '0x1',
            },
          ],
        };
      if (path === 'tgm/holders')
        return {
          data: [
            {
              address: '0xabc',
              address_label: 'Fund',
              value_usd: 100,
              ownership_percentage: 0.01,
              balance_change_7d: 1,
              token_amount: 2,
            },
          ],
        };
      if (path === 'tgm/token-information')
        return {
          data: {
            token_details: {
              circulating_supply: 50,
              total_supply: 100,
            },
            spot_metrics: { total_holders: 9 },
          },
        };
      if (path === 'tgm/position-intelligence') return positionOk;
      if (path === 'smart-money/perp-trades') return { data: [] };
      if (path === 'tgm/flow-intelligence') return flowOk;
      if (path === 'perp-leaderboard') return { data: [] };
      return { data: [] };
    });
    const { refreshSavedNansenData } = await import('../src/nansen/refresh');
    await refreshSavedNansenData(temp.db, 'server-only-secret');
    const callsBeforeRead = vi.mocked(fetch).mock.calls.length;
    const { GET } = await import(
      '../src/app/api/theses/[thesisId]/[symbol]/route'
    );
    const ticker = THESES[0].tickers.find((row) => row.symbol === 'ARB')!;
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ thesisId: 'robinhood', symbol: ticker.symbol }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.symbol).toBe('ARB');
    expect(body.movements.status).toBe('ok');
    expect(body.holders.status).toBe('ok');
    expect(body.supply.status).toBe('ok');
    expect(body.perps.status).toBe('ok');
    expect(vi.mocked(fetch).mock.calls).toHaveLength(callsBeforeRead);
  });

  test('marks solana spot sections not-applicable without calling them', async () => {
    const called: string[] = [];
    mockNansen((path) => {
      called.push(path);
      if (path === 'tgm/position-intelligence') return positionOk;
      if (path === 'smart-money/perp-trades') return { data: [] };
      throw new Error(`unexpected ${path}`);
    });
    const { loadTickerDetail } = await import('../src/thesis/nansen');
    const detail = await loadTickerDetail(
      'bullrun',
      'SOL',
      'server-only-secret',
    );
    expect(detail?.movements.status).toBe('not-applicable');
    expect(detail?.holders.status).toBe('not-applicable');
    expect(detail?.supply.status).toBe('not-applicable');
    expect(detail?.perps.status).toBe('ok');
    expect(called.every((path) => !path.includes('who-bought-sold'))).toBe(
      true,
    );
    expect(called.every((path) => !path.includes('holders'))).toBe(true);
  });
});
