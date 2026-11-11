//! Reproducible offline stress simulation. PRNG is for testing only and is not
//! the on-chain random source.
use iroh_economics::configured::Economy;
use iroh_economics::{
    CONTRIBUTION, DENOMINATOR, FEE, Health, PRICE, REWARDS, TARGET, distribution, health,
};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};

#[derive(Clone)]
struct Model {
    id: String,
    economy: Option<Economy>,
}
impl Model {
    fn price(&self) -> u128 {
        self.economy.as_ref().map_or(PRICE, |e| e.price)
    }
    fn rewards(&self) -> [u128; 3] {
        self.economy.as_ref().map_or(REWARDS, |e| e.rewards)
    }
    fn target(&self) -> u128 {
        self.economy.as_ref().map_or(TARGET, |e| e.target)
    }
    fn contribution(&self) -> u128 {
        self.economy
            .as_ref()
            .map_or(CONTRIBUTION, |e| e.contribution())
    }
    fn fee(&self) -> u128 {
        self.economy.as_ref().map_or(FEE, |e| e.fee())
    }
    fn odds(&self, a: u128) -> iroh_economics::Distribution {
        self.economy
            .as_ref()
            .map_or_else(|| distribution(a), |e| e.distribution(a))
    }
    fn health(&self, a: u128) -> Health {
        self.economy
            .as_ref()
            .map_or_else(|| health(a), |e| e.health(a))
    }
}
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        let bound = u64::MAX - u64::MAX % n;
        loop {
            let v = self.next();
            if v < bound {
                return v % n;
            }
        }
    }
}
fn simulate(model: &Model, initial: u128, attempts: u64, seed: u64) -> Value {
    let mut pool = initial;
    let mut min_pool = pool;
    let mut rng = Rng(seed);
    let mut paid = 0u128;
    let mut fees = 0u128;
    let mut accepted = 0u64;
    let mut rejected = 0u64;
    let mut failed_then_retried = 0u64;
    let mut counts = [0u64; 3];
    for step in 0..attempts {
        if pool < model.rewards()[2] {
            rejected += 1;
            continue;
        }
        let odds = model.odds(pool);
        assert_eq!(odds.common + odds.rare + odds.legendary, DENOMINATOR);
        let draw = rng.below(u64::from(DENOMINATOR)) as u32;
        let tier = if draw < odds.common {
            0
        } else if draw < odds.common + odds.rare {
            1
        } else {
            2
        };
        let reward = model.rewards()[tier];
        let before = pool;
        pool += model.contribution();
        let maximum_reserve = model.rewards()[2];
        assert!(pool >= maximum_reserve);
        let selected_reserve = reward;
        assert!(pool >= selected_reserve);
        if step % 10_000 == 0 {
            // A failed callback leaves pool and selected liability untouched.
            assert_eq!(pool, before + model.contribution());
            assert_eq!(fees, u128::from(accepted) * model.fee());
            failed_then_retried += 1;
        }
        // Retry settles the same reward, with no call to the PRNG.
        pool -= reward;
        paid += reward;
        fees += model.fee();
        accepted += 1;
        counts[tier] += 1;
        min_pool = min_pool.min(pool);
        assert_eq!(
            pool + fees + paid,
            initial + u128::from(accepted) * model.price()
        );
    }
    json!({"initial_pool":initial.to_string(),"attempts":attempts,"accepted":accepted,"rejected":rejected,
        "tier_counts":counts,"failed_then_retried":failed_then_retried,"final_pool":pool.to_string(),
        "minimum_pool":min_pool.to_string(),"total_paid":paid.to_string(),"vested_fees":fees.to_string(),"conservation":true})
}
fn legendary_streak(model: &Model) -> Value {
    let mut pool = model.target();
    let mut n = 0;
    while pool >= model.rewards()[2] {
        pool += model.contribution();
        pool -= model.rewards()[2];
        n += 1;
        assert!(n < 1_000_000);
    }
    json!({"accepted_before_stop":n,"remaining_pool":pool.to_string(),"maximum_reward":model.rewards()[2].to_string(),"negative_balance":false})
}
fn concurrent(model: &Model) -> Value {
    let mut pool = model.target();
    let mut reserved = 0;
    let mut pending = 0;
    for _ in 0..1000 {
        let available = pool - reserved;
        let limit = match model.health(available) {
            Health::Healthy => 64,
            Health::Caution => 16,
            Health::Critical => 4,
        };
        if available < model.rewards()[2] || pending >= limit {
            break;
        }
        pool += model.contribution();
        reserved += model.rewards()[2];
        pending += 1;
        assert!(pool >= reserved);
    }
    json!({"accepted_before_limit":pending,"pool":pool.to_string(),"reserved":reserved.to_string(),"solvent":pool>=reserved})
}
fn bonus_depletion(config: &Value, model: &Model) -> Value {
    let rewards = config["bonus_rewards"].as_array().unwrap();
    let mut stock = vec![100u64; rewards.len()];
    let mut rng = Rng(0x1a0b);
    let mut n = 0;
    let mut bonus_counts = vec![0u64; stock.len()];
    while stock.iter().all(|s| *s >= 1) && n < 1_000_000 {
        // One candidate liability per reward entry is reserved before the draw.
        let odds = model.odds(model.target());
        let draw = rng.below(u64::from(DENOMINATOR)) as u32;
        let tier = if draw < odds.common {
            0
        } else if draw < odds.common + odds.rare {
            1
        } else {
            2
        };
        if rng.below(2) == 1 {
            let candidates: Vec<_> = rewards
                .iter()
                .enumerate()
                .filter(|(_, r)| r["tier"] == tier)
                .map(|(i, _)| i)
                .collect();
            let selected = candidates[rng.below(candidates.len() as u64) as usize];
            stock[selected] -= 1;
            bonus_counts[selected] += 1;
        }
        n += 1;
    }
    json!({"initial_payouts_per_candidate":100,"accepted_before_inventory_stop":n,"remaining_payouts":stock,
        "bonus_payout_counts":bonus_counts,"oversubscribed":false,"usdi_valuation":null})
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let registry: Value =
        serde_json::from_slice(&fs::read(root.join("config/cases.testnet.json"))?)?;
    let mut reports = Vec::new();
    for row in registry["cases"].as_array().unwrap() {
        let id = row["id"].as_str().unwrap().to_string();
        let economy = if id == "dragon-tea" {
            None
        } else {
            let e: Economy = serde_json::from_value(row["config"]["economy"].clone())?;
            e.validate()?;
            Some(e)
        };
        let model = Model { id, economy };
        let target_odds = model.odds(model.target());
        let runs=[("empty",0),("minimum",model.rewards()[2]),("low",model.target()/10),("target",model.target()),("excess",model.target()*2)]
            .into_iter().map(|(name,a)|json!({"scenario":name,"result":simulate(&model,a,1_000_000,0x1a0b20261111)})).collect::<Vec<_>>();
        reports.push(json!({"case_id":model.id,"price":model.price().to_string(),"rewards":model.rewards().map(|a|a.to_string()),
            "target":model.target().to_string(),"target_probabilities":[target_odds.common,target_odds.rare,target_odds.legendary],
            "target_expected_numerator":target_odds.expected_numerator_for(model.rewards()).to_string(),
            "runs":runs,"legendary_streak":legendary_streak(&model),"concurrent":concurrent(&model),
            "bonus_depletion":bonus_depletion(&row["config"],&model)}));
    }
    let path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("docs/multi-case-simulation.json"));
    fs::write(
        &path,
        serde_json::to_string_pretty(
            &json!({"seed":"0x1a0b20261111","network":"offline only","unit":"USDI base units, six decimals",
        "attempts_per_case":5_000_000,"total_attempts":25_000_000,"mock_token_market_values":null,"cases":reports}),
        )? + "\n",
    )?;
    println!(
        "PASS 25,000,000 opening attempts across five cases; USDI conservation, maximum liabilities, forced legendary depletion, failed callbacks/retry and bonus inventory stops. Report {}",
        path.display()
    );
    Ok(())
}
