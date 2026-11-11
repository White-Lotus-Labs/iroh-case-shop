# Randomness, committed outcomes and known limits

The contract calls `near_sdk::env::random_seed_array()` in a receipt after the paid opening's accepted block. The [NEAR SDK source](https://github.com/near/near-sdk-rs/blob/master/near-sdk/src/environment/env.rs) describes this as the current block's 32-byte seed, based on the block VRF value and unchanged within that method or block. [NEAR's randomness guidance](https://docs.near.org/smart-contracts/security/random) describes the security context. A protocol seed is not an application-specific VRF proof.

## What the implementation commits

Admission records the account, opening ID, monotonically increasing per-account nonce, accepted height, revision and exact tier probability counts. The payment must match the case, price, quote revision and expiry. The receiver consumes an accepted payment synchronously, so a later detached payout failure cannot cause the NEP-141 resolver to refund an accepted opening.

The later resolver hashes the protocol seed with the current contract account, opening ID and accepted height. It takes a 64-bit hash prefix and rejects the incomplete upper interval before reducing modulo 1,000,000. This removes modulo bias assuming uniform hash input. It tries four domain counters. If all four reject, the opening remains undrawn and requires later recovery. No funds are released and no fee vests on this path.

A separate hash domain selects the 50% bonus bit. Configured cases use another domain for a uniform candidate choice within the selected tier. That choice also rejects incomplete intervals. Failure to obtain a candidate leaves the opening undrawn. Dragon's original bonus bit and one-token-per-tier mapping remain unchanged.

The resolver stores USDI amount, draw, selected candidate and immutable payout state before sending transfers. A callback for a stored Paying, Claimable or Completed opening cannot select a new result. Payout retries do not call any randomness function. The callback requires the matching attempt and outstanding transfer count. A stale callback cannot settle a retry or release funds twice.

## What users and validators can influence

Users choose when to submit a payment, their account and quote, and whether to request recovery for an undrawn opening. They cannot supply the protocol seed, pick their opening ID directly, alter accepted probabilities or redraw a selected reward through the public ABI. The frontend reel receives the recorded outcome and does not choose rewards.

Validators and receipt scheduling affect the block in which the resolver runs. A validator with foreknowledge of a seed may influence inclusion, ordering or censorship. Any public recovery call for an undrawn opening can schedule an additional resolver; whichever eligible resolver executes first records the outcome. The contract does not precommit a fixed future block's seed and cannot retrieve a historical seed. A proposer or user with predictive knowledge and scheduling influence is therefore outside the unbiased-draw assumption.

The original four-attempt rejection path can also defer to a different later seed, although the probability under uniform 64-bit samples is extremely small. Hashing an account, ID and height separates openings; it does not remove validator influence or turn a known seed into secret randomness.

The 50% bonus bit and candidate selection are domain separated, but claims of statistical independence still assume SHA-256 behaves as a random oracle for these inputs. Simulations use a separate deterministic test PRNG and do not prove the chain RNG's distribution or resistance to manipulation.

## Security scope

This remains an explicitly labeled NEAR Testnet demonstration. The implementation guarantees one stored result per accepted opening and no redraw on payout retry. It does not claim adversarially unbiased gambling fairness, an application VRF proof or resistance to a malicious block proposer. Production use with assets of value requires a separately reviewed randomness design, such as a verifiable service or a carefully bounded commit/reveal protocol, and new deployment approval.

## Verification

Rust tests exercise same-block rejection, deferred selection, frozen odds after pool changes, duplicate resolver calls, private callbacks, stale payout attempts, both payout-leg failure permutations, unchanged draws on retry and exactly-once fee vesting. Configured cases also test uniform candidate indexing through their recorded token identity, full pre-draw reservations and release of unselected liabilities.

The Sandbox collection runner executes the five case paths with real local receipts and actual NEP-141 balances. It verifies a selected bonus payout and a configured case's real token transfer failure, then confirms that recovery pays only the failed token with the original stored draw. The migration runner additionally uses the captured deployed V1 WASM and raw state to test legacy recovery. Local Sandbox tests do not prove a live wallet's signing or public Testnet activation.
