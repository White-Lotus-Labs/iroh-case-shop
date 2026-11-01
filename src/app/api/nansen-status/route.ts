import { nansenAvailabilityFromEnv } from '../../../nansen/availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { nansen: nansenAvailabilityFromEnv(process.env.NANSEN_API_KEY) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
