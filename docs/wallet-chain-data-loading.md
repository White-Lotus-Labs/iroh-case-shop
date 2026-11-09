# Wallet chain data loading incident

## Diagnosis

The Host and standalone Cases shared a controller that published wallet data only after a single aggregate refresh. A held `get_history` request on the base branch kept the wallet balance at the placeholder even when `ft_balance_of`, `has_claimed`, and pool reads had completed. The interval also started a new refresh every 12 seconds and aborted the previous one, whose per-request deadline was 15 seconds. With a request held across repeated polls, the obsolete refresh could neither publish partial data nor surface its timeout. The receipt check ran after the same aggregate read, and a wallet approval in progress blocked refreshes.

The configured `rpc.testnet.near.org` endpoint returned HTTP 429 with an explicit deprecation notice during the incident investigation. [NEAR's deprecation notice](https://www.near.org/blog/deprecation-of-near-org-and-pagoda-co-rpc-endpoints) documents the reduced limits. The replacement [FastNear Testnet RPC](https://docs.fastnear.com/rpc) returned finalized contract state and accepted browser CORS preflights.

## Read-only Testnet verification

- `usdi-needmore-1-near.testnet` is deployed with code hash `2z7yWfap6hkGAcow7xFKRghGWv7Uq1uea3Vn7HV6QuaJ`.
- `cases-needmore-1-near.testnet` is deployed with code hash `EdQrCQ4CDhFLJfJpPxShQVCj1K9DdfF4Cf3z247yh3ow` and identifies the USDI contract as its token.
- At finalized blocks 276961992–276961998, `needmore_1_near.testnet` held 1,000 USDI, `has_claimed` was true, and the case contract reported no active or historical opening for that account. The pool was Healthy with 1,000 USDI held and available, zero reserved rewards, and zero completed payouts.
- The [starter claim receipt](https://testnet.nearblocks.io/txns/GyQLbawAKPGjvmaL767yUFGYdgvY3r8nSonpMUsDoxvH) was independently confirmed through Testnet RPC with status `FINAL` and a USDI mint log for 1,000 USDI to the signer.

## Fix and verification

- The case client exposes individually validated contract views. The controller publishes the account ID immediately and each read as it settles, with separate status and retry controls for balance, eligibility, pool, and opening history. A failed refresh can retain a visibly labeled last confirmed value.
- The read scheduler limits parallel requests, gives each request an eight-second deadline, retries a transient read once after backoff, and schedules polling after the current cycle finishes. Manual refreshes during an in-flight cycle coalesce. Closing the parchment or changing accounts aborts that scope and ignores late responses.
- The pending intent still blocks new signing until resolved. Receipt checks run separately, match the signer, receiver, action, arguments, gas, deposit and inclusion block, and require finality. A single wallet callback hash is accepted only with a matching saved intent. The transaction status is shown near the wallet actions. The controller refreshes contract data after verification and never resends payable calls.
- The test suite uses a controlled HOT Connect wallet for approvals, rejection, session restoration, and redirect recovery. The public-RPC browser check uses the real account ID with a connector that cannot sign and verifies live balance, claimed state, pool and opening history. A real Meteor approval or redirect was not automated. The wallet's own already-submitted claim was verified independently on chain.
- TypeScript and the production build passed in the isolated checkout with the existing font cache. A fresh isolated build hit an unrelated Next.js Google Fonts resolution error before that cache was used.
- Final results were 329 Vitest tests and 35 production Playwright checks, including the separate live RPC read. Browser regressions covered slow and hanging requests, HTTP 429 and HTTP 503, manual retry, repeated refresh, unmount, connection and account switching, rejection, finality, and reload or redirect recovery without a second submission.
