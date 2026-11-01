import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NANSEN_WARMING_MESSAGE } from '../src/nansen/snapshot-store';
import { openTempDb } from './temp-sqlite';

let temp: ReturnType<typeof openTempDb>;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NANSEN_API_KEY', 'server-only-secret');
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

test('GET reads the saved leaderboard and does not call Nansen', async () => {
  const upstream = vi.fn().mockResolvedValue(
    Response.json({
      data: [
        {
          trader_address: `0x${'1'.repeat(40)}`,
          trader_address_label: 'Observed Trader',
          total_pnl: 4200,
          roi: 0.12,
          account_value: null,
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', upstream);
  const { writeNansenSnapshot } = await import('../src/nansen/snapshot-store');
  const { DEFAULT_LEADERBOARD_CACHE_KEY: LEADERBOARD_CACHE_KEY } = await import(
    '../src/leaderboard/boards'
  );
  const savedAt = Date.parse('2026-09-27T12:00:00Z');
  await writeNansenSnapshot(
    temp.db,
    LEADERBOARD_CACHE_KEY,
    {
      entries: [
        {
          rank: 1,
          address: `0x${'1'.repeat(40)}`,
          displayName: 'Observed Trader',
          pnl: 4200,
          roi: 0.12,
          accountValue: null,
        },
      ],
    },
    savedAt,
  );
  const { GET } = await import('../src/app/api/smart-wallet-leaderboard/route');
  const first = await GET();
  const second = await GET();
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(upstream).not.toHaveBeenCalled();
  const body = await first.text();
  expect(await second.text()).toBe(body);
  expect(body).not.toContain('server-only-secret');
  expect(body).toContain(new Date(savedAt).toISOString());
  expect(first.headers.get('cache-control')).toBe('no-store');
});

test('GET returns a safe error when no key exists and never calls Nansen', async () => {
  vi.stubEnv('NANSEN_API_KEY', '');
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  const { GET } = await import('../src/app/api/smart-wallet-leaderboard/route');
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: 'Nansen API is not configured.',
  });
  expect(upstream).not.toHaveBeenCalled();
});

test('GET says readings are still being saved when the database is empty', async () => {
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  const { GET } = await import('../src/app/api/smart-wallet-leaderboard/route');
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: NANSEN_WARMING_MESSAGE });
  expect(upstream).not.toHaveBeenCalled();
});

test('GET reads the board and sort named in the query', async () => {
  const { writeNansenSnapshot } = await import('../src/nansen/snapshot-store');
  const { boardCacheKey } = await import('../src/leaderboard/boards');
  await writeNansenSnapshot(
    temp.db,
    boardCacheKey('whales', 'roi'),
    {
      entries: [
        {
          rank: 1,
          address: `0x${'2'.repeat(40)}`,
          displayName: 'Whale Trader',
          pnl: 10,
          roi: 2,
          accountValue: null,
        },
      ],
    },
    Date.parse('2026-09-27T12:00:00Z'),
  );
  const { GET } = await import('../src/app/api/smart-wallet-leaderboard/route');
  const response = await GET(
    new Request(
      'http://127.0.0.1/api/smart-wallet-leaderboard?board=whales&metric=roi',
    ),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    entries: { displayName: string }[];
  };
  expect(body.entries[0]?.displayName).toBe('Whale Trader');
});

test('GET falls back to a sort the meme board has', async () => {
  const { writeNansenSnapshot } = await import('../src/nansen/snapshot-store');
  const { boardCacheKey } = await import('../src/leaderboard/boards');
  const saved = (displayName: string) => ({
    entries: [
      {
        rank: 1,
        address: `0x${'3'.repeat(40)}`,
        displayName,
        pnl: 10,
        roi: 2,
        accountValue: null,
        chains: ['robinhood'],
      },
    ],
  });
  const at = Date.parse('2026-09-27T12:00:00Z');
  await writeNansenSnapshot(
    temp.db,
    boardCacheKey('meme', 'wins'),
    saved('Meme Wins'),
    at,
  );
  await writeNansenSnapshot(
    temp.db,
    boardCacheKey('meme', 'roi'),
    saved('Meme Roi'),
    at,
  );
  const { GET } = await import('../src/app/api/smart-wallet-leaderboard/route');
  const read = async (query: string) => {
    const response = await GET(
      new Request(`http://127.0.0.1/api/smart-wallet-leaderboard?${query}`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: { displayName: string }[];
    };
    return body.entries[0]?.displayName;
  };
  expect(await read('board=meme&metric=account')).toBe('Meme Wins');
  expect(await read('board=meme&metric=roi')).toBe('Meme Roi');
});
