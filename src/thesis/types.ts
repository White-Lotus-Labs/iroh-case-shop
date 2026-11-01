// Frozen contract shared by the deck config, the /api/theses routes, and the deck UI.
// Change it only through the orchestrator.

import type { SnapshotMeta } from '../nansen/snapshot-store';

export type ThesisId = 'robinhood' | 'bullrun' | 'ai';

export type NansenChain =
  | 'robinhood'
  | 'ethereum'
  | 'arbitrum'
  | 'base'
  | 'solana'
  | 'hyperevm';

export interface Ticker {
  symbol: string;
  name: string;
  assetClass: 'crypto' | 'stock' | 'native';
  /** Spot token Nansen indexes. Absent for perp-only tickers. */
  token?: { chain: NansenChain; address: string };
  /** Hyperliquid perp symbol, when smart money trades it as a perp. */
  perp?: string;
}

export interface Thesis {
  id: ThesisId;
  numeral: 'I' | 'II' | 'III';
  title: string;
  subtitle: string;
  body: string;
  spirit: string;
  image: string;
  /** Hue in degrees, used to tint glows such as the Cross Beam background. */
  hue: number;
  colors: { primary: string; accent: string; ink: string };
  tickers: Ticker[];
}

export type ConvictionLevel = 'weak' | 'steeping' | 'strong' | 'unknown';

export interface Conviction {
  level: ConvictionLevel;
  /** Tickers with positive 7-day smart money net flow. */
  accumulating: number;
  /** Tickers that returned a usable smart money figure. */
  measured: number;
  /** Sum of 7-day smart money net flow in USD across measured tickers. */
  netFlowUsd: number | null;
}

export interface TickerSignal {
  symbol: string;
  status: 'ok' | 'empty' | 'error';
  source: 'flow-intelligence' | 'position-intelligence';
  /** 7-day smart money net flow in USD (spot), or net long minus short (perp). */
  smartMoneyNetFlowUsd: number | null;
  whaleNetFlowUsd: number | null;
  exchangeNetFlowUsd: number | null;
  smartMoneyWallets: number | null;
}

export interface ThesisSummary {
  id: ThesisId;
  conviction: Conviction;
  tickers: TickerSignal[];
}

export type DeckSnapshot = { theses: ThesisSummary[] } & SnapshotMeta;

export type Section<T> =
  | { status: 'ok'; data: T }
  | { status: 'empty' }
  | { status: 'unavailable'; reason: string }
  | { status: 'not-applicable' };

export interface WalletMove {
  address: string;
  label: string | null;
  boughtUsd: number | null;
  soldUsd: number | null;
}

export interface SmartTrade {
  trader: string;
  label: string | null;
  action: 'buy' | 'sell';
  valueUsd: number | null;
  at: string | null;
  txHash: string | null;
}

export interface HolderRow {
  address: string;
  label: string | null;
  valueUsd: number | null;
  ownershipPct: number | null;
  change7dPct: number | null;
}

export interface SupplyGap {
  circulating: number | null;
  total: number | null;
  /** Share of total supply not yet circulating, 0-100. */
  notCirculatingPct: number | null;
}

export interface PerpBook {
  smartLongUsd: number | null;
  smartShortUsd: number | null;
  recent: {
    trader: string;
    label: string | null;
    side: 'long' | 'short';
    action: string;
    valueUsd: number | null;
    at: string | null;
  }[];
}

export interface TickerDetail {
  thesisId: ThesisId;
  symbol: string;
  fetchedAt: string;
  stale: boolean;
  movements: Section<{
    buyers: WalletMove[];
    sellers: WalletMove[];
    recent: SmartTrade[];
  }>;
  holders: Section<{ totalHolders: number | null; smartMoney: HolderRow[] }>;
  supply: Section<SupplyGap>;
  perps: Section<PerpBook>;
  /** When holders and supply were last asked for; they refresh every 4 hours. */
  metaFetchedAt?: string;
}

/** Error body for every /api/theses response that is not 200. */
export interface DeckError {
  error: string;
}
