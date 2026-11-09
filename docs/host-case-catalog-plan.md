# Host tea case catalog

Base branch: `feature/usdi-dynamic-case-pool` at `edd8e1e`. Work on `feature/host-3d-case-catalog`. Preserve the pre-existing deployment notes and scripts outside milestone commits.

## Milestone 1 · Restore the standalone Cases page

- [x] Reproduce wheel and keyboard scrolling on the existing route before changing CSS. Confirm whether controls receive pointer events and whether the SDK leaves an overlay or scroll lock.
- [x] Fix the document scroll rule at its source. Preserve the room and authorization layouts and retain transaction guards when RPC or wallet state is unresolved.
- [x] Exercise mobile, no extension, connection rejection and return, connected reload, and disconnect through the real connector with a controlled injected wallet. Record what the mock cannot prove.
- [x] Run browser tests and TypeScript, then commit the fix.

Baseline wheel input left `scrollY` at zero before authorization. The document's room scroll lock applied to the standalone route. After scoping it, wheel and keyboard scrolling work and Refresh receives clicks after connection, rejection, reload, and disconnect. HOT Connect removed its picker after each tested outcome. RPC failures correctly kept chain writes disabled. Four targeted Playwright checks and TypeScript passed. The injected wallet exercises the real connector lifecycle without the Meteor extension.

## Milestone 2 · Share chain and transaction state

- [x] Extract the existing case controller. Preserve the quote, intent, signer, finality, pending receipt, and payout checks for both surfaces.
- [x] Supply contract-backed case metadata, pool state, and public odds. Keep anonymous quote data separate from wallet authorization and display actual weighted expected payout.
- [x] Run unit and browser tests and TypeScript, then commit the refactor.

The legacy route and Host share the controller and recovery panel. The public odds request returns only display data. The official RPC confirmed the deployed case code and the USDI token at finalized block 276955541: 1,000 USDI available and held by the case contract, Healthy, with odds of 27.7778%, 67.2222%, and 5%. TypeScript, 329 Vitest tests, and three standalone browser regressions passed.

## Milestone 3 · Build the Host experience

- [x] Use AvatarSeat and the existing opening parchment for collection, inspection, and settlement. Keep the room, Uncle, camera, and rollers. Retain explicit Counter research prompts as a contextual chat path.
- [x] Route the header shortcut into the room station. Preserve old direct links. Restore the Host view on reload and keep wheel, touch, keyboard, and wallet interactions inside the parchment.
- [x] Present the real tiers, odds, price, pool, balance, starter claim, storage cost, and opening controls. Use the same pending and recovery logic as the standalone route.
- [x] Reveal the tea box only after a verified draw. Distinguish outstanding payment, completed payout, and refund. Respect reduced motion and use the existing room canvas.
- [x] Verify browser interactions and TypeScript, then commit the integrated experience.

The Host opens the collection by default. The header button uses the same station and parchment, and the current view is restored from the URL. Counter research prompts still open contextual chat. The coffer uses CSS perspective in the existing room and reads the verified draw and payout state. TypeScript, the production build, and all 16 Cases and Host Playwright checks passed against the production build.

## Milestone 4 · Verify the experience

- [x] Exercise claim, rejection, opening, verified draw, payout, and recovery after reload through a controlled wallet and RPC fixture. Verify public deployment separately via read-only Testnet RPC.
- [x] Test 320px, 390px, tablet, 1366px, and 1920px layouts, keyboard, scroll, reduced motion, and other room stations. Inspect catalog, detail, and reward screenshots.
- [x] Run relevant suites and a production build. Commit verified changes. Do not push, merge, alter contracts, access credentials, or submit any on-chain transaction.

The controlled wallet exercised HOT Connect selection and cancellation, starter claim, native storage, opening, reload with a pending hash, confirmed draw, completed payout, full refund, and failure. It also verified that the displayed odds changed with the pool revision. The production browser separately read the official Testnet RPC without a wallet. This live check was read-only.

Checked the production layout at 320, 390, 820, 1366, and 1920px, with native mobile touch input and keyboard scrolling. Reviewed catalog, inspection, and fixture payout screenshots. Moved the open button next to the odds and shortened the mobile cover art to keep the collection action in view. Camera coverage caught an existing Host hover shader missing uniform declarations. The repaired outline passed both development-only camera checks.

Final verification: 329 Vitest tests, 38 production Playwright checks, two development camera checks, a separate live browser read, and a clean production build with TypeScript validation. Contract code and financial parameters were outside this change.
