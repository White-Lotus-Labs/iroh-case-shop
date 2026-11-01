import { describe, expect, it, vi } from 'vitest';
import { nansenPost, parseRetryAfter } from '../src/nansen/client';

describe('Nansen JSON transport', () => {
  it('keeps upstream status and Retry-After for manager decisions', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('rate', {
          status: 429,
          headers: { 'retry-after': '3' },
        }),
    ) as unknown as typeof fetch;
    await expect(nansenPost('test', {}, 'key', fetcher)).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 3000,
      kind: 'http',
    });
    expect(
      parseRetryAfter(
        'Wed, 21 Oct 2026 07:28:00 GMT',
        Date.parse('2026-10-21T07:27:58Z'),
      ),
    ).toBe(2000);
  });

  it('distinguishes caller cancellation from network failure', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          (init.signal as AbortSignal).addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          ),
        ),
    ) as unknown as typeof fetch;
    const pending = nansenPost('test', {}, 'key', fetcher, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      nansenPost(
        'test',
        {},
        'key',
        vi.fn(async () => {
          throw new Error('offline');
        }) as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ status: 502, kind: 'network' });
  });

  it('does not treat invalid JSON as a retryable upstream failure', async () => {
    const fetcher = vi.fn(
      async () => new Response('{broken'),
    ) as unknown as typeof fetch;
    await expect(nansenPost('test', {}, 'key', fetcher)).rejects.toMatchObject({
      kind: 'parse',
      retryable: false,
    });
  });
});
