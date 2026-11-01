import type { PrismaClient } from '@prisma/client';
import { contextualQuestion } from '../nansen/context';

export class ChatNotFoundError extends Error {
  constructor() {
    super('Chat not found');
  }
}

export async function createChat(db: PrismaClient, userId: string) {
  return db.chat.create({ data: { userId } });
}

export async function listChats(db: PrismaClient, userId: string) {
  return db.chat.findMany({
    where: { userId },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getChat(
  db: PrismaClient,
  userId: string,
  chatId: string,
) {
  return db.chat.findFirst({
    where: { id: chatId, userId },
    include: { messages: { orderBy: { id: 'asc' } } },
  });
}

async function ownedChat(db: PrismaClient, userId: string, chatId: string) {
  const chat = await db.chat.findFirst({ where: { id: chatId, userId } });
  if (!chat) throw new ChatNotFoundError();
  return chat;
}

export async function appendUserMessage(
  db: PrismaClient,
  userId: string,
  chatId: string,
  content: string,
) {
  const chat = await ownedChat(db, userId, chatId);
  const message = await db.message.create({
    data: { chatId, role: 'user', content },
  });
  // Prisma skips @updatedAt on an empty update, so set it explicitly.
  await db.chat.update({
    where: { id: chatId, userId },
    data: {
      updatedAt: new Date(),
      ...(chat.title === 'New chat'
        ? { title: content.replace(/\s+/g, ' ').trim().slice(0, 70) }
        : {}),
    },
  });
  return message;
}

export async function appendAssistantMessage(
  db: PrismaClient,
  userId: string,
  chatId: string,
  content: string,
  status: 'complete' | 'stopped' = 'complete',
) {
  await ownedChat(db, userId, chatId);
  const message = await db.message.create({
    data: { chatId, role: 'assistant', content, status },
  });
  await db.chat.update({
    where: { id: chatId, userId },
    data: { updatedAt: new Date() },
  });
  return message;
}

export async function setConversationId(
  db: PrismaClient,
  userId: string,
  chatId: string,
  conversationId: string | null,
) {
  await ownedChat(db, userId, chatId);
  return db.chat.update({
    where: { id: chatId, userId },
    data: { nansenConversationId: conversationId },
  });
}

/** Called only after Iroh admission, with the per-chat turn guard held. */
export async function prepareAdmittedResearchRequest(
  db: PrismaClient,
  userId: string,
  chatId: string,
  question: string,
  signal: AbortSignal,
) {
  const chat = await ownedChat(db, userId, chatId);
  // A saved Nansen conversation already holds the context.
  const text = chat.nansenConversationId
    ? question
    : contextualQuestion(
        question,
        await db.message.findMany({
          where: { chatId },
          orderBy: { id: 'asc' },
        }),
      );
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const message = await appendUserMessage(db, userId, chatId, question);
  return {
    text,
    conversationId: chat.nansenConversationId,
    userMessageId: message.id,
    previous: { title: chat.title, updatedAt: chat.updatedAt },
  };
}

/** Undo the narrow cancellation window between the user write and fetch start. */
export async function rollbackUnstartedResearchRequest(
  db: PrismaClient,
  userId: string,
  chatId: string,
  userMessageId: number,
  previous: { title: string; updatedAt: Date },
) {
  await ownedChat(db, userId, chatId);
  // Restore updatedAt too, so an unanswered question does not reorder the list.
  await db.$transaction([
    db.message.delete({ where: { id: userMessageId, chatId } }),
    db.chat.update({
      where: { id: chatId, userId },
      data: { title: previous.title, updatedAt: previous.updatedAt },
    }),
  ]);
}

/** True when the chat exists and belongs to the user. Reads no messages. */
export async function chatExists(
  db: PrismaClient,
  userId: string,
  chatId: string,
) {
  return !!(await db.chat.findFirst({
    where: { id: chatId, userId },
    select: { id: true },
  }));
}
