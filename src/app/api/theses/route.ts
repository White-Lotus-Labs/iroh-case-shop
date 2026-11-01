import { db } from '../../../auth/db';
import { jsonSavedReading } from '../../../nansen/saved-reading';
import { DECK_CACHE_KEY } from '../../../thesis/nansen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return jsonSavedReading(db, DECK_CACHE_KEY, 'Nansen is not configured.');
}
