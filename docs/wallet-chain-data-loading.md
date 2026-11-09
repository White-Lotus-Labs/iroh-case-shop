# Wallet chain data loading incident

## Diagnosis

The Host and standalone Cases shared a controller that published wallet data only after a single aggregate refresh. A held `get_history` request on the base branch kept the wallet balance at the placeholder even when `ft_balance_of`, `has_claimed`, and pool reads had completed. The interval also started a new refresh every 12 seconds and aborted the previous one, whose per-request deadline was 15 seconds. With a request held across repeated polls, the obsolete refresh could neither publish partial data nor surface its timeout. The receipt check ran after the same aggregate read, and a wallet approval in progress blocked refreshes.

The configured `rpc.testnet.near.org` endpoint returned HTTP 429 with an explicit deprecation notice during the incident investigation. [NEAR's deprecation notice](https://www.near.org/blog/deprecation-of-near-org-and-pagoda-co-rpc-endpoints) documents the reduced limits. The replacement [FastNear Testnet RPC](https://docs.fastnear.com/rpc) returned finalized contract state and accepted browser CORS preflights.

## Read-only Testnet verification

- `usdi-needmore-1-near.testnet` is deployed with code hash `2z7yWfap6hkGAcow7xFKRghGWv7Uq1uea3Vn7HV6QuaJ`.
- `cases-needmore-1-near.testnet` is deployed with code hash `EdQrCQ4CDhFLJfJpPxShQVCj1K9DdfF4Cf3z247yh3ow` and identifies the USDI contract as its token.
- At finalized blocks 276961992–276961998, `needmore_1_near.testnet` held 1,000 USDI, `has_claimed` was true, and the case contract reported no active or historical opening for that account. The pool was Healthy with 1,000 USDI held and available, zero reserved rewards, and zero completed payouts.
- The [starter claim receipt](https://testnet.nearblocks.io/txns/GyQLbawAKPGjvmaL767yUFGYdgvY3r8nSonpMUsDoxvH) was independently confirmed through Testnet RPC with status `FINAL` and a USDI mint log for 1,000 USDI to the signer.
