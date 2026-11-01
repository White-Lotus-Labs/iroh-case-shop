import {
  AgentEvent,
  encodeEvent,
  INTERRUPTED_MESSAGE,
  SseDecoder,
  validConversationId,
} from '../../../nansen/sse';
import {
  ChatNotFoundError,
  chatExists,
  prepareAdmittedResearchRequest,
  rollbackUnstartedResearchRequest,
} from '../../../iroh/history';
import { claimChatTurn } from '../../../iroh/turn-guard';
import { crossSiteError } from '../../../auth/same-origin';
import {
  agentDailyCap,
  clientIpFromRequest,
  type AgentCapClaim,
} from '../../../nansen/agent-cap';
import {
  MAX_QUESTION_LENGTH,
  MAX_RESEARCH_TEXT_LENGTH,
  QUESTION_TOO_LONG_MESSAGE,
} from '../../../nansen/limits';
import { withUnclePersona } from '../../../nansen/uncle';
import { parseRetryAfter } from '../../../nansen/client';
import {
  nansenRequestManager,
  NansenManagerError,
} from '../../../nansen/request-manager';
import {
  USER_NANSEN_API_KEY_HEADER,
  USER_NANSEN_API_KEY_MAX_LENGTH,
} from '../../../nansen/user-api-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENDPOINT = 'https://api.nansen.ai/api/v1/agent/fast';
const TIMEOUT_MS = 90_000;
/** Nansen reports spent credits as 402 or 403 with one of these codes. */
const CREDIT_ERROR = /CREDIT|EXHAUST|INSUFFICIENT_BALANCE/i;

function jsonError(
  status: number,
  error: string,
  retryAfter?: string | null,
  code?: string,
) {
  const headers = new Headers({ 'cache-control': 'no-store' });
  if (retryAfter && /^(\d{1,6}|[A-Za-z]{3}, .+ GMT)$/.test(retryAfter))
    headers.set('retry-after', retryAfter);
  return Response.json(
    { error, ...(code ? { code } : {}) },
    { status, headers },
  );
}

function capError(claim: AgentCapClaim) {
  const response = jsonError(
    429,
    'One cup for today, my friend. If you’d like to keep exploring, Nansen has more research waiting for you.',
    String(claim.retryAfterSeconds),
    'nansen_agent_daily_limit',
  );
  response.headers.set('x-ratelimit-limit', String(claim.limit));
  response.headers.set('x-ratelimit-remaining', String(claim.remaining));
  response.headers.set(
    'x-ratelimit-reset',
    String(Math.ceil(claim.resetAt / 1000)),
  );
  return response;
}

function upstreamMessage(status: number) {
  if (status === 401) return 'Nansen authentication failed.';
  if (status === 402) return 'Nansen Research Agent credits are unavailable.';
  if (status === 403)
    return 'Nansen Research Agent access is unavailable for this plan.';
  if (status === 429) return 'Too many requests. Try again shortly.';
  if (status === 400 || status === 422)
    return 'Nansen could not accept this question.';
  return 'Nansen Research Agent is temporarily unavailable.';
}

async function hasCreditError(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return false;
  const decoder = new TextDecoder();
  let sample = '';
  try {
    while (sample.length < 4096) {
      const chunk = await reader.read();
      if (chunk.done) break;
      sample += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    return false;
  } finally {
    await reader.cancel().catch(() => {});
  }
  return CREDIT_ERROR.test(sample);
}

function streamError(event: AgentEvent): AgentEvent {
  if (event.type !== 'error') return event;
  const status = event.status_code ?? 502;
  const creditError =
    (status === 402 || status === 403) && CREDIT_ERROR.test(event.error);
  return {
    type: 'error',
    error: upstreamMessage(creditError ? 402 : status),
    status_code: status,
  };
}

export async function POST(request: Request) {
  const refused = crossSiteError(request, { json: true });
  if (refused) return refused;
  if (Number(request.headers.get('content-length')) > 16_000)
    return jsonError(413, QUESTION_TOO_LONG_MESSAGE);
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 16_000) return jsonError(413, QUESTION_TOO_LONG_MESSAGE);
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, 'Invalid question.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return jsonError(400, 'Invalid question.');
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !['text', 'question', 'conversation_id', 'chatId'].includes(key),
    ) ||
    typeof value.text !== 'string' ||
    !value.text.trim() ||
    value.text.trim().length > MAX_RESEARCH_TEXT_LENGTH ||
    (value.question !== undefined &&
      (typeof value.question !== 'string' || !value.question.trim())) ||
    (value.conversation_id !== undefined &&
      !validConversationId(value.conversation_id)) ||
    (value.chatId !== undefined &&
      (typeof value.chatId !== 'string' ||
        value.chatId.length > 200 ||
        !value.chatId))
  )
    return jsonError(400, 'Invalid question or conversation.');

  const question = (value.question ?? value.text) as string;
  if (question.trim().length > MAX_QUESTION_LENGTH)
    return jsonError(413, QUESTION_TOO_LONG_MESSAGE);

  const rawUserKey = request.headers.get(USER_NANSEN_API_KEY_HEADER)?.trim();
  const userKey =
    rawUserKey && rawUserKey.length <= USER_NANSEN_API_KEY_MAX_LENGTH
      ? rawUserKey
      : '';
  const houseKey = process.env.NANSEN_API_KEY?.trim() ?? '';
  const key = userKey || houseKey;
  if (!key) return jsonError(503, 'Nansen Research Agent is not configured.');

  let text = value.text.trim();
  let conversationId = value.conversation_id as string | undefined;
  let persisted: { userId: string; chatId: string } | null = null;
  let releaseTurn: (() => void) | null = null;
  let db: typeof import('../../../auth/db').db | null = null;
  // Only a chat is saved. Without one, even a signed-in visitor (say, a guest
  // tab left open after signing in elsewhere) asks the way a guest does.
  if (typeof value.chatId === 'string') {
    if (conversationId)
      return jsonError(400, 'Invalid question or conversation.');
    const [{ db: database }, { userFromRequest }] = await Promise.all([
      import('../../../auth/db'),
      import('../../../iroh/request-user'),
    ]);
    db = database;
    const user = await userFromRequest(database, request);
    if (!user) return jsonError(401, 'Sign in to continue this chat.');
    if (!(await chatExists(database, user.id, value.chatId)))
      return jsonError(404, 'Chat not found.');
    releaseTurn = claimChatTurn(value.chatId);
    if (!releaseTurn)
      return jsonError(409, 'Another question is active in this chat.');
    persisted = { userId: user.id, chatId: value.chatId };
  }

  // House key keeps the daily cup. A visitor key skips it (they pay Nansen).
  let cap: AgentCapClaim | null = null;
  let refundCup = () => {};
  if (!userKey) {
    const clientIp = clientIpFromRequest(request);
    cap = agentDailyCap.claim(clientIp);
    if (!cap.allowed) {
      releaseTurn?.();
      return capError(cap);
    }
    // Nansen did not answer, so the guest keeps their cup for a retry.
    refundCup = () => agentDailyCap.refund(clientIp, cap!);
  }

  const preparation: {
    value: Awaited<ReturnType<typeof prepareAdmittedResearchRequest>> | null;
  } = { value: null };
  const rollbackPrepared = async () => {
    if (!preparation.value || !persisted || !db) return;
    await rollbackUnstartedResearchRequest(
      db,
      persisted.userId,
      persisted.chatId,
      preparation.value.userMessageId,
      preparation.value.previous,
    );
    preparation.value = null;
  };
  let lease;
  try {
    lease = await nansenRequestManager.acquireIroh(
      request.signal,
      persisted && db
        ? async (signal) => {
            preparation.value = await prepareAdmittedResearchRequest(
              db!,
              persisted!.userId,
              persisted!.chatId,
              question.trim(),
              signal,
            );
          }
        : undefined,
    );
  } catch (error) {
    refundCup();
    try {
      await rollbackPrepared();
    } finally {
      releaseTurn?.();
    }
    if (error instanceof ChatNotFoundError)
      return jsonError(404, 'Chat not found.');
    if (error instanceof NansenManagerError)
      return jsonError(error.status, error.message);
    if (request.signal.aborted) return jsonError(499, 'Question cancelled.');
    throw error;
  }

  if (preparation.value) {
    text = preparation.value.text;
    conversationId = preparation.value.conversationId ?? undefined;
  }

  const upstreamController = new AbortController();
  const onAbort = () => upstreamController.abort();
  lease.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => upstreamController.abort(), TIMEOUT_MS);
  const releaseUpstream = () => {
    clearTimeout(timer);
    lease.signal.removeEventListener('abort', onAbort);
    lease.release();
  };
  // Nansen sent no answer: undo the saved question, then free the chat.
  const rejectUnanswered = async (response: Response) => {
    upstreamController.abort();
    releaseUpstream();
    refundCup();
    await rollbackPrepared().catch(() => {});
    releaseTurn?.();
    return response;
  };
  const upstreamText = conversationId ? text : withUnclePersona(text);
  let upstream: Response;
  let fetchStarted = false;
  try {
    if (lease.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    fetchStarted = true;
    upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        apikey: key,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify({
        text: upstreamText,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
      signal: upstreamController.signal,
      cache: 'no-store',
    });
  } catch {
    // A timeout or Stop after the call started may already cost Nansen credits.
    const unanswered = !fetchStarted || !upstreamController.signal.aborted;
    let rollbackFailed = false;
    try {
      if (unanswered) await rollbackPrepared();
    } catch {
      rollbackFailed = true;
    } finally {
      releaseUpstream();
      releaseTurn?.();
    }
    if (unanswered) refundCup();
    if (rollbackFailed)
      return jsonError(500, 'The cancelled question could not be cleaned up.');
    if (lease.signal.aborted) return jsonError(499, 'Question cancelled.');
    return jsonError(502, 'Nansen Research Agent is temporarily unavailable.');
  }
  // A visitor's own key has its own Nansen limit: its 429 must not pause the
  // house key's queue for everyone else.
  const noteRateLimit = (retryAfterMs: number) => {
    if (!userKey) lease.noteRateLimit(retryAfterMs);
  };
  if (!upstream.ok) {
    if (upstream.status === 429)
      noteRateLimit(parseRetryAfter(upstream.headers.get('retry-after')));
    const creditError =
      (upstream.status === 402 || upstream.status === 403) &&
      (await hasCreditError(upstream));
    return rejectUnanswered(
      jsonError(
        upstream.status,
        creditError ? upstreamMessage(402) : upstreamMessage(upstream.status),
        upstream.headers.get('retry-after'),
      ),
    );
  }
  if (
    !upstream.body ||
    !upstream.headers.get('content-type')?.includes('text/event-stream')
  )
    return rejectUnanswered(
      jsonError(502, 'Nansen Research Agent returned an invalid stream.'),
    );

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = upstream.body.getReader();
  } catch {
    return rejectUnanswered(
      jsonError(502, 'Nansen Research Agent returned an invalid stream.'),
    );
  }
  const bodyStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const text = new TextDecoder();
      const parser = new SseDecoder();
      let finished = false;
      let done = false;
      let upstreamError = false;
      let answer = '';
      let returnedConversationId: string | null = null;
      const forward = (parsed: AgentEvent) => {
        if (done || upstreamError) return;
        const event = streamError(parsed);
        if (event.type === 'delta') answer += event.text;
        if (event.type === 'finish') {
          finished = true;
          returnedConversationId = event.conversation_id;
        }
        if (event.type === 'done') {
          done = true;
          return;
        }
        if (event.type === 'error') upstreamError = true;
        if (event.type === 'error' && event.status_code === 429)
          noteRateLimit(1000);
        controller.enqueue(encodeEvent(event));
      };
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          parser.feed(text.decode(chunk.value, { stream: true }), forward);
          if (done || upstreamError) break;
        }
        if (!upstreamError) parser.end(forward);
        if (!finished && !upstreamError && !upstreamController.signal.aborted)
          controller.enqueue(
            encodeEvent({ type: 'error', error: INTERRUPTED_MESSAGE }),
          );
      } catch {
        if (!upstreamController.signal.aborted && !upstreamError)
          controller.enqueue(
            encodeEvent({ type: 'error', error: INTERRUPTED_MESSAGE }),
          );
      } finally {
        releaseUpstream();
        // An error with no text lets the user retry; Stop and timeout keep the cup.
        if (!finished && !answer && !upstreamController.signal.aborted) {
          refundCup();
          await rollbackPrepared().catch(() => {});
        }
        await reader.cancel().catch(() => {});
        let saveFailed = false;
        if (persisted) {
          try {
            const { db } = await import('../../../auth/db');
            const { appendAssistantMessage, setConversationId } = await import(
              '../../../iroh/history'
            );
            if (answer.trim())
              await appendAssistantMessage(
                db,
                persisted.userId,
                persisted.chatId,
                answer,
                finished ? 'complete' : 'stopped',
              );
            if (finished)
              await setConversationId(
                db,
                persisted.userId,
                persisted.chatId,
                returnedConversationId,
              );
          } catch {
            saveFailed = true;
          }
        }
        try {
          if (saveFailed && !upstreamError)
            controller.enqueue(
              encodeEvent({
                type: 'error',
                error: 'The answer could not be saved. You can retry.',
              }),
            );
          else if (done && !upstreamError)
            controller.enqueue(encodeEvent({ type: 'done' }));
        } catch {
          /* The browser already cancelled. */
        }
        releaseTurn?.();
        try {
          controller.close();
        } catch {
          /* The browser already cancelled. */
        }
      }
    },
    cancel() {
      upstreamController.abort();
      void reader.cancel().catch(() => {});
      releaseUpstream();
    },
  });
  return new Response(bodyStream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...(cap
        ? {
            'x-ratelimit-limit': String(cap.limit),
            'x-ratelimit-remaining': String(cap.remaining),
            'x-ratelimit-reset': String(Math.ceil(cap.resetAt / 1000)),
          }
        : {}),
    },
  });
}
