import { afterEach, describe, expect, it, vi } from 'vitest';
import { IrohSession } from '../src/nansen/session';
import {
  clearUserNansenApiKey,
  setUserNansenApiKey,
  USER_NANSEN_API_KEY_HEADER,
  USER_NANSEN_API_KEY_STORAGE,
} from '../src/nansen/user-api-key';

function sse(parts: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts)
          controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

afterEach(() => {
  clearUserNansenApiKey();
  try {
    localStorage?.removeItem(USER_NANSEN_API_KEY_STORAGE);
  } catch {
    /* Storage may be missing in this runner. */
  }
});

describe('Iroh client session', () => {
  it('sends the user key header when a browser key is stored', async () => {
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value);
        },
        removeItem: (key: string) => {
          memory.delete(key);
        },
      },
    });
    expect(setUserNansenApiKey('browser-byok')).toBe(true);
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ error: 'capped' }, { status: 429 }));
    const session = new IrohSession(fetcher);
    await session.send('hello');
    const headers = new Headers(
      (fetcher.mock.calls[0][1] as RequestInit).headers,
    );
    expect(headers.get(USER_NANSEN_API_KEY_HEADER)).toBe('browser-byok');
  });

  it('does not send questions longer than 100 characters', () => {
    const fetcher = vi.fn();
    const session = new IrohSession(fetcher);

    expect(session.send('x'.repeat(101))).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('exposes the daily cap code for the access CTA', async () => {
    const session = new IrohSession(
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error:
              'One cup for today, my friend. If you’d like to keep exploring, Nansen has more research waiting for you.',
            code: 'nansen_agent_daily_limit',
          },
          { status: 429 },
        ),
      ),
    );

    await session.send('One more question');

    expect(session.getSnapshot()).toMatchObject({
      error:
        'One cup for today, my friend. If you’d like to keep exploring, Nansen has more research waiting for you.',
      errorCode: 'nansen_agent_daily_limit',
    });
  });

  it('waits for the server stream to close before treating an answer as saved', async () => {
    let close!: () => void;
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"delta","text":"Answer"}\n\ndata: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
              ),
            );
            close = () => controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    const session = new IrohSession(fetcher);
    let settled = false;
    const pending = session.send('Question');
    if (!pending) throw new Error('send did not start');
    void pending.then(() => {
      settled = true;
    });
    await vi.waitFor(() =>
      expect(session.getSnapshot().conversationId).toBe('conv_1'),
    );
    expect(settled).toBe(false);
    close();
    await pending;
    expect(settled).toBe(true);
  });
  it('restores a saved chat and sends its ID for a follow-up', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        sse([
          'data: {"type":"delta","text":"Seven-day answer"}\n\ndata: {"type":"finish","conversation_id":"conv_2"}\n\ndata: [DONE]\n\n',
        ]),
      );
    const session = new IrohSession(fetcher);
    session.restore(
      'chat_old',
      [
        {
          id: '1',
          role: 'user',
          content: 'What is ETH doing?',
          status: 'complete',
        },
        {
          id: '2',
          role: 'assistant',
          content: 'ETH has inflows.',
          status: 'complete',
        },
      ],
      'conv_1',
    );
    expect(session.getSnapshot().messages).toHaveLength(2);
    await session.send('How about seven days?');
    expect(
      JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({
      text: 'How about seven days?',
      chatId: 'chat_old',
    });
    expect(session.getSnapshot().conversationId).toBe('conv_2');
  });

  it('starts a new saved chat without reusing the old chat ID', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        sse([
          'data: {"type":"finish","conversation_id":null}\n\ndata: [DONE]\n\n',
        ]),
      );
    const session = new IrohSession(fetcher);
    session.restore('old', [], 'conv_old');
    session.restore('new', [], null);
    await session.send('New question');
    expect(
      JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({
      text: 'New question',
      chatId: 'new',
    });
    expect(session.getSnapshot().conversationId).toBeNull();
  });

  it('clears a stale ID when Nansen finishes a follow-up without one', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        sse([
          'data: {"type":"finish","conversation_id":null}\n\ndata: [DONE]\n\n',
        ]),
      );
    const session = new IrohSession(fetcher);
    session.restore('old', [], 'conv_old');
    await session.send('Follow-up');
    expect(session.getSnapshot().conversationId).toBeNull();
  });
  it('streams the first answer and sends a follow-up with the returned conversation ID', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        sse([
          'data: {"type":"delta","text":"First"}\n\ndata: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        sse([
          'data: {"type":"tool_call","name":"holdings"}\n\ndata: {"type":"delta","text":"Second"}\n\ndata: {"type":"finish","conversation_id":"conv_2"}\n\ndata: [DONE]\n\n',
        ]),
      );
    const session = new IrohSession(fetcher);
    await session.send('What is ETH doing?');
    expect(session.getSnapshot().messages.map((m) => m.content)).toEqual([
      'What is ETH doing?',
      'First',
    ]);
    expect(session.getSnapshot().conversationId).toBe('conv_1');
    await session.send('And HYPE?');
    expect(
      JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({ text: 'What is ETH doing?' });
    expect(
      JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string),
    ).toEqual({ text: 'And HYPE?', conversation_id: 'conv_1' });
    expect(session.getSnapshot().conversationId).toBe('conv_2');
    expect(session.getSnapshot().messages.at(-1)?.content).toBe('Second');
    expect(session.getSnapshot().currentTool).toBe(null);
  });

  it('stops an active stream and preserves partial text', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = vi.fn(async () => sse([]));
    fetcher.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              controller = c;
              c.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"delta","text":"Partial"}\n\n',
                ),
              );
            },
            cancel() {
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const session = new IrohSession(fetcher);
    const pending = session.send('question');
    await vi.waitFor(() =>
      expect(session.getSnapshot().messages.at(-1)?.content).toBe('Partial'),
    );
    session.stop();
    await pending;
    expect(session.getSnapshot().messages.at(-1)?.status).toBe('stopped');
    expect(session.getSnapshot().isStreaming).toBe(false);
  });

  it('reset clears the ID and messages and blocks duplicate send', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const session = new IrohSession(fetcher);
    const pending = session.send('one');
    expect(session.send('two')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    session.reset();
    resolve(
      sse([
        'data: {"type":"finish","conversation_id":"old"}\n\ndata: [DONE]\n\n',
      ]),
    );
    await pending;
    expect(session.getSnapshot().messages).toEqual([]);
    expect(session.getSnapshot().conversationId).toBe(null);
  });

  it('keeps the question and exposes a retryable error for HTTP failures', async () => {
    const session = new IrohSession(async () =>
      Response.json(
        { error: 'Nansen authentication failed.' },
        { status: 401 },
      ),
    );
    await session.send('question');
    expect(session.getSnapshot().error).toContain('authentication failed');
    expect(session.getSnapshot().messages[0].content).toBe('question');
    expect(session.getSnapshot().messages.at(-1)?.status).toBe('error');
  });

  it('retries the failed question without a second copy of it', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: 'Bad gateway.' }, { status: 502 }),
      )
      .mockResolvedValueOnce(
        sse([
          'data: {"type":"delta","text":"Answer"}\n\ndata: {"type":"finish","conversation_id":"c1"}\n\ndata: [DONE]\n\n',
        ]),
      );
    const session = new IrohSession(fetcher);
    await session.send('question');
    await session.retry();
    const { messages, error } = session.getSnapshot();
    expect(messages.map((m) => [m.role, m.content, m.status])).toEqual([
      ['user', 'question', 'complete'],
      ['assistant', 'Answer', 'complete'],
    ]);
    expect(error).toBe(null);
  });

  it('keeps partial answer text when a retry resends the question', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(sse(['data: {"type":"delta","text":"Kept"}\n\n']))
      .mockResolvedValueOnce(
        Response.json({ error: 'Daily cap.' }, { status: 429 }),
      );
    const session = new IrohSession(fetcher);
    await session.send('question');
    await session.retry();
    const { messages, error } = session.getSnapshot();
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'question'],
      ['assistant', 'Kept'],
      ['user', 'question'],
      ['assistant', ''],
    ]);
    expect(error).toBe('Daily cap.');
  });

  it('shows a safe error for a browser network failure', async () => {
    const session = new IrohSession(async () => {
      throw new Error('internal stack and secret details');
    });
    await session.send('question');
    expect(session.getSnapshot().error).toBe(
      'The research connection was interrupted. You can retry.',
    );
  });

  it('preserves partial answer before a malformed SSE event', async () => {
    const session = new IrohSession(async () =>
      sse(['data: {"type":"delta","text":"Kept"}\n\ndata: {broken}\n\n']),
    );
    await session.send('question');
    expect(session.getSnapshot().messages.at(-1)?.content).toBe('Kept');
    expect(session.getSnapshot().error).toContain('interrupted');
  });

  it('completes an answer when DONE is the final line without a blank delimiter', async () => {
    const session = new IrohSession(async () =>
      sse([
        'data: {"type":"delta","text":"Answer"}\n\ndata: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n',
      ]),
    );
    await session.send('question');
    expect(session.getSnapshot().messages.at(-1)?.status).toBe('complete');
    expect(session.getSnapshot().conversationId).toBe('conv_1');
    expect(session.getSnapshot().error).toBeNull();
  });

  it('marks a full answer complete when Nansen finishes with a null conversation ID', async () => {
    const session = new IrohSession(async () =>
      sse([
        'data: {"type":"delta","text":"Answer"}\n\ndata: {"type":"finish","conversation_id":null}\n\ndata: [DONE]\n\n',
      ]),
    );
    await session.send('question');
    expect(session.getSnapshot().messages.at(-1)?.status).toBe('complete');
    expect(session.getSnapshot().conversationId).toBeNull();
    expect(session.getSnapshot().error).toBeNull();
  });

  it('includes the previous ETH exchange when a follow-up has no Nansen conversation ID', async () => {
    const previousQuestion =
      'What is smart money doing with ETH on Ethereum over the last 24 hours?';
    const previousAnswer =
      'Smart Trader wallets had $201.6K net outflow; Top PnL wallets had $7.0M net inflow.';
    const followUp = 'How does that compare with the last 7 days?';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        sse([
          `data: ${JSON.stringify({ type: 'delta', text: previousAnswer })}\n\ndata: {"type":"finish","conversation_id":null}\n\ndata: [DONE]\n\n`,
        ]),
      )
      .mockResolvedValueOnce(
        sse([
          'data: {"type":"delta","text":"Seven-day comparison"}\n\ndata: {"type":"finish","conversation_id":null}\n\ndata: [DONE]\n\n',
        ]),
      );
    const session = new IrohSession(fetcher);
    await session.send(previousQuestion);
    await session.send(followUp);
    const body = JSON.parse(
      (fetcher.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(body.text).toContain(previousQuestion);
    expect(body.text).toContain(previousAnswer);
    expect(body.text).toContain(followUp);
    expect(body.conversation_id).toBeUndefined();
    expect(session.getSnapshot().messages.at(-2)?.content).toBe(followUp);
  });

  it('keeps context-bearing requests within the Nansen text limit', async () => {
    const longAnswer = 'A'.repeat(10_000);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        sse([
          `data: ${JSON.stringify({ type: 'delta', text: longAnswer })}\n\ndata: {"type":"finish","conversation_id":null}\n\ndata: [DONE]\n\n`,
        ]),
      )
      .mockResolvedValueOnce(
        sse([
          'data: {"type":"finish","conversation_id":null}\n\ndata: [DONE]\n\n',
        ]),
      );
    const session = new IrohSession(fetcher);
    await session.send('Tell me about ETH.');
    const followUp = `Compare this: ${'B'.repeat(80)}`;
    await session.send(followUp);
    const body = JSON.parse(
      (fetcher.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(body.text.length).toBeLessThanOrEqual(6000);
    expect(body.text).toContain('Tell me about ETH.');
    expect(body.text).toContain('Compare this:');
    expect(body.question).toBe(followUp);
  });
});
