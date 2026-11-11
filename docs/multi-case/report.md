# Iroh five-case implementation and Testnet report

Prepared November 11, 2026. The local implementation is verified. Public Testnet still runs the original USDI-only Dragon Tea contract. Its bonus upgrade, four new cases and nine new mock deployments remain unsubmitted pending the bounded approval and native funding described below. No new case is claimed live.

## Implemented collection

All cases stay inside Host → Tea Cases in the existing 3D tea house and animated parchment. Planned cases have exact configured reward previews and disabled signing. Deployed cases read live prices, quotes, balances, inventory and settlement state. The reel displays a validated recorded result. Case selection, refresh recovery, independent read failures, wallet finality and return navigation are covered by tests.

### Bamboo Mist Case

Price 0.5 USDI. Common/Rare/Legendary USDI payouts are 0.2 / 0.5 / 4. Target available liquidity is 250 USDI. Maximum USDI exposure per admitted opening is 4 USDI.

Contract `bamboo.needmore_1_near.testnet`. Status: proposed, not deployed.

Bonus quantities by tier:

- Common: 25 SHITZU, 25 BLACKDRAGON.
- Rare: 10 NEKO.
- Legendary: 1 RHEA.

The tier has a 50% bonus chance. When several candidates share a tier, one is selected uniformly, so each has conditional probability `1/(2k)` for `k` candidates. All bonus quantities are unofficial mocks with no USD valuation.

At target liquidity, Common/Rare/Legendary probability counts are `258334 / 726666 / 15000` out of `1,000,000`. These are reference values, not a quote for current public liquidity.

### Dragon Tea Case

Price 1 USDI. Common/Rare/Legendary USDI payouts are 0.1 / 1 / 5. Target available liquidity is 1000 USDI. Maximum USDI exposure per admitted opening is 5 USDI.

Contract `cases-needmore-1-near.testnet`. Status: existing live USDI case; bonus activation pending.

Bonus quantities by tier:

- Common: 50 SHITZU.
- Rare: 5 RHEA.
- Legendary: 1 AURORA.

The tier has a 50% bonus chance. When several candidates share a tier, one is selected uniformly, so each has conditional probability `1/(2k)` for `k` candidates. All bonus quantities are unofficial mocks with no USD valuation.

At target liquidity, Common/Rare/Legendary probability counts are `277778 / 672222 / 50000` out of `1,000,000`. These are reference values, not a quote for current public liquidity.

### Moon Spirit Case

Price 2 USDI. Common/Rare/Legendary USDI payouts are 0.1 / 2 / 20. Target available liquidity is 2000 USDI. Maximum USDI exposure per admitted opening is 20 USDI.

Contract `moon.needmore_1_near.testnet`. Status: proposed, not deployed.

Bonus quantities by tier:

- Common: 20 PURGE, 2 GEAR.
- Rare: 50 NEKO, 2 mpDAO.
- Legendary: 0.1 STNEAR.

The tier has a 50% bonus chance. When several candidates share a tier, one is selected uniformly, so each has conditional probability `1/(2k)` for `k` candidates. All bonus quantities are unofficial mocks with no USD valuation.

At target liquidity, Common/Rare/Legendary probability counts are `431579 / 528421 / 40000` out of `1,000,000`. These are reference values, not a quote for current public liquidity.

### Phoenix Flame Case

Price 5 USDI. Common/Rare/Legendary USDI payouts are 0.1 / 3.5 / 100. Target available liquidity is 5000 USDI. Maximum USDI exposure per admitted opening is 100 USDI.

Contract `phoenix.needmore_1_near.testnet`. Status: proposed, not deployed.

Bonus quantities by tier:

- Common: 2 RHEA.
- Rare: 2 AURORA, 5 mpDAO.
- Legendary: 0.2 LINEAR, 0.2 STNEAR, 0.25 wNEAR.

The tier has a 50% bonus chance. When several candidates share a tier, one is selected uniformly, so each has conditional probability `1/(2k)` for `k` candidates. All bonus quantities are unofficial mocks with no USD valuation.

At target liquidity, Common/Rare/Legendary probability counts are `483824 / 486176 / 30000` out of `1,000,000`. These are reference values, not a quote for current public liquidity.

### Uncle's Secret Reserve

Price 10 USDI. Common/Rare/Legendary USDI payouts are 2 / 15 / 120. Target available liquidity is 10000 USDI. Maximum USDI exposure per admitted opening is 120 USDI.

Contract `reserve.needmore_1_near.testnet`. Status: proposed, not deployed.

Bonus quantities by tier:

- Common: 10 RHEA, 10 AURORA.
- Rare: 20 mpDAO, 0.5 rNEAR.
- Legendary: 1 STNEAR, 1 LINEAR, 1 wNEAR.

The tier has a 50% bonus chance. When several candidates share a tier, one is selected uniformly, so each has conditional probability `1/(2k)` for `k` candidates. All bonus quantities are unofficial mocks with no USD valuation.

At target liquidity, Common/Rare/Legendary probability counts are `786539 / 168461 / 45000` out of `1,000,000`. These are reference values, not a quote for current public liquidity.

## Token identities and deployment status

USDI remains the payment and base reward token with six decimals. Twelve bonus mocks are supported. The existing SHITZU, RHEA and AURORA deployments retain six decimals, even where canonical Mainnet tokens have different precision. New mocks use the verified precision below. Every mock has a fixed initial supply of 100,000 whole units and no post-initialization mint method.

- SHITZU: 6 decimals, `iroh-test-shitzu.testnet`, verified-live.
- RHEA: 6 decimals, `iroh-test-rhea.testnet`, verified-live.
- AURORA: 6 decimals, `iroh-test-aurora.testnet`, verified-live.
- BLACKDRAGON: 24 decimals, `blackdragon.needmore_1_near.testnet`, proposed.
- NEKO: 24 decimals, `neko.needmore_1_near.testnet`, proposed.
- mpDAO: 6 decimals, `mpdao.needmore_1_near.testnet`, proposed.
- GEAR: 18 decimals, `gear.needmore_1_near.testnet`, proposed.
- PURGE: 18 decimals, `purge.needmore_1_near.testnet`, proposed.
- wNEAR: 24 decimals, `wnear.needmore_1_near.testnet`, proposed.
- STNEAR: 24 decimals, `stnear.needmore_1_near.testnet`, proposed.
- LINEAR: 24 decimals, `linear.needmore_1_near.testnet`, proposed.
- rNEAR: 24 decimals, `rnear.needmore_1_near.testnet`, proposed.

wNEAR, STNEAR, LINEAR and rNEAR mocks do not wrap, stake, redeem, produce yield or carry backing. META is excluded as deprecated, SWEAT because of its announced sunset, and LONK/UWON because current primary-source identity could not be adequately established. [Token research](../token-identities.md) records exact canonical IDs, primary sources, metadata snapshots, duplicate-symbol risks and exclusion reasons.

Thirteen distinct dedicated keys were generated directly into macOS Keychain for the nine token and four case accounts. Only public key records are stored in the repository. Existing account permissions were not changed. Account FullAccess keys retain the protocol ability to replace code, even though the token contract exposes no admin mint method.

## Probability definitions and solvency

Let `D=1,000,000`, `A=pool-reserved`, opening price `P`, target liquidity `T`, and USDI rewards `r0<r1<r2`. Each exact payment puts `19P/20` in the pool and `P/20` in pending fees. Configured prices are divisible by 20 base units.

New cases interpolate a floored target EV `E(A)` and Legendary probability count `L(A)` over pool intervals `[0,T]` and `[T,2T]`, then hold them constant. EV endpoints in basis points of price are Bamboo `7000/9500/11500`, Moon `5000/9500/16000`, Phoenix `4000/9500/18000`, Reserve `6500/9500/16500`. Legendary counts at the same endpoints are Bamboo `1000/15000/30000`, Moon `5000/40000/100000`, Phoenix `2000/30000/70000`, Reserve `3000/45000/85000`.

The solver is `R=floor((D*E-D*r0-(r2-r0)*L)/(r1-r0))`, `C=D-R-L`. Actual EV is `(r0*C+r1*R+r2*L)/D`. Configuration validation proves positive normalized counts over both intervals with a rounding margin and bounded u128 arithmetic. At target liquidity, target EV is exactly 95% of price before Rare flooring.

Dragon's function is preserved exactly: `B=min(A,2000000000)`, `E=clamp(450000+floor(B/2000),600000,1400000)`, `L=clamp(saturating_sub(floor(B/10000),50000),10000,150000)`, followed by the same normalization solver with Dragon's rewards. All amounts here are USDI base units.

Admission requires enough available USDI to reserve the maximum payout before counting the incoming contribution. It also reserves every possible bonus candidate. Selection releases unused reserves; successful callbacks subtract matching funds and liabilities, while failed legs retain both. Only unpaid legs can be retried. Fees vest only when all selected legs settle. Each account physically isolates its pool and inventory.

The deterministic simulation ran 25,000,000 attempted openings across empty, minimum, low, target and excess liquidity, plus maximum-payout streaks, concurrent reservations, failed callbacks and bonus depletion. Exact conservation and safe admission stops passed. [The mathematical report](../multi-case-economics.md) supplies the rounding proof, bounds and maximum exposure analysis; [simulation data](../multi-case-simulation.json) records every scenario.

## Randomness and security

The contract uses NEAR protocol randomness in a later receipt, with account/opening/accepted-height hashing and rejection sampling. Separate domains select bonus presence and candidate. A recorded draw is immutable; retry and duplicate callbacks cannot redraw or settle twice. Validator influence, receipt timing, censorship and undrawn-opening scheduling remain assumptions. This is not claimed to be an adversarially fair application VRF. [The randomness analysis](../multi-case-randomness.md) documents the exact rejection and recovery limits.

Independent review by gpt-6-astra found no blocking contract accounting or cross-case settlement defect. It found two deployment-preparation defects, acceptance of reordered Dragon tokens and extra Dragon keys. Both are fixed with regression tests. Base58 byte-length validation and new-token funding bounds were tightened too. The indexer received a separate review with no actionable finding. This review is not a public-chain deployment or a real HOT wallet test.

## Shelf history

The Shelf aggregates finalized records by case contract, case ID and nonce. Details displays case identity, price, tier, reward, settlement state, contract and transaction information where available. Paginated history can load the full per-account opening chain after upgrade; the current V1 API returns the latest 20. Locally saved verified receipts remain bounded to 60 per deployment and browser. Missing hashes remain unavailable.

Wallet references use the read-only NearBlocks v3 proxy with cursor pagination. They remain labeled unverified until Details checks the transaction, complete finalized receipt graph, inclusion block and successful NEP-141 event executors through RPC. Historical reads have a fixed archival fallback. Public evidence loaded 10+7 distinct references and verified the original Dragon opening transaction through 12 receipt outcomes, including the real USDI purchase and payout. Indexer coverage can be delayed or omit incoming interactions. This is not a claim of a complete wallet-to-wallet ledger. [Indexer evidence and limits](../multi-case-indexer.md) explain the boundary. The trader board remains accessible.

## Verification results

- 79 Rust tests passed; exact final case/mock/original USDI artifact hashes recorded before and after all suites.
- 362 Vitest tests passed across 50 files.
- 13 Node deployment-helper tests passed: nine bounded-batch tests and four historical USDI helper tests with its exact approved artifact.
- 84 of 84 full Playwright tests passed in the supported development environment, 6.9 minutes.
- 39 of 39 production case, wallet, recovery, roulette and Shelf Playwright tests passed, 1.9 minutes.
- next typegen and tsc --noEmit passed.
- Production Next.js build passed with an isolated migrated SQLite database and the existing Google Fonts network access.
- All three genuine local Sandbox suites passed: five-case collection, original Dragon regressions, and pinned deployed V1 state migration. Includes actual USDI/bonus transfers, failures, same-draw retry, duplicate prevention, inventory isolation and stale refunds.
- 25,000,000 attempted openings passed exact integer conservation and reservation checks across five liquidity scenarios per case, plus forced legendary and bonus-depletion stresses.

Initial full-suite failures exposed the removed account page, stale brand and Shelf coordinates, native browser modal traversal, and the development error badge. All were resolved and the complete suite reran green. Production-only full-suite probes were stopped because camera diagnostics are intentionally absent and secure session cookies require HTTPS for the request client.

Browser wallet and mutation coverage uses fixture signing and RPC responses. Sandbox uses real local NEP-141 receipts. Neither establishes real HOT Connect signing on public Testnet. Full browser tests run with development camera diagnostics; the production subset covers cases, wallets, roulette and Shelf. The deleted optional account page was restored from its previous implementation after the full suite exposed its broken documented link. Production session cookies remain secure.

The final contract verification records before/after artifact hashes around all Rust, Sandbox and simulation steps. [Evidence files](evidence/) include the logs, public-chain snapshots, live indexer verification and visual inspection screenshots.

## Public Testnet state and authorized action

At finalized block `277243023`, Dragon remains revision 13, unpaused, with 995.8 USDI available, 0.2 USDI vested fees, no pending liabilities and the original four completed openings. Historical payouts total 8 USDI. Existing live addresses are USDI `usdi-needmore-1-near.testnet`, case `cases-needmore-1-near.testnet`, and the three existing mock IDs listed above.

The only new submitted transaction is the previously approved SHITZU storage registration: [9oNjXJASSDQgdu3vh4eZuZYMgkiW1fLpcnkaftEksvPq](https://testnet.nearblocks.io/txns/9oNjXJASSDQgdu3vh4eZuZYMgkiW1fLpcnkaftEksvPq). It used the dedicated case signer, 30 Tgas and exactly 0.00125 NEAR. Finalized receipt and storage verification passed. No new paid opening, migration, funding or unpause was submitted.

## Bounded batch requiring approval

The exact proposal is [deployment-batch.json](deployment-batch.json), SHA-256 `4cf07ab44a6dcf3f9aedf970c938808ec2bcb61e6e21fec959bf36d859db5cc9`. Its 90 transactions cover thirteen account creations, fourteen deployments or upgrades, twenty-eight storage registrations, twenty-nine inventory funding calls, Dragon pausing and five unpauses. Every account, public key, WASM checksum, initializer, migration argument, raw transfer amount, recipient, gas and deposit is specified. [Deployment review](deployment-review.md) and [individual command templates](deployment-commands.txt) describe sequencing and finalized preconditions.

The maximum native expenditure is **91.705000000000000000000035 test NEAR**, including 73.035000000000000000000035 in attached deposits and 18.67 in maximum fees. New case USDI funding is exactly **1,000 USDI**, allocated 50/150/300/500. Bonus funding covers 100 possible payouts per candidate, including the original Dragon allocations.

The owner currently has 24.108852052391552799199995 test NEAR and 1,004 USDI. Meeting the conservative batch ceiling requires at least **67.59614794760844720080004 additional test NEAR**. No unspecified faucet or funding transaction is included. The batch is unapproved and not ready for execution until approval and adequate native funds exist.

Case WASM SHA-256: `48e560f15ef75db48d82ab1d57ca119b752059d96c1157c897ce3dbf87b7c06e`. Mock WASM SHA-256: `faa2b5cd6957806b93b8c96067152e21ecda54bd63bb7cb5da385c5ebea6a630`. Exact binaries are archived under `artifacts/testnet/`. USDI is not upgraded.

## Remaining work that requires authorization or external state

1. Fund the known owner account to the reviewed execution ceiling and approve the exact bounded batch.
2. Execute its dependency chains, stopping affected operations if code, keys, revision, storage costs or finality differ from the reviewed conditions.
3. Verify actual deployed code, all legacy records, inventories, receipts and unpaused quotes; only then update verified deployment status.
4. Obtain bounded approval for any real user claim/opening not included in this batch and verify real HOT signing and new public Testnet payouts. No new case is currently represented as live.

## Commits and changed files

Branch: `codex/multi-case-testnet-expansion`. No merge, push, reset or history rewrite was performed. Pre-existing unrelated working changes were preserved.

- `72504b3b3533a71a1270b06c160ae5e0d187d7eb`: Add isolated configurable tea cases and verified fixed-supply mocks
- `e864583e64b2e2cc8142de5723eca75ddf29441c`: Integrate five tea cases and verified paginated Shelf history

Changed task files are listed in [changed-files.txt](changed-files.txt).
