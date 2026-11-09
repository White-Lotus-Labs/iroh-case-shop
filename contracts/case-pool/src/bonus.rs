use super::*;

const AMOUNTS: [u128; 3] = [50_000_000, 5_000_000, 1_000_000];
const SYMBOLS: [&str; 3] = ["SHITZU", "RHEA", "AURORA"];
const NAMES: [&str; 3] = ["Test Shitzu", "Test Rhea", "Test Aurora"];
const TIERS: [&str; 3] = ["Common", "Rare", "Legendary"];

#[near(serializers = [borsh])]
pub(super) struct Inventory {
    pub(super) token: AccountId,
    pub(super) funds: u128,
    pub(super) reserved: u128,
    pub(super) in_flight: u128,
}

impl Inventory {
    pub(super) fn new(token: AccountId) -> Self {
        Self {
            token,
            funds: 0,
            reserved: 0,
            in_flight: 0,
        }
    }

    pub(super) fn available(&self) -> u128 {
        sub(self.funds, self.reserved)
    }

    pub(super) fn view(&self, tier: usize) -> Value {
        json!({
            "reward_id": format!("bonus-{}", SYMBOLS[tier].to_ascii_lowercase()),
            "token_contract_id": self.token, "token_symbol": SYMBOLS[tier],
            "token_decimals": 6, "amount": amount(tier).to_string(), "display_name": NAMES[tier],
            "tier": TIERS[tier], "chance_in_tier_bps": 5000,
            "available": self.available().to_string(), "reserved": self.reserved.to_string(),
            "in_flight": self.in_flight.to_string(), "funds": self.funds.to_string(),
        })
    }
}

pub(super) fn amount(tier: usize) -> u128 {
    AMOUNTS[tier]
}

pub(super) fn tier(draw: u32, odds: [u32; 3]) -> usize {
    if draw < odds[0] {
        0
    } else if draw < odds[0] + odds[1] {
        1
    } else {
        2
    }
}

pub(super) fn selected(tier: usize, bit: bool, enabled: bool) -> Option<u8> {
    (enabled && bit).then_some(tier as u8)
}
