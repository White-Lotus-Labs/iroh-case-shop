import { leaderboardRefreshTargets } from '../leaderboard/boards';
import { memeCallPlan } from '../leaderboard/meme';
import { THESES } from '../thesis/deck';
import type { Ticker } from '../thesis/types';

export type PlannedNansenCall = {
  surface: 'deck' | 'ticker-detail' | 'leaderboard';
  endpoint: string;
  thesisId: string | null;
  symbol: string | null;
  /** 'slow' calls run every 4 hours (see SLOW_REFRESH_MS); the rest every hour. */
  tier: 'hourly' | 'slow';
};

/** Holders and token information change slowly, so they ride the 4-hour tier. */
const SLOW_DETAIL_ENDPOINTS = new Set(['tgm/holders', 'tgm/token-information']);

function deckEndpoint(ticker: Ticker): string {
  return ticker.assetClass === 'native' && ticker.perp
    ? 'tgm/position-intelligence'
    : 'tgm/flow-intelligence';
}

/** Spot calls skipped for Solana. Perp calls only when the ticker has a perp. */
function detailEndpoints(ticker: Ticker): string[] {
  const endpoints: string[] = [];
  if (ticker.token && ticker.token.chain !== 'solana') {
    endpoints.push(
      'tgm/who-bought-sold',
      'tgm/who-bought-sold',
      'tgm/dex-trades',
      'tgm/holders',
      'tgm/token-information',
    );
  }
  if (ticker.perp) {
    endpoints.push('tgm/position-intelligence', 'smart-money/perp-trades');
  }
  return endpoints;
}

/**
 * Every Nansen request the hourly save is expected to make, derived from the
 * thesis catalog and the same rules as the fetchers.
 */
export function nansenCallPlan(): {
  deck: PlannedNansenCall[];
  details: PlannedNansenCall[];
  leaderboard: PlannedNansenCall[];
  background: PlannedNansenCall[];
  /** Every call in a full fill: a first start, or a run where every tier is due. */
  backgroundCount: number;
  /** Calls in a run where only the hourly tier is due. */
  hourlyCount: number;
  uncleEndpoint: 'agent/fast';
} {
  const deck = THESES.flatMap((thesis) =>
    thesis.tickers.map((ticker) => ({
      surface: 'deck' as const,
      endpoint: deckEndpoint(ticker),
      thesisId: thesis.id,
      symbol: ticker.symbol,
      tier: 'hourly' as const,
    })),
  );
  const details = THESES.flatMap((thesis) =>
    thesis.tickers.flatMap((ticker) =>
      detailEndpoints(ticker).map((endpoint) => ({
        surface: 'ticker-detail' as const,
        endpoint,
        thesisId: thesis.id,
        symbol: ticker.symbol,
        tier: SLOW_DETAIL_ENDPOINTS.has(endpoint)
          ? ('slow' as const)
          : ('hourly' as const),
      })),
    ),
  );
  // One perp-leaderboard call per Hyperliquid target, then the meme pool and its entity lookups.
  const leaderboard: PlannedNansenCall[] = [
    ...leaderboardRefreshTargets()
      .filter((target) => target.board !== 'meme')
      .map(() => 'perp-leaderboard'),
    ...memeCallPlan(),
  ].map((endpoint) => ({
    surface: 'leaderboard' as const,
    endpoint,
    thesisId: null,
    symbol: null,
    tier: 'slow' as const,
  }));
  const background = [...deck, ...details, ...leaderboard];
  return {
    deck,
    details,
    leaderboard,
    background,
    backgroundCount: background.length,
    hourlyCount: background.filter((call) => call.tier === 'hourly').length,
    uncleEndpoint: 'agent/fast',
  };
}
