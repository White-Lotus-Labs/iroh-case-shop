# Iroh five-case implementation and Testnet report

Updated November 12, 2026. All 90 approved Testnet transactions are FINAL and verified. All five cases and twelve fixed-supply bonus mocks are deployed; every approved pool and inventory allocation is funded, and all five cases are active. Formal security audit is deferred by the user. Deployment acceptance checks and functional tests do not constitute that audit.

## Implemented collection

All cases stay inside Host → Tea Cases in the existing 3D tea house and animated parchment. Planned cases have exact configured reward previews and disabled signing. Deployed cases read live prices, quotes, balances, inventory and settlement state. The reel displays a validated recorded result. Case selection, refresh recovery, independent read failures, wallet finality and return navigation are covered by tests.

### Bamboo Mist Case

Price 0.5 USDI. Common/Rare/Legendary USDI payouts are 0.2 / 0.5 / 4. Target available liquidity is 250 USDI. Maximum USDI exposure per admitted opening is 4 USDI.

Contract `bamboo.needmore_1_near.testnet`. Status: verified live with funded bonuses.

Bonus quantities by tier:

- Common: 25 SHITZU, 25 BLACKDRAGON.
- Rare: 10 NEKO.
- Legendary: 1 RHEA.

The tier has a 50% bonus chance. When several candidates share a tier, one is selected uniformly, so each has conditional probability `1/(2k)` for `k` candidates. All bonus quantities are unofficial mocks with no USD valuation.

At target liquidity, Common/Rare/Legendary probability counts are `258334 / 726666 / 15000` out of `1,000,000`. These are reference values, not a quote for current public liquidity.

### Dragon Tea Case

Price 1 USDI. Common/Rare/Legendary USDI payouts are 0.1 / 1 / 5. Target available liquidity is 1000 USDI. Maximum USDI exposure per admitted opening is 5 USDI.

Contract `cases-needmore-1-near.testnet`. Status: verified live with funded bonuses.

Bonus quantities by tier:

- Common: 50 SHITZU.
- Rare: 5 RHEA.
- Legendary: 1 AURORA.

The tier has a 50% bonus chance. When several candidates share a tier, one is selected uniformly, so each has conditional probability `1/(2k)` for `k` candidates. All bonus quantities are unofficial mocks with no USD valuation.

At target liquidity, Common/Rare/Legendary probability counts are `277778 / 672222 / 50000` out of `1,000,000`. These are reference values, not a quote for current public liquidity.

### Moon Spirit Case

Price 2 USDI. Common/Rare/Legendary USDI payouts are 0.1 / 2 / 20. Target available liquidity is 2000 USDI. Maximum USDI exposure per admitted opening is 20 USDI.

Contract `moon.needmore_1_near.testnet`. Status: verified live with funded bonuses.

Bonus quantities by tier:

- Common: 20 PURGE, 2 GEAR.
- Rare: 50 NEKO, 2 mpDAO.
- Legendary: 0.1 STNEAR.

The tier has a 50% bonus chance. When several candidates share a tier, one is selected uniformly, so each has conditional probability `1/(2k)` for `k` candidates. All bonus quantities are unofficial mocks with no USD valuation.

At target liquidity, Common/Rare/Legendary probability counts are `431579 / 528421 / 40000` out of `1,000,000`. These are reference values, not a quote for current public liquidity.

### Phoenix Flame Case

Price 5 USDI. Common/Rare/Legendary USDI payouts are 0.1 / 3.5 / 100. Target available liquidity is 5000 USDI. Maximum USDI exposure per admitted opening is 100 USDI.

Contract `phoenix.needmore_1_near.testnet`. Status: verified live with funded bonuses.

Bonus quantities by tier:

- Common: 2 RHEA.
- Rare: 2 AURORA, 5 mpDAO.
- Legendary: 0.2 LINEAR, 0.2 STNEAR, 0.25 wNEAR.

The tier has a 50% bonus chance. When several candidates share a tier, one is selected uniformly, so each has conditional probability `1/(2k)` for `k` candidates. All bonus quantities are unofficial mocks with no USD valuation.

At target liquidity, Common/Rare/Legendary probability counts are `483824 / 486176 / 30000` out of `1,000,000`. These are reference values, not a quote for current public liquidity.

### Uncle's Secret Reserve

Price 10 USDI. Common/Rare/Legendary USDI payouts are 2 / 15 / 120. Target available liquidity is 10000 USDI. Maximum USDI exposure per admitted opening is 120 USDI.

Contract `reserve.needmore_1_near.testnet`. Status: verified live with funded bonuses.

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
- BLACKDRAGON: 24 decimals, `blackdragon.needmore_1_near.testnet`, verified-live.
- NEKO: 24 decimals, `neko.needmore_1_near.testnet`, verified-live.
- mpDAO: 6 decimals, `mpdao.needmore_1_near.testnet`, verified-live.
- GEAR: 18 decimals, `gear.needmore_1_near.testnet`, verified-live.
- PURGE: 18 decimals, `purge.needmore_1_near.testnet`, verified-live.
- wNEAR: 24 decimals, `wnear.needmore_1_near.testnet`, verified-live.
- STNEAR: 24 decimals, `stnear.needmore_1_near.testnet`, verified-live.
- LINEAR: 24 decimals, `linear.needmore_1_near.testnet`, verified-live.
- rNEAR: 24 decimals, `rnear.needmore_1_near.testnet`, verified-live.

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

The Shelf aggregates finalized records by case contract, case ID and nonce. Details displays case identity, price, tier, reward, settlement state, contract and transaction information where available. Paginated history can load the full per-account opening chain after upgrade; the historical V1 API returned the latest 20; the upgraded implementation supports pagination. Locally saved verified receipts remain bounded to 60 per deployment and browser. Missing hashes remain unavailable.

Wallet references use the read-only NearBlocks v3 proxy with cursor pagination. They remain labeled unverified until Details checks the transaction, complete finalized receipt graph, inclusion block and successful NEP-141 event executors through RPC. Historical reads have a fixed archival fallback. Public evidence loaded 10+7 distinct references and verified the original Dragon opening transaction through 12 receipt outcomes, including the real USDI purchase and payout. Indexer coverage can be delayed or omit incoming interactions. This is not a claim of a complete wallet-to-wallet ledger. [Indexer evidence and limits](../multi-case-indexer.md) explain the boundary. The trader board remains accessible.

## Verification results

- 79 Rust tests passed; exact final case/mock/original USDI artifact hashes recorded before and after all suites.
- 368 Vitest tests passed across 50 files with the all-five-active candidate configuration.
- 13 Node approved-batch and browser-action tests belong to the committed tree; 4 historical USDI helper tests also passed in the original working directory.
- 85 of 85 full Playwright tests passed in 7.1 minutes with controlled wallets/RPC and an all-five-active registry. The tested source/configuration was checked byte-for-byte against the final activated source.
- The final production build passed a five-case UI smoke check using real public Testnet RPC: exact pools 50/995.8/150/300/500 USDI displayed with no wallet connected and zero transactions submitted. This is read-only production integration coverage. The older 39-test production fixture suite remains historical evidence.
- Next typegen and tsc --noEmit passed for the final all-five-active candidate, including the JSON import-attribute fix.
- Production Next.js build passed in a fresh committed-source copy without .env files, with a disposable migrated SQLite database and Nansen disabled.
- All three genuine local Sandbox suites passed: five-case collection, original Dragon regressions, and pinned deployed V1 state migration. Includes actual USDI/bonus transfers, failures, same-draw retry, duplicate prevention, inventory isolation and stale refunds.
- 25,000,000 attempted openings passed exact integer conservation and reservation checks across five liquidity scenarios per case, plus forced legendary and bonus-depletion stresses.

The final browser run first exposed missing Node ESM JSON attributes; the shared catalog imports were corrected and all 85 browser tests then passed. Activating the live registries exposed historical proposal/absent-token fixture assumptions in 2 Node tests and 1 Python test. Their pre-deployment states are now explicit, preserving the original assertions; all 13 committed Node and 44 Python checks pass. A test-only formatting issue was corrected. No contract binary changed.

Browser wallet and mutation coverage uses fixture signing and RPC responses. Sandbox uses real local NEP-141 receipts. Neither establishes real HOT Connect signing on public Testnet. Full browser tests run with development camera diagnostics; the production subset covers cases, wallets, roulette and Shelf. The deleted optional account page was restored from its previous implementation after the full suite exposed its broken documented link. Production session cookies remain secure.

The final contract verification records before/after artifact hashes around all Rust, Sandbox and simulation steps. [Evidence files](evidence/) include the logs, public-chain snapshots, live indexer verification and visual inspection screenshots.

## Public Testnet state and authorized action

At finalized block 277414585, Dragon is revision 19, paused=false, with 995.8 USDI available, 0.2 USDI vested fees and 4 completed payouts. Its pinned migration preserved the legacy opening and credit records. Historical payouts total 8 USDI.

The separately approved SHITZU registration predates the 90-step batch and remains finalized. Current-batch hashes, actual fees and results are listed below. No paid opening, starter claim, Mainnet transaction or treasury withdrawal was submitted.

## Approved bounded batch and execution status

The exact proposal is [deployment-batch.json](deployment-batch.json), SHA-256 `4cf07ab44a6dcf3f9aedf970c938808ec2bcb61e6e21fec959bf36d859db5cc9`. Its 90 transactions cover thirteen account creations, fourteen deployments or upgrades, twenty-eight storage registrations, twenty-nine inventory funding calls, Dragon pausing and five unpauses. Every account, public key, WASM checksum, initializer, migration argument, raw transfer amount, recipient, gas and deposit is specified. [Deployment review](deployment-review.md) and [individual command templates](deployment-commands.txt) describe sequencing and finalized preconditions.

The maximum native expenditure is **91.705000000000000000000035 test NEAR**, including 73.035000000000000000000035 in attached deposits and 18.67 in maximum fees. New case USDI funding is exactly **1,000 USDI**, allocated 50/150/300/500. Bonus funding covers 100 possible payouts per candidate, including the original Dragon allocations.

At recorded finalized block 277414585, the owner holds 35.99431465207043339919996 test NEAR and 4 USDI. The exact batch approval remains unchanged. Current per-step results are in execution.json.

Case WASM SHA-256: `48e560f15ef75db48d82ab1d57ca119b752059d96c1157c897ce3dbf87b7c06e`. Mock WASM SHA-256: `faa2b5cd6957806b93b8c96067152e21ecda54bd63bb7cb5da385c5ebea6a630`. Exact binaries are archived under `artifacts/testnet/`. USDI is not upgraded.

## Follow-up outside the completed batch

1. The approved deployment batch is complete; no batch transaction remains pending.


2. Any real paid opening, starter claim, additional storage prepayment or HOT wallet signing test outside this batch needs separate bounded authorization. Public bonus payout behavior remains covered by genuine local Sandbox receipts, not a new public paid opening.

## Verified execution progress

All 90 approved Testnet transactions are FINAL and verified. All five cases and twelve fixed-supply bonus mocks are deployed; every approved pool and inventory allocation is funded, and all five cases are active. Formal security audit is deferred by the user. Deployment acceptance checks and functional tests do not constitute that audit.

Receipts record execution fees of 0.1648514257739972 test NEAR. Verified attached deposits: 73.035000000000000000000035 test NEAR, including 73 transferred as new-account funding and 0.035 token-registration deposits. The gross approved attached-deposit plus fee total is 73.199851425773997200000035 test NEAR, below the original ceiling. Account funding and storage backing are not burned fees.

44 Python execution/handoff/acceptance tests and 13 committed Node batch/action tests passed. All 90 saved FINAL receipts, exact actions, actual fees, unique hashes and the aggregate budget were reverified. No duplicate or unlisted transaction was submitted.

### Finalized case pools, inventories and quotes

Owner balance decreased by 73.114537400321119400000035 test NEAR since execution began, including transfers retained on the new accounts. The gross ceiling calculation also adds dedicated-account fees to account funding, so it is a conservative authorization comparison rather than a second charge to the owner.

#### Bamboo Mist Case — `bamboo.needmore_1_near.testnet`

Pool funds 50 USDI; available 50; vested fees 0; actual token balance 50. Revision 6; paused=false; completed history rows 0. Native balance 6.988459606187226300000001 test NEAR; retained storage backing 5.58486 test NEAR.

Contract quote Common/Rare/Legendary counts 461000 / 535200 / 3800 out of 1000000. Owner-specific can_open=false; reason `Prepay case storage in NEAR`. Normal player storage/funding requirements are not deployment failures; no unlisted player prepayment or opening was submitted.

- SHITZU `iroh-test-shitzu.testnet`: funds 2500, available 2500, reserved 0, in flight 0.
- BLACKDRAGON `blackdragon.needmore_1_near.testnet`: funds 2500, available 2500, reserved 0, in flight 0.
- NEKO `neko.needmore_1_near.testnet`: funds 1000, available 1000, reserved 0, in flight 0.
- RHEA `iroh-test-rhea.testnet`: funds 100, available 100, reserved 0, in flight 0.

#### Dragon Tea Case — `cases-needmore-1-near.testnet`

Pool funds 995.8 USDI; available 995.8; vested fees 0.2; actual token balance 996. Revision 19; paused=false; completed history rows 4. Native balance 10.080336956707242699999998 test NEAR; retained storage backing 5.58269 test NEAR.

Contract quote Common/Rare/Legendary counts 278245 / 672175 / 49580 out of 1000000. Owner-specific can_open=false; reason `Prepay case storage in NEAR`. Normal player storage/funding requirements are not deployment failures; no unlisted player prepayment or opening was submitted.

- SHITZU `iroh-test-shitzu.testnet`: funds 5000, available 5000, reserved 0, in flight 0.
- RHEA `iroh-test-rhea.testnet`: funds 500, available 500, reserved 0, in flight 0.
- AURORA `iroh-test-aurora.testnet`: funds 100, available 100, reserved 0, in flight 0.

#### Moon Spirit Case — `moon.needmore_1_near.testnet`

Pool funds 150 USDI; available 150; vested fees 0; actual token balance 150. Revision 7; paused=false; completed history rows 0. Native balance 6.987004815000913700000001 test NEAR; retained storage backing 5.58713 test NEAR.

Contract quote Common/Rare/Legendary counts 563027 / 429348 / 7625 out of 1000000. Owner-specific can_open=false; reason `Prepay case storage in NEAR`. Normal player storage/funding requirements are not deployment failures; no unlisted player prepayment or opening was submitted.

- PURGE `purge.needmore_1_near.testnet`: funds 2000, available 2000, reserved 0, in flight 0.
- GEAR `gear.needmore_1_near.testnet`: funds 200, available 200, reserved 0, in flight 0.
- NEKO `neko.needmore_1_near.testnet`: funds 5000, available 5000, reserved 0, in flight 0.
- mpDAO `mpdao.needmore_1_near.testnet`: funds 200, available 200, reserved 0, in flight 0.
- STNEAR `stnear.needmore_1_near.testnet`: funds 10, available 10, reserved 0, in flight 0.

#### Phoenix Flame Case — `phoenix.needmore_1_near.testnet`

Pool funds 300 USDI; available 300; vested fees 0; actual token balance 300. Revision 8; paused=false; completed history rows 0. Native balance 6.985545507405415000000001 test NEAR; retained storage backing 5.5891 test NEAR.

Contract quote Common/Rare/Legendary counts 497095 / 499225 / 3680 out of 1000000. Owner-specific can_open=false; reason `Prepay case storage in NEAR`. Normal player storage/funding requirements are not deployment failures; no unlisted player prepayment or opening was submitted.

- RHEA `iroh-test-rhea.testnet`: funds 200, available 200, reserved 0, in flight 0.
- AURORA `iroh-test-aurora.testnet`: funds 200, available 200, reserved 0, in flight 0.
- mpDAO `mpdao.needmore_1_near.testnet`: funds 500, available 500, reserved 0, in flight 0.
- LINEAR `linear.needmore_1_near.testnet`: funds 20, available 20, reserved 0, in flight 0.
- STNEAR `stnear.needmore_1_near.testnet`: funds 20, available 20, reserved 0, in flight 0.
- wNEAR `wnear.needmore_1_near.testnet`: funds 25, available 25, reserved 0, in flight 0.

#### Uncle's Secret Reserve — `reserve.needmore_1_near.testnet`

Pool funds 500 USDI; available 500; vested fees 0; actual token balance 500. Revision 9; paused=false; completed history rows 0. Native balance 6.984089203280777100000001 test NEAR; retained storage backing 5.59161 test NEAR.

Contract quote Common/Rare/Legendary counts 683500 / 311400 / 5100 out of 1000000. Owner-specific can_open=false; reason `Prepay case storage in NEAR`. Normal player storage/funding requirements are not deployment failures; no unlisted player prepayment or opening was submitted.

- RHEA `iroh-test-rhea.testnet`: funds 1000, available 1000, reserved 0, in flight 0.
- AURORA `iroh-test-aurora.testnet`: funds 1000, available 1000, reserved 0, in flight 0.
- mpDAO `mpdao.needmore_1_near.testnet`: funds 2000, available 2000, reserved 0, in flight 0.
- rNEAR `rnear.needmore_1_near.testnet`: funds 50, available 50, reserved 0, in flight 0.
- STNEAR `stnear.needmore_1_near.testnet`: funds 100, available 100, reserved 0, in flight 0.
- LINEAR `linear.needmore_1_near.testnet`: funds 100, available 100, reserved 0, in flight 0.
- wNEAR `wnear.needmore_1_near.testnet`: funds 100, available 100, reserved 0, in flight 0.

### Finalized mock supply and balances

- SHITZU `iroh-test-shitzu.testnet`: supply 100000, owner 92500; case balances bamboo-mist=2500, dragon-tea=5000, moon-spirit=0, phoenix-flame=0, uncles-secret-reserve=0. Metadata, decimals, code, supply and storage are checked by the public audit.
- RHEA `iroh-test-rhea.testnet`: supply 100000, owner 98200; case balances bamboo-mist=100, dragon-tea=500, moon-spirit=0, phoenix-flame=200, uncles-secret-reserve=1000. Metadata, decimals, code, supply and storage are checked by the public audit.
- AURORA `iroh-test-aurora.testnet`: supply 100000, owner 98700; case balances bamboo-mist=0, dragon-tea=100, moon-spirit=0, phoenix-flame=200, uncles-secret-reserve=1000. Metadata, decimals, code, supply and storage are checked by the public audit.
- BLACKDRAGON `blackdragon.needmore_1_near.testnet`: supply 100000, owner 97500; case balances bamboo-mist=2500, dragon-tea=0, moon-spirit=0, phoenix-flame=0, uncles-secret-reserve=0. Metadata, decimals, code, supply and storage are checked by the public audit.
- NEKO `neko.needmore_1_near.testnet`: supply 100000, owner 94000; case balances bamboo-mist=1000, dragon-tea=0, moon-spirit=5000, phoenix-flame=0, uncles-secret-reserve=0. Metadata, decimals, code, supply and storage are checked by the public audit.
- MPDAO `mpdao.needmore_1_near.testnet`: supply 100000, owner 97300; case balances bamboo-mist=0, dragon-tea=0, moon-spirit=200, phoenix-flame=500, uncles-secret-reserve=2000. Metadata, decimals, code, supply and storage are checked by the public audit.
- GEAR `gear.needmore_1_near.testnet`: supply 100000, owner 99800; case balances bamboo-mist=0, dragon-tea=0, moon-spirit=200, phoenix-flame=0, uncles-secret-reserve=0. Metadata, decimals, code, supply and storage are checked by the public audit.
- PURGE `purge.needmore_1_near.testnet`: supply 100000, owner 98000; case balances bamboo-mist=0, dragon-tea=0, moon-spirit=2000, phoenix-flame=0, uncles-secret-reserve=0. Metadata, decimals, code, supply and storage are checked by the public audit.
- WNEAR `wnear.needmore_1_near.testnet`: supply 100000, owner 99875; case balances bamboo-mist=0, dragon-tea=0, moon-spirit=0, phoenix-flame=25, uncles-secret-reserve=100. Metadata, decimals, code, supply and storage are checked by the public audit.
- STNEAR `stnear.needmore_1_near.testnet`: supply 100000, owner 99870; case balances bamboo-mist=0, dragon-tea=0, moon-spirit=10, phoenix-flame=20, uncles-secret-reserve=100. Metadata, decimals, code, supply and storage are checked by the public audit.
- LINEAR `linear.needmore_1_near.testnet`: supply 100000, owner 99880; case balances bamboo-mist=0, dragon-tea=0, moon-spirit=0, phoenix-flame=20, uncles-secret-reserve=100. Metadata, decimals, code, supply and storage are checked by the public audit.
- RNEAR `rnear.needmore_1_near.testnet`: supply 100000, owner 99950; case balances bamboo-mist=0, dragon-tea=0, moon-spirit=0, phoenix-flame=0, uncles-secret-reserve=50. Metadata, decimals, code, supply and storage are checked by the public audit.

Retained storage backing across the snapshotted case and mock accounts totals 66.75911 test NEAR. Registration deposits above are accounted separately and are not additional burned transaction fees.

### Every finalized batch transaction

- `token-BLACKDRAGON-create`: [transaction `EaRaXfVSA3wiWaRp3Q8uVGkpP8buHsCLD4EsGPg85BTD`](https://testnet.nearblocks.io/txns/EaRaXfVSA3wiWaRp3Q8uVGkpP8buHsCLD4EsGPg85BTD), FINAL; fee 0.0071149895375 test NEAR; attached 5 test NEAR.
- `dragon-register-RHEA`: [transaction `GCW9EVoGZ8uuZWvkvrMdoNcbrmAEngtDXFfJggUbXMoQ`](https://testnet.nearblocks.io/txns/GCW9EVoGZ8uuZWvkvrMdoNcbrmAEngtDXFfJggUbXMoQ), FINAL; fee 0.0002009044679782 test NEAR; attached 0.00125 test NEAR.
- `dragon-register-AURORA`: [transaction `5HsUXkbmwobiuCFqwPuRqLWDgmti2Sa7uQKvARQ1wANn`](https://testnet.nearblocks.io/txns/5HsUXkbmwobiuCFqwPuRqLWDgmti2Sa7uQKvARQ1wANn), FINAL; fee 0.0002004484679782 test NEAR; attached 0.00125 test NEAR.
- `dragon-pause`: [transaction `6yR2z3c2bQUeHeEyznUSbSz9YQEbwYvGqZomuckshcy8`](https://testnet.nearblocks.io/txns/6yR2z3c2bQUeHeEyznUSbSz9YQEbwYvGqZomuckshcy8), FINAL; fee 0.0001919112754613 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `dragon-upgrade`: [transaction `EoKEYMLUpD6pBnsPSjUvMhr43paoVs3KU54tg41u4cgM`](https://testnet.nearblocks.io/txns/EoKEYMLUpD6pBnsPSjUvMhr43paoVs3KU54tg41u4cgM), FINAL; fee 0.0042227059092395 test NEAR; attached 0 test NEAR.
- `dragon-fund-bonus-dragon-tea-SHITZU`: [transaction `Hv3s7ub9b4hrYYnNykNoiyrdiiraRoEv99v8VqWsMzdp`](https://testnet.nearblocks.io/txns/Hv3s7ub9b4hrYYnNykNoiyrdiiraRoEv99v8VqWsMzdp), FINAL; fee 0.0006941339800047 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `dragon-fund-bonus-dragon-tea-RHEA`: [transaction `GtUEJN5LRt5tjanXDKUNEFrERdFL8MhvN1hyLaNScLvy`](https://testnet.nearblocks.io/txns/GtUEJN5LRt5tjanXDKUNEFrERdFL8MhvN1hyLaNScLvy), FINAL; fee 0.0006939056158108 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `dragon-fund-bonus-dragon-tea-AURORA`: [transaction `AcB83J57ff2Wof7VejEkiKoX9biPP9U7wa8wM7qFC3vc`](https://testnet.nearblocks.io/txns/AcB83J57ff2Wof7VejEkiKoX9biPP9U7wa8wM7qFC3vc), FINAL; fee 0.000693132295579 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `unpause-dragon-tea`: [transaction `ARiLPsYj6zJ1vyj6GPxaKqoocM6bZnujgZY1W7Yz5AsQ`](https://testnet.nearblocks.io/txns/ARiLPsYj6zJ1vyj6GPxaKqoocM6bZnujgZY1W7Yz5AsQ), FINAL; fee 0.0002114043842353 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `token-BLACKDRAGON-deploy`: [transaction `BwxYr2jHBESrDiqw7x3LPic4ixeYtF5kykWhyu32Tx6F`](https://testnet.nearblocks.io/txns/BwxYr2jHBESrDiqw7x3LPic4ixeYtF5kykWhyu32Tx6F), FINAL; fee 0.0025930306150778 test NEAR; attached 0 test NEAR.
- `token-NEKO-create`: [transaction `Gz6T9NKfntG4BEQ7WAww7FVx5QsYLTZkXHNjbYNPEJYJ`](https://testnet.nearblocks.io/txns/Gz6T9NKfntG4BEQ7WAww7FVx5QsYLTZkXHNjbYNPEJYJ), FINAL; fee 0.0071149895375 test NEAR; attached 5 test NEAR.
- `token-NEKO-deploy`: [transaction `9MWmiGZkaTM6H1t93zKMufzNiVzyRvkAYTmmBtRD11AH`](https://testnet.nearblocks.io/txns/9MWmiGZkaTM6H1t93zKMufzNiVzyRvkAYTmmBtRD11AH), FINAL; fee 0.0025864121636472 test NEAR; attached 0 test NEAR.
- `token-MPDAO-create`: [transaction `BDD8vXgEvn41ySJXJuqe8GLWqD8e9A2h3JBVoZebGViw`](https://testnet.nearblocks.io/txns/BDD8vXgEvn41ySJXJuqe8GLWqD8e9A2h3JBVoZebGViw), FINAL; fee 0.0071149895375 test NEAR; attached 5 test NEAR.
- `token-MPDAO-deploy`: [transaction `HoNUG6rC6aLwYAsTkKbFCyvxSPXCZjvyY1chsYKidMBL`](https://testnet.nearblocks.io/txns/HoNUG6rC6aLwYAsTkKbFCyvxSPXCZjvyY1chsYKidMBL), FINAL; fee 0.0025857164887976 test NEAR; attached 0 test NEAR.
- `token-GEAR-create`: [transaction `ZyjSTWyyHAfiXfcmTPaeyN7sU4SzCwYvHGPZ2kytTVq`](https://testnet.nearblocks.io/txns/ZyjSTWyyHAfiXfcmTPaeyN7sU4SzCwYvHGPZ2kytTVq), FINAL; fee 0.0071149895375 test NEAR; attached 5 test NEAR.
- `token-GEAR-deploy`: [transaction `hcDQ1pLqKFYGKp5wxh2FXh5Djz4xyqHSVcVSEDi2j6T`](https://testnet.nearblocks.io/txns/hcDQ1pLqKFYGKp5wxh2FXh5Djz4xyqHSVcVSEDi2j6T), FINAL; fee 0.0025879939982946 test NEAR; attached 0 test NEAR.
- `token-PURGE-create`: [transaction `FbAkwbSdWDDUq2NqZWBHGDPcr4hNgJ18AH9JBpr51q22`](https://testnet.nearblocks.io/txns/FbAkwbSdWDDUq2NqZWBHGDPcr4hNgJ18AH9JBpr51q22), FINAL; fee 0.0071149895375 test NEAR; attached 5 test NEAR.
- `token-PURGE-deploy`: [transaction `D62DjTCCvnsWdXoBzCv5NgVb7aJk3mou1wkfnyfTHaZ1`](https://testnet.nearblocks.io/txns/D62DjTCCvnsWdXoBzCv5NgVb7aJk3mou1wkfnyfTHaZ1), FINAL; fee 0.0025844206723976 test NEAR; attached 0 test NEAR.
- `token-WNEAR-create`: [transaction `G91eUEjAVDNsqAtKrxyC53vRCsZx4Mtknq9BEEFL9y5C`](https://testnet.nearblocks.io/txns/G91eUEjAVDNsqAtKrxyC53vRCsZx4Mtknq9BEEFL9y5C), FINAL; fee 0.0071149895375 test NEAR; attached 5 test NEAR.
- `token-WNEAR-deploy`: [transaction `7SQZQs6gprjwy8p2oynE1a6tDDfCVP1FggMuCfUDLyaV`](https://testnet.nearblocks.io/txns/7SQZQs6gprjwy8p2oynE1a6tDDfCVP1FggMuCfUDLyaV), FINAL; fee 0.0025885459531142 test NEAR; attached 0 test NEAR.
- `token-STNEAR-create`: [transaction `AAM9gDZUjQEd3eukiCs672mFKGrcKXfFe2BWM5sSSBAz`](https://testnet.nearblocks.io/txns/AAM9gDZUjQEd3eukiCs672mFKGrcKXfFe2BWM5sSSBAz), FINAL; fee 0.0071149895375 test NEAR; attached 5 test NEAR.
- `token-STNEAR-deploy`: [transaction `28fKwyyeAjmg36GfTqwN5vVsLf7zjindSjcfbuKogjHF`](https://testnet.nearblocks.io/txns/28fKwyyeAjmg36GfTqwN5vVsLf7zjindSjcfbuKogjHF), FINAL; fee 0.002589472348654 test NEAR; attached 0 test NEAR.
- `token-LINEAR-create`: [transaction `CCeriMQfX9mtSa9NrmB5CUSNnNmF1oaCqVtMDvWqKtfX`](https://testnet.nearblocks.io/txns/CCeriMQfX9mtSa9NrmB5CUSNnNmF1oaCqVtMDvWqKtfX), FINAL; fee 0.0071149895375 test NEAR; attached 5 test NEAR.
- `token-LINEAR-deploy`: [transaction `6JuQZ4ayyxGrBa4zp94Lfp4wg6nakSMdaLB9FMFJpeKN`](https://testnet.nearblocks.io/txns/6JuQZ4ayyxGrBa4zp94Lfp4wg6nakSMdaLB9FMFJpeKN), FINAL; fee 0.002590404785494 test NEAR; attached 0 test NEAR.
- `token-RNEAR-create`: [transaction `3N5WBo7rL3Ga82a3NtKkqnEnhHGjunnwY39cnasJ6drd`](https://testnet.nearblocks.io/txns/3N5WBo7rL3Ga82a3NtKkqnEnhHGjunnwY39cnasJ6drd), FINAL; fee 0.0071149895375 test NEAR; attached 5 test NEAR.
- `token-RNEAR-deploy`: [transaction `26iJiGNJhi8L7V8Z3rgAXnnEwqbWyiTH11N5zz2z9NRG`](https://testnet.nearblocks.io/txns/26iJiGNJhi8L7V8Z3rgAXnnEwqbWyiTH11N5zz2z9NRG), FINAL; fee 0.002583101456537 test NEAR; attached 0 test NEAR.
- `case-bamboo-mist-create`: [transaction `2MaaH9WtZv9pd7fu5HVQ887Xz3e3eyXfM5tXSsdnW7Mi`](https://testnet.nearblocks.io/txns/2MaaH9WtZv9pd7fu5HVQ887Xz3e3eyXfM5tXSsdnW7Mi), FINAL; fee 0.0071149895375 test NEAR; attached 7 test NEAR.
- `case-bamboo-mist-deploy`: [transaction `BLw6UsDLtDq11BvB1LUVAV36Xc3BE7hZe7NdxeTuq1mf`](https://testnet.nearblocks.io/txns/BLw6UsDLtDq11BvB1LUVAV36Xc3BE7hZe7NdxeTuq1mf), FINAL; fee 0.004277140987815 test NEAR; attached 0 test NEAR.
- `case-register-usdi-bamboo-mist`: [transaction `8LygBAXXcb7dSZmCp6QJ1UJnbkT75dbzHcE6DwSAt3Ls`](https://testnet.nearblocks.io/txns/8LygBAXXcb7dSZmCp6QJ1UJnbkT75dbzHcE6DwSAt3Ls), FINAL; fee 0.0002055659024549 test NEAR; attached 0.00125 test NEAR.
- `case-register-bamboo-mist-SHITZU`: [transaction `Dgex13pXHngiv8HubAuZ2SBkwKCmnA8zpgVpcNKVT3hR`](https://testnet.nearblocks.io/txns/Dgex13pXHngiv8HubAuZ2SBkwKCmnA8zpgVpcNKVT3hR), FINAL; fee 0.0002011669809157 test NEAR; attached 0.00125 test NEAR.
- `case-register-bamboo-mist-BLACKDRAGON`: [transaction `GAKyrHntXC9sEY9bzCPjTUfv62BAeYUVjP3EpXtFbZDP`](https://testnet.nearblocks.io/txns/GAKyrHntXC9sEY9bzCPjTUfv62BAeYUVjP3EpXtFbZDP), FINAL; fee 0.0002042724803362 test NEAR; attached 0.00125 test NEAR.
- `case-register-bamboo-mist-NEKO`: [transaction `99Cq6KCtht46LE5JLCupN6jLKxTvWUA6sbsno2TS2Lch`](https://testnet.nearblocks.io/txns/99Cq6KCtht46LE5JLCupN6jLKxTvWUA6sbsno2TS2Lch), FINAL; fee 0.0002010804803362 test NEAR; attached 0.00125 test NEAR.
- `case-register-bamboo-mist-RHEA`: [transaction `HDABeuYwuYywAuRBx6dSGHTNHgme2qZnt3bcTDfHKAvs`](https://testnet.nearblocks.io/txns/HDABeuYwuYywAuRBx6dSGHTNHgme2qZnt3bcTDfHKAvs), FINAL; fee 0.0002011669809157 test NEAR; attached 0.00125 test NEAR.
- `case-fund-usdi-bamboo-mist`: [transaction `vhZWBfU9HsNmm2DYiqoLCAWr9HF3PGcvpRQ4MhmfXrg`](https://testnet.nearblocks.io/txns/vhZWBfU9HsNmm2DYiqoLCAWr9HF3PGcvpRQ4MhmfXrg), FINAL; fee 0.0006563357429362 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-bamboo-mist-SHITZU`: [transaction `5NzwykqBDYkXMmX5yq3xhCvPyJR7xtrufnVUD3u8wgd`](https://testnet.nearblocks.io/txns/5NzwykqBDYkXMmX5yq3xhCvPyJR7xtrufnVUD3u8wgd), FINAL; fee 0.000719666309742 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-bamboo-mist-BLACKDRAGON`: [transaction `3FAWWsDx85PkTvXvYpctHVdCtxeFqoq32jQmRMx5Dr4x`](https://testnet.nearblocks.io/txns/3FAWWsDx85PkTvXvYpctHVdCtxeFqoq32jQmRMx5Dr4x), FINAL; fee 0.0007302044507289 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-bamboo-mist-NEKO`: [transaction `3SAD5GsRmdNjnnnWMFsGx214ZMWZvj6wriYbSSKe3nmK`](https://testnet.nearblocks.io/txns/3SAD5GsRmdNjnnnWMFsGx214ZMWZvj6wriYbSSKe3nmK), FINAL; fee 0.000723148347066 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-bamboo-mist-RHEA`: [transaction `2Z81VBnX1BSYjfuTny3osCz4Mv8gDXLRN52DzneXyTzs`](https://testnet.nearblocks.io/txns/2Z81VBnX1BSYjfuTny3osCz4Mv8gDXLRN52DzneXyTzs), FINAL; fee 0.0007194021556621 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-moon-spirit-create`: [transaction `EGgAMuCYt4EC5af82c8ZgYRTmNQedg9KJb68EhjbNct5`](https://testnet.nearblocks.io/txns/EGgAMuCYt4EC5af82c8ZgYRTmNQedg9KJb68EhjbNct5), FINAL; fee 0.0071149895375 test NEAR; attached 7 test NEAR.
- `case-moon-spirit-deploy`: [transaction `3ns1JzvwAhiQkoZzr59iHsi3Rx2BpGWJaZ6c6wug7zHP`](https://testnet.nearblocks.io/txns/3ns1JzvwAhiQkoZzr59iHsi3Rx2BpGWJaZ6c6wug7zHP), FINAL; fee 0.0042843766865596 test NEAR; attached 0 test NEAR.
- `case-register-usdi-moon-spirit`: [transaction `Fj19QaCCcwkY4EaHx64brFrq6NCXKVg9Tx5g8sGJxRQq`](https://testnet.nearblocks.io/txns/Fj19QaCCcwkY4EaHx64brFrq6NCXKVg9Tx5g8sGJxRQq), FINAL; fee 0.0002055012371867 test NEAR; attached 0.00125 test NEAR.
- `case-register-moon-spirit-PURGE`: [transaction `BreK16v41hYA7bbH2FkHcxTZWa2KYjtwvpCzaf5pFJLS`](https://testnet.nearblocks.io/txns/BreK16v41hYA7bbH2FkHcxTZWa2KYjtwvpCzaf5pFJLS), FINAL; fee 0.000199647815068 test NEAR; attached 0.00125 test NEAR.
- `case-register-moon-spirit-GEAR`: [transaction `zkQPVRJGYRwK6awmVK5DK8e4HUuKvrgEXuUgKimfpDj`](https://testnet.nearblocks.io/txns/zkQPVRJGYRwK6awmVK5DK8e4HUuKvrgEXuUgKimfpDj), FINAL; fee 0.000201471815068 test NEAR; attached 0.00125 test NEAR.
- `case-register-moon-spirit-NEKO`: [transaction `CMe3feprWxsrKRPAScxRMNm78Kda7vCnGLmz5ZqDNLm`](https://testnet.nearblocks.io/txns/CMe3feprWxsrKRPAScxRMNm78Kda7vCnGLmz5ZqDNLm), FINAL; fee 0.000201243815068 test NEAR; attached 0.00125 test NEAR.
- `case-register-moon-spirit-mpDAO`: [transaction `At2VtHpeTSP8XC1jvWWNGXcXdK4QscVdRkuqftJ1bUdH`](https://testnet.nearblocks.io/txns/At2VtHpeTSP8XC1jvWWNGXcXdK4QscVdRkuqftJ1bUdH), FINAL; fee 0.000201015815068 test NEAR; attached 0.00125 test NEAR.
- `case-register-moon-spirit-STNEAR`: [transaction `95N4iQGMrQEU6XVWR9h6dArNPWV1XzV4CpgvqQypge9M`](https://testnet.nearblocks.io/txns/95N4iQGMrQEU6XVWR9h6dArNPWV1XzV4CpgvqQypge9M), FINAL; fee 0.000201927815068 test NEAR; attached 0.00125 test NEAR.
- `case-fund-usdi-moon-spirit`: [transaction `4zM8AehftxzBXU6W6LW3utMKYnHYcWpbhjAx8fGsmiCM`](https://testnet.nearblocks.io/txns/4zM8AehftxzBXU6W6LW3utMKYnHYcWpbhjAx8fGsmiCM), FINAL; fee 0.0006567420212285 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-moon-spirit-PURGE`: [transaction `mttoMLZFbGD21xLu5b3homhfLDwLuPe5JBAo4XeAB4G`](https://testnet.nearblocks.io/txns/mttoMLZFbGD21xLu5b3homhfLDwLuPe5JBAo4XeAB4G), FINAL; fee 0.0007260656441503 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-moon-spirit-GEAR`: [transaction `3Pu6PnZRokeqC8Teq3kGKxMD8rFpG1Aii8H8hC9jkqop`](https://testnet.nearblocks.io/txns/3Pu6PnZRokeqC8Teq3kGKxMD8rFpG1Aii8H8hC9jkqop), FINAL; fee 0.0007294715626223 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-moon-spirit-NEKO`: [transaction `5hocb7WBbasr23hRCa2mzRNzCndgYkLfQsXe8CmTwnpC`](https://testnet.nearblocks.io/txns/5hocb7WBbasr23hRCa2mzRNzCndgYkLfQsXe8CmTwnpC), FINAL; fee 0.0007294705462174 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-moon-spirit-mpDAO`: [transaction `8gWb5d3GxCBkMx94moo9XwfFgCWJoe73YJiE26w87kh2`](https://testnet.nearblocks.io/txns/8gWb5d3GxCBkMx94moo9XwfFgCWJoe73YJiE26w87kh2), FINAL; fee 0.0007266763308446 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-moon-spirit-STNEAR`: [transaction `7GHtuKngRZLiENfjLT4bJcb9URF3CBWps6jCpMtA6yjB`](https://testnet.nearblocks.io/txns/7GHtuKngRZLiENfjLT4bJcb9URF3CBWps6jCpMtA6yjB), FINAL; fee 0.0007313126841882 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-phoenix-flame-create`: [transaction `CVnZtvCHoXgtPXdXi4xU8rLWhuCBSkoRCUJaWaVNPBJY`](https://testnet.nearblocks.io/txns/CVnZtvCHoXgtPXdXi4xU8rLWhuCBSkoRCUJaWaVNPBJY), FINAL; fee 0.0071149895375 test NEAR; attached 7 test NEAR.
- `case-phoenix-flame-deploy`: [transaction `CqdawJhi71zCpGjwSnUmy1QjAqorLvD1DRxe1QwM2sia`](https://testnet.nearblocks.io/txns/CqdawJhi71zCpGjwSnUmy1QjAqorLvD1DRxe1QwM2sia), FINAL; fee 0.0042888614074178 test NEAR; attached 0 test NEAR.
- `case-register-usdi-phoenix-flame`: [transaction `EJkDAryPqh89aM65nveKiph796rCDVi2Hfhiean5yb8k`](https://testnet.nearblocks.io/txns/EJkDAryPqh89aM65nveKiph796rCDVi2Hfhiean5yb8k), FINAL; fee 0.0002055969598172 test NEAR; attached 0.00125 test NEAR.
- `case-register-phoenix-flame-RHEA`: [transaction `ACBMNDghZG8GGPf3gCYupCihKaeGXHQ1hAsFUjPD9JHq`](https://testnet.nearblocks.io/txns/ACBMNDghZG8GGPf3gCYupCihKaeGXHQ1hAsFUjPD9JHq), FINAL; fee 0.000201198038278 test NEAR; attached 0.00125 test NEAR.
- `case-register-phoenix-flame-AURORA`: [transaction `63DJB2ShhHgP9hfK5kujicbyrjiWuvxXxj8ovaSCwnu7`](https://testnet.nearblocks.io/txns/63DJB2ShhHgP9hfK5kujicbyrjiWuvxXxj8ovaSCwnu7), FINAL; fee 0.000200742038278 test NEAR; attached 0.00125 test NEAR.
- `case-register-phoenix-flame-mpDAO`: [transaction `7yjQFzSk9a3oACvgrxJXaqFLscHHWvd3BKEHUhfEe5sT`](https://testnet.nearblocks.io/txns/7yjQFzSk9a3oACvgrxJXaqFLscHHWvd3BKEHUhfEe5sT), FINAL; fee 0.0002013395376985 test NEAR; attached 0.00125 test NEAR.
- `case-register-phoenix-flame-LINEAR`: [transaction `5MJz92BLRr1D81Ri8CYsUCEoz9VutoqCtdEoddtga2T3`](https://testnet.nearblocks.io/txns/5MJz92BLRr1D81Ri8CYsUCEoz9VutoqCtdEoddtga2T3), FINAL; fee 0.0002024795376985 test NEAR; attached 0.00125 test NEAR.
- `case-register-phoenix-flame-STNEAR`: [transaction `DpozEQrq62wpcCg4tgysBAWmFzG743itKLJkfjGNFs5B`](https://testnet.nearblocks.io/txns/DpozEQrq62wpcCg4tgysBAWmFzG743itKLJkfjGNFs5B), FINAL; fee 0.0002022515376985 test NEAR; attached 0.00125 test NEAR.
- `case-register-phoenix-flame-wNEAR`: [transaction `81K7nSKc8CNzN9Ts1tsK2Qt1xq8bYsby5w2LQ35VLtZi`](https://testnet.nearblocks.io/txns/81K7nSKc8CNzN9Ts1tsK2Qt1xq8bYsby5w2LQ35VLtZi), FINAL; fee 0.0002020235376985 test NEAR; attached 0.00125 test NEAR.
- `case-fund-usdi-phoenix-flame`: [transaction `8m76Ds4zDAujqkaU9EQQMCBBWi6zE9wbDo4WAFsz2a6t`](https://testnet.nearblocks.io/txns/8m76Ds4zDAujqkaU9EQQMCBBWi6zE9wbDo4WAFsz2a6t), FINAL; fee 0.0006568268799602 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-phoenix-flame-RHEA`: [transaction `3qMtFg8dAugD1EuxTLBaN6H1uGwsmUhzHvqfZHXvsjFt`](https://testnet.nearblocks.io/txns/3qMtFg8dAugD1EuxTLBaN6H1uGwsmUhzHvqfZHXvsjFt), FINAL; fee 0.0007299697354066 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-phoenix-flame-AURORA`: [transaction `nCLJT39JxwH8cY4Unh3uaN49Jz6nj79Yam349NiSrzD`](https://testnet.nearblocks.io/txns/nCLJT39JxwH8cY4Unh3uaN49Jz6nj79Yam349NiSrzD), FINAL; fee 0.0007291964974504 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-phoenix-flame-mpDAO`: [transaction `Bq5gcsKua6nL8iunqgakXwWCqCk1pLpYXEuFiPjQxuQz`](https://testnet.nearblocks.io/txns/Bq5gcsKua6nL8iunqgakXwWCqCk1pLpYXEuFiPjQxuQz), FINAL; fee 0.0007309343818801 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-phoenix-flame-LINEAR`: [transaction `4LCaDGf4DCzW5Ufy7CcJ2YaRnDvyHuqtVpAJRw9mLkNd`](https://testnet.nearblocks.io/txns/4LCaDGf4DCzW5Ufy7CcJ2YaRnDvyHuqtVpAJRw9mLkNd), FINAL; fee 0.0007364986966901 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-phoenix-flame-STNEAR`: [transaction `Ai68fV2FovceqS7iB6dVi1MqjcDeZfQ3f6huAbnSsCoU`](https://testnet.nearblocks.io/txns/Ai68fV2FovceqS7iB6dVi1MqjcDeZfQ3f6huAbnSsCoU), FINAL; fee 0.0007355945951477 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-phoenix-flame-wNEAR`: [transaction `8y2aH9q2gTSqmc9N4QeKxCrbeMfzGK1ttafju4ZnZ6U5`](https://testnet.nearblocks.io/txns/8y2aH9q2gTSqmc9N4QeKxCrbeMfzGK1ttafju4ZnZ6U5), FINAL; fee 0.0007354937848466 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-uncles-secret-reserve-create`: [transaction `FBLjjiNoUscvh9oWitJiqR4PM2uU1gEh93A4u5mehnJp`](https://testnet.nearblocks.io/txns/FBLjjiNoUscvh9oWitJiqR4PM2uU1gEh93A4u5mehnJp), FINAL; fee 0.0071149895375 test NEAR; attached 7 test NEAR.
- `case-uncles-secret-reserve-deploy`: [transaction `46RpkY62Lgw3GCBvq6u3aWACEgL1gJNnHAKSsWuuht6N`](https://testnet.nearblocks.io/txns/46RpkY62Lgw3GCBvq6u3aWACEgL1gJNnHAKSsWuuht6N), FINAL; fee 0.0042942819943572 test NEAR; attached 0 test NEAR.
- `case-register-usdi-uncles-secret-reserve`: [transaction `3hJwNmbjVaFn6wqiMJLx5ytExfuAU6wnCtupomdL4e6x`](https://testnet.nearblocks.io/txns/3hJwNmbjVaFn6wqiMJLx5ytExfuAU6wnCtupomdL4e6x), FINAL; fee 0.0002058249598172 test NEAR; attached 0.00125 test NEAR.
- `case-register-uncles-secret-reserve-RHEA`: [transaction `14jqN8tTk62fC3XSna7dBKvLs3CG6hyWKkzmaSRDwmeg`](https://testnet.nearblocks.io/txns/14jqN8tTk62fC3XSna7dBKvLs3CG6hyWKkzmaSRDwmeg), FINAL; fee 0.000201426038278 test NEAR; attached 0.00125 test NEAR.
- `case-register-uncles-secret-reserve-AURORA`: [transaction `ERkRgtdmtLK1eub6nGtc5uTHZdxYTjDf5h3yfVq2VcHK`](https://testnet.nearblocks.io/txns/ERkRgtdmtLK1eub6nGtc5uTHZdxYTjDf5h3yfVq2VcHK), FINAL; fee 0.000200970038278 test NEAR; attached 0.00125 test NEAR.
- `case-register-uncles-secret-reserve-mpDAO`: [transaction `uMoe45htjSxvfaZTuxiyMpZP4Soo4s4cP7SQiZQ19T5`](https://testnet.nearblocks.io/txns/uMoe45htjSxvfaZTuxiyMpZP4Soo4s4cP7SQiZQ19T5), FINAL; fee 0.0002015675376985 test NEAR; attached 0.00125 test NEAR.
- `case-register-uncles-secret-reserve-rNEAR`: [transaction `8ecBTFjNZ8rQ1VhgdS4Lz3gCrUHPemqzFeQYvjLRVrYr`](https://testnet.nearblocks.io/txns/8ecBTFjNZ8rQ1VhgdS4Lz3gCrUHPemqzFeQYvjLRVrYr), FINAL; fee 0.0001988315376985 test NEAR; attached 0.00125 test NEAR.
- `case-register-uncles-secret-reserve-STNEAR`: [transaction `AyQSZ41WMpdPnisZTBTE6sTXfs9f3nKADJVJbuam66xg`](https://testnet.nearblocks.io/txns/AyQSZ41WMpdPnisZTBTE6sTXfs9f3nKADJVJbuam66xg), FINAL; fee 0.0002024795376985 test NEAR; attached 0.00125 test NEAR.
- `case-register-uncles-secret-reserve-LINEAR`: [transaction `A5VYh1rJCwjtEK7WiHKcvzrYdYpA7qwTrje4Wo6aZqUv`](https://testnet.nearblocks.io/txns/A5VYh1rJCwjtEK7WiHKcvzrYdYpA7qwTrje4Wo6aZqUv), FINAL; fee 0.0002029355376985 test NEAR; attached 0.00125 test NEAR.
- `case-register-uncles-secret-reserve-wNEAR`: [transaction `HAcNdeDggcyyu2qcczqUTXS49xJGCrEde8RHZsrYgAa3`](https://testnet.nearblocks.io/txns/HAcNdeDggcyyu2qcczqUTXS49xJGCrEde8RHZsrYgAa3), FINAL; fee 0.0002024795376985 test NEAR; attached 0.00125 test NEAR.
- `case-fund-usdi-uncles-secret-reserve`: [transaction `2mpbgTkFMyQicvVq4wzPwGXKspAFGUoCBkX7XRKVTq91`](https://testnet.nearblocks.io/txns/2mpbgTkFMyQicvVq4wzPwGXKspAFGUoCBkX7XRKVTq91), FINAL; fee 0.0006572828799602 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-uncles-secret-reserve-RHEA`: [transaction `BjedFc6dKc7kWWog5CQDUNj6VpfGJEMB9SsUcK1zpyXn`](https://testnet.nearblocks.io/txns/BjedFc6dKc7kWWog5CQDUNj6VpfGJEMB9SsUcK1zpyXn), FINAL; fee 0.0007360449703043 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-uncles-secret-reserve-AURORA`: [transaction `4YB2o6WwUuc2tcV5PYs1r2BuoHUx1dzai6aaTe6DfEGd`](https://testnet.nearblocks.io/txns/4YB2o6WwUuc2tcV5PYs1r2BuoHUx1dzai6aaTe6DfEGd), FINAL; fee 0.0007352717323481 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-uncles-secret-reserve-mpDAO`: [transaction `4KQ5DJ5qTAhA4CzR6jGDAhNLXYpzRvcNcGE2dpgfAMPG`](https://testnet.nearblocks.io/txns/4KQ5DJ5qTAhA4CzR6jGDAhNLXYpzRvcNcGE2dpgfAMPG), FINAL; fee 0.0007369983450206 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-uncles-secret-reserve-rNEAR`: [transaction `EEqscWFBsbiTVA1Y7Z5XNBTqtvaNLntuQGwMKaY8bp96`](https://testnet.nearblocks.io/txns/EEqscWFBsbiTVA1Y7Z5XNBTqtvaNLntuQGwMKaY8bp96), FINAL; fee 0.0007345619962546 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-uncles-secret-reserve-STNEAR`: [transaction `2NtUjgX2eqA63V64bN1ohK3LgzD8CQFnpEgtsgxcgBjB`](https://testnet.nearblocks.io/txns/2NtUjgX2eqA63V64bN1ohK3LgzD8CQFnpEgtsgxcgBjB), FINAL; fee 0.0007416630011706 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-uncles-secret-reserve-LINEAR`: [transaction `62RZddXkz7oFDUE2CihiQzbWBwujFCUopHN1htxUqVq1`](https://testnet.nearblocks.io/txns/62RZddXkz7oFDUE2CihiQzbWBwujFCUopHN1htxUqVq1), FINAL; fee 0.0007425828996282 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `case-fund-bonus-uncles-secret-reserve-wNEAR`: [transaction `CFPe7TzwHp9YcoRENL7Ziu7E5JMDakym65trqW1mjpCZ`](https://testnet.nearblocks.io/txns/CFPe7TzwHp9YcoRENL7Ziu7E5JMDakym65trqW1mjpCZ), FINAL; fee 0.0007415730512487 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `unpause-bamboo-mist`: [transaction `AGy26fvn8WisJB1CAG21FeTjnT8QVcNjTXhYPVu4LBkF`](https://testnet.nearblocks.io/txns/AGy26fvn8WisJB1CAG21FeTjnT8QVcNjTXhYPVu4LBkF), FINAL; fee 0.0002070368849562 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `unpause-moon-spirit`: [transaction `HFjGnxoRyZ3oo3HhgC77k4W4ADF8cPbrzDzhSxJ6YiCk`](https://testnet.nearblocks.io/txns/HFjGnxoRyZ3oo3HhgC77k4W4ADF8cPbrzDzhSxJ6YiCk), FINAL; fee 0.0002074928849562 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `unpause-phoenix-flame`: [transaction `7TmZ6Ck1zdGEJXN3dqkBz3HZyE4gZmBtxj98j5uq75Hj`](https://testnet.nearblocks.io/txns/7TmZ6Ck1zdGEJXN3dqkBz3HZyE4gZmBtxj98j5uq75Hj), FINAL; fee 0.0002072648849562 test NEAR; attached 0.000000000000000000000001 test NEAR.
- `unpause-uncles-secret-reserve`: [transaction `C4LDGjP2MM5RPY7M7985d98vAUseCDHn33y1GfuYm5No`](https://testnet.nearblocks.io/txns/C4LDGjP2MM5RPY7M7985d98vAUseCDHn33y1GfuYm5No), FINAL; fee 0.0002072648849562 test NEAR; attached 0.000000000000000000000001 test NEAR.

The canonical journal is [execution.json](execution.json), with append-only events in [execution-journal.jsonl](execution-journal.jsonl) and raw finalized receipts alongside it. The approved manifest/checksum are unchanged. The existing owner key was verified with a non-transaction NEP-413 signature; no replacement owner key or on-chain permission change was added.

Meteor signed the approved Dragon owner calls. Its blocked BLACKDRAGON request was canceled without broadcast. Subsequent Keychain signing uses checked offline state, exact signed-wire validation and one fixed Testnet RPC submission, followed by full FINAL receipt verification. [Signing review](offline-signing-review.md) records the CLI behavior and guard tests.

Public read-only evidence is in [execution-preflight.json](execution-preflight.json) and [the repeatable audit](evidence/final-readonly-audit.json). The audit checks actual pools, inventory, fixed token supplies, storage, quotes and preserved Dragon history. Real HOT Connect signing and a new public paid bonus payout remain unverified because they are outside this approved transaction batch.

## Commits and changed files

Branch: `codex/multi-case-testnet-expansion`. No merge, push, reset or history rewrite was performed. Pre-existing unrelated working changes were preserved.

- `72504b3b3533a71a1270b06c160ae5e0d187d7eb`: Add isolated configurable tea cases and verified fixed-supply mocks
- `e864583e64b2e2cc8142de5723eca75ddf29441c`: Integrate five tea cases and verified paginated Shelf history
- `03825cf5802f7b7fefd95d110fa71118206ef610`: Record bounded Testnet deployment proposal and complete verification evidence
- `1e582f371494a15078f537e8e7a723e1ac53ed8d`: Pin conditional deployment approval and retain the funding gate
- `d9d44b285db709397cb9805c816af72256160033`: Execute approved Dragon registrations and guard deployment resumption
- `690b1e171ffe06034cbfe85ca296aca7777764ae`: Activate Dragon bonuses on Testnet and record guarded wallet deployment
- `051ec7fa1057f37a876fba9482308d6921fcec67`: Document private owner Keychain setup and verification gate
- `28ae9278f3d8ce378d6b0c623bcf5a5df4eda635`: Verify owner signer and bind approved submissions to checked Testnet state
- `97baf1df7871e698a5982177a49486e27ddb01ee`: Audit all five deployed cases and prepare independent live case fixtures
- `6619e7124ff757ea1a79dd6702819a71f74f7d13`: Prepare frontend integration handoff at paused Testnet checkpoint
- `da6b16ad712d9a1d9a1f26893855eee8ca514c32`: Document complete frontend integration with app APIs and Testnet contracts

Changed task files are listed in [changed-files.txt](changed-files.txt).
