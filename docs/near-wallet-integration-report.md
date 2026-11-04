# NEAR Testnet wallet integration report

Date: 2026-11-04. The implementation is on the existing
`feature/near-wallet-integration` branch. No push or merge was performed.

## Git status and ownership

- Starting commit and unchanged `main`: `3fee2c237ead407bbef6769ff2b9959346d7c188`.
- `6ee9582 docs: record reviewed NEAR wallet integration plan`
- `c313fbb chore: add official HOT Connect dependency`
- `a35dc07 feat(wallet): integrate tested NEAR Testnet connection and sessions`
- `b72af5e fix(wallet): restore keyboard focus after disconnect`
- Final review/verification documentation is committed separately after these milestones.

The starting tree already contained the wallet dependency, implementation,
styles, plan and tests as uncommitted work. These were preserved, reviewed and
explicitly included in the commits above. This run corrected the adapter,
validation, event ordering, provider scope and duplicate control label, and
extended tests. The plan records the initial patch snapshot and evidence.
No unrelated tracked edits were present or included. No Git history was rewritten. The working tree is clean at delivery, and `main`
remains at its starting commit.

## Implementation

Created files:

- `src/ui/wallet/nearConnector.ts`
- `src/ui/wallet/walletController.ts`
- `src/ui/wallet/WalletProvider.tsx`
- `src/ui/wallet/WalletMenu.tsx`
- `tests/wallet-controller.test.ts`
- `tests/wallet-adapter.test.ts`
- `tests/browser/wallet.spec.ts`
- `docs/near-wallet-integration-plan.md`
- `docs/near-wallet-integration-report.md`

Modified files:

- `package.json`, `pnpm-lock.yaml`: exact official SDK version 0.12.0.
- `src/app/layout.tsx`: mount the client provider around application children.
- `src/ui/TeaRoomShell.tsx`: render the wallet control in the existing header.
- `src/ui/AccountMenu.tsx`: label the separate guest account link "Log in".
- `src/app/globals.css`: themed, responsive wallet control/popover/messages.
- `docs/development.md`: wallet architecture and maintenance notes.

The provider imports the SDK after mount and shares one connector per page.
The connector pins `network: 'testnet'`, requires the documented Testnet feature
and disables automatic connection. Connect opens the official selector without
requesting a signed message, transaction or access key. The controller validates
returned account syntax and displays the account through `useWallet`.

Disconnect calls SDK `disconnect(wallet)` and waits for wallet sign-out and SDK
selection removal. Failures keep the connected account visible with feedback.
Restoration uses `getConnectedWallet()` to ask a live wallet session for accounts,
checks the wallet's manifest capability and validates the returned accounts.
A stored ID alone never establishes connection. The application stores no custom
account session, credentials, private keys or seed phrases.

The sequence guard rejects results superseded by newer events or unmount.
Initialization runs once per controller. Subscriptions detach on disposal.
Busy controls prevent duplicate picker and conflicting actions. Cancellation is
a notice, while unexpected failures have readable feedback and action-only logs.

## Verification results

Commands used the real installed pnpm executable:
`node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs`. The plain `pnpm` shim tries
to fetch a release in this environment. Below, `pnpm` denotes that executable.

| Category | Command or check | Result |
| --- | --- | --- |
| Dependency consistency | `pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts` | PASS |
| All unit tests | `pnpm test` | PASS: 45 files, 300 tests |
| Wallet units and real-SDK adapter | `pnpm exec vitest run tests/wallet-controller.test.ts tests/wallet-adapter.test.ts` | PASS: 36 tests, also included in the full unit suite |
| TypeScript | `pnpm typecheck` | PASS: `next typegen` and `tsc --noEmit` |
| Configured lint equivalent | `pnpm format:check` | PASS; repository has no ESLint/lint script |
| Production build | `pnpm build` | PASS, rerun after final source changes with font network access |
| Wallet browser tests | `pnpm test:e2e tests/browser/wallet.spec.ts` | PASS: 5 tests |
| Current official wallet manifest in real selector | Chromium check with official manifest 1.1.0 | PASS: 6 Testnet-compatible wallets offered, Mainnet-only wallets excluded |
| Broader browser regressions | Command below | FAIL: 13 pass, 2 stale assertions fail |
| Failed focus assertion in isolation | `pnpm test:e2e tests/browser/deck.spec.ts -g 'full motion reading'` | FAIL: same stale platform focus expectation |
| Full browser suite, initial attempt | `pnpm test:e2e` | INCOMPLETE: stopped after 10 failures and one interrupted test; 37 did not run |
| Real third-party Testnet wallet authorization/refresh/disconnect | Requires a real wallet and user authorization | NOT VERIFIED |
| Diff whitespace | `git diff --check` | PASS |

The broader regression command was:

```sh
pnpm test:e2e tests/browser/camera-look.spec.ts tests/browser/deck.spec.ts tests/browser/station-dock.spec.ts tests/browser/waiting-room.spec.ts tests/browser/waiting-sketchbook.spec.ts tests/browser/thesis-deep-link.spec.ts --max-failures=3
```

The five wallet browser scenarios cover default state and one picker,
cancellation, connection/account display, restoration and disconnection across
refreshes, narrow layout, delayed authorization and rejected authorization.
They listen for page errors and unexpected console errors. Expected application
API HTTP 503 messages for absent Nansen data are excluded from console failures.
The injected wallet asserts Testnet network parameters and no access-key request.

The browser server used `DATABASE_URL=file:/tmp/iroh-wallet-browser.db` and an
empty `NANSEN_API_KEY`, so the corrected regression run did not depend on the
user's database or spend Nansen credits. The server was stopped after testing.

## Bugs found and fixed

1. **Restore errors hidden by the SDK.** SDK `wallet()` catches every session
   exception and converts it to "No accounts found". The adapter now uses
   `getConnectedWallet()`, retaining actual failures. A real-SDK test reproduced
   the hidden exception before the fix and passes afterward.
2. **Restored Mainnet-only wallet accepted.** Restoration bypassed the selector's
   manifest filter. The adapter now explicitly checks `features.testnet`.
3. **Malformed accounts accepted.** Empty strings, invalid syntax, one-character
   IDs and overly long IDs could be shown as connected. A boundary validator
   rejects them; six failing cases now pass. Empty restored arrays stay disconnected.
4. **Stale results after sign-out.** Sign-out during restoration or connection
   was ignored. It now invalidates pending results. Both regression tests pass.
5. **Repeated initialization.** Repeated controller start could restore over a
   current connection. Start is now idempotent and tested.
6. **Wrong-network error erased during cleanup.** SDK sign-out emitted during
   rejected-session cleanup invalidated the rejection feedback. Scoped cleanup
   handling preserves the message; the event-ordering regression passes.
7. **Provider available only to its menu.** Move it to the App Router root so
   other page components can use the hook without creating another connector.
8. **Two controls said Connect Wallet.** The existing account link had a wallet
   label despite its login purpose. Its visible label now matches its existing
   accessible "Log in" label; the browser connection test passes.
9. **Button remained clickable while connecting.** Busy state now disables it,
   with duplicate protection also in the controller. The delayed browser test passes.

10. **Keyboard focus lost after disconnect.** Final read-only review found that
    removing the Disconnect button left focus on the document. A browser
    assertion reproduced it. Closing the connected popover after sign-out now
    returns focus to the wallet trigger.

Final source review found no Critical or Important issues. Its one Minor finding
was addressed with the focus fix above.

Eleven new unit failures and one later event-ordering failure were observed
before their corresponding fixes. No test assertions were removed or skipped.

## Remaining limitations and unrelated failures

Real wallets were not authorized. The injected-wallet checks verify application
and SDK wiring, not third-party wallet availability, extension behavior or real
session persistence. No real account, wallet extension or credentials were used.

The current [official manifest](https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/manifest.json)
advertises Testnet for Meteor, Intear, Ledger, Nightly, Ethereum Wallets and
NEAR CLI without WalletConnect. HOT Wallet, MyNearWallet and other entries that
do not advertise Testnet are filtered out. Manifest declarations may change.
Implicit account IDs exist on multiple networks, so names alone cannot validate
network membership; SDK parameters and wallet capability declarations govern it.

If both SDK manifest sources fail, the SDK returns an empty list. The application
shows an error and asks the user to reload to fetch the list again.

The broader suite is not fully green:

- The first full-suite server lacked `DATABASE_URL`, causing registration HTTP
  500 errors. This test environment mistake was corrected before the 15-test
  broader regression run and the final wallet browser run.
- The existing account specs require `/account`, absent from the starting
  commit's `src/app` tree. The existing guest account link also has an empty href.
  Account routing is outside this wallet-only assignment and was preserved.
- `deck.spec.ts:281` expects Omni to receive Shift+Tab focus from the dialog close
  button. The unchanged platform array at `3fee2c2` ends with Hyperliquid.
- `waiting-sketchbook.spec.ts:88` expects "Iroh's Tea Shop". The unchanged
  `PROJECT.name` at `3fee2c2` is "Iroh's Case Shop".

An initial typecheck failed against stale generated `.next/types/app` output.
The production build regenerated it, after which the exact typecheck passed
without modifying the unrelated leaderboard handler.

The full real-wallet acceptance criteria and a wholly passing application-wide
browser suite remain unverified. The plan keeps these limits explicit.

## Manual verification

From `/Users/mark/Documents/iroh-case-shop`:

1. Use Node 24.10.0 with `nvm use`, then `pnpm install --frozen-lockfile` if needed.
2. Run:

   ```sh
   DATABASE_URL=file:./dev.db NANSEN_API_KEY= pnpm dev
   ```

   On this machine, if the corepack shim fails, replace `pnpm` with
   `node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs`.
3. Open `http://127.0.0.1:3000/?thesis=ai` to access the header directly, or open
   the root URL and enter the tea room once loading finishes.
4. Click **Connect Wallet**. Confirm the official picker offers Testnet wallets
   and excludes HOT Wallet unless its manifest has subsequently added Testnet.
5. Select a compatible wallet that you have configured for NEAR Testnet. Follow
   its authorization UI using a Testnet account. Do not enter keys into the app.
6. Confirm your account ID replaces the connect label. Open the account popover
   to read the full ID and the **NEAR Testnet** label.
7. Refresh. Once restoration finishes, the same live account should appear
   without another picker or authorization prompt where that wallet supports it.
8. Open the account popover and select **Disconnect**. Confirm the label returns
   to **Connect Wallet**.
9. Refresh again. Confirm it stays disconnected and no picker opens automatically.
10. Optionally cancel a picker and reject wallet authorization. Confirm the app
    stays disconnected with a cancellation notice and allows another attempt.

No transfers, contracts, signature-based authentication or Mainnet fallback are
part of this feature.
