# Dragon Tea Case Testnet launch checklist

Work on `feature/usdi-dynamic-case-pool`. The existing simulations and Sandbox
notes remain the reference for the reward formulas and accounting invariants.
The wallet owner approves each public transaction separately.

- [x] Verify USDI on the official NEAR Testnet RPC. At finalized block
  `276780155`, `usdi-needmore-1-near.testnet` had the reviewed WASM SHA-256
  `1d7dadcfacdb79ec66c0990c74cc0089b5ee2acce0409937637d6eaefed2b343`, symbol
  `USDI`, six decimals, and 1,000 USDI in circulation, all held by
  `needmore_1_near.testnet`. That account had yet to claim its starter bonus.
  [Deployment transaction](https://testnet.nearblocks.io/txns/F9EeNVXavsUGem5dkEkXVoPcNDv1YQN2EnHfHshYC7cF)
- [x] Check the proposed case account. The same block returned `UNKNOWN_ACCOUNT`
  for `cases-needmore-1-near.testnet`, and USDI reported no storage registration
  for that ID. The live NEP-145 minimum was 0.00125 test NEAR.
- [x] Verify claims, duplicate rejection, funding, settlement, stale quotes and
  payout recovery on a local Sandbox chain using the existing contract artifacts.
  The live USDI WASM exports `claim_starter` and `has_claimed`. The live quote was
  0.00381 test NEAR for an unregistered claimant, including registration and the
  permanent claim marker, and 0.00256 for an already registered claimant.
- [x] Rebuild the case WASM with the pinned Rust 1.99.1 toolchain, locked
  dependencies and the MVP WASM target. The fresh build's SHA-256 was
  `ca7bcdef4d3640339318c4589808213df8f8de959de09210770f91e062e2c2aa`.
  The build used a separate target directory to retain the existing artifacts.
  All 57 Rust tests, 328 frontend unit tests and four deployment-helper tests
  passed. The existing Sandbox runner also passed with this rebuilt case WASM
  and the exact USDI WASM deployed on Testnet, including six settled openings.
- [x] Create the dedicated case key and review the faucet transaction. The
  [local Swift helper](../scripts/create-case-key.swift) writes one generic
  password item to the user's default file-based Keychain. Its service is
  `near-testnet-cases-needmore-1-near.testnet` and its account attribute is
  `cases-needmore-1-near.testnet:<public-key>`. It prints the public key after a
  successful save. Run the helper yourself and share only that public key.
- [x] Create the account through the approved Testnet faucet request. At
  finalized block `276784042`, official RPC confirmed a 10 test NEAR balance,
  no deployed code, and one FullAccess key,
  `ed25519:7mkuqApHc4Da4mzL4Xn3jBatX2o49nkJfxYAAoP9puMc`. The faucet paid
  0.0071149895375 test NEAR in total burned fees. The exact local Keychain
  service and account attributes were found without retrieving item data.
  [Faucet transaction](https://testnet.nearblocks.io/txns/7Yz9MaSEvs6fW592hyFxPNy46wCQLXEmNdBH8wavuH9T)
- [x] Verify the approved case deployment. The transaction finalized at block
  `276785095`, signed by the reviewed FullAccess key. The deployed WASM
  matched the reviewed SHA-256. At finalized block `276785217`, public RPC
  confirmed `owner_id` and `treasury_id` `needmore_1_near.testnet` and
  `token_id` `usdi-needmore-1-near.testnet` in stored state. `get_case`
  confirmed the 1 USDI price, 0.95 pool contribution, 0.05 treasury fee, and
  the three expected rewards. The pool started empty with a 1,000 USDI target.
  The fee was 0.0032480799795832 test NEAR and account storage was 424,000 bytes.
  [Deployment transaction](https://testnet.nearblocks.io/txns/7tEmfRgXSpjHQmB3orkh66cWqck1hz7bLt5VhaEhM5hQ)
- [ ] Review and approve USDI storage registration for the case account and the
  separate authenticated funding transfer of exactly 1,000 bootstrap USDI.
  Verify the actual FT balance, pool accounting and 1,000 USDI target.
- [x] Configure the frontend with both verified Testnet IDs. A Chromium check
  using a simulated wallet and live read-only RPC showed the 1,000 USDI balance,
  starter eligibility and the unfunded pool. Opening remained disabled. The
  six case browser tests and 328 frontend unit tests passed after fixing the
  browser `fetch` invocation.
- [ ] Verify the funded frontend with a real HOT Connect wallet, including odds,
  health, claim and balance, history and refresh recovery.
- [ ] Verify a real fresh-wallet Testnet claim and duplicate rejection, then a
  1 USDI opening, final reward, pool contribution and treasury fee. Test safe
  wallet failure paths and use Sandbox for disruptive failure injection.
- [ ] Record the final transaction links, costs, evidence and remaining limits.

Starter eligibility is enforced permanently by the token contract per NEAR
account ID. Someone who controls several eligible Testnet accounts can claim
once from each. The starter tokens have no real monetary value.

## Pending Testnet transaction reviews

At finalized block `276780775`, the case account was still unused and the
owner still held the full 1,000 USDI bootstrap. These are planning estimates
from that block's gas price and protocol costs, including the full prepaid gas
budget. Recheck balances, fees and account state before each approval.

1. **USDI registration.** `needmore_1_near.testnet` calls `storage_deposit` on
   `usdi-needmore-1-near.testnet` with
   `{"account_id":"cases-needmore-1-near.testnet","registration_only":true}`.
   Prepay 30 Tgas and attach the live NEP-145 minimum, 0.00125 test NEAR at this
   block. The fee estimate is 0.003121 test NEAR.
2. **Bootstrap funding.** The same wallet calls `ft_transfer_call` on USDI with
   `{"receiver_id":"cases-needmore-1-near.testnet","amount":"1000000000","msg":"{\"action\":\"fund\"}"}`.
   Prepay 250 Tgas and attach one yoctoNEAR. The fee estimate is 0.025121 test
   NEAR. After finality, verify the actual USDI balance and `get_pool` both show
   1,000 USDI with zero pending fees or reserved rewards.
