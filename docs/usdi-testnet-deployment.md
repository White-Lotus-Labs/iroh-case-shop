# USDI Testnet deployment and manual verification

## Current public account status

The user proposed these IDs. A finalized public Testnet RPC query on
2026-11-04 at block 276242194 returned UNKNOWN_ACCOUNT for all four:

- Owner/admin and initial treasury: `pandacoderexe-admin.testnet`.
- Required parent: `pandacoderexe.testnet`.
- USDI contract: `usdi.pandacoderexe.testnet`.
- Case contract: `cases.pandacoderexe.testnet`.

They were not existing accounts at that check. This does not reserve their names;
recheck immediately before creating them. The active app configuration remains
null until genuine deployment and funding are confirmed.

## Build and verify before any signature

Use Rust 1.99.1, the pinned wasm target, Node 24 and pnpm. Install toolchain
components using rustup if not already available. Never source environment or
credential files for these scripts.

```sh
pnpm contracts:test
pnpm contracts:build
pnpm contracts:integration
pnpm contracts:simulate
pnpm test
pnpm typecheck
pnpm format:check
pnpm build
node scripts/usdi-deployment.mjs check
node scripts/usdi-deployment.mjs plan
```

The Rust scripts accept `IROH_CARGO_BIN` if Cargo is installed separately.
In this session Cargo/Rust caches were isolated in `/tmp/iroh-contract-toolchain`.
The plain pnpm Corepack shim failed offline; the installed executable is
`node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs`.

The build writes both wasm files under
`contracts/target/wasm32-unknown-unknown/release/` and prints their SHA256 hashes.
The planner reads those public binaries and public configuration only. It writes
an unsigned reviewable plan to `/tmp/iroh-usdi-deployment-plan.json`; it cannot
create accounts, sign or broadcast transactions. No private keys are needed.

## Create the accounts with explicit wallet approval

1. In a Testnet-capable wallet, create and fund `pandacoderexe.testnet` and the
   separate `pandacoderexe-admin.testnet` account. These are sibling accounts;
   the admin account cannot create children under the other parent by name.
   Use the wallet's supported Testnet named-account creation/faucet flow. If
   that wallet cannot create those names, use a supported Testnet account-creation
   service or Ledger-backed NEAR CLI account creation. Keep signing in the wallet.
2. From `pandacoderexe.testnet`, create `usdi.pandacoderexe.testnet` and
   `cases.pandacoderexe.testnet` as its children. Account creation requires the
   parent's authorization. Give each contract a user-controlled full-access
   wallet/hardware key through that wallet's account-creation flow, never by
   providing private material to the assistant or a repository script.
3. Fund each contract with enough Testnet NEAR for code storage, state and gas.
   Ten Testnet NEAR per contract is a conservative prototype starting balance;
   code storage alone is several NEAR at the protocol byte price. Inspect the
   actual balances and storage requirements before signing. Fund the admin for
   registration and operating calls too. These native balances are separate
   from the 1000 USDI reward pool.
4. Run the public availability check again. It must show these genuine accounts.
   If any already contains code, stop and review it before replacing anything.

No account-creation transaction has been authorized or submitted by this work.
The proposed public IDs are stored separately in `config/deployment.testnet.json`.
No account or access key is generated for public deployment by the scripts.

## Deploy and initialize atomically

The maintained NEAR CLI supports `use-file` followed by `with-init-call`, so
code deployment and initialization can be one transaction. Avoid deploying an
uninitialized public contract in a separate transaction that someone could initialize.

The unsigned plan contains exact argument arrays for the current official CLI.
For example, after selecting the USDI contract account in the signing wallet:

```sh
near contract deploy usdi.pandacoderexe.testnet \
  use-file contracts/target/wasm32-unknown-unknown/release/iroh_usdi.wasm \
  with-init-call new json-args '{"owner_id":"pandacoderexe-admin.testnet"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-later
```

For the game:

```sh
near contract deploy cases.pandacoderexe.testnet \
  use-file contracts/target/wasm32-unknown-unknown/release/iroh_case_pool.wasm \
  with-init-call new json-args '{"owner_id":"pandacoderexe-admin.testnet","token_id":"usdi.pandacoderexe.testnet","treasury_id":"pandacoderexe-admin.testnet"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-later
```

`sign-later` prepares an unsigned transaction; it does not deploy. The CLI's
current signing modes include hardware `sign-with-ledger`, which leaves the
private key on the device. If the contract accounts are Ledger-controlled,
replace `sign-later` with `sign-with-ledger` and complete its public derivation
path and on-device approval prompts, then select `send` only after explicit
approval of that transaction. For a browser wallet, use a wallet/tool supporting
DeployContract+FunctionCall for the selected contract account with the same
wasm and arguments. The app's ordinary game buttons intentionally expose
function calls, rather than account creation or arbitrary contract deployment.

Do not use CLI keychain, private-key-file, plaintext-key or mnemonic modes for
an assistant-controlled deployment. If no suitable wallet deployment signer is
available, deployment remains blocked until the user supplies that signing
capability. Account creation and each deployment require the user's explicit
approval even though all local build/test work is complete.

Official CLI command source and signing guide:
[deployment source](https://github.com/near/near-cli-rs/tree/main/src/commands/contract/deploy),
[signing guide](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md).

## Register and actually fund the pool

After both deployments have finalized:

1. Read USDI `ft_metadata` and `ft_total_supply`. Verify USD Iroh, USDI, 6 decimals
   and the finite 1,000 USDI bootstrap held by the admin.
2. Read USDI `storage_balance_bounds`; use its `min` yoctoNEAR to call
   `storage_deposit({account_id:"cases.pandacoderexe.testnet",registration_only:true})`
   from the admin wallet. This registers the pool's actual FT account.
3. From `pandacoderexe-admin.testnet`, authorize USDI `ft_transfer_call` with
   receiver `cases.pandacoderexe.testnet`, amount `"1000000000"`, msg
   `"{\"action\":\"fund\"}"`, one yoctoNEAR deposit and 250 Tgas.
   The unsigned plan includes this exact call. It transfers the bootstrap
   tokens; no method simply sets a fictional reserve.
4. Wait for FINAL receipts. Read USDI `ft_balance_of` for the case account and
   game `get_pool`. Both should reconcile to 1,000 USDI with no liabilities/fees.
5. Record the public transaction hashes and Testnet explorer links. No such
   hashes exist yet for this feature because public deployment was not executed.
6. Only after successful verification set `tokenContractId` and `caseContractId`
   in `config/contracts.testnet.json` to the confirmed proposed IDs, preserving
   network `testnet` and the official Testnet RPC. Rebuild the frontend.

## Test the player experience

1. Start with `DATABASE_URL=file:./dev.db NANSEN_API_KEY= pnpm dev` and open
   `http://127.0.0.1:3000/cases`. The key is deliberately empty; no environment
   file or existing secret needs to be inspected. Existing public deployment
   configuration is read from JSON, not environment variables.
2. Connect a supported Testnet wallet. Before deployment, the page honestly
   shows the deployment blocker and disables claims/purchases.
3. Once configured, inspect the real USDI balance and eligibility. Click
   **Claim 1,000 starter USDI** and review the wallet's native storage deposit/gas.
   `claim_storage_cost` is authoritative: currently 0.00381 NEAR when
   unregistered, 0.00256 NEAR when already registered. The claim registers and
   mints atomically, then refunds any excess. The claim marker is permanent.
4. Verify 1,000 USDI appears after finalized receipts. Refresh and verify the
   bonus remains claimed. A second on-chain claim must fail.
5. Prepay case storage through the page. Account storage is 256 bytes and each
   persisted opening budgets 2,048 bytes, currently 0.00256 and 0.02048 NEAR.
   Unused prepaid credit remains on-chain and does not count as USDI. There is
   no storage-credit withdrawal method in this prototype; the UI exposes costs.
6. Review price 1 USDI, the three reward amounts, current quote probabilities,
   expected reward, available reserve, health and 5% fee. Confirm **Open Case**
   in the wallet. Quotes use exact revision/zero slippage; competing changes
   cause a full token refund and require a fresh review.
7. Watch actual chain status. A reward appears only after the deferred on-chain
   draw. A completed reward requires a successful token transfer callback.
   Accepted odds are shown with the opening. Refresh/disconnect/reconnect must
   recover it through the contract. If wallet redirect omitted a transaction
   hash, supply the public hash from that wallet to resume FINAL verification.
8. Check balance change equals minus 1 USDI plus the actual reward. Check the
   pool changed by plus 0.95 USDI minus reward and matured treasury by 0.05 USDI.
   During ordinary asynchronous payouts use the displayed book reconciliation range;
   at quiescence ordinary funded flows match actual FT balances. Unprocessed incoming transfers and unsolicited donations are separate surplus, not reward liquidity.
9. If a recipient unregisters its FT account before payout, the opening becomes
   funded and Claimable. Use **Register USDI account** on the page, confirm the standard token
   storage deposit, then retry the payout. Registration never mints another
   starter allocation. The stored reward cannot change. Never retry a Paying
   transfer by timeout; an unknown callback is deliberately fail-closed.
10. Repeat and observe odds follow available funds P-L. The target remains
    1,000 USDI regardless of website user count. Reserve failure, risk limits,
    manual pause or insufficient USDI/storage blocks a new purchase.

## Remaining limits

The SDK randomness source is a later NEAR protocol block seed, bound to the
contract/opening/acceptance block and sampled without modulo bias. Validators
can influence ordering or withhold a block, and recovery timing is not a VRF.
This is a Testnet demonstration, not provably fair or production-grade gambling.

A callback that never executes leaves a transfer in Paying with funded book
liability. Vanilla FT transfers have no idempotency key, so no timeout-based
retry is provided. Confirmed failures are safely retryable; unknown outcomes
require receipt investigation. The contract must retain native NEAR operating
balance for its one-yocto token calls. History is prepaid and views are bounded.

One claim per account is not one claim per person; unlimited account creation
makes the faucet unsuitable for real value. USDI has no backing, redemption,
price oracle or real monetary value. Only Testnet is supported.
