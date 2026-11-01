import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createAccount } from '../src/auth/service';
import type { NansenRequestManager } from '../src/nansen/request-manager';
import { openTempDb } from './temp-sqlite';

let temp: ReturnType<typeof openTempDb>;
let db: PrismaClient;

beforeEach(() => {
  process.env.NANSEN_AGENT_DAILY_LIMIT = '1000';
  temp = openTempDb();
  db = temp.db;
  vi.resetModules();
  vi.doMock('../src/auth/db', () => ({ db }));
});

afterEach(async () => {
  vi.doUnmock('../src/auth/db');
  vi.unstubAllGlobals();
  delete process.env.NANSEN_API_KEY;
  delete process.env.NANSEN_AGENT_DAILY_LIMIT;
  await temp.close();
});

/** Resolves once the next acquireIroh call has queued its job. */
function queuedIn(manager: NansenRequestManager) {
  const acquire = manager.acquireIroh.bind(manager);
  return new Promise<void>((resolve) => {
    vi.spyOn(manager, 'acquireIroh').mockImplementationOnce((...args) => {
      const lease = acquire(...args);
      resolve();
      return lease;
    });
  });
}

function request(url: string, token?: string, body?: object) {
  return new Request(`http://localhost${url}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token ? { cookie: `tea_session=${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe('Iroh chat HTTP routes', () => {
  it('creates, lists, and restores only the authenticated user’s chats', async () => {
    const owner = await createAccount(db, 'Owner', 'correct horse');
    const other = await createAccount(db, 'Other', 'correct horse');
    const collection = await import('../src/app/api/iroh/chats/route');
    const detail = await import('../src/app/api/iroh/chats/[chatId]/route');
    expect(
      (await collection.POST(request('/api/iroh/chats', undefined, {}))).status,
    ).toBe(401);
    const created = await collection.POST(
      request('/api/iroh/chats', owner.token, {}),
    );
    expect(created.status).toBe(201);
    const { chat } = (await created.json()) as { chat: { id: string } };
    const ownList = await collection.GET(
      request('/api/iroh/chats', owner.token),
    );
    expect(
      ((await ownList.json()) as { chats: { id: string }[] }).chats.map(
        (item) => item.id,
      ),
    ).toEqual([chat.id]);
    const otherList = await collection.GET(
      request('/api/iroh/chats', other.token),
    );
    expect(((await otherList.json()) as { chats: unknown[] }).chats).toEqual(
      [],
    );
    expect(
      (
        await detail.GET(request(`/api/iroh/chats/${chat.id}`, other.token), {
          params: Promise.resolve({ chatId: chat.id }),
        })
      ).status,
    ).toBe(404);
  });

  it('stores streamed messages and reuses each chat’s server-side Nansen ID', async () => {
    const owner = await createAccount(db, 'Owner', 'correct horse');
    const collection = await import('../src/app/api/iroh/chats/route');
    const { POST } = await import('../src/app/api/nansen-agent/route');
    const firstChat = (await (
      await collection.POST(request('/api/iroh/chats', owner.token, {}))
    ).json()) as { chat: { id: string } };
    const secondChat = (await (
      await collection.POST(request('/api/iroh/chats', owner.token, {}))
    ).json()) as { chat: { id: string } };
    const outbound: Record<string, unknown>[] = [];
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        outbound.push(JSON.parse(init.body as string));
        const n = outbound.length;
        return new Response(
          `data: {"type":"delta","text":"Answer ${n}"}\n\ndata: {"type":"finish","conversation_id":"conv_${n}"}\n\ndata: [DONE]\n\n`,
          {
            headers: { 'content-type': 'text/event-stream' },
          },
        );
      }),
    );
    const ask = async (chatId: string, text: string) => {
      const response = await POST(
        request('/api/nansen-agent', owner.token, { chatId, text }),
      );
      expect(response.status).toBe(200);
      await response.text();
    };
    await ask(firstChat.chat.id, 'What is ETH doing?');
    await ask(firstChat.chat.id, 'How about seven days?');
    await ask(secondChat.chat.id, 'Fresh SOL question');
    expect(outbound).toHaveLength(3);
    expect(outbound[0].text).toContain('You are Uncle');
    expect(outbound[0].text).toContain('What is ETH doing?');
    expect(outbound[0]).not.toHaveProperty('conversation_id');
    expect(outbound[1]).toEqual({
      text: 'How about seven days?',
      conversation_id: 'conv_1',
    });
    expect(outbound[2].text).toContain('You are Uncle');
    expect(outbound[2].text).toContain('Fresh SOL question');
    expect(outbound[2]).not.toHaveProperty('conversation_id');
    const saved = await db.chat.findUniqueOrThrow({
      where: { id: firstChat.chat.id },
      include: { messages: { orderBy: { id: 'asc' } } },
    });
    expect(saved.nansenConversationId).toBe('conv_2');
    expect(
      saved.messages.map((message) => [message.role, message.content]),
    ).toEqual([
      ['user', 'What is ETH doing?'],
      ['assistant', 'Answer 1'],
      ['user', 'How about seven days?'],
      ['assistant', 'Answer 2'],
    ]);
  });

  it('rejects cross-user streaming before contacting Nansen', async () => {
    const owner = await createAccount(db, 'Owner', 'correct horse');
    const other = await createAccount(db, 'Other', 'correct horse');
    const collection = await import('../src/app/api/iroh/chats/route');
    const { POST } = await import('../src/app/api/nansen-agent/route');
    const { chat } = (await (
      await collection.POST(request('/api/iroh/chats', owner.token, {}))
    ).json()) as { chat: { id: string } };
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await POST(
      request('/api/nansen-agent', other.token, {
        chatId: chat.id,
        text: 'Steal it',
      }),
    );
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.message.count({ where: { chatId: chat.id } })).toBe(0);
  });

  it('Stop while queued makes no upstream call and persists no message', async () => {
    const owner = await createAccount(db, 'Owner', 'correct horse');
    const { createChat } = await import('../src/iroh/history');
    const chat = await createChat(db, owner.user.id);
    const { POST } = await import('../src/app/api/nansen-agent/route');
    const { nansenRequestManager } = await import(
      '../src/nansen/request-manager'
    );
    const first = await nansenRequestManager.acquireIroh();
    const second = await nansenRequestManager.acquireIroh();
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const queued = queuedIn(nansenRequestManager);
    const pending = POST(
      new Request('http://localhost/api/nansen-agent', {
        method: 'POST',
        headers: {
          cookie: `tea_session=${owner.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ chatId: chat.id, text: 'Queued question' }),
        signal: controller.signal,
      }),
    );
    await queued;
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.message.count({ where: { chatId: chat.id } })).toBe(0);
    first.release();
    second.release();
  });

  it('rejects a second active turn for one saved chat', async () => {
    const owner = await createAccount(db, 'Owner', 'correct horse');
    const { createChat } = await import('../src/iroh/history');
    const chat = await createChat(db, owner.user.id);
    const { POST } = await import('../src/app/api/nansen-agent/route');
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new ReadableStream({ start() {} }), {
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    );
    const first = await POST(
      request('/api/nansen-agent', owner.token, {
        chatId: chat.id,
        text: 'First',
      }),
    );
    expect(first.status).toBe(200);
    const second = await POST(
      request('/api/nansen-agent', owner.token, {
        chatId: chat.id,
        text: 'Second',
      }),
    );
    expect(second.status).toBe(409);
    expect(await db.message.count({ where: { chatId: chat.id } })).toBe(1);
    await first.body!.cancel();
  });

  it('reads the latest conversation ID after Iroh admission', async () => {
    const owner = await createAccount(db, 'Owner', 'correct horse');
    const { createChat, setConversationId } = await import(
      '../src/iroh/history'
    );
    const chat = await createChat(db, owner.user.id);
    const { POST } = await import('../src/app/api/nansen-agent/route');
    const { nansenRequestManager } = await import(
      '../src/nansen/request-manager'
    );
    const first = await nansenRequestManager.acquireIroh();
    const second = await nansenRequestManager.acquireIroh();
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return new Response(
          'data: {"type":"finish","conversation_id":"conv_new"}\n\ndata: [DONE]\n\n',
          {
            headers: { 'content-type': 'text/event-stream' },
          },
        );
      }),
    );
    const queued = queuedIn(nansenRequestManager);
    const pending = POST(
      request('/api/nansen-agent', owner.token, {
        chatId: chat.id,
        text: 'Follow up',
      }),
    );
    await queued;
    await setConversationId(db, owner.user.id, chat.id, 'conv_latest');
    first.release();
    const response = await pending;
    await response.text();
    expect(bodies).toEqual([
      { text: 'Follow up', conversation_id: 'conv_latest' },
    ]);
    second.release();
  });

  it('rolls back the question and frees the chat when Nansen rejects it', async () => {
    const owner = await createAccount(db, 'Owner', 'correct horse');
    const { createChat, getChat } = await import('../src/iroh/history');
    const chat = await createChat(db, owner.user.id);
    const { POST } = await import('../src/app/api/nansen-agent/route');
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 503 }))
        .mockResolvedValueOnce(
          new Response('{}', { headers: { 'content-type': 'text/json' } }),
        ),
    );
    const ask = () =>
      POST(
        request('/api/nansen-agent', owner.token, {
          chatId: chat.id,
          text: 'hello',
        }),
      );

    expect((await ask()).status).toBe(503);
    expect((await ask()).status).toBe(502);
    const restored = await getChat(db, owner.user.id, chat.id);
    expect(restored?.messages).toEqual([]);
    expect(restored?.title).toBe('New chat');
  });

  it('rolls back the question on a network error or an empty error stream', async () => {
    const owner = await createAccount(db, 'Owner', 'correct horse');
    const { createChat, getChat } = await import('../src/iroh/history');
    const chat = await createChat(db, owner.user.id);
    const { POST } = await import('../src/app/api/nansen-agent/route');
    process.env.NANSEN_API_KEY = 'test-only-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(
          new Response(
            'data: {"type":"error","error":"down","status_code":502}\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        ),
    );
    const ask = () =>
      POST(
        request('/api/nansen-agent', owner.token, {
          chatId: chat.id,
          text: 'hello',
        }),
      );

    expect((await ask()).status).toBe(502);
    const streamed = await ask();
    expect(streamed.status).toBe(200);
    await streamed.text();
    const restored = await getChat(db, owner.user.id, chat.id);
    expect(restored?.messages).toEqual([]);
    expect(restored?.title).toBe('New chat');
  });

  it('rolls back the user write when Stop lands just before Agent fetch', async () => {
    const owner = await createAccount(db, 'Owner', 'correct horse');
    const { createChat, getChat } = await import('../src/iroh/history');
    const chat = await createChat(db, owner.user.id);
    const { POST } = await import('../src/app/api/nansen-agent/route');
    process.env.NANSEN_API_KEY = 'test-only-secret';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const originalUpdate = db.chat.update.bind(db.chat);
    vi.spyOn(db.chat, 'update').mockImplementation((args) => {
      controller.abort();
      return originalUpdate(args);
    });
    const response = await POST(
      new Request('http://localhost/api/nansen-agent', {
        method: 'POST',
        headers: {
          cookie: `tea_session=${owner.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ chatId: chat.id, text: 'Do not persist' }),
        signal: controller.signal,
      }),
    );
    expect(response.status).toBe(499);
    expect(fetch).not.toHaveBeenCalled();
    const restored = await getChat(db, owner.user.id, chat.id);
    expect(restored?.messages).toEqual([]);
    expect(restored?.title).toBe('New chat');
  });
});
