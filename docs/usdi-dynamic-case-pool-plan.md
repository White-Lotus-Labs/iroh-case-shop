# USDI and Dragon Tea Case implementation plan

> Execute and verify the tasks in order using the executing-plans workflow.
> The user's detailed task is the specification. Routine implementation is
> authorized; actual deployment and wallet signatures require separate approval.

Goal: a genuine Testnet NEP-141 faucet and safely funded dynamic case pool.
Architecture: separate USDI and case contracts, a shared pure Rust economy crate,
and a Next.js `/cases` client using the existing HOT Connect singleton.
Stack: maintained near-sdk/near-contract-standards 5.29.1, Rust, Next.js,
TypeScript, pnpm, Vitest and Playwright. Rust toolchain 1.99.1 is installed in
an isolated `/tmp/iroh-contract-toolchain` directory, never credential folders.

## Global constraints

- No existing file, directory, test, asset, branch, history or lockfile deletion.
- Never read, copy, print or modify secrets, environment files or credentials.
- New branch `feature/usdi-dynamic-case-pool` starts at wallet HEAD
  `8a032a0ff164be33af9b4e4cfbaa2789e3cefc1f`; preserve both parent branches.
- USDI has 6 decimals, no USD backing and no real monetary value.
- Price 1,000,000 units; contribution 950,000; fee 50,000; rewards
  100,000 / 1,000,000 / 5,000,000; target 1,000,000,000.
- No economics changes without approval. No mainnet deployment or automatic push.
- Public contract IDs stay null until real deployment. No invented addresses.

## Accounting and interfaces

USDI exposes NEP-141, NEP-145, NEP-148, `claim_starter`, `has_claimed`,
`claim_storage_cost`, and a finite owner bootstrap mint at initialization.
Claim eligibility is permanent on-chain even after token storage unregistration.
Claims atomically register, mint 1,000,000,000 units and mark claimed, with
explicit native NEAR storage cost. No unrestricted public mint method.

Game APIs: `get_case`, `get_pool`, `get_quote(account_id)`,
`get_account_opening(account_id)`, `get_opening(opening_id)`, bounded
`get_history(account_id, limit)`, `storage_deposit`, `storage_balance_of`,
`ft_on_transfer`, `advance_opening`, `retry_payout`, private resolution/callbacks,
owner pause and vested treasury withdrawal.

Only authenticated USDI transfer calls accept payment. Funding is a separate
owner/treasury transfer message. An accepted opening consumes exactly 1 USDI,
returns immediate `U128(0)` to the standard FT resolver, reserves the maximum
reward and schedules a detached private draw receipt. Returning a settlement
promise from the receiver is forbidden: later payout failure must not refund a
consumed payment as well. Initial receiver failure rolls back state and promises.

`P >= L`, `A=P-L`. Acceptance credits P by 950,000, escrows fee 50,000 and
reserves 5,000,000. The deferred draw freezes its reward permanently and reduces
reservation to the actual reward. Success callback subtracts reward from P and L
and vests the fee. Failure retains a funded retryable reward. Never retry a
transfer still in flight or redraw a known result. Attempts identify callbacks.

During outgoing asynchronous transfers the token account can temporarily be
below the book asset balance by up to in-flight transfers. Publish that amount
and reconciliation bounds; at quiescence the token balance equals pool plus
all fee balances. Platform funds never cover rewards. Callback state changes
are bounded and pre-funded; unknown in-flight transfers cannot be retried by timeout.

Quotes commit revision, probabilities, account nonce and block expiry. Use exact
revision matching (zero slippage tolerance); stale/expired quotes refund fully.
Available liquidity is sampled before the new payment; that payment may contribute
to affordability. Healthy >=800 USDI, Caution >=500, Critical below500. Concurrency
limits 64/16/4 respectively and minimum available liquidity 5 USDI; one unresolved
opening per account. All advertised tiers remain payable; never silently trim odds.

Game storage is prepaid in native NEAR, separately from USDI price. Each opening
locks a conservative 2,048-byte storage budget, checked against actual growth;
views expose costs and remaining credit. Paid history uses bounded pagination.

Protocol block randomness is isolated, bound to contract/opening/block and sampled
in a later private receipt. It is a Testnet demonstration, not production-grade
VRF or provably fair gambling. Validator ordering/withholding and retry-timing
risks are documented. No caller-supplied entropy influences the draw.

## Ordered checklist

### Phase 1: Repository inspection and branch verification
- [x] Inspect router, root wallet provider, singleton, tests, pnpm and Git.
- [x] Create branch from wallet HEAD and prove ancestry.
- Files: this plan; no original source changes.
- Verification: Git status/log/merge-base, source and official SDK documentation.
- Acceptance: clean branch directly descended from latest wallet commit.
- Status: complete.

### Phase 2: Contract architecture and financial specification
- [x] Define token/game boundaries, receipt lifecycle, quotes and reservations above.
- [x] Check official NEAR standards, maintained SDK APIs and randomness limitations.
- [ ] Write executable integer mathematics with boundary proofs and shared vectors.
- Files: `contracts/Cargo.toml`, `contracts/economics/src/lib.rs`, financial notes.
- Tests: probability normalization/rounding, reference examples, u128 boundaries.
- Acceptance: exact formulas, immutable accepted odds, sound refund and callback design.
- Status: in progress.

### Phase 3: USDI NEP-141 token
- [ ] Implement standard core/resolver/storage/metadata using maintained standards.
- Files: `contracts/usdi/*`, workspace lockfile.
- Tests: metadata, transfers, storage, overflow, authorization, standard resolver.
- Acceptance: 6 decimals, safe finite bootstrap allocation, no public arbitrary mint.
- Status: pending.

### Phase 4: One-time 1000 USDI faucet
- [ ] Atomic permanent claimed map, exact mint, storage funding/refund and events.
- Files: token contract and tests.
- Tests: first/duplicate/different-account claims, unregister persistence, failed claim.
- Acceptance: on-chain one claim/account, registration works, storage costs explicit.
- Status: pending.

### Phase 5: Case pool and payment accounting
- [ ] Authenticate token, exact amount, case, nonce, quote, funded storage and fees.
- [ ] Authorized real-token bootstrap funding, initially zero pool.
- Files: `contracts/case-pool/src/*`.
- Tests: invalid token/amount/msg, full refunds, exact allocation and fee isolation.
- Acceptance: no payment-free or replayed opening, no fake initial reserve.
- Status: pending.

### Phase 6: Dynamic probabilities and equilibrium
- [ ] Integrate shared integer formula, denominator1,000,000 and bounded rounding.
- Files: economics crate, game quote views, shared vectors.
- Tests: all slope/clamp transitions and equilibrium drift; deterministic integer sweep.
- Acceptance: exact normalization; EV deviations quantified; unchanged economics.
- Status: pending.

### Phase 7: Safety and reservation
- [ ] Implement health levels, max reward reservations, concurrency and pause gates.
- Files: game state and tests.
- Tests: thresholds, concurrent reservations, funded failed claims, minimum liquidity.
- Acceptance: P>=L in every state, fees isolated, reject unsafe purchases with refunds.
- Status: pending.

### Phase 8: Random outcomes and settlement
- [ ] Deferred protocol randomness; private, idempotent attempt-bound callbacks.
- [ ] Recover confirmed failures without redrawing or duplicate payment.
- Files: game randomness, settlement and tests.
- Tests: successful/failed transfers, replay, private callbacks, retry and stale attempts.
- Acceptance: outcomes and accepted odds immutable; reservations held until resolution.
- Status: pending.

### Phase 9: Next.js integration and UI
- [ ] Public deployment configuration, validated finalized RPC, safe SDK signing.
- [ ] `/cases` balance, claim, Dragon Tea card, odds/pool dashboard and lifecycle UI.
- [ ] Discover pending state from chain on refresh/account change; honest undeployed state.
- Files: `src/case/*`, `src/app/cases/*`, wallet adapter/provider, public config, header link.
- Tests: RPC/action tests, account races, types/formatting and real browser UI.
- Acceptance: no fake balances/results, wallet preserved, all transaction actions explicit.
- Status: pending.

### Phase 10: Contract unit tests
- [ ] Expand adversarial token, probability, accounting and callback scenarios.
- Files: contract tests; build/test scripts.
- Tests: `cargo test --workspace`, wasm build and contract receipt integration if available.
- Acceptance: required invariants and negative scenarios pass; unavailable checks explicit.
- Status: pending.

### Phase 11: Economic simulations
- [ ] Shared Rust formulas and deterministic simulation-only PRNG, multiple seeds.
- [ ] Run all requested volumes, reserve levels, reward streaks, concurrency and failures.
- Files: Rust simulation binary, reproducible JSON/CSV, `docs/usdi-pool-simulation-report.md`.
- Tests: reward/pool conservation, repeatability, max1m openings where feasible.
- Acceptance: full metrics and honest drawdowns/pauses, no altered economics.
- Status: pending.

### Phase 12: Integration and browser tests
- [ ] Unit, types, formatting, build, wallet regression, cases browser scenarios.
- Files: `tests/usdi-*.test.ts`, `tests/browser/cases.spec.ts`.
- Acceptance: available tests run; mocked RPC checks distinguished from real contracts.
- Status: pending.

### Phase 13: Testnet deployment and end-to-end verification
- [ ] Reproducible wasm builds, wallet-authorized deploy/initialize/register/fund guide.
- [ ] Request actual deployment/signing authorization only after artifacts are reviewable.
- Files: scripts, public config placeholders, deployment documentation.
- Acceptance: genuine Testnet receipts/addresses, or exact authorization blocker recorded.
- Status: pending; real deployment awaits separate explicit approval and public account IDs.

### Phase 14: Final review and documentation
- [ ] Independent security/accounting review, fix findings and rerun affected gates.
- [ ] Update checklist, final technical report, manual guide and local Git commits.
- Acceptance: no secrets accessed, no existing files deleted, no push/merge, accurate status.
- Status: pending.

After each milestone run focused tests, applicable types/format checks, inspect
failures, update this checklist and commit only verified work. Token+faucet and
payment+economics+safety+settlement are tightly coupled deliverables; verify each
phase's acceptance inside those ordered milestones without temporary unsafe stubs.
