import { vi } from 'vitest';

/** Answers Nansen API calls by path. Throw `HTTP:<status>` to fail one. */
export function mockNansen(handler: (path: string, body: unknown) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace('https://api.nansen.ai/api/v1/', '');
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      try {
        return Response.json(handler(path, body));
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('HTTP:'))
          return new Response('fail', {
            status: Number(error.message.slice(5)),
          });
        throw error;
      }
    }),
  );
}

/** Lifts request-manager pacing and retries; undo with vi.unstubAllEnvs(). */
export function stubNansenLimits() {
  vi.stubEnv('NANSEN_REQUEST_STARTS_PER_SECOND', '1000');
  vi.stubEnv('NANSEN_REQUEST_START_BURST', '1000');
  vi.stubEnv('NANSEN_GLOBAL_MAX_CONCURRENT', '32');
  vi.stubEnv('NANSEN_NORMAL_MAX_QUEUE', '200');
  vi.stubEnv('NANSEN_JSON_MAX_RETRIES', '0');
}
