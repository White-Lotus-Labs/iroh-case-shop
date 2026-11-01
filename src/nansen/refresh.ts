import type { PrismaClient } from '@prisma/client';
import { NansenError } from './client';
import { leaderboardRefreshTargets } from '../leaderboard/boards';
import { fetchMemePool, rankMeme } from '../leaderboard/meme';
import type { SmartWalletLeaderboardEntry } from '../leaderboard/model';
import { fetchNansenLeaderboard } from '../leaderboard/provider';
import { THESES } from '../thesis/deck';
import {
  DECK_CACHE_KEY,
  SUMMARY_CONCURRENCY,
  deckFailed,
  detailCacheKey,
  detailFailed,
  loadDeckSnapshot,
  loadTickerDetail,
  mapPool,
  preferExistingDeck,
  preferExistingDetail,
} from '../thesis/nansen';
import type { ThesisId, TickerDetail } from '../thesis/types';
import {
  NANSEN_REFRESH_MS,
  REFRESH_SLACK_MS,
  markNansenSnapshotStale,
  readNansenSnapshot,
  refreshIntervalMs,
  writeNansenSnapshot,
  type SnapshotMeta,
} from './snapshot-store';

export type RefreshReport = {
  skipped: 'no-key' | null;
  saved: string[];
  kept: string[];
  missing: string[];
  /** Saved rows younger than their refresh interval; no Nansen call made. */
  fresh: string[];
  /** When the next row falls due; the background loop runs again then. */
  nextDueAt: number;
};

type Outcome = 'saved' | 'kept' | 'missing' | 'fresh';

type Job = {
  key: string;
  /** `existing` is the saved row, if any, so a load can reuse slow parts of it. */
  load: (existing: object | null) => Promise<object>;
  /** Returns a reason to keep the saved row instead of the fresh load. */
  preferExisting?: (fresh: any, existing: any) => string | null;
  /** True when the fresh load holds no usable data at all. */
  failed?: (fresh: any) => boolean;
};

function errorMessage(error: unknown): string {
  if (error instanceof NansenError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Nansen is temporarily unavailable.';
}

async function refreshOne(
  database: PrismaClient,
  job: Job,
  now: number,
): Promise<{ outcome: Outcome; dueAt: number }> {
  const existing = await readNansenSnapshot(database, job.key, now);
  const interval = refreshIntervalMs(job.key);
  // Slow keys (and any key after a restart) skip Nansen until their row is due.
  if (existing) {
    const savedAt = Date.parse(existing.fetchedAt);
    if (now - savedAt < interval - REFRESH_SLACK_MS)
      return { outcome: 'fresh', dueAt: savedAt + interval };
  }
  const outcome = await loadAndSave(database, job, now, existing, interval);
  // A kept or missing row is asked for again at the next hourly run.
  return {
    outcome,
    dueAt: now + (outcome === 'saved' ? interval : NANSEN_REFRESH_MS),
  };
}

async function loadAndSave(
  database: PrismaClient,
  job: Job,
  now: number,
  existing: SnapshotMeta | null,
  interval: number,
): Promise<Exclude<Outcome, 'fresh'>> {
  try {
    const fresh = await job.load(existing);
    const reason = existing && job.preferExisting?.(fresh, existing);
    // Keep the saved row while it is recent, or when the fresh load got nothing
    // at all, so a lasting partial failure cannot freeze a reading forever.
    if (
      existing &&
      reason &&
      (now - Date.parse(existing.fetchedAt) < 2 * interval ||
        job.failed?.(fresh))
    ) {
      await markNansenSnapshotStale(database, job.key, reason);
      return 'kept';
    }
    await writeNansenSnapshot(database, job.key, fresh, now);
    return 'saved';
  } catch (error) {
    const message = errorMessage(error);
    if (existing) {
      await markNansenSnapshotStale(database, job.key, message);
      return 'kept';
    }
    console.error(`Nansen refresh missed ${job.key}: ${message}`);
    return 'missing';
  }
}

/** The deck and the Shelf first, then every ticker page. */
function jobsFor(apiKey: string, now: number): Job[] {
  const deck: Job = {
    key: DECK_CACHE_KEY,
    load: () => loadDeckSnapshot(apiKey),
    preferExisting: preferExistingDeck,
    failed: deckFailed,
  };
  // Both meme sorts rank the same pool, so the first meme job fetches it once,
  // and the other waits on the same promise.
  let memePool: Promise<SmartWalletLeaderboardEntry[]> | undefined;
  const pool = () => (memePool ??= fetchMemePool(apiKey, now));
  const leaderboards: Job[] = leaderboardRefreshTargets().map(
    ({ board, metric, key }) => ({
      key,
      load: async () => ({
        entries:
          board === 'meme'
            ? rankMeme(await pool(), metric)
            : await fetchNansenLeaderboard(apiKey, now, fetch, board, metric),
      }),
    }),
  );
  const details: Job[] = THESES.flatMap((thesis) =>
    thesis.tickers.map((ticker) => ({
      key: detailCacheKey(thesis.id, ticker.symbol),
      load: async (existing) => {
        const detail = await loadTickerDetail(
          thesis.id as ThesisId,
          ticker.symbol,
          apiKey,
          now,
          existing as TickerDetail | null,
        );
        if (!detail) throw new NansenError('Unknown thesis or symbol.', 404);
        return detail;
      },
      preferExisting: preferExistingDetail,
      failed: detailFailed,
    })),
  );
  return [deck, ...leaderboards, ...details];
}

/**
 * Ask Nansen for the deck, the Shelf, and every known ticker, then save the
 * answers. A failed refresh keeps the previous row when one exists.
 */
export async function refreshSavedNansenData(
  database: PrismaClient,
  apiKey: string = process.env.NANSEN_API_KEY ?? '',
  now: number = Date.now(),
): Promise<RefreshReport> {
  const report: RefreshReport = {
    skipped: null,
    saved: [],
    kept: [],
    missing: [],
    fresh: [],
    nextDueAt: now + NANSEN_REFRESH_MS,
  };
  if (!apiKey.trim()) {
    report.skipped = 'no-key';
    return report;
  }
  const record = (key: string, result: { outcome: Outcome; dueAt: number }) => {
    report[result.outcome].push(key);
    report.nextDueAt = Math.min(report.nextDueAt, result.dueAt);
  };
  const jobs = jobsFor(apiKey, now);
  const results = await mapPool(jobs, SUMMARY_CONCURRENCY, (job) =>
    refreshOne(database, job, now),
  );
  results.forEach((result, index) => record(jobs[index].key, result));
  return report;
}
