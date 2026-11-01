import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createAccount } from '../src/auth/service';
import {
  appendAssistantMessage,
  appendUserMessage,
  createChat,
  getChat,
  listChats,
  prepareAdmittedResearchRequest,
  rollbackUnstartedResearchRequest,
  setConversationId,
} from '../src/iroh/history';
import { openTempDb } from './temp-sqlite';

let temp: ReturnType<typeof openTempDb>;
let db: PrismaClient;

beforeEach(() => {
  temp = openTempDb();
  db = temp.db;
});

afterEach(async () => {
  await db.$disconnect();
  await temp.close();
});

describe('persistent Iroh chats', () => {
  it('creates chats and restores ordered messages after a fresh database connection', async () => {
    const { user } = await createAccount(db, 'Mark', 'correct horse');
    const chat = await createChat(db, user.id);
    await appendUserMessage(db, user.id, chat.id, 'What is ETH doing?');
    await appendAssistantMessage(db, user.id, chat.id, 'ETH is rising.');
    await setConversationId(db, user.id, chat.id, 'conv_123');
    await db.$disconnect();
    db = new PrismaClient({ datasources: { db: { url: temp.url } } });
    const restored = await getChat(db, user.id, chat.id);
    expect(restored?.nansenConversationId).toBe('conv_123');
    expect(restored?.title).toBe('What is ETH doing?');
    expect(
      restored?.messages.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: 'user', content: 'What is ETH doing?' },
      { role: 'assistant', content: 'ETH is rising.' },
    ]);
    expect(
      restored?.messages.every((message) => message.createdAt instanceof Date),
    ).toBe(true);
    expect((await listChats(db, user.id)).map(({ id }) => id)).toEqual([
      chat.id,
    ]);
  });

  it('prevents another user from reading or changing a chat', async () => {
    const owner = (await createAccount(db, 'Owner', 'correct horse')).user;
    const other = (await createAccount(db, 'Other', 'correct horse')).user;
    const chat = await createChat(db, owner.id);
    await appendUserMessage(db, owner.id, chat.id, 'private ETH question');
    expect(await listChats(db, other.id)).toEqual([]);
    expect(await getChat(db, other.id, chat.id)).toBeNull();
    await expect(
      appendUserMessage(db, other.id, chat.id, 'intrusion'),
    ).rejects.toThrow('Chat not found');
    await expect(
      appendAssistantMessage(db, other.id, chat.id, 'intrusion'),
    ).rejects.toThrow('Chat not found');
    await expect(
      setConversationId(db, other.id, chat.id, 'stolen'),
    ).rejects.toThrow('Chat not found');
    expect((await getChat(db, owner.id, chat.id))?.messages).toHaveLength(1);
    expect(
      (await getChat(db, owner.id, chat.id))?.nansenConversationId,
    ).toBeNull();
  });

  it('starts each new chat without a Nansen conversation ID', async () => {
    const { user } = await createAccount(db, 'Mark', 'correct horse');
    const first = await createChat(db, user.id);
    await setConversationId(db, user.id, first.id, 'conv_first');
    const second = await createChat(db, user.id);
    expect(second.nansenConversationId).toBeNull();
    expect((await getChat(db, user.id, first.id))?.nansenConversationId).toBe(
      'conv_first',
    );
  });

  it('clears a saved Nansen ID when a later answer returns no ID', async () => {
    const { user } = await createAccount(db, 'Mark', 'correct horse');
    const chat = await createChat(db, user.id);
    await setConversationId(db, user.id, chat.id, 'conv_old');
    await setConversationId(db, user.id, chat.id, null);
    expect(
      (await getChat(db, user.id, chat.id))?.nansenConversationId,
    ).toBeNull();
  });

  it('reuses the saved Nansen ID for an old chat and starts a new chat without one', async () => {
    const { user } = await createAccount(db, 'Mark', 'correct horse');
    const old = await createChat(db, user.id);
    await setConversationId(db, user.id, old.id, 'conv_old');
    const signal = new AbortController().signal;
    const resumed = await prepareAdmittedResearchRequest(
      db,
      user.id,
      old.id,
      'And over 7 days?',
      signal,
    );
    expect(resumed).toMatchObject({
      text: 'And over 7 days?',
      conversationId: 'conv_old',
    });
    const fresh = await createChat(db, user.id);
    const first = await prepareAdmittedResearchRequest(
      db,
      user.id,
      fresh.id,
      'Tell me about ETH',
      signal,
    );
    expect(first).toMatchObject({
      text: 'Tell me about ETH',
      conversationId: null,
    });
  });

  it('uses multiple stored exchanges when Nansen returned no conversation ID', async () => {
    const { user } = await createAccount(db, 'Mark', 'correct horse');
    const chat = await createChat(db, user.id);
    await appendUserMessage(db, user.id, chat.id, 'What is ETH doing?');
    await appendAssistantMessage(db, user.id, chat.id, 'ETH has inflows.');
    await appendUserMessage(db, user.id, chat.id, 'What about SOL?');
    await appendAssistantMessage(db, user.id, chat.id, 'SOL has outflows.');
    const request = await prepareAdmittedResearchRequest(
      db,
      user.id,
      chat.id,
      'Compare them over seven days.',
      new AbortController().signal,
    );
    expect(request.conversationId).toBeNull();
    expect(request.text).toContain('What is ETH doing?');
    expect(request.text).toContain('ETH has inflows.');
    expect(request.text).toContain('What about SOL?');
    expect(request.text).toContain('SOL has outflows.');
    expect(request.text).toContain('Compare them over seven days.');
    expect(request.text.length).toBeLessThanOrEqual(6000);
  });

  it('moves a chat to the top when a later turn is saved without a finish', async () => {
    const { user } = await createAccount(db, 'Mark', 'correct horse');
    const a = await createChat(db, user.id);
    await appendUserMessage(db, user.id, a.id, 'q1');
    const b = await createChat(db, user.id);
    await appendUserMessage(db, user.id, b.id, 'q1');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await appendUserMessage(db, user.id, a.id, 'q2');
    await appendAssistantMessage(db, user.id, a.id, 'partial', 'stopped');
    expect((await listChats(db, user.id)).map((chat) => chat.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it('rolls back an admitted user write, title and list order if Stop precedes upstream start', async () => {
    const { user } = await createAccount(db, 'Mark', 'correct horse');
    const chat = await createChat(db, user.id);
    const newer = await createChat(db, user.id);
    await appendUserMessage(db, user.id, newer.id, 'Newer question');
    const prepared = await prepareAdmittedResearchRequest(
      db,
      user.id,
      chat.id,
      'Never sent',
      new AbortController().signal,
    );
    await rollbackUnstartedResearchRequest(
      db,
      user.id,
      chat.id,
      prepared.userMessageId,
      prepared.previous,
    );
    const restored = await getChat(db, user.id, chat.id);
    expect(restored?.messages).toEqual([]);
    expect(restored?.title).toBe('New chat');
    expect((await listChats(db, user.id)).map((row) => row.id)).toEqual([
      newer.id,
      chat.id,
    ]);
  });
});
