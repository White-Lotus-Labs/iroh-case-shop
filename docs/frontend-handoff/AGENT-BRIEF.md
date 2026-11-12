# Brief for frontend agents

Replace the Iroh interface with the agreed new design while preserving the existing backend and NEAR Testnet behavior. The visual layout, 3D room, component tree, navigation, styles, and animation may change. New contract economics, server API semantics, or owner operations are outside this frontend task.

Read these documents first:

1. [Integration reference](README.md).
2. [Application API reference](application-api.md).
3. [Recorded deployment state](deployment-state.json).

The branch `codex/frontend-handoff` is a local starting branch, not a published remote fork. The backend branch continues as `codex/multi-case-testnet-expansion`. Some historical deployment reports still describe an earlier state; prefer the handoff snapshot and per-step canonical execution records. All 90 deployment steps are complete and all five cases are active. Do not repeat deployment transactions or administer on-chain accounts from the frontend branch. Formal security audit is deferred.

Keep the core integrations independently testable:

- App authentication and chat ownership through server cookies.
- NEAR wallet connect, account changes, and disconnect independently of app login.
- Five case definitions, live reads, storage onboarding, exact payment calls, recorded draws, partial payouts, and pending-action recovery.
- Case activity and indexed transactions with explicit verification provenance.
- Research Agent streaming, Stop, limits, errors, and saved conversations.
- Thesis and leaderboard readings with timestamps, nulls, stale states, and partial unavailability.

Reuse `CaseClient`, its validators and call builders, the pending/history modules, the wallet connector, `useCaseReads`, and `useCaseController` when staying in React. Preserve equivalent behavior when porting frameworks. Reuse `src/nansen/session.ts` and `sse.ts` for chat lifecycle. Keep the `/api` server handlers or port their behavior behind the new frontend's same origin.

Build against controlled fixtures first. Never relabel an actually planned or paused public case as active to make a test pass. The existing five-case data helpers and browser fixtures can be adapted to a separate test-only registry. Mock success must remain distinguishable from finalized Testnet activity.

Do not read or distribute operator `.env` files, local databases, Keychain entries, private keys, or wallet backups. Frontend developers do not need owner credentials. All public on-chain writes in testing need the owner's explicit bounded authorization; fixture tests and read-only checks do not authorize real paid transactions.

Before handoff back to the backend team, run unit tests, type checking, a production build, and browser tests for the replacement interface. Preserve behavior assertions even if old visual selectors must change. Include narrow/mobile layouts and keyboard access. Prove case/account switching cannot redirect a pending transaction, a reload cannot pay twice, and failed payout recovery retains the recorded draw.

Report changed integration code, executed checks, failures, mock-only coverage, and anything awaiting backend deployment. Coordinate API changes with the backend team before adopting them. Verified activation registry updates are now included. Coordinate any later audited release and separately authorized live wallet/payout verification with the backend team.
