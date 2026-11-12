# Frontend integration handoff

This is the starting reference for agents replacing the entire Iroh frontend. Written on 12 November 2026. The local frontend branch is `codex/frontend-handoff`. All 90 approved Testnet deployment steps are complete. Formal security audit is deferred by the owner. No additional deployment is required to start frontend development.

Read [the agent brief](AGENT-BRIEF.md) for implementation boundaries and [the application API reference](application-api.md) for auth, chat streaming, market data, server configuration, and hosting. The contract and wallet integration is described below. [Player check](player-check.md) lists the manual wallet flow for the activated release.

The interface can change completely. Keep the contract calls, accounting, transaction validation, and recovery behavior intact. The chain remains the source of truth for prices, odds, draws, payouts, and inventories.

## Current integration boundary

The implementation contains one configurable case binary, a fixed-supply mock token binary, and the existing USDI contract. Five independent case accounts use the case API. They do not share a pool or opening IDs.

`deployment-state.json` records the finalized activation checkpoint, not a live availability endpoint. The canonical operational record is `docs/multi-case/execution.json`. All 90 approved steps and their saved receipts are verified, with no unreconciled transaction.

All five cases are deployed, funded and active, and all twelve bonus mocks are deployed. Dragon retains its original four completed openings and accounting. New case histories are empty until players open them. Registry deployment flags now match finalized activation.

Frontend agents can integrate all five real public contract APIs or use controlled fixtures. Normal players authorize their own storage, claim, opening and recovery transactions in their wallet. Agents submitting automated public test transactions on a person's behalf need a bounded authorization; the deployment batch did not include new paid player tests. Formal security audit and real-wallet public bonus payout verification are still pending.

## Files that define the integration

Paths below are relative to the repository root so this document works in another checkout.

- `config/cases.testnet.json`: all five IDs, addresses, exact USDI prices, base rewards, bonus candidates, decimals, and deployment flags.
- `config/tokens.testnet.json`: token identity, fixed supply, decimals, mock labeling, and verification status. All included token flags reflect the verified deployment checkpoint.
- `config/contracts.testnet.json`: payment token, legacy Dragon address, and the RPC used by the current frontend.
- `src/case/catalog.ts`: `caseCatalog`, `caseById`, and `deploymentForCase`. The last function rejects planned cases.
- `src/case/client.ts`: transport, validated response types, final receipt verification, and transaction builders.
- `src/case/useCaseReads.ts`: separate read states, polling, cancellation, and bounded retries.
- `src/case/useCaseController.ts`: UI-independent actions and transaction recovery, exposed through a React hook.
- `src/case/pending.ts`: persistent pending actions scoped to network, payment token, case contract, and wallet account.
- `src/case/history.ts` and `src/case/indexer.ts`: verified receipts, chain history, and indexer provenance.
- `src/ui/wallet/WalletProvider.tsx`, `nearConnector.ts`, and `walletController.ts`: wallet lifecycle and Testnet signing.
- `contracts/case-pool/src/lib.rs`, `configured.rs`, and `bonus.rs`: authoritative contract behavior. `contracts/usdi/src/lib.rs` defines the faucet and payment token.

The recommended React integration keeps `WalletProvider` and calls `useCaseController(caseById(selectedCaseId))`. The hook exposes reads, pool, odds, active opening, history, availability, errors, and actions including `claim`, `registerToken`, `prepayStorage`, `open`, `recover`, `registerBonus`, and `attachHash`. Render its loading and error states explicitly. Existing `Cases.tsx`, `TeaCaseCatalog.tsx`, `RewardReel.tsx`, and Shelf components are examples that may be replaced.

A different framework can reuse or port `CaseClient`, parsers, call builders, and pending/history rules. The React hooks are adapters, not an HTTP backend requirement. No owner key, Keychain integration, or deployment script belongs in a browser bundle.

## Networks and reads

Only NEAR Testnet is supported. Existing RPC endpoints are `https://rpc.testnet.fastnear.com` and `https://rpc.testnet.near.org`. Both have returned HTTP 429 during this deployment. RPC is an external dependency, not an app REST endpoint. Keep endpoint choice configurable, bound concurrency, and show unavailable data rather than inventing zero balances or fallback odds.

`CaseClient.view` sends JSON-RPC `query` with `request_type: "call_function"`, `finality: "final"`, `account_id`, `method_name`, and `args_base64`. Arguments are UTF-8 JSON encoded as base64. Decode `result.result` bytes as UTF-8 JSON. Handle both HTTP errors and JSON-RPC errors.

Case views are:

- `get_case({})`: identity, price, rewards, bonus metadata, and public configuration.
- `get_pool({})`: funds, available amount, reservations, liabilities, fees, paused state, revision, storage costs, and admission status.
- `get_quote({account_id})`: account-specific admission, nonce, revision, expiry, current odds, and expected reward numerator.
- `get_reward_inventory({})`: bonus funds, availability, reservations, and in-flight amounts.
- `get_opening({opening_id})`: an opening or null.
- `get_account_opening({account_id})`: the account's active opening or null.
- `get_history({account_id, limit})`: recent openings. The client limits this read to 20.
- `get_history_page({account_id, before_opening_id, limit})`: `{openings, next_cursor}`. The cursor is inclusive and belongs to the same account and case. Contract limit is 1–50.
- `storage_balance_of({account_id})`: case storage credit as a raw decimal string.

USDI views are `ft_balance_of`, `ft_metadata`, `storage_balance_of`, `storage_balance_bounds`, `has_claimed`, and `claim_storage_cost`. Account views take `{account_id}`. Bonus tokens support the standard FT metadata, supply, balance, and storage views; they do not provide the USDI starter faucet.

All monetary amounts, opening IDs, revisions, heights, and nonces represented as strings must remain strings or `BigInt`. Never round-trip them through JavaScript `Number`. USDI has six decimals. Bonus tokens use 6, 18, or 24 decimals as configured. Gas and attached NEAR deposits use raw integer strings; one NEAR is 10^24 yoctoNEAR. Probability counts use a denominator of 1,000,000.

## Wallet and opening sequence

The existing connector uses `@hot-labs/near-connect`. Recheck the selected account and Testnet capability immediately before signing. App login is separate from wallet authorization. Use the player's wallet, never the deployment owner signer.

1. Select a case definition and build its deployment with `deploymentForCase`. If null, show the configured preview and disable live writes.
2. Load case identity, pool, user USDI balance, token registration, storage credit, active opening, and quote. Do not require a wallet to display public case details.
3. Offer the USDI starter claim only when `has_claimed` is false. Use `claimCall(config, claimCost)` with the cost obtained from `claim_storage_cost`; the helper uses 50 Tgas.
4. If needed, register the user with USDI using `tokenRegistrationCall`, the live storage minimum, and 30 Tgas. This is separate from registering the case account during deployment.
5. Offer case storage prepayment using `storageCall(config, pool)`, which attaches `storage_per_opening + storage_account_cost` with 30 Tgas. Case storage credit is distinct from NEP-145 token storage.
6. Obtain a fresh account-specific quote and honor `can_open` and `reason`. Recheck after any successful mutation. A public probability quote does not authorize another account to open.
7. Build the opening with `openCall(config, quote, definition)`. Persist the intended action before wallet handoff. It calls USDI, not the case account directly.
8. Verify final transaction receipts and the resulting opening before showing a settled reward. Refresh balances, quote, active opening, and history.

For example, the opening builder produces this shape for Dragon, with live quote values substituted:

```json
{
  "receiverId": "usdi-needmore-1-near.testnet",
  "methodName": "ft_transfer_call",
  "args": {
    "receiver_id": "cases-needmore-1-near.testnet",
    "amount": "1000000",
    "msg": "{\"action\":\"open\",\"case_id\":\"dragon-tea\",\"nonce\":\"LIVE_NONCE\",\"quote\":{\"revision\":\"LIVE_REVISION\",\"expires_at\":\"LIVE_HEIGHT\"}}"
  },
  "gas": "250000000000000",
  "deposit": "1"
}
```

Do not hardcode these quote placeholders or reuse a previous quote after account or case changes. Exact opening prices and all configured payouts are in `deployment-state.json` and the case registry. The 95% pool contribution and 5% platform fee are applied by the contract; the frontend does not send separate fee transfers.

## Settlement, animation, and recovery

Opening states are `RandomnessPending`, `Paying`, `Claimable`, and `Completed`.

- `RandomnessPending`: no selected result yet. The recovery action is `advance_opening({opening_id})`.
- `Paying`: transfers are in flight. Poll; do not retry or show a completed payout.
- `Claimable`: a payout leg failed. Inspect USDI and bonus paid flags and missing receiver registration. After fixing the missing registration, use `retry_payout({opening_id})`.
- `Completed`: every selected payout leg settled. Display the recorded result and receipt evidence.

`recoverCall` attaches 1 yoctoNEAR and 150 Tgas. The contract retries outstanding legs with the same draw. A USDI leg can succeed while a bonus leg fails. Do not pay again, redraw, or implement a new opening as a recovery action.

Drive the roulette from the validated opening's recorded `draw`, tier, USDI reward, and optional bonus. Current pool odds can change after acceptance; use the accepted opening's stored probabilities to explain that result. Legacy Dragon openings lack bonus fields and remain valid.

A wallet response or transaction hash is not proof of success. `CaseClient.transaction` checks FINAL execution, signer, intended receiver/action, and receipt outcomes. Preserve `pending.ts` and its storage key scope. On reload, disconnect, RPC timeout, wallet cancellation, or missing hash, reconcile existing state before offering another payable action. Selecting another case must never redirect or resubmit a pending transaction.

## History and application endpoints

The case ledger aggregates histories across independent case accounts. Use `(case contract, opening_id)` as opening identity. The same numeric ID can exist in several cases.

`GET /api/case-history?account=<account.testnet>&cursor=<opaque cursor>` is the app's read-only NearBlocks proxy. It returns `accountId`, `transactions`, `nextCursor`, and `source`. Invalid parameters return 400, rate limiting 429, and upstream failure 502. Treat indexer entries as references until verified against finalized RPC receipts. Keep verified local and contract history visible during indexer failure. Do not fabricate transaction hashes for historical openings without known receipts.

The proxy currently uses `https://api-testnet.nearblocks.io/v3/accounts/{account}/txns`. Preserve or port the server route when moving the frontend to another framework or origin. Cursor and account validation, bounded responses, and the upstream allowlist are part of the route's behavior.

Other application routes remain in `src/app/api`: auth `POST /auth/register` and `/auth/login` accept nickname/password; `GET /auth/me` reads the session; `POST /auth/logout` clears it. These paths have the `/api` prefix. Auth uses server cookies and a Prisma database, independently of the wallet. Chat routes are `/api/iroh/chats` and `/api/iroh/chats/[chatId]`. Nansen, theses, and leaderboard routes have their own existing contracts in that directory. Preserve their handlers and inspect their schemas before redesigning those screens. Do not expose server credentials to frontend code. A new hosted frontend origin needs an explicit cookie/CORS/proxy design; same-origin local behavior does not establish cross-origin login compatibility.

## Develop and verify independently

`tests/case-fixture-data.ts` provides pure five-case data. `tests/browser/case-fixture.ts` provides controlled wallet/RPC behavior, independent `forCase(id)` states, payout failures, and recovery. These are test helpers, not production data sources.

All 85 browser tests, including the five-live-case opening journeys in `tests/browser/host-catalog.spec.ts`, passed with controlled RPC/wallet behavior. The candidate registry was checked byte-for-byte against the final activated configuration. Keep mock behavior test-only; it is not evidence of a new wallet-signed public payout.

Useful regression sources are `tests/multi-case.test.ts`, the history and pending tests, and browser specs `cases`, `host-catalog`, `chain-loading`, `reward-history`, `wallet`, and `wallet-history`. Existing contracts passed 79 Rust tests and three genuine local Sandbox suites; simulations covered 25 million attempts. The latest local frontend check passed 368 Vitest tests and TypeScript. Fixture wallet tests do not establish real HOT wallet signing or new public payouts.

Use Node >=22.12 and the lockfile. In a checkout without private `.env` files, install with `npm ci`, set a disposable `DATABASE_URL` such as `file:/tmp/iroh-frontend-dev.db`, run `npm run db:migrate`, and start `npm run dev`. Commands for checks are `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`. Provide your own approved server configuration for optional external services. Do not copy the owner's `.env`, SQLite database, wallet material, or Keychain entries to colleagues.

## Parallel ownership and final acceptance

Frontend team owns presentation, layout, animation, accessibility, and adapters needed for its chosen stack. Preserve integration behavior when replacing components. Backend team owns `contracts/`, deployment artifacts and scripts, canonical execution journals, on-chain administration, funding, activation flags, and the final audit. Do not run deployment scripts from the frontend branch.

Backend updates can arrive independently of the UI rewrite. Import reviewed public registry/status updates when each case is verified active. Any API-breaking contract change requires an updated integration reference and fixtures before adoption. New visuals do not require a new contract deployment.

Before accepting the replacement frontend, verify five independent case selections, correct decimals and prices, live quote refresh, no signing while unavailable, user storage onboarding, recorded-result animation, partial payout recovery, reload with a pending action, wallet/account switching, and paginated cross-case history. Run the new UI against controlled fixtures first. Run separately authorized public Testnet wallet and payout checks after backend activation. All-five-case deployment acceptance is complete. Formal security audit and a new real-wallet public payout check are separate pending work.

The final production UI was also checked against real public Testnet reads for all five cases, with no connected wallet or submitted transaction. Evidence is in `docs/multi-case/evidence/live-ui-readonly.json`. This validates public display integration; it does not replace a wallet-signed paid payout check or formal security audit.
