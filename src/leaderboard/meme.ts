/**
 * Meme Traders board. One Smart Money PnL leaderboard call gives the pool.
 * Nansen has no meme filter, so the meme test runs here on each row's top
 * traded tokens. Up to 8 entity lookups then merge one person's Solana and
 * EVM wallets into one row.
 */
import { managedNansenPost } from '../nansen/managed-client';
import { numberOrNull, utcDateWindow } from '../nansen/payload';
import { SUMMARY_CONCURRENCY, mapPool } from '../thesis/nansen';
import type { LeaderboardMetric } from './boards';
import { shortenAddress, type SmartWalletLeaderboardEntry } from './model';
import { toLeaderboardError } from './provider';

/** Every Smart Money chain. `chains: ["all"]` leaves out BNB, so always send the list. */
export const MEME_CHAINS = [
  'arbitrum',
  'arc',
  'avalanche',
  'base',
  'bnb',
  'ethereum',
  'hyperevm',
  'iotaevm',
  'linea',
  'mantle',
  'monad',
  'optimism',
  'plasma',
  'polygon',
  'robinhood',
  'sei',
  'solana',
  'sonic',
] as const;
export const MEME_POOL_SIZE = 100;
/** Entity lookups only for rows this high after the meme filter. */
export const MEME_ENTITY_WINDOW = 20;
export const MEME_MAX_ENTITY_CALLS = 8;

/** Tokenized stocks, wrapped and staked majors, and leveraged tokens. */
const NOT_MEME_NAME =
  /Robinhood Token|xStock|PreStocks|Wrapped|Staked|Bridged|Wormhole|\(\d+x (Long|Short)\)/i;
/** Symbol -> the name it must match to be a major. The name check keeps "BTC / Buy The Cat" a meme. */
const NOT_MEME: Record<string, RegExp> = {
  ETH: /ether/i,
  BTC: /bitcoin/i,
  SOL: /solana/i,
  WETH: /./,
  WEETH: /./,
  WEETHS: /./,
  STETH: /./,
  WSTETH: /./,
  WBTC: /./,
  CBBTC: /./,
  WSOL: /./,
  JITOSOL: /./,
  MSOL: /./,
  BNB: /./,
  WBNB: /./,
  USDC: /./,
  USDT: /./,
  DAI: /./,
  USDE: /./,
  USD1: /./,
  FDUSD: /./,
  PYUSD: /./,
  ZEC: /zcash/i,
  AERO: /aerodrome/i,
  VIRTUAL: /virtual/i,
  HYPE: /hyperliquid/i,
  JUP: /jupiter/i,
  MET: /meteora/i,
  UNI: /uniswap/i,
  CRV: /curve/i,
  LIT: /lighter/i,
  VVV: /venice/i,
  PUMP: /^pump$/i,
};

/** Nansen's label marker for an entity or public figure (bust in silhouette). */
const ENTITY_MARK = '\u{1F464}';
const GENERIC_LABEL = /^(\d+D )?Smart Trader$|^Former Smart Trader$/i;

type Token = { symbol: string; chain: string; pnl: number | null };
type PoolRow = { entry: SmartWalletLeaderboardEntry; person: boolean };

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item) => !!item && typeof item === 'object')
    : [];
}

/** Drop a leading seedling or warning sign from a token symbol. */
const cleanSymbol = (symbol: string) =>
  symbol.replace(/^(?:\u{1F331}|⚠️?)\s*/u, '');

export function isMemeToken(symbol: string, name: string): boolean {
  if (NOT_MEME_NAME.test(name)) return false;
  return !NOT_MEME[cleanSymbol(symbol).toUpperCase()]?.test(name);
}

/** Drop zero-width spaces, the trailing ` [0xb8f305]` and the leading emoji. Generic labels become ''. */
export function cleanLabel(raw: string): string {
  const label = raw
    .replace(/​/g, '')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '')
    .trim();
  return GENERIC_LABEL.test(label) ? '' : label;
}

/** Positive-PnL tokens, largest first, at most 3. */
function topThree(tokens: Token[]): Token[] {
  return tokens
    .filter((token) => (token.pnl ?? 0) > 0)
    .sort((a, b) => b.pnl! - a.pnl!)
    .slice(0, 3);
}

/** A leaderboard row when at least half of its positive token PnL is memes, else null. */
function memeRow(row: Record<string, unknown>): PoolRow | null {
  const address = text(row.address);
  if (!address) return null;
  let meme = 0;
  let total = 0;
  const tokens = records(row.top_traded_tokens_info).map((token) => {
    // usd_value is that token's PnL, and Nansen sends it as a string.
    const pnl = numberOrNull(Number(token.usd_value));
    if (pnl !== null && pnl > 0) {
      total += pnl;
      if (isMemeToken(text(token.symbol), text(token.name))) meme += pnl;
    }
    return {
      symbol: cleanSymbol(text(token.symbol)),
      chain: text(token.chain),
      pnl,
    };
  });
  if (!total || meme / total < 0.5) return null;
  // The top 3 leave out dust, such as $0.03 of ETH on Arbitrum.
  const topTokens = topThree(tokens);
  const chains = [...new Set(topTokens.map((token) => token.chain))].filter(
    Boolean,
  );
  const raw = text(row.address_label);
  const label = cleanLabel(raw);
  return {
    person: raw.includes(ENTITY_MARK) && label !== '',
    entry: {
      rank: 0,
      address,
      displayName: label || shortenAddress(address),
      pnl: numberOrNull(row.realized_pnl_usd),
      roi: numberOrNull(row.avg_trade_roi),
      accountValue: null,
      realizedPnl: numberOrNull(row.realized_pnl_usd),
      unrealizedPnl: numberOrNull(row.unrealized_pnl_usd),
      volume: null,
      trades: numberOrNull(row.n_trades),
      positions: [],
      chains: chains.length
        ? chains
        : [address.startsWith('0x') ? 'evm' : 'solana'],
      winRate: numberOrNull(row.win_rate),
      tokens: numberOrNull(row.n_tokens),
      topTokens,
    },
  };
}

/**
 * Tags a wallet with its entity total when the entity adds the other chain
 * group: a Solana wallet needs a non-Solana chain, an EVM wallet needs Solana.
 * The row keeps its own leaderboard numbers, so every row ranks on one source;
 * the entity total is shown in the card only.
 */
function entityRow(
  entry: SmartWalletLeaderboardEntry,
  summary: Record<string, unknown> | null,
): SmartWalletLeaderboardEntry | null {
  const trades = numberOrNull(summary?.traded_times);
  const realized = numberOrNull(summary?.realized_pnl_usd);
  // An unknown entity_name still answers 200, with all zeros.
  if (!trades || realized === null) return null;
  const top5 = records(summary?.top5_tokens).map((token) => ({
    symbol: cleanSymbol(text(token.token_symbol)),
    chain: text(token.chain),
    pnl: numberOrNull(token.realized_pnl),
  }));
  const chains = top5.map((token) => token.chain).filter(Boolean);
  const addsOtherGroup = entry.address.startsWith('0x')
    ? chains.includes('solana')
    : chains.some((chain) => chain !== 'solana');
  if (!addsOtherGroup) return null;
  return {
    ...entry,
    chains: [...new Set([...(entry.chains ?? []), ...chains])],
    entity: entry.displayName,
    entityTotal: {
      realizedPnl: realized,
      trades,
      tokens: numberOrNull(summary?.traded_token_count),
      topTokens: topThree(top5),
    },
  };
}

/**
 * Smart Money wallets on all 18 chains, ranked by 30-day realized PnL, kept
 * when they trade mostly memes, with entity totals attached. Throws a
 * LeaderboardError when the leaderboard call fails. A failed entity lookup
 * keeps the wallet row.
 */
export async function fetchMemePool(
  apiKey: string,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<SmartWalletLeaderboardEntry[]> {
  let rows: Record<string, unknown>[];
  try {
    const payload = await managedNansenPost<{ data?: unknown } | null>(
      'smart-money/pnl-leaderboard',
      {
        chains: [...MEME_CHAINS],
        timeframe: 30,
        order_by: [{ field: 'realized_pnl_usd', direction: 'DESC' }],
        pagination: { page: 1, per_page: MEME_POOL_SIZE },
      },
      apiKey,
      fetcher,
    );
    if (!Array.isArray(payload?.data))
      throw new Error('Invalid Nansen leaderboard response.');
    rows = records(payload.data);
  } catch (error) {
    throw toLeaderboardError(error);
  }

  const seen = new Set<string>();
  const pool: PoolRow[] = [];
  for (const row of rows) {
    const kept = memeRow(row);
    if (!kept) continue;
    // One row per wallet. EVM addresses ignore case; Solana addresses do not.
    const { address } = kept.entry;
    const key = address.startsWith('0x') ? address.toLowerCase() : address;
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(kept);
  }

  const names = [
    ...new Set(
      pool
        .slice(0, MEME_ENTITY_WINDOW)
        .filter((row) => row.person)
        .map((row) => row.entry.displayName),
    ),
  ].slice(0, MEME_MAX_ENTITY_CALLS);
  const date = utcDateWindow(now, 30);
  // ponytail: no entity cache; reuse last saved entity result if pnl-summary timeouts cause row flicker
  const summaries = await mapPool(names, SUMMARY_CONCURRENCY, async (name) => {
    try {
      return await managedNansenPost<Record<string, unknown> | null>(
        'profiler/address/pnl-summary',
        { entity_name: name, chain: 'all', date },
        apiKey,
        fetcher,
      );
    } catch {
      return null;
    }
  });
  const byName = new Map(names.map((name, index) => [name, summaries[index]]));

  // The highest-ranked wallet of an entity decides once. If it carries the
  // entity total, the entity's other wallets drop out, so one person shows
  // once. If not, they stay.
  const merged = new Map<string, boolean>();
  return pool.flatMap(({ entry, person }) => {
    const name = entry.displayName;
    if (!person || !byName.has(name)) return [entry];
    if (merged.has(name)) return merged.get(name) ? [] : [entry];
    const row = entityRow(entry, byName.get(name) ?? null);
    merged.set(name, !!row);
    return [row ?? entry];
  });
}

/** Top 10 of the pool by realized PnL, or by average trade ROI with nulls last. */
export function rankMeme(
  pool: SmartWalletLeaderboardEntry[],
  metric: LeaderboardMetric,
): SmartWalletLeaderboardEntry[] {
  const value = (entry: SmartWalletLeaderboardEntry) =>
    (metric === 'roi' ? entry.roi : entry.pnl) ?? -Infinity;
  return [...pool]
    .sort((a, b) => value(b) - value(a))
    .slice(0, 10)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/** The most one refresh asks for: the leaderboard and every entity lookup. */
export function memeCallPlan(): string[] {
  return [
    'smart-money/pnl-leaderboard',
    ...Array<string>(MEME_MAX_ENTITY_CALLS).fill(
      'profiler/address/pnl-summary',
    ),
  ];
}
