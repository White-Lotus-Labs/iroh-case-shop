import type { PrismaClient } from '@prisma/client';
import { nansenAvailabilityFromEnv } from './availability';
import {
  NANSEN_WARMING_MESSAGE,
  readNansenSnapshot,
  type SnapshotMeta,
} from './snapshot-store';

const headers = { 'cache-control': 'no-store' };

/** Page routes use this. It reads SQLite and does not call Nansen. */
export async function jsonSavedReading<T extends object>(
  database: PrismaClient,
  key: string,
  missingKeyMessage: string,
): Promise<Response> {
  try {
    const snapshot: (T & SnapshotMeta) | null = await readNansenSnapshot<T>(
      database,
      key,
    );
    if (snapshot) return Response.json(snapshot, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'read failed';
    console.error(`Could not read saved Nansen reading ${key}: ${message}`);
  }
  if (nansenAvailabilityFromEnv(process.env.NANSEN_API_KEY) === 'unavailable')
    return Response.json(
      { error: missingKeyMessage },
      { status: 503, headers },
    );
  return Response.json(
    { error: NANSEN_WARMING_MESSAGE },
    { status: 503, headers },
  );
}
