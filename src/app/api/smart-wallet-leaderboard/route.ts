import { db } from '../../../auth/db';
import {
  boardCacheKey,
  parseBoard,
  parseMetric,
} from '../../../leaderboard/boards';
import { jsonSavedReading } from '../../../nansen/saved-reading';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  const params = request ? new URL(request.url).searchParams : null;
  const board = parseBoard(params?.get('board') ?? null);
  return jsonSavedReading(
    db,
    boardCacheKey(board, parseMetric(params?.get('metric') ?? null, board)),
    'Nansen API is not configured.',
  );
}
