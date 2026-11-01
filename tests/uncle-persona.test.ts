import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { UNCLE_PERSONA_PREFIX, withUnclePersona } from '../src/nansen/uncle';

describe('Uncle persona prefix', () => {
  test('stays under 400 characters and wraps the user question', () => {
    expect(UNCLE_PERSONA_PREFIX.length).toBeLessThan(400);
    expect(withUnclePersona('What is smart money doing in ARB?')).toBe(
      `${UNCLE_PERSONA_PREFIX}What is smart money doing in ARB?`,
    );
  });
});

describe('Uncle persona on the agent route', () => {
  beforeEach(() => {
    process.env.NANSEN_AGENT_DAILY_LIMIT = '1000';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NANSEN_API_KEY;
    delete process.env.NANSEN_AGENT_DAILY_LIMIT;
  });

  test('prefixes only the first upstream turn without a conversation id', async () => {
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          'data: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const { POST } = await import('../src/app/api/nansen-agent/route');
    await POST(
      new Request('http://localhost/api/nansen-agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'flows please' }),
      }),
    );
    const first = JSON.parse(
      (fetch.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(first.text.startsWith(UNCLE_PERSONA_PREFIX)).toBe(true);
    expect(first.text.endsWith('flows please')).toBe(true);

    await POST(
      new Request('http://localhost/api/nansen-agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'and now ETH',
          conversation_id: 'conv_1',
        }),
      }),
    );
    const second = JSON.parse(
      (fetch.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(second).toEqual({
      text: 'and now ETH',
      conversation_id: 'conv_1',
    });
  });
});
