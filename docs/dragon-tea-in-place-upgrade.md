# Upgrade Dragon Tea Case in place on NEAR Testnet

This runbook records the original in-place migration rehearsal for `cases-needmore-1-near.testnet`. The November 11 expansion request supersedes its per-transaction approval policy with one fully specified bounded batch. Use [the current deployment review](multi-case/deployment-review.md) and its exact manifest checksums for new signing approval. The candidate sizes and checksums below are historical rehearsal evidence, not authorization for the current rebuilt artifact. Prepare fresh public RPC checks before signing.

The previously approved SHITZU registration finalized on November 11, 2026 as transaction `9oNjXJASSDQgdu3vh4eZuZYMgkiW1fLpcnkaftEksvPq`. Its exact parameters, finalized receipts and storage balance are recorded in `docs/multi-case/shitzu-registration.json`. The bounded batch has since been approved and funded. RHEA registration finalized as `GCW9EVoGZ8uuZWvkvrMdoNcbrmAEngtDXFfJggUbXMoQ`, and AURORA registration as `5HsUXkbmwobiuCFqwPuRqLWDgmti2Sa7uQKvARQ1wANn`. Pausing, migration, funding and unpausing remain unsubmitted because the existing owner signer is unavailable to the CLI. See `docs/multi-case/execution.json` for verified progress.

## Read the baseline

The audit pinned finalized block `277099127`, hash `6r6fS61CxAQxXBEquBmgGDxAQXm8DsssSMaQ7RNfHScn`, on November 10, 2026. The official RPC supplied the code and trie snapshots. Two additional views used FastNear at the same block after rate limiting.

- The case code hash is `EdQrCQ4CDhFLJfJpPxShQVCj1K9DdfF4Cf3z247yh3ow`. Its WASM SHA-256 is `ca7bcdef4d3640339318c4589808213df8f8de959de09210770f91e062e2c2aa`. The account held approximately 10.089 native NEAR and used 424,792 storage bytes.
- The stored owner and treasury are both `needmore_1_near.testnet`. The USDI token is `usdi-needmore-1-near.testnet`, code hash `2z7yWfap6hkGAcow7xFKRghGWv7Uq1uea3Vn7HV6QuaJ`.
- The pool is Healthy and unpaused at revision 13, with next opening ID 4. Available and gross pool funds are 995.8 USDI, and vested fees are 0.2 USDI. The actual token balance and both book bounds equal 996 USDI. Reserved rewards, pending fees, pending openings, payouts in flight and treasury transfers in flight are all zero. The case storage has no active opening entry or unresolved transfer tracked by the contract. The USDI balance reconciliation also shows no unsettled difference at the pin.
- All four openings belong to `needmore_1_near.testnet`, completed on attempt 1. Opening IDs 0, 1, 2 and 3 paid 1, 1, 5 and 1 USDI respectively, with draws 494499, 282627, 980221 and 688758. Raw state matches public views. The same account holds 1,004 USDI.
- `iroh-test-shitzu.testnet`, `iroh-test-rhea.testnet` and `iroh-test-aurora.testnet` each expose six decimals, have the reviewed mock code hash `5heV1Yf3PxjMLWuyXowJoApj38rggW8GsCoScL6Sxidz` and hold a total supply of 100,000 tokens. The owner holds each full supply. The case account has no registration and a zero balance on each mock. Their NEP-145 bounds all report `1250000000000000000000` yoctoNEAR as the minimum and maximum.

[Case account](https://testnet.nearblocks.io/address/cases-needmore-1-near.testnet) · [V1 launch record](dragon-tea-testnet-launch.md)

## Compare the storage formats

The case source in the verified V1 deployment is identical to `4ef8689` at Git blob `78202d830f9b1a7758cbbfb9aa48bf1de44b3992`. The previously reviewed bonus WASM expects a trailing `bonuses` root field and three extra fields on every opening. Deploying it alone would make both V1 root and V1 opening values unreadable. Calling either fresh initializer would conflict with existing state.

`migrate_v1` uses the original Borsh field order and types. It preserves the owner, token and treasury account IDs, USDI pool, reservations, pending and vested fees, payouts in flight, optional treasury transfer and its attempt counter, total paid, completed and pending counts, pause flag, revision and next ID. It advances revision once, so pre-upgrade quotes expire. It preserves the `a` active, `l` latest and `c` credit map handles and their values.

- V1 `o` stores Borsh `OpeningV1` rows with ID, account, nonce, previous ID, accepted height, revision, odds, status, reward, draw and attempt. The migration keeps those bytes. It appends a root `legacy_openings` option with the old map handle and the exclusive cutoff equal to V1's next ID. Lookup first checks the new `v` map, then reads `o` for IDs below the cutoff. New rows and updates to pending legacy rows go to `v`. Their previous IDs can refer to either map.
- The new `Opening` adds `bonus: Option<u8>`, `usdi_paid: bool` and `bonus_paid: bool`. V1 rows have no bonus. Only V1 `Completed` rows decode as already paid. V1 claimable or undrawn rows retain the one-leg USDI path and 60 Tgas retry. The migration requires payout and treasury transfers in flight to settle first. It also requires paused admission and an exact V1 revision.
- The new root `bonuses` option stores three `Inventory` entries in Common, Rare and Legendary order. Each stores the token account ID and three `u128` counters for funds, reserved, and in flight. The migration initializes all counters to zero. Neither this catalog nor the new opening map requires a rewrite of V1 history.
- `Status` retains Borsh ordinal order `RandomnessPending`, `Paying`, `Claimable`, `Completed`. `TreasuryTransfer` retains its `u128` amount and `u64` attempt. `Payment` and `Authorization` use JSON and retain the same inputs. Near SDK and contract standards remain at 5.29.1, with the legacy `collections::LookupMap` prefix format and Borsh 1.8.1. The USDI contract's code and storage are outside the upgrade.

New openings reserve one possible bonus from each tier before accepting USDI. The draw uses the original tier odds and USDI amount. A separate random bit selects the tier's bonus 50% of the time. The contract releases unused reservations and tracks successful transfers per leg. Failed legs retain their reserves. The callback checks status and attempt, so a retry sends only the unpaid legs and a stale callback cannot settle twice. Fees vest only after all selected legs settle. Only the owner or treasury may fund inventory through a configured token's `ft_transfer_call` receiver path. Direct transfers do not credit inventory.

[Migration implementation](../contracts/case-pool/src/migration.rs) · [NEAR migration guide](https://docs.near.org/smart-contracts/release/upgrade)

## Register, pause, upgrade and fund

1. Submit three separate Testnet `storage_deposit` calls. The signer is `cases-needmore-1-near.testnet` using its local Keychain FullAccess key `ed25519:7mkuqApHc4Da4mzL4Xn3jBatX2o49nkJfxYAAoP9puMc`. The receivers, in order, are `iroh-test-shitzu.testnet`, `iroh-test-rhea.testnet` and `iroh-test-aurora.testnet`. Each call uses `{"account_id":"cases-needmore-1-near.testnet","registration_only":true}`, 30 Tgas and exactly 0.00125 NEAR attached. The estimated upfront gas reservation is 0.031 NEAR per call before refunds. Confirm each finalized `storage_balance_of` before continuing.
2. Have `needmore_1_near.testnet` sign `set_paused({"paused":true})` on the case, with 30 Tgas and 1 yoctoNEAR. Use the existing owner wallet flow for owner transactions and the dedicated Keychain signer for the case account. Wait for finality. Confirm V1 code, the paused state, and no in-flight payout or treasury transfer. Reconcile USDI against book bounds and review any recent payment and refund receipts. Capture the current revision, history, and raw state for comparison. A known claimable or undrawn legacy opening can carry forward with its USDI reserve. A stuck in-flight transfer blocks the migration.
3. Submit one Testnet batch from `cases-needmore-1-near.testnet` to itself using its Keychain FullAccess key. Deploy the 467,474-byte candidate at `contracts/target/wasm32-unknown-unknown/release/iroh_case_pool.wasm` and call `migrate_v1` with 100 Tgas and 0 NEAR attached. If pausing advanced the observed revision from 13 to 14 and it stayed at 14, the exact arguments are `{"reward_tokens":["iroh-test-shitzu.testnet","iroh-test-rhea.testnet","iroh-test-aurora.testnet"],"expected_revision":"14"}`. Use the actual finalized post-pause revision in the approval and preview. The reviewed SHA-256 is `db082224b8164fe07d2deca055e58fad16af97e5677849f748371b08ccdb2a51` and the expected code hash is `Fk1UnNnfL3h1n9uQRWJNFwMymY5XCebMXJb5ZNmA6fbn`. Sandbox used about 35.73 Tgas. At the observed gas price of 100,000,000 yoctoNEAR per gas, the expected fee is about 0.0036 NEAR, with about 0.132 NEAR reserved upfront. Estimated additional storage backing is about 0.442 NEAR from the account's existing balance. The two actions share a receipt. If migration fails, the receipt rolls back both actions and V1 remains paused. [NEAR transaction anatomy](https://docs.near.org/protocol/transactions/transaction-anatomy)
4. After the successful batch finalizes, verify the code hash and checksum, zeroed inventory with the exact token order, paused state and a single revision increment. Compare USDI balance, pool accounting, stored odds, IDs, nonces, credits, and all history fields with the paused snapshot. Check the public history and any active rows. A settled legacy opening should have its original draw and reward and no bonus.
5. While paused, have `needmore_1_near.testnet` fund the case in three separately approved Testnet calls. Each receiver is the token contract, and each call is `ft_transfer_call` with 250 Tgas and 1 yoctoNEAR. Use `{"receiver_id":"cases-needmore-1-near.testnet","amount":"5000000000","memo":null,"msg":"{\"action\":\"fund\"}"}` for SHITZU. Replace the amount with `"500000000"` for RHEA and `"100000000"` for AURORA. These are 5,000 SHITZU, 500 RHEA and 100 AURORA, enough for 100 possible payouts of each token. After each transaction, check all receipts and the resolver's used amount. Reconcile actual token balance with the matching `get_reward_inventory` record. The estimated upfront gas reservation is 0.251 NEAR per call before refunds. Use the unchanged USDI balance and book to check for unrelated changes. If any transfer is unresolved or partially used, wait and reconcile before proposing another.
6. Once all three registered balances equal their funded books and no transfer remains unresolved, have the owner call `set_paused({"paused":false})` on the case, with 30 Tgas and 1 yoctoNEAR. Verify a new quote can open where player storage and balance permit. Use read-only checks of Host and Shelf against the finalized account. A new live opening requires its own approval.

The checksum-guarded upgrade invocation for revision 14 is shown below for review. Update the revision only after rechecking the finalized paused case and receiving the exact transaction approval.

```sh
case_wasm=contracts/target/wasm32-unknown-unknown/release/iroh_case_pool.wasm
printf '%s  %s\n' 'db082224b8164fe07d2deca055e58fad16af97e5677849f748371b08ccdb2a51' "$case_wasm" |
  shasum -a 256 -c - &&
near contract deploy cases-needmore-1-near.testnet use-file "$case_wasm" \
  with-init-call migrate_v1 json-args '{"reward_tokens":["iroh-test-shitzu.testnet","iroh-test-rhea.testnet","iroh-test-aurora.testnet"],"expected_revision":"14"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet \
  sign-with-keychain --signer-public-key ed25519:7mkuqApHc4Da4mzL4Xn3jBatX2o49nkJfxYAAoP9puMc \
  send --wait-until final
```

## Rehearse and recover

From the repository root, fetch the pinned public snapshot and run the exact production artifact in a local Sandbox. The rehearsal creates local accounts and applies public contract data. It never imports the live account keys.

```sh
python3 scripts/fetch-dragon-tea-migration-snapshot.py /tmp/iroh-case-v1-snapshot
(cd contracts && RUSTFLAGS='-C target-cpu=mvp' cargo build --locked --release --target wasm32-unknown-unknown -p iroh-case-pool -p iroh-mock-token)
cargo run --locked --manifest-path contracts/integration/Cargo.toml -- /tmp/iroh-case-v1-snapshot
```

Sandbox checks the four copied V1 openings and 996 USDI reconciliation, refuses unpaused and stale-revision migrations, and proves a successful atomic migration preserves existing child records and indexes byte for byte. It forces a genuine V1 failed payout, migrates it, and pays it once with the original draw. It refunds a stale V1 payment and links a funded V2 opening to the old history with the expected nonce. It forces a real bonus transfer failure, confirms only that leg remains reserved, then registers the recipient and retries that leg without paying USDI again. Unit tests also cover undrawn V1 recovery and migration refusal while payouts or treasury transfers are in flight.

The frontend targets the same case and USDI accounts and reads bonus token IDs from the contract. The roulette uses the persisted draw and reward. Extended rows require explicit paid flags for each leg. Historical USDI-only rows remain valid and the Shelf shows only transaction hashes it has verified.

The production build, 64 Rust unit tests, 336 Vitest tests, the existing Sandbox suite, and the snapshot migration rehearsal passed. Chromium verified live V1 history and read-only recovery of a finalized claim. The bonus browser tests used fixtures with the deployed token IDs. The broad browser suite exposed existing account-page tests that depend on the absent `/account` route, so it is outside the passing verification set.

If the atomic migration fails, confirm the V1 hash and ledger before deciding whether to retry or request an approved unpause. After a successful migration, V1 code cannot deserialize the new root. A recovery deployment must understand the migrated state and any new openings and token liabilities. Treat the pre-upgrade snapshot as evidence, since replaying it would discard legitimate later transactions and cannot undo token transfers. If a check fails after migration, keep admissions paused, reconcile payouts and balances, and review a forward fix. The migration uses Testnet randomness as before. The upgrade rehearsal does not establish production-grade randomness or actual live wallet signing for the future owner transactions.
