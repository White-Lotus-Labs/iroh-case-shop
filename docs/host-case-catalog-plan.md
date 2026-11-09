# Host tea case catalog

Base branch: `feature/usdi-dynamic-case-pool` at `edd8e1e`. Work on `feature/host-3d-case-catalog`. Preserve the pre-existing deployment notes and scripts outside milestone commits.

## Milestone 1 · Restore the standalone Cases page

- [x] Reproduce wheel and keyboard scrolling on the existing route before changing CSS. Confirm whether controls receive pointer events and whether the SDK leaves an overlay or scroll lock.
- [x] Fix the document scroll rule at its source. Preserve the room and authorization layouts and retain transaction guards when RPC or wallet state is unresolved.
- [x] Exercise mobile, no extension, connection rejection and return, connected reload, and disconnect through the real connector with a controlled injected wallet. Record what the mock cannot prove.
- [x] Run browser tests and TypeScript, then commit the fix.

Baseline wheel input left `scrollY` at zero before authorization. The document's room scroll lock applied to the standalone route. After scoping it, wheel and keyboard scrolling work and Refresh receives clicks after connection, rejection, reload, and disconnect. HOT Connect removed its picker after each tested outcome. RPC failures correctly kept chain writes disabled. Four targeted Playwright checks and TypeScript passed. The injected wallet exercises the real connector lifecycle without the Meteor extension.

## Milestone 2 · Share chain and transaction state

- [ ] Extract the existing case controller. Preserve the quote, intent, signer, finality, pending receipt, and payout checks for both surfaces.
- [ ] Supply contract-backed case metadata, pool state, and public odds. Keep anonymous quote data separate from wallet authorization and display actual weighted expected payout.
- [ ] Run unit and browser tests and TypeScript, then commit the refactor.

## Milestone 3 · Build the Host experience

- [ ] Use AvatarSeat and the existing opening parchment for collection, inspection, and settlement. Keep the room, Uncle, camera, and rollers. Retain explicit Counter research prompts as a contextual chat path.
- [ ] Route the header shortcut into the room station. Preserve old direct links. Restore the Host view on reload and keep wheel, touch, keyboard, and wallet interactions inside the parchment.
- [ ] Present the real tiers, odds, price, pool, balance, starter claim, storage cost, and opening controls. Use the same pending and recovery logic as the standalone route.
- [ ] Reveal the tea box only after a verified draw. Distinguish outstanding payment, completed payout, and refund. Respect reduced motion and use the existing room canvas.
- [ ] Verify browser interactions and TypeScript, then commit the integrated experience.

## Milestone 4 · Verify the experience

- [ ] Exercise claim, rejection, opening, verified draw, payout, and recovery after reload through a controlled wallet and RPC fixture. Verify public deployment separately via read-only Testnet RPC.
- [ ] Test 320px, 390px, tablet, 1366px, and 1920px layouts, keyboard, scroll, reduced motion, and other room stations. Inspect catalog, detail, and reward screenshots.
- [ ] Run relevant suites and a production build. Commit verified changes. Do not push, merge, alter contracts, access credentials, or submit any on-chain transaction.
