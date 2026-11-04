# NEAR Testnet wallet integration plan

## Scope and starting state

Account connection only, using `@hot-labs/near-connect@0.12.0`. No transactions,
tokens, contracts, signing requests, access keys or backend authentication.

The existing branch `feature/near-wallet-integration` was reused at `3fee2c2`.
All wallet code, styles, dependencies, tests and this plan were already present
as uncommitted work when the continuation started on 2026-11-04. They have been
reviewed and explicitly included in the feature milestones. New work in this
run corrects the SDK adapter, validation, races, provider scope, duplicate UI
label and regression coverage. The starting tracked patch and untracked-file
list were saved at `/tmp/iroh-wallet-initial.patch` and
`/tmp/iroh-wallet-initial-untracked.txt`. No unrelated edits were found.

The project uses Next.js App Router, TypeScript, React, global CSS, pnpm,
Vitest and Playwright. There is no ESLint configuration or lint script;
`format:check` and `typecheck` are the configured static checks.

## SDK verification

Checked the [HOT Labs page](https://hot-labs.org/near-connect),
[upstream README](https://github.com/azbang/near-connect), and installed
`build/NearConnector.d.ts`, `NearConnector.js`, `InjectedWallet.js` and event types.
The npm website returned HTTP 403; the installed official package is available.

- Configure both `network: 'testnet'` and `features: { testnet: true }`.
- `autoConnect: false` prevents unsolicited injected-wallet sign-in.
- Await `whenManifestLoaded`, then `connect()` for the official selector.
- Restore with `getConnectedWallet()`, which returns live wallet accounts.
  SDK `wallet()` hides all restoration exceptions as "No accounts found";
  it must not be used for restoration or to look up a known wallet at sign-out.
- Use `disconnect(selectedWallet)` to sign out and clear SDK selection storage.
- Subscribe with `on`, unsubscribe with `off`, using actual SDK event types.
- The SDK silently substitutes an empty manifest after failed remote fetches.
  The adapter reports no available wallets clearly and advises a page reload.
- Wallet names alone do not prove a network. SDK network parameters and manifest
  Testnet capability control the network; account syntax and `.near` rejection
  are additional safeguards. Implicit addresses cannot prove network membership.

The official manifest fetched on 2026-11-04 was version 1.1.0. Without the optional
WalletConnect dependency it advertises Meteor, Intear, Ledger, Nightly, Ethereum
Wallets and NEAR CLI as Testnet-compatible. HOT Wallet and MyNearWallet do not
advertise Testnet. These are manifest declarations, not successful wallet tests.
No wallet list is hardcoded into the application.

## Phases

### Phase 1: Inspect and validate the existing project

- [x] Inspect routing, components, styles, dependencies, tests and existing wallet work.
- Files: repository inspection only.
- Verification: Git status/diff, source reads, baseline Vitest: 45 files, 287 tests passed.
- Acceptance: App Router and existing wallet implementation identified; no duplication.
- Status: completed.

### Phase 2: Create and configure the Git feature branch

- [x] Reuse the existing `feature/near-wallet-integration` branch as requested.
- Files: Git metadata only; preserve inherited edits.
- Verification: branch/status and `main` reference recorded at `3fee2c2`.
- Acceptance: all new commits stay on this feature branch; no push or merge.
- Status: completed.

### Phase 3: Install and configure HOT Connect

- [x] Review the inherited exact dependency and lockfile entries for 0.12.0.
- [x] Verify installed SDK methods and Testnet configuration.
- Files: `package.json`, `pnpm-lock.yaml`, `src/ui/wallet/nearConnector.ts`.
- Verification: real-SDK adapter tests and
  `pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts` pass.
- Acceptance: official package resolves; lockfile matches; no extra wallet dependency.
- Status: completed.

### Phase 4: Implement client-side wallet connection state management

- [x] Keep SDK construction behind a dynamic import after mount.
- [x] Share one connector; clean up controller subscriptions on unmount.
- [x] Place `WalletProvider` in the root layout so page components can use `useWallet`.
- Files: `src/ui/wallet/{nearConnector,walletController,WalletProvider}.tsx/ts`, `src/app/layout.tsx`.
- Verification: controller/adapter tests, typecheck, formatting and browser mount.
- Acceptance: no SSR browser access, no duplicated listeners, disposed results ignored.
- Status: completed.

### Phase 5: Implement Connect Wallet UI

- [x] Add the themed header control, account popover and accessible full account ID.
- [x] Rename the existing login link's misleading wallet label to "Log in".
- Files: `WalletMenu.tsx`, `TeaRoomShell.tsx`, `AccountMenu.tsx`, `globals.css`.
- Verification: Playwright wallet tests, desktop picker and mobile layout checks.
- Acceptance: official picker opens once, full account is accessible, mobile control fits.
- Status: completed for injected-wallet UI; real wallet authorization remains unverified.

### Phase 6: Implement wallet disconnection

- [x] Sign out through SDK; keep the connected account visible on sign-out failure.
- Files: wallet controller and adapter.
- Verification: unit success/failure tests and browser disconnect/reload scenario.
- Acceptance: SDK selection and wallet session are cleared; refresh stays disconnected.
- Status: completed with the injected test wallet.

### Phase 7: Implement session restoration and synchronization

- [x] Ask the wallet for accounts instead of trusting a cached ID.
- [x] Enforce manifest Testnet capability on restored sessions.
- [x] Make start idempotent and let sign-out invalidate pending operations.
- Files: wallet controller and adapter.
- Verification: restored/missing/failed sessions, wrong network, late results, cleanup.
- Acceptance: a real SDK session restores without a picker; stale results never reconnect.
- Status: completed with the injected test wallet.

### Phase 8: Implement loading states and error handling

- [x] Disable conflicting requests; show busy state, cancellation notice and readable errors.
- [x] Validate malformed/empty accounts and preserve unsupported-network feedback.
- [x] Log unexpected failures by action without wallet payloads or SDK messages.
- Files: wallet components, controller and adapter.
- Verification: 36 focused unit/adapter tests and delayed/rejected authorization browser tests.
- Acceptance: cancellations are notices; unexpected failures are reported; invalid data cannot connect.
- Status: completed.

### Phase 9: Add automated tests and verify integration

- [x] All 15 required scenarios covered by unit/controller and browser tests.
- [x] Unit suite: 45 files, 300 tests pass, including 36 wallet tests.
- [x] Wallet browser suite: 5 tests pass against real SDK and an injected test wallet.
- [x] Audit wider browser regressions and inspect the picker with the current official manifest.
- [ ] Authorize a real NEAR Testnet wallet, refresh and disconnect manually.
- Files: `tests/wallet-*.test.ts`, `tests/browser/wallet.spec.ts`.
- Acceptance: automated checks pass; real-wallet limitations are explicitly documented.
- Status: automated checks completed with unrelated browser failures recorded below; real wallet not verified.

### Phase 10: Perform final regression testing and review

- [x] Typecheck, format check and diff whitespace check pass.
- [x] Initial production build passes after allowing font network access.
- [ ] Repeat production build after final source changes.
- [ ] Review final diff, commit milestones and record final Git status/report.
- Files: this checklist, `docs/development.md`, final report.
- Acceptance: verified feature committed on its existing branch; limitations recorded accurately.
- Status: in progress.

## Verification and debugging notes

The direct pnpm command in this environment is
`node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs`. The corepack shim tries to
fetch the latest pnpm release and fails DNS in the restricted sandbox.

An initial typecheck failed on stale `.next/types/app` files concerning an
optional leaderboard request parameter. A clean production build regenerated
the artifacts, and the exact `typecheck` command now passes with no source change.
The earlier plan's claimed source-level blocker is superseded by this evidence.

Browser startup first required permission to bind localhost, launch Chromium
and touch Prisma caches. The first broader suite then ran without `DATABASE_URL`,
causing registration HTTP 500 errors. That run was stopped, and the server was
restarted with `DATABASE_URL=file:/tmp/iroh-wallet-browser.db` and an empty Nansen
key. Wallet tests pass again in that environment. Existing account specs also
expect `/account`, which is absent from `git ls-tree -r HEAD src/app`; the
inherited guest account link has an empty href. No account feature was added.

Regression tests were run before fixes: 11 failures confirmed malformed account
acceptance, hidden restore errors, missing Testnet checks and stale async results.
A further failing test reproduced SDK sign-out erasing wrong-network feedback.
All now pass. Browser testing also caught the duplicate "Connect Wallet" label.

No real wallet credentials, extension or account authorization were available.
The injected wallet proves application/SDK wiring only. Actual third-party
wallet authorization, persistence and availability remain NOT VERIFIED.


The correctly configured broader browser run completed 15 tests: 13 passed,
2 failed. Both failures are stale assertions against unchanged code at `3fee2c2`:

- `deck.spec.ts:281` expects Shift+Tab from the close button to focus Omni,
  although `TRADING_PLATFORMS` already ends with Hyperliquid. The failure also
  reproduces when the test runs alone. No trading dialog code changed.
- `waiting-sketchbook.spec.ts:88` expects "Iroh's Tea Shop", although
  `PROJECT.name` already says "Iroh's Case Shop". No sketchbook content changed.

The full suite attempt before correcting `DATABASE_URL` was stopped after
10 failures and one interrupted test; 37 did not run. Its registration failures
were test setup errors. The three account specs require the absent `/account`
page. The full suite is therefore not claimed green. Existing tests and
assertions were preserved, and unrelated account/trading/sketchbook work was
not added to this feature.

Current-manifest browser check passed: all six advertised Testnet wallets were
shown and Mainnet-only wallets excluded. The first diagnostic incorrectly
waited for the SDK's boxless outer wrapper to be visible; targeting its visible
`.modal-content` corrected the diagnostic without an application change.
