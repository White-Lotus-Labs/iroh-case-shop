# Bounded Testnet deployment review

The user approved the exact batch with SHA-256 `4cf07ab44a6dcf3f9aedf970c938808ec2bcb61e6e21fec959bf36d859db5cc9` once funded. The approval record is `approval.json`. Funding is now sufficient at 109.108852 test NEAR. Two independent Dragon storage registrations are finalized; the remaining owner-dependent steps are blocked because the existing owner signer is unavailable to the CLI. The separately authorized SHITZU registration is already finalized. The manifest bytes remain unchanged.

The exact machine-readable proposal is `deployment-batch.json`. `deployment-batch.sha256` pins its serialized bytes. Rebuild with `node scripts/multi-case/prepare-batch.mjs` only when source, keys, artifacts and the latest public preflight are final. Any change to the reviewed JSON requires reviewing its new checksum. The generator never signs, retrieves secrets or sends transactions. `deployment-commands.txt` contains individual CLI templates, not a runnable deployment script.

## Accounts and scope

The inventory owner, parent and treasury are `needmore_1_near.testnet`. USDI remains `usdi-needmore-1-near.testnet`. Dragon remains `cases-needmore-1-near.testnet`. Existing token accounts `iroh-test-shitzu.testnet`, `iroh-test-rhea.testnet` and `iroh-test-aurora.testnet` are not redeployed or granted new keys.

Nine new fixed-supply token subaccounts are `blackdragon`, `neko`, `mpdao`, `gear`, `purge`, `wnear`, `stnear`, `linear` and `rnear`, each under `.needmore_1_near.testnet`. Four new case subaccounts are `bamboo`, `moon`, `phoenix` and `reserve`, under the same parent. The thirteen dedicated public keys are listed in `config/deployment-keys.testnet.json`. Each private credential was generated directly into its own macOS Keychain service. It was never printed or written to a project file.

Each new token account receives 5 test NEAR. Each new case account receives 7 test NEAR. These amounts cover code and account storage with native balance remaining for future gas. The account creation actions add one dedicated FullAccess key to a new account only. The existing owner and case permissions are unchanged.

Deploy and initialize each account atomically in one receipt signed by that same account. Token initialization uses `new` with the exact asset enum and existing inventory owner, allocating 100,000 whole mock units with registry decimals. Case initialization uses `new_configured` with the complete immutable case configuration. New cases start paused.

## Funding and activation

New USDI pools receive 50 Bamboo, 150 Moon, 300 Phoenix and 500 Reserve USDI, exactly 1,000 USDI total. Target liquidity is an economic reference, not a claim that these pools start at target. Each bonus inventory receives 100 possible payout quantities. Dragon receives the original 5,000 SHITZU, 500 RHEA and 100 AURORA. Every raw token amount and recipient appears separately in the manifest. Mock quantities carry no USD valuation.

Register each new case with USDI and its configured reward tokens using exactly 0.00125 NEAR and 30 Tgas per registration, conditional on matching live NEP-145 bounds. The approved SHITZU registration on Dragon is already finalized and omitted. Dragon still needs RHEA and AURORA registrations.

Pause Dragon at its reviewed revision, record a fresh raw-state and balance snapshot, then atomically deploy the reviewed new WASM and call `migrate_v1`. The proposal expects V1 revision 13 before pausing, revision 14 after pausing and passes `expected_revision:"14"`. Any intervening opening or admin operation changes that prerequisite and blocks this migration. Preserve every legacy opening, credit, USDI book and inventory identity. Funding and unpausing follow only after finalized verification.

## Expenditure and execution gates

The manifest gives exact deposits, prepaid gas, a gas-price ceiling of 1,000,000,000 yoctoNEAR per gas, and a separate maximum 0.1 NEAR protocol action-fee allowance per transaction. Re-estimate protocol action fees before signing and stop if this allowance would be exceeded. Its aggregate ceiling conservatively adds all deposits and all signer fees; fees on newly funded accounts therefore have extra budget margin. Attached account funding remains on the dedicated contract accounts.

The original preparation snapshot had about 24.1089 test NEAR and 1,004 USDI. The fresh execution snapshot has 109.108852 test NEAR, which covers the reviewed ceiling. The immutable manifest retains its historical preparation-time funding flag; current funding and execution status are recorded separately in `execution-preflight.json` and `execution.json`. No unspecified faucet or funding operation is added to this authorization. The batch consumes 1,000 existing USDI and the explicitly listed mock quantities.

After approval, execute only the exact included actions in dependency order, checking finalized results after each. Stop the affected chain on changed code, keys, revision, storage bounds, funding amount, unresolved transfers or ambiguous finality. Never blindly resubmit. Independent preparation remains safe while approval or funding is pending.

The proposal excludes user openings, starter claims, treasury withdrawals, transfers to unknown recipients, existing-token upgrades and Mainnet operations. Real HOT signing and new public Testnet opening/payout proof remain follow-up verification after deployment approval. Do not mark new cases verified-live based on local tests or account creation alone.
