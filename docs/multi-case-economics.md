# Multi-case integer economics and solvency

All money in this report is USDI with six decimals. Bonus token quantities have no assigned USD price. Canonical deployment inputs are in `config/cases.testnet.json`. The shared case WASM runs on independent contract accounts. Each account has its own USDI pool, fees, credits, openings, bonus books and payout liabilities.

## Prices, rewards and liquidity

Bamboo Mist costs 0.5 USDI. Common, Rare and Legendary rewards are 0.2, 0.5 and 4 USDI. Its target available liquidity is 250 USDI. This limits its maximum loss per opening to less than the premium cases and gives it a larger minimum reward relative to price.

Dragon Tea stays at 1 USDI, with rewards 0.1, 1 and 5 USDI and a 1,000 USDI target. Its deployed probability function is preserved exactly. Its Common, Rare and Legendary bonuses remain 50 SHITZU, 5 RHEA and 1 AURORA, conditional on the existing 50% bonus bit.

Moon Spirit costs 2 USDI, with rewards 0.1, 2 and 20 USDI and a 2,000 USDI target.

Phoenix Flame costs 5 USDI, with rewards 0.1, 3.5 and 100 USDI and a 5,000 USDI target. It has the widest maximum reward relative to price, at 20 times its price.

Uncle's Secret Reserve costs 10 USDI, with rewards 2, 15 and 120 USDI and a 10,000 USDI target. Its lower target Rare frequency and higher baseline reward distinguish it from Phoenix.

Every payment contributes exactly 95% to its case pool and 5% to a pending platform fee. Prices must be positive multiples of 20 base units, so this split has no rounding remainder. Inventory funding need not equal the target. A case can open at lower liquidity only if it can reserve its entire maximum reward before counting the incoming contribution. New configured cases start paused.

## Shared probability construction

Let `D = 1,000,000`, `A = pool - reserved`, `T` be target liquidity, `P` be price and `r0 < r1 < r2` be USDI rewards. Probabilities are integer counts in `[0,D)`.

Each new case specifies EV endpoint basis points `e0,e2` and Legendary counts `l0,l1,l2`. Clamp `A` to `2T`. On `[0,T]`, interpolate from `floor(P*e0/10000)` to `19P/20`; on `[T,2T]`, interpolate from `19P/20` to `floor(P*e2/10000)`. Each interpolation rounds downward in integer base units. Call the result `E(A)`. Interpolate the Legendary count with the same two intervals and downward rounding. Call it `L(A)`.

The exact remaining counts are:

```
R(A) = floor((D*E(A) - D*r0 - (r2-r0)*L(A)) / (r1-r0))
C(A) = D - R(A) - L(A)
EV numerator = r0*C(A) + r1*R(A) + r2*L(A)
```

Bamboo uses `e0=7000,e2=11500` and `l0=1000,l1=15000,l2=30000`.
Moon uses `e0=5000,e2=16000` and `l0=5000,l1=40000,l2=100000`.
Phoenix uses `e0=4000,e2=18000` and `l0=2000,l1=30000,l2=70000`.
Reserve uses `e0=6500,e2=16500` and `l0=3000,l1=45000,l2=85000`.

At target liquidity, exact Common/Rare/Legendary counts are:

- Bamboo: `258334 / 726666 / 15000`, with expected reward `0.4749998` USDI.
- Dragon: `277778 / 672222 / 50000`, with expected reward `0.9499998` USDI.
- Moon: `431579 / 528421 / 40000`, with expected reward `1.8999999` USDI.
- Phoenix: `483824 / 486176 / 30000`, with expected reward `4.7499984` USDI.
- Reserve: `786539 / 168461 / 45000`, with expected reward `9.499993` USDI.

This is a dynamic liquidity model. Low liquidity reduces expected payouts below the 95% contribution and tends to rebuild liquidity. High liquidity increases expected payouts above the contribution and tends to distribute surplus. This is statistical behavior, not a guarantee that every sample path recovers or never stops accepting openings. Maximum-reserve admission supplies the deterministic solvency guarantee.

## Probability proof and integer bounds

`C + R + L = D` by construction. The unfloored Rare numerator and the corresponding Common slack are affine on each pool interval. Configuration validation checks all three endpoints with a margin of `D + (r2-r0) + (r1-r0)`. The EV interpolation loses less than one base unit, and Legendary interpolation loses less than one count. That margin bounds their combined interior perturbations and the final Rare flooring. Both remaining probabilities therefore stay positive throughout both intervals. The curve is constant after `2T`.

The achieved numerator is at most `D*E`, and its shortfall is strictly less than `r1-r0`. At `A=T`, `E=0.95P` exactly. There is no assumption that floating-point percentages sum to one.

Validation bounds `P <= 10^18`, `T <= 10^18`, `r2 <= 100P` and EV endpoint basis points to at most 30,000. The largest interpolation product is below `3*10^36`, within `u128`. Every money addition/subtraction uses checked integer operations. Bonus amounts are positive and bounded separately, and actual funding must exist before reservations are allowed.

Dragon's exact preserved function is:

```
B = min(A, 2,000,000,000)
E = clamp(450,000 + floor(B/2,000), 600,000, 1,400,000)
L = clamp(saturating_sub(floor(B/10,000), 50,000), 10,000, 150,000)
R = floor((D*E - 100,000*D - 4,900,000*L) / 900,000)
C = D - R - L
```

## USDI liabilities and payout proof

The pool book includes reserved rewards, not pending or vested fees. Available liquidity is the pool book less all unresolved USDI liabilities. Admission requires `A >= r2` before payment. It then adds the contribution to the pool and reserves `r2`. Since the contribution is nonnegative, `pool >= reserved` remains true even if all unresolved openings later select Legendary.

After the draw, the contract releases `r2-r_selected`. A successful USDI callback subtracts the same selected amount from both pool and reserve. A failed callback subtracts neither. Consequently `pool >= reserved` is preserved by both outcomes. There is at most one active opening per account per case. Health limits admission to 64, 16 or 4 pending openings. Independent contract accounts cannot spend each other's balances.

The quiescent USDI balance is `pool + pending_fees + vested_fees + treasury_pending`. During transfers it lies between that book minus in-flight transfers and the full book. Pending fees become vested only after every selected payout leg confirms success. Treasury withdrawal can use only vested fees, with one outstanding withdrawal attempt. Unknown in-flight transfer outcomes block retries rather than risk a duplicate payment.

The maximum USDI liability for one newly admitted opening is 4, 5, 20, 100 or 120 USDI respectively. Before the result, a case with `n` pending openings can reserve at most `n*r2`. After selection, its actual liabilities can be lower. Available liquidity excludes all of them.

## Bonus quantities and inventory proof

The canonical registry lists each token quantity, decimals and tier. Existing Dragon six-decimal mocks stay unchanged. New mocks mirror their reviewed token decimals, including 18 and 24 decimals. Staking derivative mocks have no redemption, staking, yield, backing or wrapping behavior.

For each tier, the bonus probability is 50%. If a tier has `k` candidates, a separate domain-separated uniform choice selects one of the `k` with rejection sampling. Each candidate therefore has conditional probability `1/(2k)` within that tier. A configured case rejects duplicate token contracts, so each inventory book has exactly one funding destination and reward entry.

Before accepting an opening, the contract reserves one payout quantity from every possible candidate. It rejects the entire payment if any candidate lacks that quantity. Once the selected tier and bonus bit are recorded, all unselected candidate reservations are released. A selected failed transfer retains its exact quantity until successful recovery. Inventory accounting never adds to, subtracts from or changes the USDI probability calculation.

Funding is accepted only from the case owner or treasury through the configured token's `ft_transfer_call` receiver. Direct transfers do not create bookkeeping credits. Quiescent token balances equal their inventory funds; in-flight bounds are `funds-in_flight` through `funds`. No owner inventory withdrawal method is exposed.

## Reproducible evidence

Run `bash scripts/contracts.sh collection-simulate`. It generates `docs/multi-case-simulation.json` from canonical case configs with seed `0x1a0b20261111`. Each case receives one million attempted openings at empty, minimum, low, target and excess liquidity, for 25 million total attempts. The simulator uses an offline PRNG, not the contract's randomness, and asserts exact USDI cash conservation after every accepted result.

The report also models failed callbacks followed by same-result retries, simultaneous maximum reservations, forced Legendary depletion and 100-payout-per-candidate bonus depletion. Empty or depleted pools reject payments rather than invent balances. The forced Legendary paths stop after 70 Bamboo, 246 Dragon, 110 Moon, 52 Phoenix and 90 Reserve openings from target liquidity, before any negative balance.

These simulations test the economic model. Rust contract tests and actual Sandbox receipt tests independently test implementation. They do not establish real-wallet compatibility or public Testnet activation.

## Verified local results on November 11, 2026

The complete Rust suite passed 79 tests: 34 case tests, 12 economy tests, 12 original simulator tests, 4 mock-token tests and 17 USDI tests. The five-case Sandbox runner passed actual USDI and bonus transfers on every case using twelve real local mock contracts. It also passed stale quote refunds, independent inventory checks and a failed bonus transfer followed by a same-draw retry that paid only the outstanding token.

The original Dragon Sandbox journey passed its concurrent-payment race, full refunds, real failed USDI payout and recovery. The captured block `277099127` V1 migration rehearsal passed preservation of four historic openings, all raw child records, credits, quotes and USDI books; rollback of a failed atomic migration; a 60 Tgas legacy retry; and migrated bonus failure/recovery. The migration receipt burned `42,201,979,092,395` gas in this local rehearsal.

All three Sandbox runs used the final case WASM candidate with SHA-256 `48e560f15ef75db48d82ab1d57ca119b752059d96c1157c897ce3dbf87b7c06e`, 556,769 bytes. The mock WASM SHA-256 was `faa2b5cd6957806b93b8c96067152e21ecda54bd63bb7cb5da385c5ebea6a630`. These are local build and receipt results. Public deployment and any public opening require the separately approved Testnet batch and subsequent live verification.
