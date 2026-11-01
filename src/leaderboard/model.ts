import { numberOrNull } from '../nansen/payload';
import type { SnapshotMeta } from '../nansen/snapshot-store';

export interface WalletPosition {
  coin: string;
  side: 'long' | 'short';
  valueUsd: number | null;
  unrealizedPnl: number | null;
}

export interface SmartWalletLeaderboardEntry {
  rank: number;
  address: string;
  displayName: string;
  pnl: number | null;
  roi: number | null;
  accountValue: number | null;
  /** Optional: rows saved before these fields existed do not have them. */
  realizedPnl?: number | null;
  unrealizedPnl?: number | null;
  volume?: number | null;
  trades?: number | null;
  positions?: WalletPosition[];
  /** Meme board only. Nansen chain ids ('solana', 'robinhood', 'bsc', ...). Absent means Hyperliquid. */
  chains?: string[];
  /** 0..1 from the leaderboard. */
  winRate?: number | null;
  tokens?: number | null;
  /** At most 3, largest PnL first. */
  topTokens?: { symbol: string; chain: string; pnl: number | null }[];
  /** Nansen entity name when this wallet's entity also trades on the other chain group. */
  entity?: string;
  /**
   * That entity's 30-day total across all its wallets and chains (profiler
   * pnl-summary). Shown in the card; ranking uses the wallet's own numbers.
   */
  entityTotal?: {
    realizedPnl: number;
    trades: number | null;
    tokens: number | null;
    topTokens: { symbol: string; chain: string; pnl: number | null }[];
  };
}

export type SmartWalletLeaderboardSnapshot = {
  entries: SmartWalletLeaderboardEntry[];
} & SnapshotMeta;

export function shortenAddress(address: string): string {
  return address.length > 13
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;
}

/** Nansen `top_positions`, largest first. HIP-3 coins drop their deployer prefix (`xyz:MU` → `MU`). */
function normalizePositions(value: unknown): WalletPosition[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (p): p is Record<string, unknown> =>
        !!p &&
        typeof p === 'object' &&
        typeof p.coin === 'string' &&
        (p.side === 'long' || p.side === 'short'),
    )
    .slice(0, 3)
    .map((p) => ({
      coin: (p.coin as string).replace(/^[^:]+:/, ''),
      side: p.side as 'long' | 'short',
      valueUsd: numberOrNull(p.position_value_usd),
      unrealizedPnl: numberOrNull(p.unrealized_pnl_usd),
    }));
}

export function normalizeLeaderboard(
  payload: unknown,
): SmartWalletLeaderboardEntry[] {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('data' in payload) ||
    !Array.isArray(payload.data)
  ) {
    throw new Error('Invalid Nansen leaderboard response.');
  }
  return payload.data
    .filter(
      (row: unknown) =>
        row &&
        typeof row === 'object' &&
        'trader_address' in row &&
        typeof row.trader_address === 'string' &&
        row.trader_address.length > 0,
    )
    .slice(0, 10)
    .map((row: Record<string, unknown>, index: number) => {
      const address = row.trader_address as string;
      const label =
        typeof row.trader_address_label === 'string'
          ? row.trader_address_label.trim()
          : '';
      const displayName =
        label &&
        label.toLowerCase() !== address.toLowerCase() &&
        !['smart hl perps trader', 'smart money'].includes(label.toLowerCase())
          ? label
          : shortenAddress(address);
      return {
        rank: index + 1,
        address,
        displayName,
        pnl: numberOrNull(row.total_pnl),
        roi: numberOrNull(row.roi),
        accountValue: numberOrNull(row.account_value),
        realizedPnl: numberOrNull(row.realized_pnl_usd),
        unrealizedPnl: numberOrNull(row.unrealized_pnl_usd),
        volume: numberOrNull(row.volume_usd),
        trades: numberOrNull(row.total_trades),
        positions: normalizePositions(row.top_positions),
      };
    });
}

const MONEY_UNITS = [
  ['', 1],
  ['K', 1_000],
  ['M', 1_000_000],
  ['B', 1_000_000_000],
] as const;

/** Two significant decimals under 10, one under 100, none above. */
function moneyDigits(unit: string, scaled: number) {
  return !unit ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
}

/** Rounds the way the display does (9.995 → 10.00), unlike toFixed (9.99). */
function roundMoney(scaled: number, digits: number) {
  return Number(
    scaled.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: false,
    }),
  );
}

export function formatMoney(value: number | null, signed = false): string {
  if (value === null) return '—';
  const magnitude = Math.abs(value);
  let index = MONEY_UNITS.findLastIndex(([, size]) => magnitude >= size);
  if (index < 0) index = 0;
  // Pick the unit and decimals from the rounded value, so 999,600 reads
  // $1.00M rather than $1,000K, and 9,999,999 reads $10.0M, not $10.00M.
  let [unit, size] = MONEY_UNITS[index];
  let digits = moneyDigits(unit, magnitude / size);
  let rounded = roundMoney(magnitude / size, digits);
  while (rounded >= 1_000 && index < MONEY_UNITS.length - 1) {
    [unit, size] = MONEY_UNITS[++index];
    digits = moneyDigits(unit, magnitude / size);
    rounded = roundMoney(magnitude / size, digits);
  }
  digits = Math.min(digits, moneyDigits(unit, rounded));
  const amount = (magnitude / size).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value < 0 ? '-' : signed && value > 0 ? '+' : ''}$${amount}${unit}`;
}

export function formatRoi(value: number | null): string {
  if (value === null) return '—';
  const percent = value * 100;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

export function formatWinRate(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

const CHAIN_LABELS: Record<string, string> = {
  bsc: 'BNB',
  evm: 'EVM',
  hyperevm: 'HyperEVM',
  iotaevm: 'IOTA EVM',
};

export function chainLabel(chain: string): string {
  return CHAIN_LABELS[chain] ?? chain.charAt(0).toUpperCase() + chain.slice(1);
}
