# Multi-case Testnet expansion

The user authorized autonomous local development and dedicated keys, but only the previously approved SHITZU registration may be submitted without a new bounded approval. No Mainnet writes, pushes, merges, resets, or unrelated credential access.

## Existing flow

Host uses TeaCaseCatalog and a CaseClient. Finalized get_case/get_pool/get_quote reads gate an exact USDI ft_transfer_call. The controller records the intent before wallet signing. Receipt verification checks the original signer, receiver, arguments, deposit, gas and finalized inclusion. Contract payment acceptance reserves maximum USDI and possible token payouts, a later receipt commits one draw, and callbacks settle each leg. Shelf merges verified browser receipts with account-linked contract history. Historical V1 Dragon rows are read through the existing migration bridge.

## Decision

Use one shared configurable WASM on independent case accounts. A single registry contract would introduce composite storage keys, shared funds and new migration risks. Copying contracts would cause security fixes and economics to diverge. Independent accounts reuse settlement and recovery, isolate funds physically, and preserve Dragon's account and state.

Keep the existing CasePool root and Opening Borsh layouts intact. New private new_configured initialization writes immutable configuration and inventory to separate reserved storage keys. Missing configuration retains exact Dragon behavior. Fresh cases start paused. No frontend configuration alone marks a new account live.

Case and token registries are the source for artifact generation and browser validation. Case prices are 0.5, 1, 2, 5 and 10 USDI. Dragon keeps its original economics. Other cases have different payout ratios and target/legendary curves. Quantities use integer base units; mocks have no USD valuation. Multi-candidate tiers select at most one bonus with 50% tier probability and equal conditional candidate odds.

## Ownership and delivery

Contract work owns economics, immutable configuration, settlement, simulation and Sandbox integration. Application work owns case selection, exact metadata validation, client-scoped recovery and aggregate Shelf history. Token work owns primary-source identity evidence, one fixed-supply NEP-141 binary and dedicated secure keys. The parent coordinates public snapshots, registries, deployment batches, regression verification and commits.

New deployments require exact account/key/WASM/initialization/storage/funding/pause parameters and expenditure ceilings. Existing Dragon has a separate activation dependency chain. Public finalized preflight checks are mandatory before signing and must stop affected operations if a pinned prerequisite changes.

## Verification

Rust tests, rebuilt WASM checksums, actual Sandbox transfer receipts for every configuration, million-opening simulations, Vitest, TypeScript, production build and Playwright exercise the implementation. Mock-wallet and Sandbox results are reported separately from real-wallet and public Testnet proof. Missing history hashes remain unavailable. Live deployment and HOT signing remain unproven until observed.
