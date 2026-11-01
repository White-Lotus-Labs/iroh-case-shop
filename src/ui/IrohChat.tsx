'use client';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { IrohSession, type ChatMessage } from '../nansen/session';
import { MAX_QUESTION_LENGTH } from '../nansen/limits';
import type { NansenAvailability } from '../nansen/availability';
import {
  clearUserNansenApiKey,
  getUserNansenApiKey,
  setUserNansenApiKey,
} from '../nansen/user-api-key';
import type { PublicUser } from '../auth/service';
import { IrohMessage } from './IrohMessage';

type ChatSummary = { id: string; title: string; updatedAt: string };
type SavedMessage = Pick<ChatMessage, 'role' | 'content' | 'status'> & {
  id: number;
};

export function IrohChat({
  session,
  user,
  nansen,
  draft: draftPrefill = null,
}: {
  session: IrohSession;
  user: PublicUser | null;
  nansen: NansenAvailability;
  draft?: { text: string; key: number } | null;
}) {
  const chat = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<ChatSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(Boolean(user));
  const [hasUserKey, setHasUserKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const loadGeneration = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // Sending disables the composer, and the browser drops its focus to <body>.
  const refocusAfterAnswer = useRef(false);

  const fetchChats = async () => {
    const response = await fetch('/api/iroh/chats', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    return ((await response.json()) as { chats: ChatSummary[] }).chats;
  };
  // Failures show fixed copy, never raw fetch text such as 'Failed to fetch'.
  // Skip the result when an unmount, openChat, or newer newChat made it stale.
  const createChat = async () => {
    const generation = loadGeneration.current;
    const response = await fetch('/api/iroh/chats', { method: 'POST' });
    if (!response.ok) throw new Error();
    const { chat } = (await response.json()) as { chat: ChatSummary };
    if (generation !== loadGeneration.current) return;
    session.restore(chat.id, [], null);
    setSelectedId(chat.id);
    setHistory((current) => [chat, ...current]);
  };

  const openChat = async (chatId: string) => {
    const generation = ++loadGeneration.current;
    session.stop();
    setHistoryError(null);
    const response = await fetch(
      `/api/iroh/chats/${encodeURIComponent(chatId)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error();
    const data = (await response.json()) as {
      chat: {
        id: string;
        nansenConversationId: string | null;
        messages: SavedMessage[];
      };
    };
    if (generation !== loadGeneration.current) return;
    session.restore(
      data.chat.id,
      data.chat.messages.map((message) => ({
        ...message,
        id: String(message.id),
      })),
      data.chat.nansenConversationId,
    );
    setSelectedId(chatId);
    input.current?.focus();
  };

  const newChat = async () => {
    setDraft('');
    input.current?.focus();
    if (!user) return session.reset();
    ++loadGeneration.current;
    session.stop();
    setHistoryError(null);
    try {
      await createChat();
    } catch {
      setHistoryOpen(true);
      setHistoryError('Could not create a chat.');
    }
  };

  useEffect(() => {
    setHasUserKey(Boolean(getUserNansenApiKey()));
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const initialize = async () => {
      try {
        const chats = await fetchChats();
        if (cancelled) return;
        setHistory(chats);
        const current = session.getSnapshot().chatId;
        const target =
          current && chats.some((chat) => chat.id === current)
            ? current
            : chats[0]?.id;
        if (target) {
          setSelectedId(target);
          if (current !== target) await openChat(target);
        } else {
          await createChat();
        }
      } catch {
        if (!cancelled) {
          setHistoryOpen(true);
          setHistoryError('Could not load your chats.');
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      ++loadGeneration.current;
    };
  }, [session, user?.id]);

  // The composer is disabled while chats load, so focus it once loading ends.
  useEffect(() => {
    if (!historyLoading) input.current?.focus();
  }, [historyLoading]);
  useEffect(() => {
    if (!draftPrefill) return;
    setDraft(draftPrefill.text);
    const field = input.current;
    if (!field) return;
    field.focus();
    const end = draftPrefill.text.length;
    field.setSelectionRange(end, end);
  }, [draftPrefill?.key]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages.at(-1)?.content, chat.error]);
  useEffect(() => {
    if (chat.isStreaming || !refocusAfterAnswer.current) return;
    refocusAfterAnswer.current = false;
    // Only hand focus back if the visitor has not moved on to something else.
    if (!document.activeElement || document.activeElement === document.body)
      input.current?.focus();
  }, [chat.isStreaming]);
  const dailyCap = chat.errorCode === 'nansen_agent_daily_limit';
  const needsUserKey = !hasUserKey && (dailyCap || nansen === 'unavailable');
  const saveUserKey = (event: FormEvent) => {
    event.preventDefault();
    if (!setUserNansenApiKey(keyDraft)) return;
    setHasUserKey(true);
    setKeyDraft('');
    setKeyFormOpen(false);
    input.current?.focus();
  };
  const clearStoredKey = () => {
    clearUserNansenApiKey();
    setHasUserKey(false);
    setKeyFormOpen(false);
  };
  const send = () => {
    const pending = session.send(draft);
    if (pending) {
      refocusAfterAnswer.current = document.activeElement === input.current;
      // A click anywhere (selecting answer text, dragging the room) means the
      // visitor moved on, even if focus stays on <body>.
      if (refocusAfterAnswer.current)
        document.addEventListener(
          'pointerdown',
          () => (refocusAfterAnswer.current = false),
          { once: true, capture: true },
        );
      setDraft('');
      if (user) void pending.then(fetchChats).then(setHistory, () => {});
    }
  };
  const byokActions = (
    <div className="iroh-byok">
      {keyFormOpen ? (
        <form className="iroh-byok-form" onSubmit={saveUserKey}>
          <label htmlFor="iroh-user-key" className="sr-only">
            Your Nansen API key
          </label>
          <input
            id="iroh-user-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
            placeholder="Paste your Nansen API key"
          />
          <button type="submit" disabled={!keyDraft.trim()}>
            Save
          </button>
          <button type="button" onClick={() => setKeyFormOpen(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="iroh-limit-cta"
          onClick={() => setKeyFormOpen(true)}
        >
          Enter your key
        </button>
      )}
      <a
        className="iroh-limit-cta"
        href="https://nsn.ai/iroh0x"
        target="_blank"
        rel="noreferrer"
      >
        Get a Nansen API key ↗
      </a>
    </div>
  );
  return (
    <div className="iroh-chat">
      <header className="iroh-chat-head">
        <div className="iroh-chat-title">
          <div className="eyebrow">THE HOST · NANSEN RESEARCH AGENT</div>
          <h1>
            Ask <em>Uncle</em>
          </h1>
          <p>
            {nansen === 'configured' || hasUserKey
              ? 'Live Nansen research · Fast mode'
              : 'Nansen research is offline'}
          </p>
        </div>
        <div className="iroh-chat-actions">
          {user && (
            <button
              type="button"
              aria-controls="iroh-history"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              {historyOpen ? 'Hide history' : 'Chat history'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void newChat()}
            disabled={historyLoading}
          >
            Begin a new conversation
          </button>
        </div>
      </header>
      <div
        className={`iroh-chat-body${historyOpen && user ? ' has-history' : ''}`}
      >
        {user && (
          <aside
            id="iroh-history"
            className="iroh-history"
            aria-label="Chat history"
            hidden={!historyOpen}
          >
            <div className="iroh-history-label">YOUR CHATS</div>
            {historyLoading && <p>Loading chats…</p>}
            {historyError && <p role="alert">{historyError}</p>}
            {history.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === selectedId ? 'is-selected' : ''}
                aria-current={item.id === selectedId ? 'page' : undefined}
                onClick={() =>
                  void openChat(item.id).catch(() =>
                    setHistoryError('Could not open this chat.'),
                  )
                }
              >
                {item.title}
              </button>
            ))}
          </aside>
        )}
        <div
          className="iroh-transcript"
          role="log"
          aria-label="Uncle conversation"
          aria-live="polite"
        >
          {chat.messages.length === 0 && (
            <div className="iroh-greeting">
              <span className="iroh-seal" aria-hidden="true">
                茶
              </span>
              <p className="iroh-greeting-title">
                Bring me a token, wallet, or market question.
              </p>
              {(nansen === 'configured' || hasUserKey) && (
                <p>
                  I’ll consult Nansen’s Research Agent and bring back the
                  onchain evidence.
                </p>
              )}
              {needsUserKey && !dailyCap && (
                <>
                  <p>
                    The house key is offline. Enter your own Nansen key, or get
                    one below.
                  </p>
                  {byokActions}
                </>
              )}
              {!user && (
                <p>
                  <a href="/account">Log in</a> to save this chat.
                </p>
              )}
            </div>
          )}
          {chat.messages
            // An empty reply shows no card: the activity line below is the
            // one waiting signal, and a failed reply shows the error box.
            .filter(
              (message) => message.content || message.status === 'stopped',
            )
            .map((message) => (
              <article
                className={`iroh-message is-${message.role}`}
                key={message.id}
              >
                <div className="iroh-speaker">
                  {message.role === 'user' ? 'You' : 'Uncle'}
                </div>
                {message.content && <IrohMessage content={message.content} />}
                {message.status === 'stopped' && (
                  <small>Stopped · partial answer</small>
                )}
              </article>
            ))}
          {chat.isStreaming && (
            <p className="iroh-activity" role="status">
              {nansen === 'unavailable' && !hasUserKey
                ? 'Nansen research is offline'
                : chat.currentTool
                  ? `Researching with Nansen: ${chat.currentTool}`
                  : 'Uncle is consulting Nansen…'}
            </p>
          )}
          {chat.error && (
            <div
              className={`iroh-error${dailyCap ? ' is-limit' : ''}`}
              role="alert"
            >
              <p>{chat.error}</p>
              {dailyCap
                ? !hasUserKey && byokActions
                : (nansen === 'configured' || hasUserKey) && (
                    <button type="button" onClick={() => session.retry()}>
                      Try again
                    </button>
                  )}
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>
      {hasUserKey && (
        <p className="iroh-byok-using">
          Using your Nansen key{' '}
          <button type="button" onClick={clearStoredKey}>
            Clear
          </button>
        </p>
      )}
      <form
        className="iroh-compose"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor="iroh-question" className="sr-only">
          Ask an onchain research question
        </label>
        <textarea
          id="iroh-question"
          ref={input}
          value={draft}
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={
            historyLoading
              ? 'Loading your chats…'
              : needsUserKey
                ? dailyCap
                  ? 'Daily limit reached. Enter your key to continue.'
                  : 'Enter a Nansen API key to ask Uncle.'
                : 'What is smart money doing with BTC this week?'
          }
          rows={2}
          disabled={
            chat.isStreaming ||
            historyLoading ||
            needsUserKey ||
            (Boolean(user) && !chat.chatId)
          }
        />
        <div className="iroh-compose-bottom">
          <span>
            {draft.length}/{MAX_QUESTION_LENGTH} characters
          </span>
          {chat.isStreaming ? (
            <button
              type="button"
              className="primary"
              onClick={() => session.stop()}
              aria-label="Stop generation"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="primary"
              disabled={
                !draft.trim() ||
                historyLoading ||
                needsUserKey ||
                (Boolean(user) && !chat.chatId)
              }
            >
              Ask Uncle <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
