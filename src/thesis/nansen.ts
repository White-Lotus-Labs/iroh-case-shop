import { NansenError } from '../nansen/client';
import { managedNansenPost } from '../nansen/managed-client';
import { numberOrNull } from '../nansen/payload';
import { REFRESH_SLACK_MS, SLOW_REFRESH_MS } from '../nansen/snapshot-store';
import { computeConviction } from './conviction';
import { THESES, findThesis, findTicker } from './deck';
import type {
  DeckSnapshot,
  HolderRow,
  PerpBook,
  Section,
  SmartTrade,
  SupplyGap,
  Ticker,
  TickerDetail,
  TickerSignal,
  ThesisId,
  ThesisSummary,
  WalletMove,
} from './types';

export const DECK_CACHE_KEY = 'thesis-deck:v1';

const SMART_MONEY_LABELS = [
  'Smart Trader',
  '30D Smart Trader',
  '90D Smart Trader',
  '180D Smart Trader',
  'Fund',
] as const;

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dataRows(payload: unknown): Record<string, unknown>[] {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('data' in payload) ||
    !Array.isArray((payload as { data: unknown }).data)
  )
    return [];
  return (payload as { data: unknown[] }).data.filter(
    (row): row is Record<string, unknown> =>
      !!row && typeof row === 'object' && !Array.isArray(row),
  );
}

function dataObject(payload: unknown): Record<string, unknown> | null {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('data' in payload) ||
    !(payload as { data: unknown }).data ||
    typeof (payload as { data: unknown }).data !== 'object' ||
    Array.isArray((payload as { data: unknown }).data)
  )
    return null;
  return (payload as { data: Record<string, unknown> }).data;
}

function last7Days(now: number) {
  return {
    from: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date(now).toISOString(),
  };
}

function isSolana(ticker: Ticker) {
  return ticker.token?.chain === 'solana';
}

function usesPositionSignal(ticker: Ticker) {
  return ticker.assetClass === 'native' && !!ticker.perp;
}

export function normalizeFlowSignal(
  symbol: string,
  payload: unknown,
): TickerSignal {
  const row = dataRows(payload)[0];
  if (!row) {
    return {
      symbol,
      status: 'empty',
      source: 'flow-intelligence',
      smartMoneyNetFlowUsd: null,
      whaleNetFlowUsd: null,
      exchangeNetFlowUsd: null,
      smartMoneyWallets: null,
    };
  }
  const smartMoneyNetFlowUsd = numberOrNull(row.smart_trader_net_flow_usd);
  return {
    symbol,
    status: smartMoneyNetFlowUsd === null ? 'empty' : 'ok',
    source: 'flow-intelligence',
    smartMoneyNetFlowUsd,
    whaleNetFlowUsd: numberOrNull(row.whale_net_flow_usd),
    exchangeNetFlowUsd: numberOrNull(row.exchange_net_flow_usd),
    smartMoneyWallets: numberOrNull(row.smart_trader_wallet_count),
  };
}

export function normalizePositionSignal(
  symbol: string,
  payload: unknown,
): TickerSignal {
  const row = dataRows(payload)[0];
  if (!row) {
    return {
      symbol,
      status: 'empty',
      source: 'position-intelligence',
      smartMoneyNetFlowUsd: null,
      whaleNetFlowUsd: null,
      exchangeNetFlowUsd: null,
      smartMoneyWallets: null,
    };
  }
  const longs = numberOrNull(row.smart_trader_longs_usd);
  const shorts = numberOrNull(row.smart_trader_shorts_usd);
  const smartMoneyNetFlowUsd =
    longs === null || shorts === null ? null : longs - shorts;
  return {
    symbol,
    status: smartMoneyNetFlowUsd === null ? 'empty' : 'ok',
    source: 'position-intelligence',
    smartMoneyNetFlowUsd,
    whaleNetFlowUsd: null,
    exchangeNetFlowUsd: null,
    smartMoneyWallets: numberOrNull(row.smart_trader_wallet_count),
  };
}

export function normalizeWalletMoves(payload: unknown): WalletMove[] {
  return dataRows(payload)
    .map((row) => {
      const address = stringOrNull(row.address);
      if (!address) return null;
      return {
        address,
        label: stringOrNull(row.address_label),
        boughtUsd: numberOrNull(row.bought_volume_usd),
        soldUsd: numberOrNull(row.sold_volume_usd),
      };
    })
    .filter((row): row is WalletMove => row !== null)
    .slice(0, 5);
}

export function normalizeDexTrades(payload: unknown): SmartTrade[] {
  return dataRows(payload)
    .map((row) => {
      const trader = stringOrNull(row.trader_address);
      const actionRaw = stringOrNull(row.action)?.toUpperCase();
      if (!trader || (actionRaw !== 'BUY' && actionRaw !== 'SELL')) return null;
      return {
        trader,
        label: stringOrNull(row.trader_address_label),
        action: actionRaw === 'BUY' ? ('buy' as const) : ('sell' as const),
        valueUsd: numberOrNull(row.estimated_value_usd),
        at: stringOrNull(row.block_timestamp),
        txHash: stringOrNull(row.transaction_hash),
      };
    })
    .filter((row): row is SmartTrade => row !== null)
    .slice(0, 5);
}

function change7dPct(row: Record<string, unknown>): number | null {
  const change = numberOrNull(row.balance_change_7d);
  const amount = numberOrNull(row.token_amount);
  if (change === null || amount === null) return null;
  const prior = amount - change;
  if (!(prior > 0)) return null;
  return (change / prior) * 100;
}

export function normalizeHolders(payload: unknown): HolderRow[] {
  return dataRows(payload)
    .map((row) => {
      const address = stringOrNull(row.address);
      if (!address) return null;
      const ownership = numberOrNull(row.ownership_percentage);
      return {
        address,
        label: stringOrNull(row.address_label),
        valueUsd: numberOrNull(row.value_usd),
        ownershipPct: ownership === null ? null : ownership * 100,
        change7dPct: change7dPct(row),
      };
    })
    .filter((row): row is HolderRow => row !== null)
    .slice(0, 5);
}

export function normalizeSupply(payload: unknown): SupplyGap | null {
  const data = dataObject(payload);
  if (!data) return null;
  const details =
    data.token_details &&
    typeof data.token_details === 'object' &&
    !Array.isArray(data.token_details)
      ? (data.token_details as Record<string, unknown>)
      : null;
  if (!details) return null;
  const circulating = numberOrNull(details.circulating_supply);
  const total = numberOrNull(details.total_supply);
  const notCirculatingPct =
    circulating === null || total === null || total <= 0
      ? null
      : Math.max(0, Math.min(100, ((total - circulating) / total) * 100));
  if (circulating === null && total === null) return null;
  return { circulating, total, notCirculatingPct };
}

export function normalizeTotalHolders(payload: unknown): number | null {
  const data = dataObject(payload);
  if (!data) return null;
  const metrics =
    data.spot_metrics &&
    typeof data.spot_metrics === 'object' &&
    !Array.isArray(data.spot_metrics)
      ? (data.spot_metrics as Record<string, unknown>)
      : null;
  return metrics ? numberOrNull(metrics.total_holders) : null;
}

export function normalizePerpBook(
  positionPayload: unknown,
  tradesPayload: unknown,
): PerpBook {
  const row = dataRows(positionPayload)[0];
  const recent = dataRows(tradesPayload)
    .map((trade) => {
      const trader = stringOrNull(trade.trader_address);
      const sideRaw = stringOrNull(trade.side)?.toLowerCase();
      if (!trader || (sideRaw !== 'long' && sideRaw !== 'short')) return null;
      return {
        trader,
        label: stringOrNull(trade.trader_address_label),
        side: sideRaw as 'long' | 'short',
        action: stringOrNull(trade.action) ?? '',
        valueUsd: numberOrNull(trade.value_usd),
        at: stringOrNull(trade.block_timestamp),
      };
    })
    .filter((trade): trade is PerpBook['recent'][number] => trade !== null)
    .slice(0, 5);
  return {
    smartLongUsd: row ? numberOrNull(row.smart_trader_longs_usd) : null,
    smartShortUsd: row ? numberOrNull(row.smart_trader_shorts_usd) : null,
    recent,
  };
}

function errorSignal(
  symbol: string,
  source: TickerSignal['source'],
): TickerSignal {
  return {
    symbol,
    status: 'error',
    source,
    smartMoneyNetFlowUsd: null,
    whaleNetFlowUsd: null,
    exchangeNetFlowUsd: null,
    smartMoneyWallets: null,
  };
}

export const SUMMARY_CONCURRENCY = 4;

/** Run at most `concurrency` async jobs at a time; preserve order. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length || 1) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export function countErroredTickers(theses: ThesisSummary[]): number {
  return theses.reduce(
    (total, thesis) =>
      total +
      thesis.tickers.filter((ticker) => ticker.status === 'error').length,
    0,
  );
}

/** Keep a better cached deck when a refresh returns more ticker errors. */
export function preferExistingDeck(
  fresh: { theses: ThesisSummary[] },
  existing: { theses: ThesisSummary[] },
): string | null {
  if (countErroredTickers(fresh.theses) > countErroredTickers(existing.theses))
    return 'Fresh deck had more ticker errors than the cached snapshot.';
  return null;
}

const DETAIL_SECTIONS = ['movements', 'holders', 'supply', 'perps'] as const;
const countUnavailable = (detail: TickerDetail) =>
  DETAIL_SECTIONS.filter((key) => detail[key].status === 'unavailable').length;

/** Keep a better cached ticker page: the loader turns Nansen errors into 'unavailable'. */
export function preferExistingDetail(
  fresh: TickerDetail,
  existing: TickerDetail,
): string | null {
  if (countUnavailable(fresh) > countUnavailable(existing))
    return 'Fresh detail had more unavailable sections than the cached snapshot.';
  return null;
}

/** Every ticker errored: the fresh deck holds no usable reading. */
export const deckFailed = (fresh: { theses: ThesisSummary[] }) =>
  fresh.theses.every((thesis) =>
    thesis.tickers.every((ticker) => ticker.status === 'error'),
  );

/**
 * Every section this run asked for is unavailable: the fresh page holds no new
 * reading. Holders and supply reused from the saved page do not count, and
 * neither do sections that never apply to the ticker.
 */
export const detailFailed = (fresh: TickerDetail) => {
  const reused =
    !!fresh.metaFetchedAt && fresh.metaFetchedAt !== fresh.fetchedAt;
  const asked = (
    reused ? (['movements', 'perps'] as const) : DETAIL_SECTIONS
  ).filter((section) => fresh[section].status !== 'not-applicable');
  return (
    asked.length > 0 &&
    asked.every((section) => fresh[section].status === 'unavailable')
  );
};

async function fetchTickerSignal(
  ticker: Ticker,
  apiKey: string,
): Promise<TickerSignal> {
  if (usesPositionSignal(ticker)) {
    try {
      const payload = await managedNansenPost(
        'tgm/position-intelligence',
        { token_address: ticker.perp },
        apiKey,
      );
      return normalizePositionSignal(ticker.symbol, payload);
    } catch {
      return errorSignal(ticker.symbol, 'position-intelligence');
    }
  }
  if (!ticker.token) return errorSignal(ticker.symbol, 'flow-intelligence');
  try {
    const payload = await managedNansenPost(
      'tgm/flow-intelligence',
      {
        chain: ticker.token.chain,
        token_address: ticker.token.address,
        timeframe: '7d',
      },
      apiKey,
    );
    return normalizeFlowSignal(ticker.symbol, payload);
  } catch {
    return errorSignal(ticker.symbol, 'flow-intelligence');
  }
}

export async function loadDeckSnapshot(
  apiKey: string,
  options: {
    concurrency?: number;
  } = {},
): Promise<{
  theses: ThesisSummary[];
}> {
  const concurrency = options.concurrency ?? SUMMARY_CONCURRENCY;
  const jobs = THESES.flatMap((thesis) =>
    thesis.tickers.map((ticker) => ({ thesisId: thesis.id, ticker })),
  );
  const signals = await mapPool(jobs, concurrency, ({ ticker }) =>
    fetchTickerSignal(ticker, apiKey),
  );
  let offset = 0;
  const theses: ThesisSummary[] = THESES.map((thesis) => {
    const tickers = signals.slice(offset, offset + thesis.tickers.length);
    offset += thesis.tickers.length;
    return {
      id: thesis.id,
      conviction: computeConviction(tickers),
      tickers,
    };
  });
  return { theses };
}

function unavailable(reason: string): Section<never> {
  return { status: 'unavailable', reason };
}

async function settled<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: NansenError }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof NansenError
          ? error
          : new NansenError('Nansen is temporarily unavailable.', 502),
    };
  }
}

async function loadMovements(
  ticker: Ticker,
  apiKey: string,
  now: number,
): Promise<TickerDetail['movements']> {
  if (!ticker.token || isSolana(ticker)) return { status: 'not-applicable' };
  const date = last7Days(now);
  const base = {
    chain: ticker.token.chain,
    token_address: ticker.token.address,
    date,
    pagination: { page: 1, per_page: 10 },
  };
  const filters = { include_smart_money_labels: [...SMART_MONEY_LABELS] };
  const [buy, sell, dex] = await Promise.all([
    settled(
      managedNansenPost(
        'tgm/who-bought-sold',
        { ...base, buy_or_sell: 'BUY', filters },
        apiKey,
      ),
    ),
    settled(
      managedNansenPost(
        'tgm/who-bought-sold',
        { ...base, buy_or_sell: 'SELL', filters },
        apiKey,
      ),
    ),
    settled(
      managedNansenPost(
        'tgm/dex-trades',
        { ...base, only_smart_money: true },
        apiKey,
      ),
    ),
  ]);
  if (!buy.ok && !sell.ok && !dex.ok)
    return unavailable('Smart money movements are temporarily unavailable.');
  const buyers = buy.ok ? normalizeWalletMoves(buy.value) : [];
  const sellers = sell.ok ? normalizeWalletMoves(sell.value) : [];
  const recent = dex.ok ? normalizeDexTrades(dex.value) : [];
  if (buyers.length === 0 && sellers.length === 0 && recent.length === 0)
    return { status: 'empty' };
  return { status: 'ok', data: { buyers, sellers, recent } };
}

function buildHoldersSection(
  holdersResult:
    | { ok: true; value: unknown }
    | { ok: false; error: NansenError }
    | null,
  infoResult:
    | { ok: true; value: unknown }
    | { ok: false; error: NansenError }
    | null,
): TickerDetail['holders'] {
  if (holdersResult === null) return { status: 'not-applicable' };
  if (!holdersResult.ok && (!infoResult || !infoResult.ok))
    return unavailable('Holder data is temporarily unavailable.');
  const smartMoney = holdersResult.ok
    ? normalizeHolders(holdersResult.value)
    : [];
  const totalHolders =
    infoResult && infoResult.ok
      ? normalizeTotalHolders(infoResult.value)
      : null;
  if (smartMoney.length === 0 && totalHolders === null)
    return { status: 'empty' };
  return { status: 'ok', data: { totalHolders, smartMoney } };
}

function buildSupplySection(
  ticker: Ticker,
  infoResult:
    | { ok: true; value: unknown }
    | { ok: false; error: NansenError }
    | null,
): TickerDetail['supply'] {
  if (
    !ticker.token ||
    isSolana(ticker) ||
    ticker.assetClass === 'stock' ||
    ticker.assetClass === 'native'
  )
    return { status: 'not-applicable' };
  if (!infoResult)
    return unavailable('Supply data is temporarily unavailable.');
  if (!infoResult.ok)
    return unavailable('Supply data is temporarily unavailable.');
  const data = normalizeSupply(infoResult.value);
  if (!data) return { status: 'empty' };
  return { status: 'ok', data };
}

async function loadPerps(
  ticker: Ticker,
  apiKey: string,
): Promise<TickerDetail['perps']> {
  if (!ticker.perp) return { status: 'not-applicable' };
  const [position, trades] = await Promise.all([
    settled(
      managedNansenPost(
        'tgm/position-intelligence',
        { token_address: ticker.perp },
        apiKey,
      ),
    ),
    settled(
      managedNansenPost(
        'smart-money/perp-trades',
        {
          filters: { token_symbol: ticker.perp },
          lookback_hours: 24,
          pagination: { page: 1, per_page: 10 },
        },
        apiKey,
      ),
    ),
  ]);
  if (!position.ok && !trades.ok)
    return unavailable('Perp data is temporarily unavailable.');
  const data = normalizePerpBook(
    position.ok ? position.value : { data: [] },
    trades.ok ? trades.value : { data: [] },
  );
  if (
    data.smartLongUsd === null &&
    data.smartShortUsd === null &&
    data.recent.length === 0
  )
    return { status: 'empty' };
  return { status: 'ok', data };
}

export async function loadTickerDetail(
  thesisId: ThesisId,
  symbol: string,
  apiKey: string,
  now: number = Date.now(),
  previous: TickerDetail | null = null,
): Promise<TickerDetail | null> {
  const thesis = findThesis(thesisId);
  const ticker = findTicker(thesisId, symbol);
  if (!thesis || !ticker) return null;

  // Holders and supply move slowly: reuse the saved ones until they are due.
  const reuse =
    !!previous?.metaFetchedAt &&
    now - Date.parse(previous.metaFetchedAt) <
      SLOW_REFRESH_MS - REFRESH_SLACK_MS &&
    previous.holders.status !== 'unavailable' &&
    previous.supply.status !== 'unavailable';
  const needsSpotMeta = !reuse && !!ticker.token && !isSolana(ticker);

  const [movements, holdersResult, infoResult, perps] = await Promise.all([
    loadMovements(ticker, apiKey, now),
    needsSpotMeta
      ? settled(
          managedNansenPost(
            'tgm/holders',
            {
              chain: ticker.token!.chain,
              token_address: ticker.token!.address,
              label_type: 'smart_money',
              filters: {
                include_smart_money_labels: [...SMART_MONEY_LABELS],
              },
              pagination: { page: 1, per_page: 10 },
            },
            apiKey,
          ),
        )
      : Promise.resolve(null),
    needsSpotMeta
      ? settled(
          managedNansenPost(
            'tgm/token-information',
            {
              chain: ticker.token!.chain,
              token_address: ticker.token!.address,
              timeframe: '7d',
            },
            apiKey,
          ),
        )
      : Promise.resolve(null),
    loadPerps(ticker, apiKey),
  ]);

  return {
    thesisId: thesis.id,
    symbol: ticker.symbol,
    fetchedAt: new Date(now).toISOString(),
    stale: false,
    movements,
    holders: reuse
      ? previous!.holders
      : buildHoldersSection(holdersResult, infoResult),
    supply: reuse ? previous!.supply : buildSupplySection(ticker, infoResult),
    perps,
    metaFetchedAt: reuse
      ? previous!.metaFetchedAt
      : new Date(now).toISOString(),
  };
}

export function detailCacheKey(thesisId: string, symbol: string) {
  return `thesis-detail:${thesisId}:${symbol.toUpperCase()}`;
}

export type { DeckSnapshot };
