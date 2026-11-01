import type { PrismaClient } from '@prisma/client';

/** How often the background loop runs, and how often fast readings refresh. */
export const NANSEN_REFRESH_MS = 60 * 60 * 1000;
/** Slow readings (Shelf boards, token holders and supply) refresh this often. */
export const SLOW_REFRESH_MS = 4 * NANSEN_REFRESH_MS;
/** A run starts about an hour after the last one; this keeps it from skipping a due row. */
export const REFRESH_SLACK_MS = 5 * 60 * 1000;
/**
 * A saved row keeps its run's start time, so it is one interval old when the
 * next due run starts. The grace covers that run, so readers do not see a
 * false Stale.
 */
const STALE_GRACE_MS = 15 * 60 * 1000;

/** The Shelf boards read 30-day windows, so they move slowly. Everything else is hourly. */
export function refreshIntervalMs(key: string): number {
  return key.startsWith('smart-wallet-leaderboard:')
    ? SLOW_REFRESH_MS
    : NANSEN_REFRESH_MS;
}

export const NANSEN_WARMING_MESSAGE =
  'Market readings are still being saved. The shop saves them in the background after it starts.';

export type SnapshotMeta = {
  fetchedAt: string;
  expiresAt: string;
  source: 'nansen';
  stale: boolean;
  refreshError?: string;
};

const META_KEYS = [
  'fetchedAt',
  'expiresAt',
  'source',
  'stale',
  'refreshError',
] as const;

export function stripSnapshotMeta<T extends object>(value: T): T {
  const copy: Record<string, unknown> = {
    ...(value as Record<string, unknown>),
  };
  for (const key of META_KEYS) delete copy[key];
  return copy as T;
}

export async function readNansenSnapshot<T extends object>(
  database: PrismaClient,
  key: string,
  now: number = Date.now(),
): Promise<(T & SnapshotMeta) | null> {
  const row = await database.nansenSnapshot.findUnique({ where: { key } });
  if (!row) return null;
  let payload: T;
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    payload = parsed as T;
  } catch {
    return null;
  }
  const fetchedAtMs = row.fetchedAt.getTime();
  const interval = refreshIntervalMs(key);
  const staleAfter = fetchedAtMs + interval + STALE_GRACE_MS;
  const overdue = now >= staleAfter;
  const refreshError =
    row.refreshError ??
    (overdue
      ? `This reading is older than ${interval === NANSEN_REFRESH_MS ? 'an hour' : `${interval / NANSEN_REFRESH_MS} hours`}.`
      : undefined);
  return {
    ...payload,
    fetchedAt: row.fetchedAt.toISOString(),
    expiresAt: new Date(staleAfter).toISOString(),
    source: 'nansen',
    stale: row.stale || overdue,
    ...(refreshError ? { refreshError } : {}),
  };
}

export async function writeNansenSnapshot(
  database: PrismaClient,
  key: string,
  value: object,
  now: number,
): Promise<void> {
  const payload = JSON.stringify(stripSnapshotMeta(value));
  const fetchedAt = new Date(now);
  await database.nansenSnapshot.upsert({
    where: { key },
    create: {
      key,
      payload,
      fetchedAt,
      stale: false,
      refreshError: null,
    },
    update: {
      payload,
      fetchedAt,
      stale: false,
      refreshError: null,
    },
  });
}

export async function markNansenSnapshotStale(
  database: PrismaClient,
  key: string,
  refreshError: string,
): Promise<void> {
  await database.nansenSnapshot.update({
    where: { key },
    data: { stale: true, refreshError },
  });
}
