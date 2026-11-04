# USDI and Dragon Tea Case technical report

Date: 2026-11-04. The local implementation, tests, simulations and deployment
artifacts are complete. Public Testnet account creation, deployment and wallet
end-to-end transactions remain blocked on explicit user authorization. No public
transaction was submitted, and no public deployment success is claimed.

## Git and scope

Original wallet branch: `feature/near-wallet-integration`, preserved at
`8a032a0ff164be33af9b4e4cfbaa2789e3cefc1f`.
New branch: `feature/usdi-dynamic-case-pool`, created directly from that HEAD.
`git merge-base --is-ancestor feature/near-wallet-integration HEAD` passes.
`main` remains at `3fee2c237ead407bbef6769ff2b9959346d7c188`.

Verified milestones:

- `d1d996e docs: specify USDI and dynamic case accounting plan`
- `5685df9 feat(usdi): add standard token and permanent starter faucet`
- `4ef8689 feat(case): enforce dynamic odds and funded payout settlement`
- `5e5849f test(contracts): verify real receipts and simulate pool economics`
- `3ae0be8 feat(cases): add USDI onboarding and verified case transactions`
- `f1d15f5 fix(cases): recover payouts after token unregistration`
- `eaf9d03 docs(deploy): prepare unsigned Testnet deployment handoff`

This final report/checklist is committed after those milestones. The final
working tree is clean; no push, merge, reset, rebase or branch deletion occurred.
The starting tree was clean. Existing repository files, features, tests, assets
and lockfiles were preserved; no existing file was deleted. No user secret,
environment file, private wallet key or credential file was inspected or copied.
The local Sandbox generates its own ephemeral test keys; it never uses a saved
user wallet or a public network signer.

## Contract structure and methods

`contracts/usdi` uses exact maintained near-sdk/near-contract-standards 5.29.1.
It delegates NEP-141 core/resolution, NEP-145 storage and NEP-148 metadata to the
standards implementation. Metadata is USD Iroh / USDI / 6 decimals, with explicit
no-backing/no-real-value test-currency metadata. Initialization mints a finite
1,000 USDI bootstrap to the owner for actual pool funding.

Public token methods are `new`, `ft_balance_of`, `ft_total_supply`, `ft_transfer`,
`ft_transfer_call`, `ft_metadata`, standard `storage_*`, `claim_starter`,
`has_claimed` and `claim_storage_cost`. `ft_resolve_transfer` is private.
There is no callable arbitrary mint method; the wasm exports were checked.

`claim_starter` atomically registers if needed, mints 1,000 USDI to its predecessor
and records a permanent claim marker. Duplicate claims and insufficient native
storage payment fail before issuance. Unregistering cannot remove the marker.
At the current byte cost, an unregistered claim requires 0.00381 NEAR and an
already registered claim 0.00256 NEAR, plus gas. The live cost view is authoritative.

`contracts/case-pool` accepts only the configured USDI contract's authenticated
receiver calls. Its API includes `new`, `get_case`, `get_pool`, `get_quote`,
`get_account_opening`, `get_opening`, bounded `get_history`, game storage credit
methods, `ft_on_transfer`, `advance_opening`, `retry_payout`, owner pause and
vested treasury withdrawal. Draw, payout and treasury callbacks are private.

`contracts/economics` is the pure integer module shared with the simulator.
`contracts/integration` is a genuine local NEAR Sandbox runner with an independent
Cargo lockfile because current workspaces 0.24 and SDK 5.29.1 require incompatible
native crypto dependency versions. No maintained library was downgraded.

Both wasm binaries are built under `contracts/target/wasm32-unknown-unknown/release`.
Their current sizes and SHA256 hashes are in the
[unsigned deployment plan](usdi-testnet-deployment-plan.json). The planner checks
the actual compiled files, rather than inventing deployment artifacts.

## Economics and asynchronous accounting

One USDI is 1,000,000 units. Each accepted purchase consumes exactly 1,000,000:
950,000 enters P and 50,000 enters a separate pending-fee balance. Rewards are
100,000 / 1,000,000 / 5,000,000 units. T is 1,000,000,000 units and A=P-L.

The exact continuous formulas, expressed in whole USDI, are:

```text
E_target(A) = clamp(0.95 + 0.0005*(A-1000), 0.60, 1.40)
p_legendary(A) = clamp(0.05 + 0.0001*(A-1000), 0.01, 0.15)
p_rare(A) = (E_target(A)-0.10-4.90*p_legendary(A))/0.90
p_common(A) = 1-p_rare(A)-p_legendary(A)
```

The deterministic contract floors the target and rare probability and gives the
remainder to common, with denominator 1,000,000. At A=1,000 USDI, probabilities are
27.7778% common, 67.2222% rare, 5% legendary, yielding 0.9499998 USDI expected reward.
Continuous-curve EV error is below 0.0000019 USDI. Close to the target, rounding can
dominate the ideal drift sign within a reserve band below 0.0038 USDI; that is
explicitly quantified rather than hidden. No economic parameter was changed.

Healthy means A>=800 USDI, Caution means 500<=A<800, and Critical means A<500.
Their pending-opening caps are 64/16/4. New openings also require at least 5 USDI
available and at most one unresolved opening per account. User growth does not
change T. All three published rewards remain affordable.

Acceptance freezes revision, odds, account nonce and expiry; stale quotes have
zero slippage tolerance and fully refund USDI. Network gas is still spent.
An accepted opening reserves 5 USDI and returns immediate U128(0) to consume its
FT payment, then schedules a detached future private draw. The draw replaces the
maximum reservation with the permanently stored reward. A successful payout
callback decreases P and L by that reward and vests exactly 0.05 USDI. A confirmed
failure retains its reward liability and fee escrow, allowing same-reward retry.
Stale/duplicate callbacks cannot pay twice. A still-in-flight transfer is never
retried on timeout. Treasury withdrawals use only vested fees and their own
attempt-bound callback.

At quiescence for ordinary processed inflows, actual case-token balance equals
P plus all fee balances. Outgoing transfer uncertainty has explicit in-flight
book bounds. Unprocessed incoming receipts, resolver refunds and unsolicited
positive token surpluses require separate reconciliation; they never become
available reward liquidity merely because the FT account holds them.
See [the full financial design](usdi-financial-design.md) for derivation,
rounding proof, receipt semantics, storage costs and limitations.

## Frontend behavior

The new `/cases` route retains the root HOT Connect provider/singleton and adds:

- Actual finalized USDI balance and permanent claim eligibility.
- Explicit wallet-authorized starter claim, native storage prepayment and
  standard token re-registration without minting a second starter allocation.
- Dragon Tea price, three rewards, current and accepted odds, expected reward,
  health and a pool/reservation/fee dashboard.
- Chain-backed opening history, pending draw/transfer, funded failed payout and
  registration/retry recovery. No client-generated outcome is displayed.
- Public account-scoped transaction intents saved before wallet redirect.
  A recovered hash must match signer, receiver, method, decoded arguments,
  deposit and gas, and be included after the finalized pre-signing block boundary.
  FINAL checks and timeouts never cause automatic transaction resubmission.
- Account/unmount guards, disabled conflicting actions and tested320px/390px layouts.

The active contract config intentionally remains null. Until genuine deployment
is confirmed, balances/odds/results are unavailable and payable controls disabled.
User-proposed deployment IDs live separately in `config/deployment.testnet.json`.

## Verification

The pnpm commands used `node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs`
because this machine's Corepack shim tried a blocked release lookup. Rust
commands used Rust 1.99.1 and isolated `/tmp/iroh-contract-toolchain` caches via
PATH, CARGO_HOME, RUSTUP_HOME and IROH_CARGO_BIN. No saved wallet was required.

| Category                                        | Executed command                                                                                              | Result                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Rust contracts and simulation tests             | `bash scripts/contracts.sh test`                                                                              | PASS: 57 tests, 0 ignored; 17 token, 19 pool, 9 probability, 12 simulation                    |
| Wasm build                                      | `bash scripts/contracts.sh build`                                                                             | PASS: both contracts, locked dependencies, release overflow checks, MVP wasm target           |
| Genuine local receipts                          | `bash scripts/contracts.sh integration`                                                                       | PASS: six completed openings plus concurrent rejection and same-reward failed-payout recovery |
| Economic simulations                            | `bash scripts/contracts.sh simulate`                                                                          | PASS: 84 scenarios, 13,492,200 attempts, 53,697,455 invariant checks                          |
| Frontend unit suite                             | `pnpm test`                                                                                                   | PASS: 328 tests in 46 files                                                                   |
| Focused cases/wallet units                      | `pnpm exec vitest run tests/usdi-client.test.ts tests/wallet-controller.test.ts tests/wallet-adapter.test.ts` | PASS: 64 tests                                                                                |
| TypeScript                                      | `pnpm typecheck`                                                                                              | PASS                                                                                          |
| Configured lint equivalent                      | `pnpm format:check`                                                                                           | PASS; no ESLint/lint script exists in this repository                                         |
| Rust formatting                                 | direct `rustfmt --edition 2024 --check` on contract/simulator/integration sources                             | PASS                                                                                          |
| Wallet and cases browser suite                  | `pnpm test:e2e tests/browser/cases.spec.ts tests/browser/wallet.spec.ts`                                      | PASS: 11 tests, including connected wallet at 320px                                           |
| Production build                                | `pnpm build`                                                                                                  | PASS after final registration-recovery changes                                                |
| Lockfile consistency                            | `pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts`                                   | PASS; no npm lockfile introduced                                                              |
| Public availability                             | `node scripts/usdi-deployment.mjs check docs/usdi-account-availability.json`                                  | PASS: all four accounts not found at final block 276242194                                    |
| Unsigned artifacts                              | `node scripts/usdi-deployment.mjs plan docs/usdi-testnet-deployment-plan.json`                                | PASS; no signing/broadcast capability                                                         |
| Script syntax and diff                          | `node --check scripts/usdi-deployment.mjs`, `git diff --check`                                                | PASS                                                                                          |
| Public deployment/real-wallet claim/open/payout | Requires approved accounts and wallet signatures                                                              | BLOCKED / NOT VERIFIED                                                                        |

The real Sandbox test executes compiled wasm and actual cross-contract receipts,
not mocked result JSON. It verifies bootstrap funding, faucet issuance and
permanent eligibility, wrong-amount/stale-quote full refunds, forged-token
rejection, two-account concurrent quote contention, and actual FT unregistration
causing payout failure. Re-registering and retrying pays the same draw once on
attempt 2. It reconciles real local FT balances, pool funds, fees and supply.
The parent rerun uses the frontend's gas budgets of 50/30/250/150 Tgas for claims,
case storage, ordinary purchases and recovery. See [Sandbox notes](usdi-sandbox-notes.md).

The browser tests use an injected wallet and an honest undeployed configuration;
they do not establish third-party wallet compatibility or public-contract UI
end-to-end execution. The app was also visually inspected at desktop and mobile
sizes. Browser servers used an isolated SQLite file and empty Nansen key and
were stopped after testing. The whole application browser suite was not claimed
green; unrelated baseline failures are recorded in the prior wallet report.

## Simulation results

The full matrix uses seeds 1, 7, 42 and requested counts through 1,000,000 attempts,
reserve starts 500/1000/1500 USDI, growth from 1000 to 5000 users, forced reward
streaks, concurrent requests, failed transfers, empty liquidity and repeated
faucet claims. The same integer distribution code is linked by contract and model.
SplitMix64 exists only in the simulation binary.

In seed 42's million-opening run starting at 1,000 USDI, final pool was 1,029.5,
minimum 882.95, mean 998.802932, median 998 and mean payout 0.9499705 USDI.
Runs starting at 500 and 1500 showed similar mean-reverting behavior; stochastic
paths do not guarantee a return to exactly1,000. The forced legendary streak
accepted 246 openings before liquidity fell to 3.7 USDI and later purchases were
rejected. Unrecovered failed transfers kept 64 claims backed by 46.9 USDI of
liabilities, with fees still escrowed. All tested P>=L and conservation checks held.
These are model results, not guaranteed solvency or fairness in every scenario.

The [simulation report](usdi-pool-simulation-report.md) includes labeled graphs
and metric definitions. Its JSON/CSV artifacts contain every seed/scenario,
reward frequencies, health transitions, drawdowns, liabilities, fees and failures.

## Issues found and corrected

- Native SDK/workspaces crypto versions could not share one dependency resolution.
  The real receipt runner now has an independent workspace/lockfile.
- Compilation caught a callback editing typo and non-exhaustive SDK error enum.
  Both were corrected before the passing native and wasm runs.
- The deprecated unbounded callback-result API was replaced with bounded decoding;
  unknown results do not enable duplicate payout attempts.
- The new header link initially overflowed at 390px. Navigation placement was fixed
  and checked at 320px and 390px, preserving all existing controls. The light page's
  wallet icon now inherits a readable dark color.
- Review found that an older finalized same-method hash could unlock an uncertain
  transaction. Five failing tests preceded the exact-call/fresh-block fix.
- The final recovery check found no page action for a claimed-but-unregistered
  USDI recipient. Two failing checks preceded registration-state reads and the
  standard re-registration button. This never re-enables the faucet.
- One browser run timed out in the existing 3D room readiness helper after refresh.
  The wallet test passed immediately in isolation and in subsequent full runs.
  No assertion was removed; the intermittent readiness cause was not established
  and is retained as a browser-timing limitation.
- The temporary Rust install emitted an optional objcopy rpath warning during the
  first native simulator release build. The simulator still completed all checks;
  setting that toolchain's library path made the tool's version check succeed.
  No compiler/test error was suppressed.

## Deployment blocker and security limits

The public RPC report at 2026-11-04T20:07:56Z found no admin, parent, USDI or case
account. The exact proposed names are:

- `pandacoderexe-admin.testnet`: owner/admin and initial treasury.
- `pandacoderexe.testnet`: required parent of the two contract accounts.
- `usdi.pandacoderexe.testnet`: proposed token account, not deployed.
- `cases.pandacoderexe.testnet`: proposed game account, not deployed.

The admin and parent are siblings; the admin cannot create children beneath
`pandacoderexe.testnet` without that parent's authorization. Creation, native
funding, atomic deploy+init, FT registration and actual 1,000 USDI pool funding
require explicit user wallet approval. No public transaction links exist because
none were submitted. The current CLI deployment/signing commands were checked
against official source, but no CLI credential signer was executed.

Protocol randomness is a later NEAR block seed with isolated, bound unbiased
sampling. It is not a production VRF or a claim of provable fairness. Validator
ordering/withholding and recovery timing remain risks. Unknown payout callbacks
stay Paying; there is intentionally no timeout-based duplicate transfer. Native
storage credits are not withdrawable in this prototype, and game operating NEAR
must cover its one-yocto calls. Retained deployment keys imply upgrade trust.
The faucet is account-based and not Sybil resistant. USDI has no real backing.

## Manual guide and remaining acceptance

Follow [the deployment and player guide](usdi-testnet-deployment.md) for exact
build commands, account creation order, unsigned deploy+init arguments, storage
registration, funding, public configuration and browser verification steps.
Once deployed and configured, start the application, open `/cases`, connect,
claim, check the balance, prepay storage, open, verify reward/pool/accepted odds,
refresh and recover pending state. The guide also covers registration recovery.

All local implementation, source/financial invariants, available tests, build,
review and simulation criteria are verified. Public account existence, deployment,
real third-party wallet signatures, actual public pool funding and real Testnet
payout/UI end-to-end criteria remain unchecked. The plan keeps Phase 13 open.
