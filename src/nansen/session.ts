import { INTERRUPTED_MESSAGE, SseDecoder } from './sse';
import { contextualQuestion } from './context';
import { MAX_QUESTION_LENGTH } from './limits';
import {
  getUserNansenApiKey,
  USER_NANSEN_API_KEY_HEADER,
} from './user-api-key';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'streaming' | 'stopped' | 'error';
}

export interface ChatSnapshot {
  messages: ChatMessage[];
  chatId: string | null;
  conversationId: string | null;
  isStreaming: boolean;
  currentTool: string | null;
  error: string | null;
  errorCode: string | null;
  lastQuestion: string | null;
}

const initial = (): ChatSnapshot => ({
  messages: [],
  chatId: null,
  conversationId: null,
  isStreaming: false,
  currentTool: null,
  error: null,
  errorCode: null,
  lastQuestion: null,
});

class ChatError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

export class IrohSession {
  private state = initial();
  private listeners = new Set<() => void>();
  private active: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private generation = 0;

  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<ChatSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private updateMessage(id: string, patch: Partial<ChatMessage>) {
    this.update({
      messages: this.state.messages.map((message) =>
        message.id === id ? { ...message, ...patch } : message,
      ),
    });
  }

  send(question: string): Promise<void> | false {
    const text = question.trim();
    if (this.active || !text || text.length > MAX_QUESTION_LENGTH) return false;
    const conversationId = this.state.conversationId;
    const chatId = this.state.chatId;
    const requestText =
      conversationId || chatId
        ? text
        : contextualQuestion(text, this.state.messages);
    const owner = ++this.generation;
    const abort = new AbortController();
    this.active = abort;
    const assistantId = crypto.randomUUID();
    this.update({
      messages: [
        ...this.state.messages,
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: text,
          status: 'complete',
        },
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          status: 'streaming',
        },
      ],
      isStreaming: true,
      currentTool: null,
      error: null,
      errorCode: null,
      lastQuestion: text,
    });
    return this.run(
      requestText,
      text,
      conversationId,
      chatId,
      assistantId,
      owner,
      abort,
    );
  }

  /** Resend the last question in place of its failed turn, not below it. */
  // ponytail: a signed-in chat can keep the first user row in SQLite until
  // reload; the server rollback owns that half.
  retry(): Promise<void> | false {
    const question = this.state.lastQuestion;
    // An error is set only after a failed send, so the failed turn is the last
    // two messages: the question and its reply. No request is active then.
    // Drop that turn only when no answer text arrived; partial text stays.
    if (!this.state.error || !question) return false;
    if (!this.state.messages.at(-1)?.content)
      this.update({ messages: this.state.messages.slice(0, -2) });
    return this.send(question);
  }

  private async run(
    text: string,
    question: string,
    conversationId: string | null,
    chatId: string | null,
    assistantId: string,
    owner: number,
    abort: AbortController,
  ) {
    const current = () => owner === this.generation && this.active === abort;
    let finished = false;
    try {
      const userKey = getUserNansenApiKey();
      const response = await this.fetcher('/api/nansen-agent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(userKey ? { [USER_NANSEN_API_KEY_HEADER]: userKey } : {}),
        },
        body: JSON.stringify({
          text,
          ...(text !== question ? { question } : {}),
          ...(chatId
            ? { chatId }
            : conversationId
              ? { conversation_id: conversationId }
              : {}),
        }),
        signal: abort.signal,
      });
      if (!current()) return;
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: unknown;
          code?: unknown;
        };
        throw new ChatError(
          typeof data.error === 'string'
            ? data.error
            : 'Nansen Research Agent is temporarily unavailable.',
          typeof data.code === 'string' ? data.code : null,
        );
      }
      if (!response.body) throw new ChatError(INTERRUPTED_MESSAGE);
      const reader = response.body.getReader();
      this.reader = reader;
      const decoder = new TextDecoder();
      const parser = new SseDecoder();
      let done = false;
      const consume = (event: ReturnType<SseDecoder['feed']>[number]) => {
        if (done) return;
        if (event.type === 'delta') {
          const old = this.state.messages.find(
            (message) => message.id === assistantId,
          );
          this.updateMessage(assistantId, {
            content: (old?.content ?? '') + event.text,
          });
        } else if (event.type === 'tool_call') {
          this.update({ currentTool: event.name.slice(0, 80) });
        } else if (event.type === 'finish') {
          finished = true;
          this.update({ conversationId: event.conversation_id });
        } else if (event.type === 'error') {
          throw new ChatError(event.error);
        } else if (event.type === 'done') {
          done = true;
        }
      };
      while (current()) {
        const part = await reader.read();
        if (!current()) return;
        if (part.done) break;
        parser.feed(decoder.decode(part.value, { stream: true }), consume);
      }
      if (!current()) return;
      parser.end(consume);
      if (!finished) throw new ChatError(INTERRUPTED_MESSAGE);
      this.updateMessage(assistantId, { status: 'complete' });
      this.update({ currentTool: null, isStreaming: false });
    } catch (error) {
      if (!current()) return;
      const message =
        error instanceof ChatError ? error.message : INTERRUPTED_MESSAGE;
      this.updateMessage(assistantId, { status: 'error' });
      this.update({
        error: message,
        errorCode: error instanceof ChatError ? error.code : null,
        currentTool: null,
        isStreaming: false,
      });
    } finally {
      if (current()) {
        this.active = null;
        this.reader = null;
      }
    }
  }

  stop() {
    if (!this.active) return;
    this.generation++;
    this.active.abort();
    void this.reader?.cancel().catch(() => {});
    this.active = null;
    this.reader = null;
    const last = this.state.messages.at(-1);
    if (last?.role === 'assistant' && last.status === 'streaming')
      this.updateMessage(last.id, { status: 'stopped' });
    this.update({ isStreaming: false, currentTool: null });
  }

  reset() {
    this.stop();
    this.update(initial());
  }

  restore(
    chatId: string,
    messages: ChatMessage[],
    conversationId: string | null,
  ) {
    this.stop();
    this.update({
      ...initial(),
      chatId,
      messages,
      conversationId,
      lastQuestion:
        [...messages].reverse().find((message) => message.role === 'user')
          ?.content ?? null,
    });
  }
}
