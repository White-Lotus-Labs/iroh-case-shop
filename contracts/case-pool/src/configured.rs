//! Immutable case configuration and auxiliary inventory. The deployed Dragon
//! root and opening encodings remain unchanged.
use super::*;
use iroh_economics::configured::Economy;

const CONFIG_KEY: &[u8] = b"iroh:case-config:v1";
const INVENTORY_KEY: &[u8] = b"iroh:case-inventory:v1";
const TIERS: [&str; 3] = ["Common", "Rare", "Legendary"];

#[near(serializers = [json])]
#[derive(Clone)]
#[serde(deny_unknown_fields)]
pub struct CaseConfig {
    pub case_id: String,
    pub name: String,
    pub economy: Economy,
    pub bonus_rewards: Vec<BonusReward>,
}
#[near(serializers = [json])]
#[derive(Clone)]
#[serde(deny_unknown_fields)]
pub struct BonusReward {
    pub token_contract_id: AccountId,
    pub token_symbol: String,
    pub display_name: String,
    pub token_decimals: u8,
    pub amount: U128,
    pub tier: u8,
}
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
struct InventoryState {
    funds: u128,
    reserved: u128,
    in_flight: u128,
}

pub(super) struct RewardEntry {
    pub(super) reward: BonusReward,
    pub(super) funds: u128,
    pub(super) reserved: u128,
    pub(super) in_flight: u128,
}
impl RewardEntry {
    pub(super) fn available(&self) -> u128 {
        sub(self.funds, self.reserved)
    }
    pub(super) fn view(&self, index: usize, candidates: usize) -> Value {
        json!({"reward_id":format!("bonus-{}-{}",self.reward.token_symbol.to_ascii_lowercase(),index),
            "token_contract_id":self.reward.token_contract_id,"token_symbol":self.reward.token_symbol,
            "display_name":self.reward.display_name,"token_decimals":self.reward.token_decimals,
            "amount":self.reward.amount.0.to_string(),"tier":TIERS[usize::from(self.reward.tier)],
            "chance_in_tier_bps":5000,"candidates_in_tier":candidates,"selection_denominator":candidates,
            "available":self.available().to_string(),"reserved":self.reserved.to_string(),
            "in_flight":self.in_flight.to_string(),"funds":self.funds.to_string(),
            "expected_balance_min":sub(self.funds,self.in_flight).to_string(),
            "expected_balance_max":self.funds.to_string(),"mock":true})
    }
}

#[near]
impl CasePool {
    /// Fresh independently deployed case account only. Configuration has no
    /// mutation method, and admission stays paused until inventory is verified.
    #[init]
    #[private]
    pub fn new_configured(
        owner_id: AccountId,
        token_id: AccountId,
        treasury_id: AccountId,
        config: CaseConfig,
    ) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Case account must initialize"
        );
        require!(
            !env::storage_has_key(CONFIG_KEY) && !env::storage_has_key(INVENTORY_KEY),
            "Configuration already initialized"
        );
        let mut case = Self::new(owner_id, token_id, treasury_id);
        require!(
            case.owner.as_str().ends_with(".testnet")
                && case.treasury.as_str().ends_with(".testnet"),
            "Administrators must be on Testnet"
        );
        require!(
            config.case_id.len() >= 3
                && config.case_id.len() <= 48
                && config
                    .case_id
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
                && config.case_id != "dragon-tea",
            "Use a distinct lowercase case ID"
        );
        require!(
            !config.name.is_empty() && config.name.len() <= 96,
            "Invalid case name"
        );
        if let Err(message) = config.economy.validate() {
            env::panic_str(message);
        }
        require!(config.bonus_rewards.len() <= 24, "At most 24 bonus rewards");
        for (i, reward) in config.bonus_rewards.iter().enumerate() {
            require!(
                reward.tier < 3
                    && reward.amount.0 > 0
                    && reward.amount.0 <= 1_000_000_000_000_000_000_000_000_000_000_000_000,
                "Invalid bonus amount or tier"
            );
            require!(
                reward.token_decimals <= 24
                    && !reward.token_symbol.is_empty()
                    && reward.token_symbol.len() <= 16
                    && reward
                        .token_symbol
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric())
                    && !reward.display_name.is_empty()
                    && reward.display_name.len() <= 96,
                "Invalid reward metadata"
            );
            require!(
                reward.token_contract_id.as_str().ends_with(".testnet")
                    && reward.token_contract_id != case.token
                    && reward.token_contract_id != env::current_account_id()
                    && !config.bonus_rewards[..i]
                        .iter()
                        .any(|old| old.token_contract_id == reward.token_contract_id),
                "Use distinct Testnet reward contracts"
            );
        }
        if !config.bonus_rewards.is_empty() {
            require!(
                (0..3).all(|tier| config.bonus_rewards.iter().any(|r| r.tier == tier)),
                "Each tier needs a bonus candidate"
            );
        }
        env::storage_write(
            CONFIG_KEY,
            &near_sdk::serde_json::to_vec(&config).expect("Configuration serializes"),
        );
        let states = vec![InventoryState::default(); config.bonus_rewards.len()];
        env::storage_write(
            INVENTORY_KEY,
            &near_sdk::borsh::to_vec(&states).expect("Inventory serializes"),
        );
        case.paused = true;
        case
    }
}

impl CasePool {
    pub(super) fn config(&self) -> Option<CaseConfig> {
        env::storage_read(CONFIG_KEY).map(|bytes| {
            near_sdk::serde_json::from_slice(&bytes).expect("Stored case configuration")
        })
    }
    pub(super) fn case_id(&self) -> String {
        self.config()
            .map_or_else(|| "dragon-tea".into(), |c| c.case_id)
    }
    pub(super) fn case_name(&self) -> String {
        self.config()
            .map_or_else(|| "Dragon Tea Case".into(), |c| c.name)
    }
    pub(super) fn price(&self) -> u128 {
        self.config().map_or(PRICE, |c| c.economy.price)
    }
    pub(super) fn rewards(&self) -> [u128; 3] {
        self.config().map_or(REWARDS, |c| c.economy.rewards)
    }
    pub(super) fn maximum_reward(&self) -> u128 {
        self.rewards()[2]
    }
    pub(super) fn fee(&self) -> u128 {
        self.config().map_or(FEE, |c| c.economy.fee())
    }
    pub(super) fn contribution(&self) -> u128 {
        self.config()
            .map_or(CONTRIBUTION, |c| c.economy.contribution())
    }
    pub(super) fn target(&self) -> u128 {
        self.config().map_or(TARGET, |c| c.economy.target)
    }
    pub(super) fn odds(&self) -> iroh_economics::Distribution {
        self.config().map_or_else(
            || distribution(self.available()),
            |c| c.economy.distribution(self.available()),
        )
    }
    pub(super) fn pool_health(&self) -> iroh_economics::Health {
        self.config().map_or_else(
            || health(self.available()),
            |c| c.economy.health(self.available()),
        )
    }
    pub(super) fn reward_entries(&self) -> Vec<RewardEntry> {
        if let Some(config) = self.config() {
            let states: Vec<InventoryState> = near_sdk::borsh::from_slice(
                &env::storage_read(INVENTORY_KEY).expect("Inventory initialized"),
            )
            .expect("Stored inventory format");
            require!(
                states.len() == config.bonus_rewards.len(),
                "Inventory configuration mismatch"
            );
            config
                .bonus_rewards
                .into_iter()
                .zip(states)
                .map(|(reward, state)| RewardEntry {
                    reward,
                    funds: state.funds,
                    reserved: state.reserved,
                    in_flight: state.in_flight,
                })
                .collect()
        } else {
            self.bonuses
                .iter()
                .flat_map(|items| {
                    items.iter().enumerate().map(|(tier, item)| {
                        let view = item.view(tier);
                        RewardEntry {
                            reward: BonusReward {
                                token_contract_id: item.token.clone(),
                                token_symbol: view["token_symbol"].as_str().expect("Symbol").into(),
                                display_name: view["display_name"].as_str().expect("Name").into(),
                                token_decimals: 6,
                                amount: U128(bonus::amount(tier)),
                                tier: tier as u8,
                            },
                            funds: item.funds,
                            reserved: item.reserved,
                            in_flight: item.in_flight,
                        }
                    })
                })
                .collect()
        }
    }
    pub(super) fn store_entries(&mut self, entries: &[RewardEntry]) {
        if env::storage_has_key(CONFIG_KEY) {
            let states: Vec<_> = entries
                .iter()
                .map(|e| InventoryState {
                    funds: e.funds,
                    reserved: e.reserved,
                    in_flight: e.in_flight,
                })
                .collect();
            env::storage_write(
                INVENTORY_KEY,
                &near_sdk::borsh::to_vec(&states).expect("Inventory serializes"),
            );
        } else if let Some(items) = self.bonuses.as_mut() {
            require!(
                entries.len() == items.len(),
                "Legacy bonus catalog mismatch"
            );
            for (item, e) in items.iter_mut().zip(entries) {
                item.funds = e.funds;
                item.reserved = e.reserved;
                item.in_flight = e.in_flight;
            }
        } else {
            require!(entries.is_empty(), "Unexpected inventory");
        }
    }
    pub(super) fn entry_view(&self, index: usize) -> Value {
        let entries = self.reward_entries();
        let entry = &entries[index];
        if self.config().is_none() {
            return self.bonuses.as_ref().expect("Legacy bonus catalog")[index].view(index);
        }
        entry.view(
            index,
            entries
                .iter()
                .filter(|e| e.reward.tier == entry.reward.tier)
                .count(),
        )
    }
    pub(super) fn select_bonus(&self, opening: &Opening, tier: usize) -> Result<Option<u8>, ()> {
        if self.config().is_none() {
            return Ok(bonus::selected(
                tier,
                randomness::bonus_bit(opening.id, opening.accepted_height),
                self.bonuses.is_some(),
            ));
        }
        if !randomness::bonus_bit(opening.id, opening.accepted_height) {
            return Ok(None);
        }
        let entries = self.reward_entries();
        let candidates: Vec<_> = entries
            .iter()
            .enumerate()
            .filter(|(_, e)| usize::from(e.reward.tier) == tier)
            .map(|(index, _)| index)
            .collect();
        if candidates.is_empty() {
            return Ok(None);
        }
        let selected = randomness::bonus_candidate(
            opening.id,
            opening.accepted_height,
            candidates.len() as u64,
        )
        .ok_or(())?;
        Ok(Some(candidates[selected as usize] as u8))
    }
}
