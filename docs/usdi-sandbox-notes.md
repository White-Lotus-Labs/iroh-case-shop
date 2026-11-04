# Local NEAR Sandbox receipt verification

The integration runner uses `near-workspaces = 0.24.0` and its local NEAR
Sandbox 2.14.0 node. It ran successfully on Darwin arm64. This is a genuine
local chain executing the compiled contract wasm, cross-contract receipts,
protocol randomness, transfers and callbacks. It is not a public Testnet
deployment or public-network verification.

Build the wasm before running the integration:

```sh
bash scripts/contracts.sh build
bash scripts/contracts.sh integration
```

The scripts support `IROH_CARGO_BIN` for an explicitly installed Cargo binary.
This verification used the isolated `/tmp/iroh-contract-toolchain` toolchain
and Cargo cache. Neither the runner nor the scripts need a saved wallet or
public-network account. The Sandbox binary downloads from NEAR's official
artifact host on its first run, which requires network access. Runtime RPC
requests go to the newly started local Sandbox.

The runner creates a fresh `testnet` namespace with a newly generated in-memory
key, then creates `owner.testnet`, `usdi.testnet`, `case.testnet`,
`treasury.testnet`, `alice.testnet` and `bob.testnet` on that local chain. This
satisfies the contracts' `.testnet` initialization checks. These names are not
evidence of any corresponding public Testnet deployment. The node's generated
validator material belongs to its temporary local chain. No user wallet keys
or credential files are accessed. The Sandbox download cache remains in the
runner's Cargo build output because `global_install` is not enabled.

The runner has an independent Cargo workspace and lockfile. Resolving it inside
the contract workspace fails because near-sdk 5.29.1's unit-testing dependency
near-crypto 0.37 pins aws-lc-rs 1.16.2, while near-workspaces 0.24.0 uses
near-crypto 0.38 and aws-lc-rs 1.18.2 or newer. Their native library links cannot
coexist in one Cargo resolution. Separating the runner preserves the exact
maintained SDK and current Sandbox runner versions.

The successful run checks:

- Exactly 1,000 USDI bootstrap supply, its owner balance, and token metadata.
- Standard receiver storage registration and actual bootstrap token funding
  through `ft_transfer_call`, rather than a synthetic pool reserve.
- Actual starter claims, permanent eligibility markers, and failed duplicate
  claims with unchanged balances and supply.
- Native NEAR game storage prepayment using on-chain cost views.
- A quoted opening, later random draw receipt, actual USDI reward transfer,
  callback completion, cleared active opening and exact user balance.
- Full refunds for a wrong payment amount and stale quote, without pool,
  fee or user-balance changes; rejection of a forged direct FT receiver call.
- Multiple accounts and repeated openings with exact reward and fee accounting.
- Two simultaneous payments at the same quote revision. Exactly one payment
  is consumed and the other is fully refunded after its quote becomes stale.
- A deterministic actual payout failure. One transaction batches a valid
  `ft_transfer_call` followed by forced FT storage unregistration, before any
  receiver receipt can execute. The later payout fails because its recipient
  is unregistered. The reward remains funded and Claimable, the fee remains
  escrowed, and unregistration does not restore faucet eligibility. Standard
  re-registration and `retry_payout` complete the same frozen draw on attempt 2,
  with one reward and one fee. The test separately accounts for the standard
  forced-unregistration burn of the user's remaining token balance.
- At quiescence, the real game token balance equals pool funds plus escrowed
  and vested fees. Reservations, active payments and in-flight transfers clear,
  and the published reconciliation bounds equal the actual balance.

Six openings completed in the final successful run, including the confirmed
failure and retry. All assertions passed. Reward values vary with genuine
local protocol randomness; the runner validates each value and exact resulting
balances rather than assuming a fixed draw.


The parent rerun also uses the frontend's exact gas budgets:50 Tgas for starter
claims,30 Tgas for game storage,250 Tgas for ordinary FT purchase/funding calls,
and150 Tgas for payout recovery. All receipt assertions passed with these limits.
