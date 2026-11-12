# Application backend API reference

This document supplements [the contract integration reference](README.md). It describes the current repository implementation, not a separately published backend service. All paths below use the frontend's own origin. The Next.js route handlers require the Node runtime and a configured Prisma SQLite database.

## Session and wallet boundaries

App identity is a server session identified by the HTTP-only `tea_session` cookie. Wallet identity is a NEAR Testnet account controlled through the wallet SDK. Connecting a wallet does not log into the application. App login does not authorize a blockchain transaction. There is no implemented cryptographic link between these identities.

Keep REST requests same-origin. The current POST guards reject `Sec-Fetch-Site` values other than `same-origin` or `none`; even a same-site sibling subdomain is not accepted. JSON POST routes require `Content-Type: application/json`. Errors use `{error: string}`, with an optional `code` on Research Agent errors. Do not replace these guards with permissive CORS to make a new frontend origin work.

For a different frontend framework, retain these route handlers behind a same-origin reverse proxy or port the backend with equivalent behavior. A static export alone cannot provide sessions, chat persistence, the history proxy, or Nansen streaming. Configure the proxy to preserve authentication cookies and support unbuffered streaming and request cancellation. A deployed HTTPS frontend must reach an HTTPS backend through that design.

## Authentication

Sources are `src/app/api/auth/`, `src/auth/service.ts`, `src/auth/validation.ts`, and `src/auth/cookie.ts`.

- `POST /api/auth/register`: JSON `{nickname, password}`. Returns HTTP 201 and `{user: {id, nickname}}`, and sets a session cookie. Nicknames allow 3–24 ASCII letters, digits, underscores, and hyphens. They are unique without regard to case. Passwords require at least eight characters and no more than 72 UTF-8 bytes. A duplicate nickname returns 409.
- `POST /api/auth/login`: same input. Returns HTTP 200 and `{user: {id, nickname}}`, sets a session cookie, and revokes the previous cookie's session. Invalid credentials return 401.
- `GET /api/auth/me`: returns `{user: {id, nickname}}`, or 401 with an error when not authenticated. Treat 401 as a signed-out state.
- `POST /api/auth/logout`: no body required. Returns `{ok: true}`, revokes the current session, and clears the cookie.

Validation errors normally return 400. Oversized declared credential requests can return 413; invalid POST origin and content type return 403 and 415. Unexpected failures return a generic 500 error. Registration and login also establish the session, so no second login request is necessary after registration.

The cookie is HTTP-only, SameSite=Lax, path `/`, valid for 30 days, and Secure in production. The client must not read or store its token. Browser same-origin fetch includes the cookie by default. Production authentication requires HTTPS; do not weaken Secure cookies for an HTTP preview.

Use user-entered credentials only in the auth request. Do not include credentials in telemetry, URLs, fixtures captured from real users, or shared agent prompts. The Prisma database remains server-side.

## Persistent chats

Sources are `src/app/api/iroh/chats/`, `src/iroh/history.ts`, `src/iroh/turn-guard.ts`, and `prisma/schema.prisma`.

- `GET /api/iroh/chats`: requires a session. Returns `{chats: [{id, title, createdAt, updatedAt}]}`, newest updated first.
- `POST /api/iroh/chats`: requires a session, same origin, and no body. Returns HTTP 201 and `{chat}`. The new title is `New chat`.
- `GET /api/iroh/chats/<chatId>`: requires an owned chat. Returns `{chat}`, with messages in ascending message ID order. A missing or inaccessible chat returns 404; no session returns 401.

`chat` follows the current Prisma serialization: `id`, `userId`, `title`, nullable `nansenConversationId`, timestamps, and, on the detail route, `messages`. Message fields are numeric `id`, `chatId`, `role`, `content`, `status`, and `createdAt`. Timestamps serialize as ISO strings. Roles used by the service are `user` and `assistant`; stored assistant status is `complete` or `stopped`.

The browser does not directly POST messages to the chat detail route. It sends a Research Agent request with `chatId`; the server verifies ownership, manages conversation context, and persists admitted messages. Chat titles update from the first question. No chat update or delete endpoint is implemented. Do not invent these requests in the UI.

## Research Agent and streaming

Sources are `src/app/api/nansen-agent/route.ts`, `src/nansen/session.ts`, `src/nansen/sse.ts`, and `src/nansen/limits.ts`. Reuse the session module when practical; it already handles cancellation and obsolete responses.

`POST /api/nansen-agent` accepts JSON with these fields:

- `text`: required nonempty text, at most 6,000 trimmed characters.
- `question`: optional nonempty user question, at most 100 trimmed characters. If omitted, `text` also serves as the question and must fit that limit.
- `chatId`: optional owned app chat ID for persistent, authenticated conversation.
- `conversation_id`: optional upstream conversation ID for an unpersisted conversation. It is mutually exclusive with `chatId`.

Unknown body fields are rejected. Chat IDs have a maximum length of 200. Upstream conversation IDs must be nonempty, trimmed, at most 200 characters, with no control characters. The route rejects declared bodies over 16,000 bytes and raw text over 16,000 characters.

For a first guest question, send `{text: question}`. For a saved conversation, create a chat and send `{text: question, chatId}`. For guest continuation, reuse the `conversation_id` from the previous `finish` event. Do not send a client-built conversation ID with an app chat ID. If conversation context makes `text` longer than the question, also pass the original `question` so its separate limit remains enforceable.

The server normally uses its own Nansen credential. Optional user-provided credentials are accepted through the `x-user-nansen-api-key` header, with a maximum length of 256. Existing BYOK behavior is defined in `src/nansen/user-api-key.ts`; its browser storage is sensitive. Do not read another person's stored key, put a house/server key in the bundle, or log that header. BYOK is for the Research Agent, not for thesis or leaderboard reads.

A successful response is `text/event-stream`. Read the response body as a stream, not `response.json()`. Feed UTF-8 text chunks to `SseDecoder`, whose JSON events are:

```ts
// Defined in src/nansen/sse.ts; import this type instead of duplicating it.
type AgentEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; name: string }
  | { type: 'finish'; conversation_id: string | null }
  | { type: 'error'; error: string; status_code?: number }
  | { type: 'done' };
```

The wire format is `data: <JSON>` followed by a blank line. Completion uses `data: [DONE]`. Append `delta.text` to the current answer, show tool activity separately, and retain the conversation ID from `finish`. HTTP 200 does not guarantee a complete answer: an `error` can arrive after streaming starts. Treat EOF without a valid finish as interrupted, preserve partial text, and offer an explicit retry. Stop aborts the request and must not automatically start a replacement paid request.

Pre-stream errors are JSON. Important statuses are 400 invalid request, 401 session required or upstream authentication failure, 402 exhausted upstream credits, 403 origin or upstream plan restriction, 404 chat missing, 409 another active turn in the same chat, 413 length limit, 429 rate/daily limit, 503 unconfigured or unavailable service, and other mapped upstream/transport failures. Display the error and respect `Retry-After` when present. For the house-key daily cap, `code` is `nansen_agent_daily_limit`, with `x-ratelimit-limit`, `x-ratelimit-remaining`, and `x-ratelimit-reset` response headers.

The default house-key cap is one admitted request per client IP per UTC day. It is configurable through `NANSEN_AGENT_DAILY_LIMIT`. The existing cap and per-chat turn guard are process-local, not a distributed production quota service. Visitor BYOK bypasses the house daily cap. A canceled request may already have consumed upstream credits; never promise that Stop refunds it.

## Nansen availability and saved market readings

`GET /api/nansen-status` returns `{nansen: "configured" | "unavailable"}`. It checks presence of server configuration only. It does not prove upstream connectivity, credit availability, or authorization for every feature.

Market read routes load saved SQLite snapshots. They do not call the external Nansen API on each page visit. `src/instrumentation.ts` starts the Node background refresh loop; preserve that worker behavior if migrating hosting. The build phase does not start the loop. Polling the read routes cannot substitute for a missing refresh worker.

Successful saved readings include `source: "nansen"`, `fetchedAt`, `expiresAt`, `stale`, and optional `refreshError`. Show their timestamp and stale state. A stale saved reading can still return HTTP 200. A missing snapshot returns HTTP 503 with `{error}`, either unconfigured or warming up. Do not display missing metrics as zero. The background scheduling uses hourly fast readings, four-hour slow readings, and a freshness grace period; the response metadata is authoritative for the UI.

### Thesis deck

- `GET /api/theses`: returns `DeckSnapshot`, including `theses` summaries and snapshot metadata.
- `GET /api/theses/<thesisId>/<symbol>`: returns a saved `TickerDetail` plus snapshot metadata. Unknown thesis/symbol returns 404. Encode dynamic path segments.

Exact shared types are in `src/thesis/types.ts`, and valid identities are in `src/thesis/deck.ts`. Thesis IDs are `robinhood`, `bullrun`, and `ai`; valid symbols differ by thesis. Summaries contain `id`, `conviction`, and ticker signals. Details contain `thesisId`, `symbol`, `movements`, `holders`, `supply`, and `perps`. Each detail section is independently `ok` with data, `empty`, `unavailable` with a reason, or `not-applicable`. Render these distinctions without hiding every successful section when one source fails. Nullable metrics are not zero. Use the shared types rather than defining a competing API schema.

### Wallet leaderboards

`GET /api/smart-wallet-leaderboard?board=<board>&metric=<metric>` returns `SmartWalletLeaderboardSnapshot`, defined in `src/leaderboard/model.ts`, with saved-reading metadata.

Boards are `perps`, `smart-money`, `whales`, and `meme`. Non-meme metrics are `wins`, `losses`, `roi`, `account`, `holdings`, and `positions`; meme supports `wins` and `roi`. Invalid board values default to `perps`. Invalid or unsupported metrics default to `wins`. Holdings reuses the account-value sort and is not proof of separate token holdings data. Labels and sorting behavior are defined in `src/leaderboard/boards.ts`. These rankings are external research data, separate from the connected NEAR wallet and the case activity ledger.

## Local and hosted runtime

The lockfile and `package.json` define the supported stack: Node >=22.12, Next.js, React, Prisma, and the wallet connector. Use a fresh checkout with no inherited private environment files. Set a disposable `DATABASE_URL`, run `npm ci`, `npm run db:migrate`, and `npm run dev`. For production run migrations, `npm run build`, and `npm run start` with approved server configuration and HTTPS.

Only variable names are documented here: `DATABASE_URL` is required by the database; `NANSEN_API_KEY` enables external Nansen calls; `NANSEN_AGENT_DAILY_LIMIT` controls the house daily allowance. Additional queue/concurrency knobs are in `src/nansen/request-manager.ts`. Never copy the current operator's values or private files. Starting a configured backend can start background Nansen work and consume credits; develop with controlled responses or your own authorized service configuration.

A new visual framework does not require replacing the smart contracts or rewriting these API handlers. Hosting that backend separately, distributing SQLite, or running multiple workers requires backend infrastructure decisions. Those capabilities are not established by the current local integration tests.
