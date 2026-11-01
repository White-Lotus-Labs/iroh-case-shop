import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../src/app/api/nansen-agent/route';
import { nansenRequestManager } from '../src/nansen/request-manager';
import {
  USER_NANSEN_API_KEY_HEADER,
  USER_NANSEN_API_KEY_MAX_LENGTH,
} from '../src/nansen/user-api-key';

const request = (
  body: unknown,
  clientIp?: string,
  extraHeaders?: Record<string, string>,
) =>
  new Request('http://localhost/api/nansen-agent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(clientIp ? { 'x-forwarded-for': clientIp } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  process.env.NANSEN_AGENT_DAILY_LIMIT = '1000';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NANSEN_API_KEY;
  delete process.env.NANSEN_AGENT_DAILY_LIMIT;
});

describe('Nansen agent route', () => {
  it('requires a configured key without making an upstream call', async () => {
    delete process.env.NANSEN_API_KEY;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await POST(request({ text: 'hello' }));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('not configured');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts only validated text to fast mode with a server-side key and streams deltas', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('data: {"type":"delta","text":"Hel'),
              );
              controller.enqueue(
                new TextEncoder().encode(
                  'lo"}\n\ndata: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
                ),
              );
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const response = await POST(request({ text: 'hello' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(
      'https://api.nansen.ai/api/v1/agent/fast',
    );
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      text: expect.stringContaining('You are Uncle'),
    });
    expect(JSON.parse(init.body as string).text).toContain('Question: hello');
    expect(new Headers(init.headers).get('apikey')).toBe('test-only-secret');
    expect(await response.text()).toContain('"text":"Hello"');
    expect(await request({ text: 'x' }).text()).not.toContain(
      'test-only-secret',
    );
  });

  it('includes conversation_id only for follow-ups', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          'data: {"type":"finish","conversation_id":"conv_2"}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetch);
    await POST(request({ text: 'follow up', conversation_id: 'conv_1' }));
    expect(
      JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({ text: 'follow up', conversation_id: 'conv_1' });
  });

  it('caps daily Research Agent calls before contacting Nansen', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    process.env.NANSEN_AGENT_DAILY_LIMIT = '1';
    const fetch = vi.fn(
      async () =>
        new Response(
          'data: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetch);

    const first = await POST(request({ text: 'first' }, '203.0.113.10'));
    expect(first.status).toBe(200);
    expect(first.headers.get('x-ratelimit-remaining')).toBe('0');
    await first.text();

    const capped = await POST(request({ text: 'second' }, '203.0.113.10'));
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({
      error:
        'One cup for today, my friend. If you’d like to keep exploring, Nansen has more research waiting for you.',
      code: 'nansen_agent_daily_limit',
    });
    expect(capped.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(capped.headers.get('x-ratelimit-limit')).toBe('1');
    expect(capped.headers.get('x-ratelimit-remaining')).toBe('0');
    const otherIp = await POST(
      request({ text: 'other visitor' }, '203.0.113.11'),
    );
    expect(otherIp.status).toBe(200);
    await otherIp.text();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not give another cup for a forged left-most x-forwarded-for', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    process.env.NANSEN_AGENT_DAILY_LIMIT = '1';
    const fetch = vi.fn(
      async () =>
        new Response(
          'data: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetch);

    // The client sends the left entries; the proxy appends the right one.
    const first = await POST(
      request({ text: 'first' }, '198.51.100.1, 203.0.113.60'),
    );
    expect(first.status).toBe(200);
    await first.text();
    for (const forged of ['198.51.100.2', '198.51.100.3, 192.0.2.4']) {
      const capped = await POST(
        request({ text: 'again' }, `${forged}, 203.0.113.60`),
      );
      expect(capped.status).toBe(429);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses a visitor key and skips the daily cup', async () => {
    delete process.env.NANSEN_API_KEY;
    process.env.NANSEN_AGENT_DAILY_LIMIT = '1';
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          'data: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetch);

    const first = await POST(
      request({ text: 'first' }, '203.0.113.40', {
        [USER_NANSEN_API_KEY_HEADER]: 'visitor-byok',
      }),
    );
    expect(first.status).toBe(200);
    expect(first.headers.get('x-ratelimit-limit')).toBeNull();
    await first.text();
    const second = await POST(
      request({ text: 'second' }, '203.0.113.40', {
        [USER_NANSEN_API_KEY_HEADER]: 'visitor-byok',
      }),
    );
    expect(second.status).toBe(200);
    await second.text();
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstInit = fetch.mock.calls[0][1] as RequestInit;
    expect(new Headers(firstInit.headers).get('apikey')).toBe('visitor-byok');
  });

  it('falls back to the house key when the visitor header is empty or overlong', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          'data: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetch);

    await POST(
      request({ text: 'empty header' }, undefined, {
        [USER_NANSEN_API_KEY_HEADER]: '   ',
      }),
    );
    await POST(
      request({ text: 'overlong header' }, undefined, {
        [USER_NANSEN_API_KEY_HEADER]: 'x'.repeat(
          USER_NANSEN_API_KEY_MAX_LENGTH + 1,
        ),
      }),
    );
    const emptyInit = fetch.mock.calls[0][1] as RequestInit;
    const overlongInit = fetch.mock.calls[1][1] as RequestInit;
    expect(new Headers(emptyInit.headers).get('apikey')).toBe(
      'test-only-secret',
    );
    expect(new Headers(overlongInit.headers).get('apikey')).toBe(
      'test-only-secret',
    );
  });

  it('prefers the visitor key over the house key when both are present', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    process.env.NANSEN_AGENT_DAILY_LIMIT = '1';
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          'data: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetch);

    const house = await POST(request({ text: 'house' }, '203.0.113.50'));
    expect(house.status).toBe(200);
    await house.text();
    const capped = await POST(request({ text: 'capped' }, '203.0.113.50'));
    expect(capped.status).toBe(429);

    const byok = await POST(
      request({ text: 'byok' }, '203.0.113.50', {
        [USER_NANSEN_API_KEY_HEADER]: 'visitor-byok',
      }),
    );
    expect(byok.status).toBe(200);
    await byok.text();
    const byokInit = fetch.mock.calls.at(-1)![1] as RequestInit;
    expect(new Headers(byokInit.headers).get('apikey')).toBe('visitor-byok');
  });

  it('gives the daily cup back when Nansen fails before answering', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    process.env.NANSEN_AGENT_DAILY_LIMIT = '1';
    const answer = () =>
      new Response(
        'data: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockRejectedValueOnce(new Error('net'))
      .mockImplementation(async () => answer());
    vi.stubGlobal('fetch', fetch);
    const ip = '203.0.113.9';

    expect((await POST(request({ text: 'hi' }, ip))).status).toBe(503);
    expect((await POST(request({ text: 'hi' }, ip))).status).toBe(502);
    const answered = await POST(request({ text: 'hi' }, ip));
    expect(answered.status).toBe(200);
    await answered.text();
    expect((await POST(request({ text: 'hi' }, ip))).status).toBe(429);
  });

  it.each([
    [401, 'authentication failed'],
    [402, 'credits'],
    [403, 'access'],
    [429, 'Too many requests'],
    [504, 'temporarily unavailable'],
  ])('maps upstream HTTP %i to a safe error', async (status, message) => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"error":"secret details"}', {
            status,
            headers: { 'retry-after': status === 429 ? '0' : '12' },
          }),
      ),
    );
    const response = await POST(request({ text: 'hello' }));
    expect(response.status).toBe(status);
    expect(await response.text()).toContain(message);
    expect(response.headers.get('retry-after')).toBe(
      status === 429 ? '0' : '12',
    );
  });

  it('rejects empty and malformed requests before fetch', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const body of [
      { text: '' },
      { text: 'hi', conversation_id: { id: 1 } },
      { text: 'hi', url: 'https://evil.example' },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a question another site sends from a hidden form', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const form = request({ text: 'hi' }, undefined, {
      'content-type': 'text/plain',
    });
    expect((await POST(form)).status).toBe(415);
    const crossSite = request({ text: 'hi' }, undefined, {
      'sec-fetch-site': 'cross-site',
    });
    expect((await POST(crossSite)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks for a shorter question before contacting Nansen', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const response = await POST(request({ text: 'x'.repeat(101) }));

    expect(response.status).toBe(413);
    expect(await response.text()).toContain(
      'Keep the question to 100 characters or fewer.',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves a delta before malformed SSE in the same network chunk', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            'data: {"type":"delta","text":"Kept"}\n\ndata: {broken}\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );
    const response = await POST(request({ text: 'hello' }));
    const output = await response.text();
    expect(output).toContain('"text":"Kept"');
    expect(output).toContain('connection was interrupted');
  });

  it('emits a single safe SSE error even if upstream sends sensitive text', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            'data: {"type":"error","error":"secret details","status_code":402}\n\ndata: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );
    const response = await POST(request({ text: 'hello' }));
    const output = await response.text();
    expect(output).toContain('credits are unavailable');
    expect(output).not.toContain('secret details');
    expect(output.match(/"type":"error"/g)).toHaveLength(1);
  });

  it('cancels the Nansen request when the browser cancels its stream', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"delta","text":"Partial"}\n\n',
                ),
              );
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }),
    );
    const response = await POST(request({ text: 'hello' }));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(signal?.aborted).toBe(true);
  });

  it('recognizes exhausted credits even when Nansen returns 403', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '{"error":{"code":"CREDITS_EXHAUSTED","message":"private"}}',
            { status: 403 },
          ),
      ),
    );
    const response = await POST(request({ text: 'hello' }));
    expect(await response.text()).toContain('credits are unavailable');
  });

  it('keeps opaque conversation IDs as JSON rather than constraining Nansen to one ID format', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          'data: {"type":"finish","conversation_id":"conv/2026.09"}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const response = await POST(
      request({ text: 'follow-up', conversation_id: 'conv/2026.09' }),
    );
    expect(response.status).toBe(200);
    expect(
      JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({ text: 'follow-up', conversation_id: 'conv/2026.09' });
  });

  it('recognizes a credit error inside a streamed Nansen event', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            'data: {"type":"error","error":"CREDITS_EXHAUSTED","status_code":403}\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );
    const response = await POST(request({ text: 'hello' }));
    expect(await response.text()).toContain('credits are unavailable');
  });

  it('does not report interruption after an answer whose DONE sentinel ends at EOF', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            'data: {"type":"delta","text":"Answer"}\n\ndata: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );
    const response = await POST(request({ text: 'hello' }));
    const output = await response.text();
    expect(output).toContain('"text":"Answer"');
    expect(output).toContain('"conversation_id":"conv_1"');
    expect(output).toContain('data: [DONE]');
    expect(output).not.toContain('interrupted');
  });

  it('forwards Nansen completion with a null conversation ID without an interruption error', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            'data: {"type":"delta","text":"Answer"}\n\ndata: {"type":"finish","conversation_id":null,"tool_calls":[]}\n\ndata: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );
    const response = await POST(request({ text: 'hello' }));
    const output = await response.text();
    expect(output).toContain('"text":"Answer"');
    expect(output).toContain('"type":"finish","conversation_id":null');
    expect(output).toContain('data: [DONE]');
    expect(output).not.toContain('interrupted');
  });

  it('does not pause house-key work when a visitor key hits a 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('slow down', {
            status: 429,
            headers: { 'retry-after': '5' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            'data: {"type":"error","error":"limited","status_code":429}\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        ),
    );
    const visitor = { [USER_NANSEN_API_KEY_HEADER]: 'visitor-byok' };
    const first = await POST(request({ text: 'hello' }, undefined, visitor));
    expect(first.status).toBe(429);
    const second = await POST(request({ text: 'hello' }, undefined, visitor));
    expect(await second.text()).toContain('"status_code":429');
    const started = Date.now();
    const lease = await nansenRequestManager.acquireIroh();
    expect(Date.now() - started).toBeLessThan(500);
    lease.release();
  });

  it('serves a guest whose browser still holds an expired session cookie', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            'data: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );
    const response = await POST(
      request({ text: 'hello' }, undefined, { cookie: 'tea_session=gone' }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('conv_1');
  });

  it('shares an SSE 429 cooldown with later Nansen work', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            'data: {"type":"error","error":"limited","status_code":429}\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );
    const response = await POST(request({ text: 'hello' }));
    expect(await response.text()).toContain('"status_code":429');
    const started = Date.now();
    const lease = await nansenRequestManager.acquireIroh();
    expect(Date.now() - started).toBeGreaterThanOrEqual(850);
    lease.release();
  });
});
