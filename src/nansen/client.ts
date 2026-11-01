const BASE = 'https://api.nansen.ai/api/v1';

export class NansenError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfterMs = 0,
    public kind:
      | 'http'
      | 'network'
      | 'timeout'
      | 'parse'
      | 'configuration' = 'http',
  ) {
    super(message);
  }

  get retryable() {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      (this.kind === 'http' && [500, 502, 503, 504].includes(this.status))
    );
  }
}

function safeError(status: number, retryAfterMs: number): NansenError {
  if (status === 401)
    return new NansenError('Nansen authentication failed.', 401, retryAfterMs);
  if (status === 402)
    return new NansenError(
      'Nansen API credits are unavailable.',
      402,
      retryAfterMs,
    );
  if (status === 403)
    return new NansenError(
      'Nansen API access is unavailable for this plan.',
      403,
      retryAfterMs,
    );
  if (status === 429)
    return new NansenError(
      'Too many requests. Please try again shortly.',
      429,
      retryAfterMs,
    );
  return new NansenError(
    'Nansen is temporarily unavailable.',
    status,
    retryAfterMs,
  );
}

export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number {
  if (!value) return 0;
  if (/^\d{1,6}$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export async function nansenPost<T = unknown>(
  path: string,
  body: unknown,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<T> {
  if (!apiKey.trim())
    throw new NansenError(
      'Nansen API is not configured.',
      503,
      0,
      'configuration',
    );
  if (signal?.aborted)
    throw new DOMException('The request was cancelled.', 'AbortError');
  let response: Response;
  const timeout = AbortSignal.timeout(15_000);
  try {
    response = await fetcher(`${BASE}/${path}`, {
      method: 'POST',
      headers: { apikey: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: 'no-store',
    });
  } catch {
    if (signal?.aborted)
      throw new DOMException('The request was cancelled.', 'AbortError');
    if (timeout.aborted)
      throw new NansenError('Nansen request timed out.', 504, 0, 'timeout');
    throw new NansenError(
      'Nansen is temporarily unavailable.',
      502,
      0,
      'network',
    );
  }
  if (!response.ok)
    throw safeError(
      response.status,
      parseRetryAfter(response.headers.get('retry-after')),
    );
  try {
    return (await response.json()) as T;
  } catch (error) {
    if (signal?.aborted)
      throw new DOMException('The request was cancelled.', 'AbortError');
    if (timeout.aborted)
      throw new NansenError('Nansen request timed out.', 504, 0, 'timeout');
    if (!(error instanceof SyntaxError))
      throw new NansenError(
        'Nansen is temporarily unavailable.',
        502,
        0,
        'network',
      );
    throw new NansenError(
      'Nansen returned an invalid response.',
      502,
      0,
      'parse',
    );
  }
}
