import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  cleanLabel,
  isMemeToken,
  rankMeme,
  type fetchMemePool as FetchMemePool,
} from '../src/leaderboard/meme';
import {
  chainLabel,
  type SmartWalletLeaderboardEntry,
} from '../src/leaderboard/model';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/nansen');
const load = (name: string) =>
  JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;

type Row = {
  address: string;
  address_label: string;
  realized_pnl_usd: number;
  avg_trade_roi: number;
  win_rate: number;
  n_trades: number;
};
const leaderboard = load('smart-money-pnl-leaderboard.json') as {
  data: Row[];
};
const ogle = load('profiler-pnl-summary__entity-ogle.json');
const salem = load('profiler-pnl-summary__entity-Salem.json');
const cooker = load('profiler-pnl-summary__entity-Cooker.json');
const unknown = load('profiler-pnl-summary__entity-unknown.json');
const now = Date.parse('2026-09-28T12:00:00Z');

/** A Nansen stub. Entity lookups answer from `summaries` (a number is an HTTP error) or with the zero response. */
function nansen(
  summaries: Record<string, object | number> = {},
  board: object | number = leaderboard,
) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let active = 0;
  let peak = 0;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('https://api.nansen.ai/api/v1/', '');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path, body });
    const answer =
      path === 'smart-money/pnl-leaderboard'
        ? board
        : (summaries[body.entity_name as string] ?? unknown);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return typeof answer === 'number'
      ? new Response('fail', { status: answer })
      : Response.json(answer);
  });
  const lookups = () =>
    calls.filter((call) => call.path === 'profiler/address/pnl-summary');
  return {
    fetcher: fetcher as unknown as typeof fetch,
    calls,
    lookups,
    peak: () => peak,
  };
}

let fetchMemePool: typeof FetchMemePool;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('NANSEN_REQUEST_STARTS_PER_SECOND', '1000');
  vi.stubEnv('NANSEN_REQUEST_START_BURST', '1000');
  vi.stubEnv('NANSEN_JSON_MAX_RETRIES', '0');
  ({ fetchMemePool } = await import('../src/leaderboard/meme'));
});

afterEach(() => vi.unstubAllEnvs());

const byAddress = (pool: SmartWalletLeaderboardEntry[], prefix: string) =>
  pool.find((entry) => entry.address.startsWith(prefix));

describe('meme leaderboard request', () => {
  test('asks for all 18 Smart Money chains by name, 30 days, realized PnL, 100 rows', async () => {
    const stub = nansen();
    await fetchMemePool('key', now, stub.fetcher);
    const body = stub.calls[0]!.body as { chains: string[] };
    expect(stub.calls[0]!.path).toBe('smart-money/pnl-leaderboard');
    expect(body).toEqual({
      chains: expect.any(Array),
      timeframe: 30,
      order_by: [{ field: 'realized_pnl_usd', direction: 'DESC' }],
      pagination: { page: 1, per_page: 100 },
    });
    expect(body.chains).toHaveLength(18);
    expect(body.chains).toContain('bnb');
    expect(body.chains).toContain('solana');
    expect(body.chains).not.toContain('all');
    expect(stub.lookups()[0]!.body).toEqual({
      entity_name: 'Salem',
      chain: 'all',
      date: { from: '2026-08-29', to: '2026-09-28' },
    });
  });
});

describe('meme filter and labels', () => {
  test('majors, staked and wrapped tokens, stocks and PUMP are not memes', () => {
    expect(isMemeToken('WEETH', 'Wrapped eETH')).toBe(false);
    expect(isMemeToken('AERO', 'Aerodrome')).toBe(false);
    expect(isMemeToken('ZEC', 'Zcash')).toBe(false);
    expect(isMemeToken('NFLX', 'Netflix • Robinhood Token')).toBe(false);
    expect(isMemeToken('GMEX', 'Gamestop xStock')).toBe(false);
    expect(isMemeToken('PUMP', 'Pump')).toBe(false);
    expect(isMemeToken('ETH', 'Ether (Wormhole)')).toBe(false);
    expect(isMemeToken('BTC', 'Bitcoin')).toBe(false);
    expect(isMemeToken('BTC', 'Buy The Cat')).toBe(true);
    expect(isMemeToken('\u{1F331} E/ACC', 'Effective Accelerationism')).toBe(
      true,
    );
  });

  test('keeps rows that trade mostly memes and reads usd_value strings', async () => {
    const pool = await fetchMemePool('key', now, nansen().fetcher);
    // WEETH, PUMP, the AERO vault leader and two ZEC traders drop out.
    expect(pool).toHaveLength(25);
    for (const prefix of ['0x46a83d', 'EnaatNfH', '0xaf0fdd', '8JKZAwiT'])
      expect(byAddress(pool, prefix)).toBeUndefined();
    expect(
      byAddress(pool, 'H6PEtpaD')?.topTokens?.map((token) => token.symbol),
    ).toEqual(['STONK', 'PURR', 'BTC']);
    expect(byAddress(pool, '0xb8f305')?.topTokens?.[0]).toEqual({
      symbol: 'AI',
      chain: 'robinhood',
      pnl: 3721724.6499900357,
    });
    expect(
      byAddress(pool, 'HPZJPCpM')?.topTokens?.map((token) => token.symbol),
    ).toContain('E/ACC');
  });

  test('cleans labels and falls back to the short address for generic ones', async () => {
    expect(cleanLabel('\u{1F913} \u{1F464} \u{1F440} Salem [0xb8f305]')).toBe(
      'Salem',
    );
    expect(
      cleanLabel('​​\u{1F913} vali: @vali on Farcaster [Verified] [0xfe277a]'),
    ).toBe('vali: @vali on Farcaster [Verified]');
    expect(cleanLabel('\u{1F913} "AEtL29" on pump.fun [AEtL29wg]')).toBe(
      '"AEtL29" on pump.fun',
    );
    expect(
      cleanLabel('\u{1F913} \u{1F440} "OmakaseOnly" on FOMO [F5MYbjEA]'),
    ).toBe('"OmakaseOnly" on FOMO');
    expect(cleanLabel('\u{1F913} 30D Smart Trader [0x3894c5]')).toBe('');
    expect(cleanLabel('Smart Trader')).toBe('');
    expect(cleanLabel('Former Smart Trader')).toBe('');
    const pool = await fetchMemePool('key', now, nansen().fetcher);
    expect(byAddress(pool, '0x3894c5')?.displayName).toBe('0x3894...9abd');
  });
});

describe('meme ranking', () => {
  test('ranks Solana and EVM wallets together and shows bsc as BNB', async () => {
    const pool = await fetchMemePool(
      'key',
      now,
      nansen({ ogle, Salem: salem }).fetcher,
    );
    const wins = rankMeme(pool, 'wins');
    expect(wins.map((entry) => entry.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(wins.map((entry) => entry.address.slice(0, 8))).toEqual([
      '0xb8f305',
      '0x3894c5',
      '0x22055b',
      'AEtL29wg',
      'ARW9Nzhp',
      '0x0cc7ce',
      '0xde52c7',
      'Gz3jNBsW',
      '0xe85458',
      '0x26a286',
    ]);
    expect(wins[3]!.chains).toEqual(['solana']);
    expect(wins[6]!.chains?.map(chainLabel)).toEqual(['BNB', 'Robinhood']);
  });

  test('the roi view sorts by average trade ROI and puts nulls last', () => {
    const entry = (address: string, roi: number | null) => ({
      rank: 0,
      address,
      displayName: address,
      pnl: 1,
      roi,
      accountValue: null,
    });
    expect(
      rankMeme(
        [entry('a', null), entry('b', 0.5), entry('c', 60), entry('d', null)],
        'roi',
      ).map((row) => [row.address, row.rank]),
    ).toEqual([
      ['c', 1],
      ['b', 2],
      ['a', 3],
      ['d', 4],
    ]);
  });
});

describe('entity rows', () => {
  test('an entity on both chain groups tags its wallet row once', async () => {
    const ogleRow = leaderboard.data.find((row) =>
      row.address.startsWith('0x0cc7ce'),
    )!;
    // A second ogle wallet further down is already inside the entity total.
    const board = {
      data: [
        ...leaderboard.data,
        { ...ogleRow, address: `0x${'9'.repeat(40)}`, realized_pnl_usd: 1 },
      ],
    };
    const pool = await fetchMemePool(
      'key',
      now,
      nansen({ ogle, Cooker: cooker }, board).fetcher,
    );
    const rows = pool.filter((entry) => entry.displayName === 'ogle');
    expect(rows).toHaveLength(1);
    // The row keeps the wallet's own leaderboard numbers, so it ranks on the
    // same source as every other row. The entity total rides along for the card.
    expect(rows[0]).toMatchObject({
      address: ogleRow.address,
      entity: 'ogle',
      pnl: ogleRow.realized_pnl_usd,
      realizedPnl: ogleRow.realized_pnl_usd,
      roi: ogleRow.avg_trade_roi,
      winRate: ogleRow.win_rate,
      trades: ogleRow.n_trades,
      chains: ['robinhood', 'solana'],
      entityTotal: {
        realizedPnl: 2381278.116041062,
        trades: 3787,
        tokens: 163,
      },
    });
    expect(
      rows[0]!.entityTotal?.topTokens.map((token) => token.symbol),
    ).toEqual(['PONS', 'QUOTRON', 'INDEX']);
    expect(new Set(pool.map((entry) => entry.address)).size).toBe(pool.length);
    // Cooker's Solana token lost money, but it still shows the entity trades there.
    const cookerRow = byAddress(pool, '0xb86f49');
    expect(cookerRow?.entity).toBe('Cooker');
    expect(cookerRow?.chains).toEqual(['robinhood', 'bsc', 'solana']);
  });

  test('the higher-ranked wallet decides the merge, so no PnL counts twice', async () => {
    const wallet = (address: string, chain: string, pnl: number) => ({
      address,
      address_label: `\u{1F913} \u{1F464} Zed [${address.slice(0, 8)}]`,
      realized_pnl_usd: pnl,
      top_traded_tokens_info: [
        { symbol: 'WIF', name: 'dogwifhat', chain, usd_value: String(pnl) },
      ],
    });
    // The Solana wallet leads. The entity adds no EVM chain, so it stays a
    // wallet, and the EVM wallet must stay one too.
    const board = {
      data: [
        wallet('So1anaWa11etZed111111111111111111111111111', 'solana', 3e6),
        wallet(`0x${'a'.repeat(40)}`, 'base', 1e6),
      ],
    };
    const Zed = {
      traded_times: 50,
      realized_pnl_usd: 4e6,
      top5_tokens: [
        { token_symbol: 'WIF', chain: 'solana', realized_pnl: 4e6 },
      ],
    };
    const pool = await fetchMemePool(
      'key',
      now,
      nansen({ Zed }, board).fetcher,
    );
    expect(pool.map((entry) => [entry.pnl, entry.entity])).toEqual([
      [3e6, undefined],
      [1e6, undefined],
    ]);
  });

  test('an EVM-only entity, a zero response and a 502 keep the wallet row', async () => {
    const plain = await fetchMemePool('key', now, nansen().fetcher);
    const pool = await fetchMemePool(
      'key',
      now,
      nansen({ Salem: salem, 'Crypto Keys': unknown, UCY: 502 }).fetcher,
    );
    for (const prefix of ['0xb8f305', 'Bmi9zf27', '0xe85458']) {
      const row = byAddress(pool, prefix);
      expect(row?.entity).toBeUndefined();
      expect(row).toEqual(byAddress(plain, prefix));
    }
    expect(byAddress(pool, '0xb8f305')?.winRate).toBeCloseTo(0.533, 3);
  });

  test('looks up at most 8 entities, 4 at a time', async () => {
    const entities = leaderboard.data
      .filter((row) => row.address_label.includes('\u{1F464}'))
      .slice(0, 12);
    expect(entities).toHaveLength(12);
    const stub = nansen({}, { data: entities });
    await fetchMemePool('key', now, stub.fetcher);
    expect(stub.lookups()).toHaveLength(8);
    expect(stub.peak()).toBe(4);
  });

  test('a failed leaderboard call throws and skips the entity lookups', async () => {
    const failed = nansen({}, 502);
    await expect(
      fetchMemePool('key', now, failed.fetcher),
    ).rejects.toMatchObject({
      message: 'Smart Wallet leaderboard is temporarily unavailable.',
      status: 502,
    });
    expect(failed.lookups()).toHaveLength(0);
    await expect(
      fetchMemePool('key', now, nansen({}, { rows: [] }).fetcher),
    ).rejects.toMatchObject({ status: 502 });
  });
});
