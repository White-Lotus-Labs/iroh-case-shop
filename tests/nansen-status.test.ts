import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/nansen-status/route';
import { nansenAvailabilityFromEnv } from '../src/nansen/availability';

describe('nansen availability', () => {
  it('treats a missing or blank key as unavailable', () => {
    expect(nansenAvailabilityFromEnv(undefined)).toBe('unavailable');
    expect(nansenAvailabilityFromEnv('')).toBe('unavailable');
    expect(nansenAvailabilityFromEnv('   ')).toBe('unavailable');
    expect(nansenAvailabilityFromEnv('server-only-secret')).toBe('configured');
  });
});

describe('GET /api/nansen-status', () => {
  afterEach(() => {
    delete process.env.NANSEN_API_KEY;
  });

  it('reports unavailable without a key', async () => {
    delete process.env.NANSEN_API_KEY;
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ nansen: 'unavailable' });
  });

  it('reports configured when a key is set without returning the key', async () => {
    process.env.NANSEN_API_KEY = 'server-only-secret';
    const response = await GET();
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ nansen: 'configured' });
    expect(body).not.toContain('server-only-secret');
  });
});
