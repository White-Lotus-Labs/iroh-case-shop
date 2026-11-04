//! Integer economics shared by the case contract and offline simulations.
//!
//! Available liquidity is the pool balance less all reserved rewards, measured
//! before the next payment. Probabilities use one million equal draw intervals.

use serde::Serialize;

pub const UNIT: u128 = 1_000_000;
pub const PRICE: u128 = UNIT;
pub const CONTRIBUTION: u128 = 950_000;
pub const FEE: u128 = 50_000;
pub const TARGET: u128 = 1_000 * UNIT;
pub const MAX_REWARD: u128 = 5 * UNIT;
pub const REWARDS: [u128; 3] = [100_000, UNIT, MAX_REWARD];
pub const DENOMINATOR: u32 = 1_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Distribution {
    pub common: u32,
    pub rare: u32,
    pub legendary: u32,
    /// The clamped, floored target EV in token base units, before rare rounding.
    pub target_ev: u128,
}

impl Distribution {
    /// Actual EV multiplied by `DENOMINATOR`, without floating-point rounding.
    pub fn expected_numerator(&self) -> u128 {
        REWARDS[0] * u128::from(self.common)
            + REWARDS[1] * u128::from(self.rare)
            + REWARDS[2] * u128::from(self.legendary)
    }

    /// Maps a uniform draw in `0..DENOMINATOR` to its exact token reward.
    pub fn reward(&self, draw: u32) -> u128 {
        assert!(draw < DENOMINATOR, "draw must be below the denominator");
        if draw < self.common {
            REWARDS[0]
        } else if draw < self.common + self.rare {
            REWARDS[1]
        } else {
            REWARDS[2]
        }
    }
}

/// Computes all probabilities together; the common tier absorbs division dust.
///
/// Both curves are constant above A=2,000,000,000, so clipping A there bounds
/// every product below 2e12 even for u128::MAX. The rare numerator is positive:
/// its smallest endpoint value is 451e9. On each interval cut by A=300m, 600m,
/// 1,900m and 2,000m it is linear apart from downward rounding. The remaining
/// common probability is positive at every endpoint, with ample rounding margin.
/// We assert normalization rather than independently clamp inconsistent tiers.
///
/// Rare flooring loses less than 900,000 EV numerator units, or 0.9 base units.
/// Flooring A/2,000 loses less than one more base unit, so actual EV differs
/// from the continuous clamped target by less than 1.9 token base units.
pub fn distribution(available: u128) -> Distribution {
    let bounded = available.min(2_000_000_000);
    let target_ev = (450_000 + bounded / 2_000).clamp(600_000, 1_400_000);
    let legendary = (bounded / 10_000)
        .saturating_sub(50_000)
        .clamp(10_000, 150_000);
    let denominator = u128::from(DENOMINATOR);
    let rare_numerator =
        target_ev * denominator - REWARDS[0] * denominator - (REWARDS[2] - REWARDS[0]) * legendary;
    let rare = rare_numerator / (REWARDS[1] - REWARDS[0]);
    assert!(rare + legendary <= denominator, "invalid probability sum");
    Distribution {
        common: (denominator - rare - legendary) as u32,
        rare: rare as u32,
        legendary: legendary as u32,
        target_ev,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Health {
    Healthy,
    Caution,
    Critical,
}

pub fn health(available: u128) -> Health {
    if available >= 800 * UNIT {
        Health::Healthy
    } else if available >= 500 * UNIT {
        Health::Caution
    } else {
        Health::Critical
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_distributions_and_equilibrium_are_exact() {
        let examples = [
            (0, 488_889, 501_111, 10_000, 600_000),
            (300_000_000, 488_889, 501_111, 10_000, 600_000),
            (500_000_000, 377_778, 612_222, 10_000, 700_000),
            (600_000_000, 322_223, 667_777, 10_000, 750_000),
            (750_000_000, 305_556, 669_444, 25_000, 825_000),
            (800_000_000, 300_000, 670_000, 30_000, 850_000),
            (1_000_000_000, 277_778, 672_222, 50_000, 950_000),
            (1_250_000_000, 250_000, 675_000, 75_000, 1_075_000),
            (1_500_000_000, 222_223, 677_777, 100_000, 1_200_000),
            (1_900_000_000, 177_778, 682_222, 140_000, 1_400_000),
            (2_000_000_000, 222_223, 627_777, 150_000, 1_400_000),
        ];
        for (available, common, rare, legendary, target_ev) in examples {
            assert_eq!(
                distribution(available),
                Distribution {
                    common,
                    rare,
                    legendary,
                    target_ev
                },
                "A={available}"
            );
        }
        assert_eq!(distribution(TARGET).expected_numerator(), 949_999_800_000);
    }

    #[test]
    fn target_slope_and_both_clamps_include_boundary_neighbors() {
        for (available, expected) in [
            (0, 600_000),
            (299_999_999, 600_000),
            (300_000_000, 600_000),
            (300_001_999, 600_000),
            (300_002_000, 600_001),
            (300_004_000, 600_002),
            (1_899_997_999, 1_399_998),
            (1_899_998_000, 1_399_999),
            (1_899_999_999, 1_399_999),
            (1_900_000_000, 1_400_000),
            (1_900_002_000, 1_400_000),
            (u128::MAX, 1_400_000),
        ] {
            assert_eq!(distribution(available).target_ev, expected, "A={available}");
        }
    }

    #[test]
    fn legendary_slope_and_both_clamps_include_boundary_neighbors() {
        for (available, expected) in [
            (0, 10_000),
            (499_999_999, 10_000),
            (500_000_000, 10_000),
            (599_999_999, 10_000),
            (600_000_000, 10_000),
            (600_009_999, 10_000),
            (600_010_000, 10_001),
            (600_020_000, 10_002),
            (1_999_989_999, 149_998),
            (1_999_990_000, 149_999),
            (1_999_999_999, 149_999),
            (2_000_000_000, 150_000),
            (2_000_010_000, 150_000),
            (u128::MAX, 150_000),
        ] {
            assert_eq!(distribution(available).legendary, expected, "A={available}");
        }
    }

    #[test]
    fn health_thresholds_use_available_liquidity() {
        for (available, expected) in [
            (0, Health::Critical),
            (499_999_999, Health::Critical),
            (500_000_000, Health::Caution),
            (500_000_001, Health::Caution),
            (799_999_999, Health::Caution),
            (800_000_000, Health::Healthy),
            (800_000_001, Health::Healthy),
            (u128::MAX, Health::Healthy),
        ] {
            assert_eq!(health(available), expected, "A={available}");
        }
    }

    #[test]
    fn maximum_u128_has_the_same_saturated_distribution() {
        assert_eq!(
            distribution(u128::MAX),
            Distribution {
                common: 222_223,
                rare: 627_777,
                legendary: 150_000,
                target_ev: 1_400_000,
            }
        );
        assert_eq!(
            distribution(u128::MAX).expected_numerator(),
            1_399_999_300_000
        );
    }

    #[test]
    fn draw_intervals_pay_exactly_the_advertised_counts() {
        let odds = distribution(TARGET);
        let mut counts = [0_u32; 3];
        for draw in 0..DENOMINATOR {
            match odds.reward(draw) {
                100_000 => counts[0] += 1,
                1_000_000 => counts[1] += 1,
                5_000_000 => counts[2] += 1,
                reward => panic!("unexpected reward {reward}"),
            }
        }
        assert_eq!(counts, [277_778, 672_222, 50_000]);
        assert_eq!(odds.reward(277_777), 100_000);
        assert_eq!(odds.reward(277_778), 1_000_000);
        assert_eq!(odds.reward(949_999), 1_000_000);
        assert_eq!(odds.reward(950_000), 5_000_000);
        assert_eq!(odds.reward(999_999), 5_000_000);
    }

    #[test]
    #[should_panic(expected = "draw must be below the denominator")]
    fn draw_outside_the_probability_space_is_rejected() {
        distribution(TARGET).reward(DENOMINATOR);
    }

    fn assert_distribution_bounds(available: u128) {
        let odds = distribution(available);
        assert_eq!(odds.common + odds.rare + odds.legendary, 1_000_000);
        assert!(odds.common > 0 && odds.rare > 0 && odds.legendary > 0);
        assert!((10_000..=150_000).contains(&odds.legendary));
        let ev = odds.expected_numerator();
        let integer_target = odds.target_ev * 1_000_000;
        assert!(ev <= integer_target);
        assert!(integer_target - ev < 900_000, "A={available}");

        // Compare to the continuous curve with denominator 2,000. This does
        // not reuse the production integer target or legendary calculation.
        let continuous_scaled =
            (900_000_000 + available.min(2_000_000_000)).clamp(1_200_000_000, 2_800_000_000);
        let continuous_numerator = continuous_scaled * 1_000_000;
        assert!(ev * 2_000 <= continuous_numerator);
        assert!(
            continuous_numerator - ev * 2_000 < 3_800_000_000,
            "A={available}"
        );

        assert_eq!(odds.reward(0), 100_000);
        assert_eq!(odds.reward(odds.common), 1_000_000);
        assert_eq!(odds.reward(odds.common + odds.rare), 5_000_000);
        assert_eq!(odds.reward(999_999), 5_000_000);
    }

    #[test]
    fn every_piecewise_breakpoint_and_neighbor_preserves_the_economy() {
        let mut previous_legendary = 0;
        for breakpoint in (0_u128..=2_000_000_000).step_by(2_000) {
            let first = breakpoint.saturating_sub(1);
            for available in [first, breakpoint, breakpoint + 1] {
                assert_distribution_bounds(available);
                let legendary = distribution(available).legendary;
                assert!(legendary >= previous_legendary, "A={available}");
                previous_legendary = legendary;
            }
        }
        assert_distribution_bounds(u128::MAX);
    }

    #[test]
    fn distribution_and_health_serialize_for_quote_views() {
        let serialized = serde_json::to_value(distribution(TARGET)).unwrap();
        assert_eq!(
            serialized,
            serde_json::json!({
                "common": 277778,
                "rare": 672222,
                "legendary": 50000,
                "target_ev": 950000,
            })
        );
        assert_eq!(
            serde_json::to_string(&health(TARGET)).unwrap(),
            "\"Healthy\""
        );
    }
}
