import { NansenError } from '../nansen/client';
import { managedNansenPost } from '../nansen/managed-client';
import { utcDateWindow } from '../nansen/payload';
import { NansenManagerError } from '../nansen/request-manager';
import { boardQuery, type HlBoard, type LeaderboardMetric } from './boards';
import {
  normalizeLeaderboard,
  type SmartWalletLeaderboardEntry,
} from './model';

export class LeaderboardError extends NansenError {}

/** Any failed leaderboard call becomes a LeaderboardError with a safe message. */
export function toLeaderboardError(error: unknown): LeaderboardError {
  if (error instanceof NansenManagerError)
    return new LeaderboardError(error.message, error.status);
  if (error instanceof NansenError) {
    return new LeaderboardError(
      error.status === 502
        ? 'Smart Wallet leaderboard is temporarily unavailable.'
        : error.message,
      error.status,
      error.retryAfterMs,
    );
  }
  return new LeaderboardError(
    'Smart Wallet leaderboard is temporarily unavailable.',
    502,
  );
}

export async function fetchNansenLeaderboard(
  key: string,
  now: number,
  fetcher: typeof fetch = fetch,
  board: HlBoard = 'perps',
  metric: LeaderboardMetric = 'wins',
): Promise<SmartWalletLeaderboardEntry[]> {
  if (!key.trim())
    throw new LeaderboardError('Nansen API is not configured.', 503);
  const { filters, order_by, premium_labels } = boardQuery(board, metric);
  const body = {
    date: utcDateWindow(now, 30),
    pagination: { page: 1, per_page: 10 },
    filters,
    premium_labels,
    order_by,
  };
  try {
    const payload = await managedNansenPost(
      'perp-leaderboard',
      body,
      key,
      fetcher,
    );
    return normalizeLeaderboard(payload);
  } catch (error) {
    throw toLeaderboardError(error);
  }
}
