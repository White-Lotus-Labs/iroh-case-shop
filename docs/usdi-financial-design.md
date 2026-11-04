# USDI and Dragon Tea financial design

All contract balances are unsigned integers. One USDI is 1,000,000 base units.
USDI is an unbacked Testnet currency with no real monetary value.

## Exact economics and rounding

The user-specified continuous model, with A measured in whole USDI, is:

```text
E_target(A) = clamp(0.95 + 0.0005 * (A - 1000), 0.60, 1.40)
p_legendary(A) = clamp(0.05 + 0.0001 * (A - 1000), 0.01, 0.15)
p_rare(A) = (E_target(A) - 0.10 - 4.90 * p_legendary(A)) / 0.90
p_common(A) = 1 - p_rare(A) - p_legendary(A)
```

The shared Rust implementation receives A in token base units, caps its input
at 2,000,000,000 before arithmetic because both curves are flat thereafter, and
uses denominator D=1,000,000:

```text
E = clamp(450000 + floor(A / 2000), 600000, 1400000)
legendary = clamp(floor(A / 10000) - 50000, 10000, 150000)
rare = floor((E*D - 100000*D - 4900000*legendary) / 900000)
common = D - rare - legendary
```

A negative intermediate legendary expression is saturated before its lower
clamp. No balance or outcome decision uses floating point. All tiers stay
positive, each remains at most D, and their sum is exactly D. The test sweep
checks every 2,000-unit breakpoint and its neighbors through the entire
nonconstant domain, plus all clamp boundaries and u128::MAX.

The rare floor introduces less than 0.9 token base units of EV loss. Flooring
the target adds less than one base unit. Total departure from the continuous
curve is below 1.9 base units, or 0.0000019 USDI of expected reward. The common
tier absorbs the probability remainder. At A=1,000 USDI:

```text
common = 277778 / 1000000
rare = 672222 / 1000000
legendary = 50000 / 1000000
actual expected reward = 0.9499998 USDI
```

The resulting upward expected drift at that exact point is 0.0000002 USDI per
accepted opening. Very close to the target, within at most 0.0038 USDI of reserve,
rounding can dominate the continuous drift's sign. Outside that quantization
band, the expected drift points toward the target: contribution minus expected
reward is positive below it and negative above it. No economic parameter was
changed to improve the simulation.

## Accounts and token issuance

`iroh-usdi` delegates NEP-141 transfers/resolution, NEP-145 storage and NEP-148
metadata to near-contract-standards 5.29.1. The exact near-sdk version is also
5.29.1. Initialization on a .testnet contract mints a finite 1,000 USDI bootstrap
to the owner. There is no callable arbitrary mint method. A permanent claimed
map permits one additional 1,000 USDI allocation per predecessor account.

Claims prevalidate native storage payment and supply overflow, register the
account if needed, mint and mark claimed atomically, emit events and refund
excess. Standard unregistering cannot remove the separate permanent claim map.
Current costs are 0.00381 NEAR when unregistered and 0.00256 NEAR when already
registered; `claim_storage_cost` is authoritative. The FT registration component
remains refundable under NEP-145; the permanent claim-marker cost stays locked.

One account can claim once. One person can create many accounts, so this faucet
has no real-value Sybil resistance.

## Payment, odds and lifecycle

The game starts with zero USDI book reserve. Only an authenticated USDI
`ft_transfer_call` with an owner/treasury `fund` message can credit bootstrap
liquidity. The administrator must actually transfer its bootstrap USDI.

For purchases the receiver validates the official token predecessor, exact
1,000,000 amount, `dragon-tea`, the account's next nonce, current quote revision,
block expiry, storage credit, pause state, available liquidity and concurrency.
There is no caller-supplied player authorization: the token's sender is the player.
Rejected payments return their full amount to the standard FT resolver.

For a valid purchase, before the payment contribution changes the quote:

1. Freeze that exact probability vector and its revision in the opening.
2. Credit P by 950,000, escrow 50,000 fee units and reserve 5,000,000 in L.
3. Require P>=L, assign a unique global ID and the next account nonce.
4. Persist the opening and schedule a detached private future draw receipt.
5. Return immediate U128(0) to consume the payment.

That immediate receiver result is important. A later detached draw or payout
failure cannot turn the original purchase into both a payout and a refund.
If the receiver receipt itself fails, its state and newly scheduled promises
roll back atomically and the standard resolver refunds the payment.

The private draw runs only after the acceptance block. It binds protocol
randomness to the contract, opening ID and acceptance height and uses bounded
rejection sampling to avoid modulo bias. The reward is stored permanently.
The maximum reservation becomes the actual reward, and payout starts with a
private attempt-bound callback:

```text
RandomnessPending -> Paying -> Completed
                         \-> Claimable -> Paying (same stored reward)
```

A successful callback decreases P and L by the reward, vests exactly 50,000 fee
units and clears the active opening. A confirmed failure leaves the reward
funded in L and the fee escrowed. A retry never redraws. Duplicate or stale
callbacks cannot complete the same payout twice. An unknown or oversized token
result leaves the transfer unresolved; a Paying transfer is never retried just
because time elapsed.

## Liquidity, fees and receipt reconciliation

A=P-L is always nonnegative. A new opening cannot spend another opening's
reservation. All three advertised rewards remain affordable; no tier is removed
after payment or silently replaced after the draw.

Health depends on available liquidity, not users:

- Healthy: A>=800 USDI; at most 64 unresolved openings.
- Caution: 500<=A<800 USDI; at most 16 unresolved openings.
- Critical: A<500 USDI; at most 4 unresolved openings.

A must also be at least 5 USDI before admission. There is at most one unresolved
opening per account. Existing obligations remain funded when health falls; the
limits govern new admissions. The target remains 1,000 USDI even if users grow
from 1,000 to 5,000. Manual pause also refunds new purchases.

Platform assets never enter P. Pending fees become withdrawable only after
payout completion. One separately tracked treasury withdrawal can be in flight;
its failure restores the vested balance once, and its callback is private and
attempt-bound. There is no administrator pool withdrawal method.

For accepted and fully processed inflows, the book balance is P plus escrowed
fees plus vested fees plus any pending treasury withdrawal. Outgoing token
receipts can change the FT account before their callbacks update game books.
The view publishes the in-flight amount and the book-derived lower/upper range
for that outgoing-only uncertainty. At quiescence, ordinary funded flows
reconcile exactly to the actual FT account, as the Sandbox test demonstrates.

These are not universal bounds on arbitrary external transfers. An incoming
FT transfer can credit the token account before the game receiver runs, and a
rejected transfer remains there until the standard resolver refunds it. Those
unprocessed receipts belong to the token's transfer/resolver lifecycle. Direct
unsolicited `ft_transfer` donations can also create an unallocated positive
surplus; they do not credit P or become spendable reward liquidity. Audit such
surpluses separately against FT events and receipt state. Neither an unprocessed
inflow nor a donation lets the game promise unsupported funds.

Game native storage is separate from USDI price: 256 bytes for the account and
2,048 per persisted opening, with actual growth checked against the conservative
budget. Credits are not withdrawable in this prototype. History traversal is
bounded to 20 entries per view and every opening is prepaid. The contract also
needs native operating balance for one-yocto token calls.

## Frontend and security limits

The existing HOT Connect singleton and root wallet provider are retained.
Every payable call rechecks Testnet support, account membership and whether
its requesting component/account is still current. Balances, claim eligibility,
quotes and rewards come from finalized contract views. Accepted odds and results
are read from persisted openings; no animation selects a reward.

Public pending intents persist the exact call and a finalized block boundary
before a wallet can redirect. Recovered hashes must match signer, receiver,
method, decoded arguments, deposit and gas, and must be included after that
boundary. Finality checks request FINAL. Timeouts preserve the intent and never
resubmit. Local storage is not used as claim eligibility or balance authority.

Protocol block randomness is not a production VRF. Validators can manipulate
ordering or withhold blocks; recovery timing also creates limitations. An unknown
payout callback is intentionally fail-closed rather than risking a second
transfer. Deployment accounts remain user-controlled, so retained upgrade keys
are another prototype trust assumption. No real-money use is supported.

Official references:
[SDK](https://docs.rs/near-sdk/5.29.1/near_sdk/),
[standards](https://docs.rs/near-contract-standards/5.29.1/near_contract_standards/),
[NEP-141](https://github.com/near/NEPs/blob/master/neps/nep-0141.md),
[NEP-145](https://github.com/near/NEPs/blob/master/neps/nep-0145.md),
[NEAR randomness](https://docs.near.org/smart-contracts/security/random).
