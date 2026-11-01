/** Nansen leaderboard boards and sort metrics. Meme is the one board not on Hyperliquid. */

export const LEADERBOARD_BOARDS = [
  'perps',
  'smart-money',
  'whales',
  'meme',
] as const;
export type LeaderboardBoard = (typeof LEADERBOARD_BOARDS)[number];
export type HlBoard = Exclude<LeaderboardBoard, 'meme'>;

export const LEADERBOARD_METRICS = [
  'wins',
  'losses',
  'roi',
  'account',
  'holdings',
  'positions',
] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

/** Holdings reuses the account-value sort. This endpoint has no holdings field. */
export type StoredLeaderboardMetric = Exclude<LeaderboardMetric, 'holdings'>;

/** Meme rows come from one pool, so only the sorts that pool supports. */
export const BOARD_METRICS: Record<
  LeaderboardBoard,
  readonly LeaderboardMetric[]
> = {
  perps: LEADERBOARD_METRICS,
  'smart-money': LEADERBOARD_METRICS,
  whales: LEADERBOARD_METRICS,
  meme: ['wins', 'roi'],
};

export const BOARD_LABELS: Record<LeaderboardBoard, string> = {
  perps: 'Perps Traders',
  'smart-money': 'Smart Wallets',
  whales: 'Whales',
  meme: 'Meme Traders',
};

export const BOARD_BLURB: Record<LeaderboardBoard, string> = {
  perps: 'Smart HL Perps Traders · last 30 days',
  'smart-money': 'Fund and Smart Trader wallets · last 30 days',
  whales: 'Accounts worth $10M or more · last 30 days',
  meme: 'Smart Money wallets trading mostly memecoins · realized PnL · last 30 days',
};

/** One sentence per board for the Shelf intro. The meta line under it carries the filter and period. */
export const BOARD_INTRO: Record<LeaderboardBoard, string> = {
  perps: 'The ten Smart HL Perps Traders at the top of this ranking.',
  'smart-money':
    'The ten Fund and Smart Trader wallets at the top of this ranking.',
  whales: 'The ten biggest Hyperliquid accounts at the top of this ranking.',
  meme: 'The ten Smart Money meme traders at the top of this ranking.',
};

/** Where the rows come from, for the heading, the freshness note and the empty state. */
export const BOARD_SOURCE: Record<LeaderboardBoard, string> = {
  perps: 'Hyperliquid',
  'smart-money': 'Hyperliquid',
  whales: 'Hyperliquid',
  meme: 'Smart Money meme',
};

export const METRIC_LABELS: Record<LeaderboardMetric, string> = {
  wins: 'Biggest wins',
  losses: 'Biggest losses',
  roi: 'Highest ROI',
  account: 'Top account value',
  holdings: 'Account holdings',
  positions: 'Open-position PnL',
};

/** Valid Nansen SmartMoneyFilterType values for Hyperliquid. */
const SMART_MONEY_FILTER = [
  'Fund',
  'Smart Trader',
  '30D Smart Trader',
  '90D Smart Trader',
  '180D Smart Trader',
] as const;

/** Whales board floor. Nansen has no meme-trader label for Hyperliquid perps. */
const WHALE_MIN_ACCOUNT_USD = 10_000_000;

/** Default Perps / biggest-wins row. Keep this key so older saved rows still match. */
export const DEFAULT_LEADERBOARD_CACHE_KEY =
  'smart-wallet-leaderboard:hyperliquid:smart-hl-perps-trader:30d:total-pnl-desc:top-10';

export function parseBoard(value: string | null): LeaderboardBoard {
  return LEADERBOARD_BOARDS.includes(value as LeaderboardBoard)
    ? (value as LeaderboardBoard)
    : 'perps';
}

export function parseMetric(
  value: string | null,
  board: LeaderboardBoard,
): LeaderboardMetric {
  return BOARD_METRICS[board].includes(value as LeaderboardMetric)
    ? (value as LeaderboardMetric)
    : 'wins';
}

export function storedMetric(
  metric: LeaderboardMetric,
): StoredLeaderboardMetric {
  return metric === 'holdings' ? 'account' : metric;
}

export function boardCacheKey(
  board: LeaderboardBoard,
  metric: LeaderboardMetric,
): string {
  const stored = storedMetric(metric);
  if (board === 'meme')
    return `smart-wallet-leaderboard:meme:${stored}:30d:top-10`;
  if (board === 'perps' && stored === 'wins')
    return DEFAULT_LEADERBOARD_CACHE_KEY;
  return `smart-wallet-leaderboard:hl:${board}:${stored}:30d:top-10`;
}

export function leaderboardRefreshTargets(): {
  board: LeaderboardBoard;
  metric: StoredLeaderboardMetric;
  key: string;
}[] {
  const targets: {
    board: LeaderboardBoard;
    metric: StoredLeaderboardMetric;
    key: string;
  }[] = [];
  for (const board of LEADERBOARD_BOARDS) {
    for (const metric of BOARD_METRICS[board]) {
      if (metric === 'holdings') continue;
      targets.push({ board, metric, key: boardCacheKey(board, metric) });
    }
  }
  return targets;
}

/** Build Nansen perp-leaderboard filters and sort for a board and metric. */
export function boardQuery(board: HlBoard, metric: LeaderboardMetric) {
  const filters =
    board === 'perps'
      ? { include_smart_money_labels: ['Smart HL Perps Trader'] }
      : board === 'smart-money'
        ? { include_smart_money_labels: [...SMART_MONEY_FILTER] }
        : { account_value: { min: WHALE_MIN_ACCOUNT_USD } };

  const order_by =
    metric === 'losses'
      ? [{ field: 'total_pnl' as const, direction: 'ASC' as const }]
      : metric === 'roi'
        ? [{ field: 'roi' as const, direction: 'DESC' as const }]
        : metric === 'account' || metric === 'holdings'
          ? [{ field: 'account_value' as const, direction: 'DESC' as const }]
          : metric === 'positions'
            ? [
                {
                  field: 'unrealized_pnl_usd' as const,
                  direction: 'DESC' as const,
                },
              ]
            : [{ field: 'total_pnl' as const, direction: 'DESC' as const }];

  return { filters, order_by, premium_labels: false as const };
}
