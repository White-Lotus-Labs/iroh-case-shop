# Dragon Tea in-place migration implementation plan

Keep the deployed case account and its USDI economics. Upgrade the contract in one deploy-and-call transaction after the owner pauses admissions. Preserve V1 storage records, indexes, balances, and pending obligations.

1. Pin a finalized Testnet block and capture the public case and USDI WASM and storage. Reconcile pool counters against the token balance. Check the three bonus token registrations and holder balances.
2. Write a Sandbox regression that loads the exact V1 code and copied state, proves the baseline, and tries an atomic deploy and migration. Exercise legacy history, pause refunds and a genuine V1 failed payout across the boundary.
3. Add an explicit private Borsh migration in the case contract. Carry all V1 counters and indexes forward, read V1 openings from their original prefix, and write new or updated opening records under a separate prefix. Freeze a cutoff at V1's next ID so existing openings can never reserve or receive a bonus. Require paused admissions, an expected revision and no in-flight payout or treasury transfer.
4. Verify migrated reads and legacy recovery, then fund the three bonus tokens and exercise paid and failed bonus legs in Sandbox. Run existing contract and UI verification.
5. Build the production WASM, record the checksum, and document the transaction sequence, gates and limits of rollback. Commit the verified work on the current feature branch. Request approval for the first live transaction after the local proof.
