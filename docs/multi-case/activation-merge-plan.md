# Finish case activation and merge locally

Authorized scope: finish the unchanged 90-step Testnet batch, make all five cases usable through the existing UI, run functional checks, and merge to local main. Formal security audit is explicitly deferred by the user. Token renaming and new minigames are deferred. No push or new paid player transaction is included.

- [x] Reconcile the saved Moon PURGE hash without resubmission.
- [x] Complete and verify the remaining exact approved deployment steps.
- [x] Capture finalized public balances, inventory, metadata, configuration, and preserved Dragon history. These are deployment acceptance checks, not a formal security audit.
- [x] Mark only fully verified active cases and tokens live in frontend configuration.
- [x] Run unit, type, build, and browser checks in an isolated copy without .env files. Test opening and recovery with controlled wallets and local Sandbox receipts.
- [ ] Update handoff and execution documents, commit task changes, and merge locally to main while preserving unrelated work and existing branches.

Do not claim a real wallet-signed public opening from fixture tests. Player wallet setup and real paid opening checks require a separately bounded transaction scope.
