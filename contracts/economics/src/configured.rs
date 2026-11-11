//! Validated, integer-only economies for independently deployed cases.
use crate::{DENOMINATOR, Distribution, Health};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Economy {
    #[serde(with = "decimal")]
    pub price: u128,
    #[serde(with = "decimal_array")]
    pub rewards: [u128; 3],
    #[serde(with = "decimal")]
    pub target: u128,
    pub ev_low_bps: u32,
    pub ev_high_bps: u32,
    pub legendary_low_ppm: u32,
    pub legendary_target_ppm: u32,
    pub legendary_high_ppm: u32,
}

impl Economy {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.price < 20 || self.price > 1_000_000_000_000_000_000 || self.price % 20 != 0 {
            return Err("Price must be a bounded positive multiple of 20 base units");
        }
        if self.target < self.rewards[2] || self.target > 1_000_000_000_000_000_000 {
            return Err("Target must cover the maximum reward and be bounded");
        }
        if self.rewards[0] == 0
            || self.rewards[0] >= self.rewards[1]
            || self.rewards[1] >= self.rewards[2]
            || self.rewards[2] > self.price * 100
        {
            return Err("Rewards must be positive, increasing, and at most 100 times price");
        }
        if self.ev_low_bps == 0
            || self.ev_low_bps >= 9500
            || self.ev_high_bps <= 9500
            || self.ev_high_bps > 30000
        {
            return Err("EV bounds must bracket the 95 percent contribution");
        }
        if self.legendary_low_ppm == 0
            || self.legendary_low_ppm > self.legendary_target_ppm
            || self.legendary_target_ppm > self.legendary_high_ppm
            || self.legendary_high_ppm >= DENOMINATOR
        {
            return Err("Legendary probabilities must be positive and ordered below one million");
        }
        // The unfloored rare and common numerators are affine on both pool
        // segments. Endpoints with this margin also bound every interior
        // rounding perturbation: <1 base unit of EV and <1 ppm of legendary.
        let d = u128::from(DENOMINATOR);
        let [r0, r1, r2] = self.rewards;
        let margin = d + (r2 - r0) + (r1 - r0);
        for (bps, legendary) in [
            (self.ev_low_bps, self.legendary_low_ppm),
            (9500, self.legendary_target_ppm),
            (self.ev_high_bps, self.legendary_high_ppm),
        ] {
            let ev = self.price * u128::from(bps) / 10_000;
            let weighted = ev * d;
            let floor = r0 * d + (r2 - r0) * u128::from(legendary);
            let ceiling = r1 * d + (r2 - r1) * u128::from(legendary);
            if weighted < floor + margin || weighted + margin > ceiling {
                return Err("Economy cannot normalize positive common and rare probabilities");
            }
        }
        Ok(())
    }

    pub fn contribution(&self) -> u128 {
        self.price / 20 * 19
    }
    pub fn fee(&self) -> u128 {
        self.price / 20
    }

    pub fn distribution(&self, available: u128) -> Distribution {
        let a = available.min(self.target * 2);
        let (start_ev, end_ev, start_l, end_l, distance) = if a <= self.target {
            (
                self.price * u128::from(self.ev_low_bps) / 10_000,
                self.contribution(),
                self.legendary_low_ppm,
                self.legendary_target_ppm,
                a,
            )
        } else {
            (
                self.contribution(),
                self.price * u128::from(self.ev_high_bps) / 10_000,
                self.legendary_target_ppm,
                self.legendary_high_ppm,
                a - self.target,
            )
        };
        let target_ev = start_ev + (end_ev - start_ev) * distance / self.target;
        let legendary = start_l + (u128::from(end_l - start_l) * distance / self.target) as u32;
        let [r0, r1, r2] = self.rewards;
        let d = u128::from(DENOMINATOR);
        let rare = (target_ev * d - r0 * d - (r2 - r0) * u128::from(legendary)) / (r1 - r0);
        assert!(
            rare + u128::from(legendary) < d,
            "Invalid configured probability sum"
        );
        Distribution {
            common: (d - rare - u128::from(legendary)) as u32,
            rare: rare as u32,
            legendary,
            target_ev,
        }
    }

    pub fn health(&self, available: u128) -> Health {
        if available >= self.target * 4 / 5 {
            Health::Healthy
        } else if available >= self.target / 2 {
            Health::Caution
        } else {
            Health::Critical
        }
    }
}

impl Distribution {
    pub fn expected_numerator_for(&self, rewards: [u128; 3]) -> u128 {
        rewards[0] * u128::from(self.common)
            + rewards[1] * u128::from(self.rare)
            + rewards[2] * u128::from(self.legendary)
    }
    pub fn reward_for(&self, draw: u32, rewards: [u128; 3]) -> u128 {
        assert!(draw < DENOMINATOR, "draw must be below the denominator");
        rewards[if draw < self.common {
            0
        } else if draw < self.common + self.rare {
            1
        } else {
            2
        }]
    }
}

/// Reviewed defaults. Deployment still supplies an explicit validated config.
pub fn collection() -> Vec<(&'static str, Economy)> {
    [
        (
            "bamboo-mist",
            500_000,
            [200_000, 500_000, 4_000_000],
            250_000_000,
            7000,
            11500,
            1000,
            15000,
            30000,
        ),
        (
            "moon-spirit",
            2_000_000,
            [100_000, 2_000_000, 20_000_000],
            2_000_000_000,
            5000,
            16000,
            5000,
            40000,
            100000,
        ),
        (
            "phoenix-flame",
            5_000_000,
            [100_000, 3_500_000, 100_000_000],
            5_000_000_000,
            4000,
            18000,
            2000,
            30000,
            70000,
        ),
        (
            "uncles-secret-reserve",
            10_000_000,
            [2_000_000, 15_000_000, 120_000_000],
            10_000_000_000,
            6500,
            16500,
            3000,
            45000,
            85000,
        ),
    ]
    .into_iter()
    .map(
        |(
            id,
            price,
            rewards,
            target,
            ev_low_bps,
            ev_high_bps,
            legendary_low_ppm,
            legendary_target_ppm,
            legendary_high_ppm,
        )| {
            (
                id,
                Economy {
                    price,
                    rewards,
                    target,
                    ev_low_bps,
                    ev_high_bps,
                    legendary_low_ppm,
                    legendary_target_ppm,
                    legendary_high_ppm,
                },
            )
        },
    )
    .collect()
}

mod decimal {
    use serde::{Deserialize, Deserializer, Serializer, de::Error};
    pub fn serialize<S: Serializer>(v: &u128, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u128, D::Error> {
        String::deserialize(d)?.parse().map_err(D::Error::custom)
    }
}
mod decimal_array {
    use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};
    pub fn serialize<S: Serializer>(v: &[u128; 3], s: S) -> Result<S::Ok, S::Error> {
        v.map(|x| x.to_string()).serialize(s)
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u128; 3], D::Error> {
        let values = <[String; 3]>::deserialize(d)?;
        Ok([
            values[0].parse().map_err(D::Error::custom)?,
            values[1].parse().map_err(D::Error::custom)?,
            values[2].parse().map_err(D::Error::custom)?,
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configured_economies_normalize_at_all_pool_levels_and_match_exact_targets() {
        for (id, e) in collection() {
            assert_eq!(e.validate(), Ok(()), "{id}");
            for i in 0..=100_000u128 {
                let a = e.target * 2 * i / 100_000;
                let odds = e.distribution(a);
                assert_eq!(
                    odds.common + odds.rare + odds.legendary,
                    DENOMINATOR,
                    "{id} {a}"
                );
                assert!(odds.common > 0 && odds.rare > 0 && odds.legendary > 0);
                let ev = odds.expected_numerator_for(e.rewards);
                assert!(ev <= odds.target_ev * u128::from(DENOMINATOR));
                assert!(
                    odds.target_ev * u128::from(DENOMINATOR) - ev < e.rewards[1] - e.rewards[0]
                );
            }
            assert_eq!(e.distribution(e.target).target_ev, e.contribution());
            assert_eq!(e.distribution(e.target).legendary, e.legendary_target_ppm);
            assert_eq!(e.distribution(u128::MAX), e.distribution(e.target * 2));
            assert_eq!(e.contribution() + e.fee(), e.price);
        }
    }
    #[test]
    fn invalid_configuration_is_rejected_before_arithmetic() {
        let mut e = collection().remove(0).1;
        e.price = u128::MAX;
        assert!(e.validate().is_err());
        let mut e = collection().remove(0).1;
        e.rewards = [1, 2, u128::MAX];
        assert!(e.validate().is_err());
        let mut e = collection().remove(0).1;
        e.legendary_high_ppm = 999999;
        assert!(e.validate().is_err());
        let mut e = collection().remove(0).1;
        e.ev_low_bps = 20000;
        assert!(e.validate().is_err());
    }
    #[test]
    fn draw_intervals_match_all_advertised_counts() {
        for (_, e) in collection() {
            let odds = e.distribution(e.target);
            let mut counts = [0u32; 3];
            for draw in 0..DENOMINATOR {
                let reward = odds.reward_for(draw, e.rewards);
                counts[e.rewards.iter().position(|x| *x == reward).unwrap()] += 1;
            }
            assert_eq!(counts, [odds.common, odds.rare, odds.legendary]);
        }
    }
}
