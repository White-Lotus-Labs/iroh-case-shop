# Multi-case implementation plan

Goal: complete local five-case implementation and selected mock infrastructure, preserving Dragon state and preparing exact Testnet deployment approvals.

Architecture and constraints: see design.md and the user's full roadmap. Local development continues while Testnet writes await authorization.

- [x] Inspect existing code and runbook; compare independent accounts with a registry contract; choose one configurable binary per account.
- [x] Create dedicated codex/multi-case-testnet-expansion branch preserving pre-existing work.
- [x] Capture fresh finalized public Dragon state, token balances and registrations.
- [x] Verify candidate identities with primary sources and metadata; create fixed-supply mocks and secure dedicated keys.
- [x] Generalize integer economics and immutable case configuration while retaining exact legacy layouts and defaults.
- [x] Test normalized probabilities, solvency, independent reservations, refunds, callback idempotence, immutable draws and migration.
- [x] Simulate at least one million openings per case across liquidity conditions and repeated maximum payouts.
- [x] Implement five selectable cases in the existing parchment interface with contract-derived live odds and honest undeployed previews.
- [x] Scope reads, pending signatures and history by account and case contract; aggregate Shelf histories without fabricated receipts.
- [x] Run genuine Sandbox openings and payout verification for all five cases, including failure recovery and legacy state migration.
- [x] Run Vitest, TypeScript, production build and Playwright; fix failures.
- [x] Prepare a bounded deployment manifest with checksums, account keys, exact arguments, token amounts, deposits/gas, sequencing and maximum expenditure.
- [x] Independently review changes and evidence, correct security findings, commit only task-owned changes and deliver consolidated report.

Review focus: cross-case nonce collisions; stale reads/signatures after selection; repeat callbacks and in-flight transfers; insufficient token inventory; public state or code drift after preparation.

All authorized local steps are complete. The exact bounded Testnet batch is funded and approved. Two independent Dragon storage registrations are verified; the remaining owner-dependent operations are blocked by the unavailable existing owner Keychain signer. Current status is recorded in execution.json. Public deployment and real HOT opening verification are not marked complete.
