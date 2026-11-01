import { db } from '../../../../../auth/db';
import { jsonSavedReading } from '../../../../../nansen/saved-reading';
import { findThesis, findTicker } from '../../../../../thesis/deck';
import { detailCacheKey } from '../../../../../thesis/nansen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'cache-control': 'no-store' };

type RouteContext = { params: Promise<{ thesisId: string; symbol: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { thesisId, symbol } = await context.params;
  const thesis = findThesis(thesisId);
  const ticker = findTicker(thesisId, symbol);
  if (!thesis || !ticker)
    return Response.json(
      { error: 'Unknown thesis or symbol.' },
      { status: 404, headers },
    );

  return jsonSavedReading(
    db,
    detailCacheKey(thesis.id, ticker.symbol),
    'Nansen is not configured.',
  );
}
