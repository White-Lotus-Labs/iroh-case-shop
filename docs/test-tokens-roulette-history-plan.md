# Test tokens, roulette and Shelf activity

Base: `fix/wallet-chain-data-loading` at `8a0d1af`. Feature: `feature/test-tokens-roulette-history`.

## 1. Contracts and inventory
- [x] Add a fixed-supply Testnet NEP-141 contract with three permitted mock identities, initialized once by its own account.
- [x] Add a fresh Dragon Tea deployment path with an immutable bonus-token catalog. Preserve the USDI-only initializer and deployed v1 API. No in-place upgrade is supported because state layout changes.
- [x] Keep the USDI payout and top-level odds unchanged. Independently select a 50% bonus within each tier: 50 SHITZU for Common, 5 RHEA for Rare, 1 AURORA for Legendary. Bonuses have no USDI valuation. Reserve every possible bonus before accepting payment, release unselected reserves, settle each leg independently, and retry only confirmed failures.
- [x] Test mint constraints, inventory admission, rarity and sub-selection, payout accounting and partial failures. Build and record WASM checksums.

Verified with 61 Rust tests and the local NEAR Sandbox. Sandbox executed actual mock funding receipts and confirmed a USDI payout plus a bonus payout against both token balances. Built WASM SHA-256 hashes:

- Mock token: `45d85cb559123ec03db7ea47c8d00eed1db544ee7d8c46a17656dc109c058bad`
- Case pool: `e4092cbff3ff59676d8b530e1540b57e1939264863f8d49a0b32c29483fa1111`

## 2. Host reward presentation
- [x] Read both deployed legacy and extended reward schemas, with token symbols, denominations, inventory and payout status from the contract. Retain separate loading states.
- [x] Render a tea-themed reel driven by the selected reward from the contract. Show a neutral pending state, animate to the verified result, and support reduced motion. Verify Host browsing, exact reward, and mobile layout.

Verified legacy and bonus-enabled contract data, exact reel stop, partial settlement display, reduced motion, and mobile layouts with the production app. The release build and TypeScript checks passed.

## 3. Shelf activity
- [ ] Open activity by default while keeping the existing trader view accessible. Combine finalized contract openings with locally saved, verified app receipts. Scope by account and deployment, and leave unknown timestamps and hashes absent. Add a Details view and explorer links for verified hashes.
- [ ] Verify connected and disconnected views, detail navigation, wallet changes, retained receipts and mobile layout. Run Rust, TypeScript, Vitest, browser, and production build checks.

## 4. Testnet handoff
- [ ] Read the live USDI and v1 case configuration and inventory; check proposed account IDs without creating them. Record prerequisites for deploying and funding the new case and three mock tokens.
- [ ] Commit verified milestones. Stop at the deployment review, with separate approval required for each on-chain action.

## Testnet deployment review

Public read-only checks at finalized blocks 276971050–276971051 verified USDI at `usdi-needmore-1-near.testnet` and the USDI-only case at `cases-needmore-1-near.testnet`. The case had 995.8 USDI available, 0.2 USDI in vested fees, and 996 USDI in its token balance. The public history for `needmore_1_near.testnet` contained four completed openings. The legacy case does not expose `get_reward_inventory`.

The public Testnet RPC returned `UNKNOWN_ACCOUNT` for `iroh-test-shitzu.testnet`, `iroh-test-rhea.testnet`, `iroh-test-aurora.testnet`, and `iroh-dragon-tea-v2.testnet`. These are proposed account IDs, not deployed addresses. The frontend continues to use the existing case configuration.

1. Review and authorize account creation separately. Use a dedicated locally held key for each account. Only public keys are needed in the account-creation transaction.
2. For each mock, review the WASM deployment and initialization actions before signing. The account signs the private initializer `new({"asset":"SHITZU","owner_id":"needmore_1_near.testnet"})`, with `RHEA` or `AURORA` for the other instances. The initializer allocates a fixed supply of 100,000 units with six decimals to the inventory owner. There is no subsequent mint method.
3. Review a fresh case deployment and private `new_with_rewards` initialization. Use the existing USDI address, review the owner and treasury IDs, and pass the mock contracts in SHITZU, RHEA, AURORA order. Approve the deploy and init actions together before an atomic submission. This WASM has a different state layout from the deployed USDI-only case. Install it on the new account only.
4. Review the storage registrations and each `ft_transfer_call` funding transaction separately. A proposed review budget is 1,000 USDI, 5,000 SHITZU, 500 RHEA, and 100 AURORA. The 1,000 USDI starting pool retains the original odds benchmark and each bonus allocation covers 100 possible payouts of its token. Existing reserves are not moved. Confirm actual on-chain balances and the new `get_reward_inventory` accounting before pointing the app at the new case.
5. Record all deployed addresses, code hashes and transaction hashes after confirmation. The current app config continues to target v1 until a separate cutover.

Both rewards are sent via independent token transfers and reconciled in a single callback. A partially paid opening holds only the unpaid reserve. Fees vest only when all selected rewards settle. If a bonus transfer fails because the recipient lacks token storage, the Host exposes the registration cost, a registration action and a payout retry. Unfunded inventory blocks acceptance and leaves the original payment refundable. Unsolicited direct token transfers do not increase the book reserve.

The Shelf reads the active case's recent finalized openings and browser receipts verified against the original action. It does not index unrelated transfers or synthesize hashes or timestamps for legacy case records. Receipt history is scoped to the account and case deployment, and is local to the browser. Purchases already represented by a matching verified receipt are joined to the contract record by nonce. Claims or failures from another browser session require an indexer or previously saved receipt.
