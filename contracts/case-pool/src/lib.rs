mod bonus;
mod configured;
mod migration;

use iroh_economics::{
    CONTRIBUTION, DENOMINATOR, FEE, PRICE, REWARDS, TARGET, distribution, health,
};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{Value, json};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, assert_one_yocto, env,
    ext_contract, near, require,
};

#[cfg(test)]
use iroh_economics::MAX_REWARD;

const OPENING_BYTES: u128 = 2_048;
const ACCOUNT_BYTES: u128 = 256;
const DRAW_GAS: Gas = Gas::from_tgas(85);
const TRANSFER_GAS: Gas = Gas::from_tgas(25);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);

#[ext_contract(ext_token)]
#[allow(dead_code)]
trait Token {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}
#[ext_contract(ext_self)]
#[allow(dead_code)]
trait Callbacks {
    fn resolve_opening(&mut self, opening_id: U64) -> bool;
    fn on_payout(&mut self, opening_id: U64, attempt: U64) -> bool;
    fn on_treasury(&mut self, attempt: U64) -> bool;
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Status {
    RandomnessPending,
    Paying,
    Claimable,
    Completed,
}
#[near(serializers = [borsh])]
#[derive(Clone)]
struct Opening {
    id: u64,
    account: AccountId,
    nonce: u64,
    previous: Option<u64>,
    accepted_height: u64,
    revision: u64,
    odds: [u32; 3],
    status: Status,
    reward: Option<u128>,
    draw: Option<u32>,
    attempt: u64,
    bonus: Option<u8>,
    usdi_paid: bool,
    bonus_paid: bool,
}
#[near(serializers = [borsh])]
struct TreasuryTransfer {
    amount: u128,
    attempt: u64,
}
#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
struct Authorization {
    revision: U64,
    expires_at: U64,
}
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Payment {
    Fund,
    Open {
        case_id: String,
        nonce: U64,
        quote: Authorization,
    },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CasePool {
    owner: AccountId,
    token: AccountId,
    treasury: AccountId,
    pool: u128,
    reserved: u128,
    pending_fees: u128,
    fees: u128,
    in_flight: u128,
    treasury_transfer: Option<TreasuryTransfer>,
    treasury_attempt: u64,
    total_paid: u128,
    completed: u64,
    pending: u32,
    paused: bool,
    revision: u64,
    next_id: u64,
    openings: LookupMap<u64, Opening>,
    active: LookupMap<AccountId, u64>,
    latest: LookupMap<AccountId, u64>,
    credits: LookupMap<AccountId, u128>,
    bonuses: Option<[bonus::Inventory; 3]>,
    legacy_openings: Option<migration::LegacyOpenings>,
}

#[near]
impl CasePool {
    #[init]
    pub fn new(owner_id: AccountId, token_id: AccountId, treasury_id: AccountId) -> Self {
        require!(
            env::current_account_id().as_str().ends_with(".testnet"),
            "Testnet deployment only"
        );
        require!(
            token_id.as_str().ends_with(".testnet"),
            "USDI must be on Testnet"
        );
        require!(
            owner_id != env::current_account_id() && treasury_id != env::current_account_id(),
            "Use separate administrative accounts"
        );
        Self {
            owner: owner_id,
            token: token_id,
            treasury: treasury_id,
            pool: 0,
            reserved: 0,
            pending_fees: 0,
            fees: 0,
            in_flight: 0,
            treasury_transfer: None,
            treasury_attempt: 0,
            total_paid: 0,
            completed: 0,
            pending: 0,
            paused: false,
            revision: 0,
            next_id: 0,
            openings: LookupMap::new(b"v"),
            active: LookupMap::new(b"a"),
            latest: LookupMap::new(b"l"),
            credits: LookupMap::new(b"c"),
            bonuses: None,
            legacy_openings: None,
        }
    }

    /// For a newly created case account. Existing state is not migrated.
    #[init]
    #[private]
    pub fn new_with_rewards(
        owner_id: AccountId,
        token_id: AccountId,
        treasury_id: AccountId,
        reward_tokens: [AccountId; 3],
    ) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Case account must initialize"
        );
        let mut case = Self::new(owner_id, token_id, treasury_id);
        case.configure_rewards(reward_tokens);
        case
    }

    pub fn get_reward_inventory(&self) -> Vec<Value> {
        let entries = self.reward_entries();
        entries
            .iter()
            .enumerate()
            .map(|(index, _)| self.entry_view(index))
            .collect()
    }

    pub fn get_case(&self) -> Value {
        let rewards: Vec<_> = ["Common", "Rare", "Legendary"].iter().zip(self.rewards()).map(|(tier, amount)| {
            json!({"reward_id":format!("usdi-{}", tier.to_ascii_lowercase()), "token_contract_id":self.token,
                "token_symbol":"USDI", "token_decimals":6, "amount":amount.to_string(),
                "display_name":"USD Iroh", "tier":tier})
        }).collect();
        json!({"case_id":self.case_id(), "name":self.case_name(), "token_id":self.token,
            "price":self.price().to_string(), "pool_contribution":self.contribution().to_string(), "platform_fee":self.fee().to_string(),
            "target":self.target().to_string(), "probability_denominator":DENOMINATOR,
            "rewards":rewards,
            "randomness":"NEAR protocol randomness; Testnet demonstration, not production-grade VRF",
            "quote_policy":"Exact revision, zero slippage; stale quotes are fully refunded",
            "bonus_rewards":self.get_reward_inventory(),"history_pagination":true})
    }
    pub fn get_pool(&self) -> Value {
        let book = add(
            add(self.pool, self.pending_fees),
            add(self.fees, self.treasury_pending()),
        );
        let flights = add(self.in_flight, self.treasury_pending());
        json!({"pool_funds":self.pool.to_string(),"reserved_rewards":self.reserved.to_string(),
            "available":self.available().to_string(),"target":self.target().to_string(),"health":self.pool_health(),
            "pending_fees":self.pending_fees.to_string(),"treasury_available":self.fees.to_string(),
            "treasury_in_flight":self.treasury_pending().to_string(),"in_flight_payouts":self.in_flight.to_string(),
            "pending_openings":self.pending,"completed_payouts":self.completed.to_string(),"total_paid":self.total_paid.to_string(),
            "revision":self.revision.to_string(),"paused":self.paused,"can_open":self.admission_error().is_none(),
            "storage_per_opening":Self::opening_cost().to_string(),"storage_account_cost":Self::account_cost().to_string(),
            "expected_balance_min":sub(book, flights).to_string(),"expected_balance_max":book.to_string()})
    }
    pub fn get_quote(&self, account_id: AccountId) -> Value {
        let odds = self.odds();
        let error = self.admission_error().or_else(|| {
            if self.active.get(&account_id).is_some() {
                Some("Finish the pending opening first")
            } else if self.credits.get(&account_id).unwrap_or(0) < Self::opening_cost() {
                Some("Prepay case storage in NEAR")
            } else {
                None
            }
        });
        json!({"case_id":self.case_id(),"revision":self.revision.to_string(),"expires_at":env::block_height().checked_add(120).expect("Height overflow").to_string(),
            "nonce":self.next_nonce(&account_id).to_string(),"common":odds.common,"rare":odds.rare,"legendary":odds.legendary,
            "denominator":DENOMINATOR,"target_ev":odds.target_ev.to_string(),"expected_numerator":odds.expected_numerator_for(self.rewards()).to_string(),
            "available":self.available().to_string(),"can_open":error.is_none(),"reason":error})
    }
    pub fn get_opening(&self, opening_id: U64) -> Option<Value> {
        self.read_opening(opening_id.0)
            .map(|o| self.opening_view(&o))
    }
    pub fn get_account_opening(&self, account_id: AccountId) -> Option<Value> {
        self.active
            .get(&account_id)
            .and_then(|id| self.read_opening(id))
            .map(|o| self.opening_view(&o))
    }
    pub fn get_history(&self, account_id: AccountId, limit: u32) -> Vec<Value> {
        let mut id = self.latest.get(&account_id);
        let mut result = Vec::new();
        for _ in 0..limit.min(20) {
            let Some(opening) = id.and_then(|id| self.read_opening(id)) else {
                break;
            };
            id = opening.previous;
            result.push(self.opening_view(&opening));
        }
        result
    }
    /// The cursor is inclusive: it identifies the next linked row to read.
    /// Only rows belonging to the requested account can be traversed.
    pub fn get_history_page(
        &self,
        account_id: AccountId,
        before_opening_id: Option<U64>,
        limit: u32,
    ) -> Value {
        require!(
            (1..=50).contains(&limit),
            "History page limit must be between 1 and 50"
        );
        let mut id = before_opening_id
            .map(|cursor| {
                let row = self.read_opening(cursor.0).expect("Unknown history cursor");
                require!(
                    row.account == account_id,
                    "History cursor belongs to another account"
                );
                cursor.0
            })
            .or_else(|| self.latest.get(&account_id));
        let mut rows = Vec::new();
        for _ in 0..limit {
            let Some(row) = id.and_then(|next| self.read_opening(next)) else {
                break;
            };
            require!(row.account == account_id, "History chain account mismatch");
            id = row.previous;
            rows.push(self.opening_view(&row));
        }
        json!({"openings":rows,"next_cursor":id.map(|next|next.to_string())})
    }
    pub fn storage_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.credits.get(&account_id).unwrap_or(0))
    }
    #[payable]
    pub fn storage_deposit(&mut self) -> U128 {
        let account = env::predecessor_account_id();
        let mut deposit = env::attached_deposit().as_yoctonear();
        if self.credits.get(&account).is_none() {
            require!(
                deposit >= Self::account_cost(),
                "Insufficient account storage deposit"
            );
            deposit = sub(deposit, Self::account_cost());
        }
        let balance = add(self.credits.get(&account).unwrap_or(0), deposit);
        self.credits.insert(&account, &balance);
        U128(balance)
    }
    #[payable]
    pub fn set_paused(&mut self, paused: bool) {
        assert_one_yocto();
        self.assert_owner();
        self.paused = paused;
        self.bump();
    }
    #[payable]
    pub fn advance_opening(&mut self, opening_id: U64) {
        assert_one_yocto();
        require!(
            env::prepaid_gas() >= Gas::from_tgas(100),
            "Attach at least 100 Tgas"
        );
        let opening = self.read_opening(opening_id.0).expect("Unknown opening");
        require!(
            opening.status == Status::RandomnessPending,
            "Draw already selected"
        );
        self.schedule_draw(opening_id.0);
    }
    #[payable]
    pub fn retry_payout(&mut self, opening_id: U64) {
        assert_one_yocto();
        let mut opening = self.read_opening(opening_id.0).expect("Unknown opening");
        let two_legs = !opening.usdi_paid && opening.bonus.is_some() && !opening.bonus_paid;
        require!(
            env::prepaid_gas() >= Gas::from_tgas(if two_legs { 90 } else { 60 }),
            "Attach enough gas for outstanding payout legs"
        );
        require!(
            opening.status == Status::Claimable,
            "Only a confirmed failure can retry"
        );
        require!(
            opening.account == env::predecessor_account_id(),
            "Only the reward owner can retry"
        );
        self.send_payout(&mut opening);
    }
    #[private]
    pub fn resolve_opening(&mut self, opening_id: U64) -> bool {
        self.assert_private();
        let Some(mut opening) = self.read_opening(opening_id.0) else {
            return false;
        };
        if opening.status != Status::RandomnessPending
            || env::block_height() <= opening.accepted_height
        {
            return false;
        }
        let Some(draw) = randomness::draw(opening.id, opening.accepted_height) else {
            return false;
        };
        let tier = bonus::tier(draw, opening.odds);
        let reward = self.rewards()[tier];
        let reserved_bonus = self
            .legacy_openings
            .as_ref()
            .is_none_or(|old| opening.id >= old.end);
        if reserved_bonus {
            opening.bonus = match self.select_bonus(&opening, tier) {
                Ok(selected) => selected,
                Err(()) => return false,
            };
            let mut entries = self.reward_entries();
            for (index, item) in entries.iter_mut().enumerate() {
                if opening.bonus != Some(index as u8) {
                    item.reserved = sub(item.reserved, item.reward.amount.0);
                }
            }
            self.store_entries(&entries);
        }
        opening.reward = Some(reward);
        opening.draw = Some(draw);
        opening.status = Status::Claimable;
        self.reserved = sub(self.reserved, sub(self.maximum_reward(), reward));
        self.bump();
        event(
            "reward_selected",
            json!({"opening_id":opening.id.to_string(),"reward":reward.to_string(),"draw":draw}),
        );
        self.send_payout(&mut opening);
        true
    }
    #[private]
    pub fn on_payout(&mut self, opening_id: U64, attempt: U64) -> bool {
        self.assert_private();
        let Some(mut opening) = self.read_opening(opening_id.0) else {
            return false;
        };
        if opening.status != Status::Paying || opening.attempt != attempt.0 {
            return false;
        }
        let bonus_tier = opening
            .bonus
            .filter(|_| !opening.bonus_paid)
            .map(usize::from);
        let usdi_due = !opening.usdi_paid;
        require!(
            env::promise_results_count() == u64::from(usdi_due) + u64::from(bonus_tier.is_some()),
            "Unexpected transfer result count"
        );
        let reward = opening.reward.expect("Reserved reward");
        if usdi_due {
            self.in_flight = sub(self.in_flight, reward);
            if transfer_succeeded_at(0) {
                self.pool = sub(self.pool, reward);
                self.reserved = sub(self.reserved, reward);
                self.total_paid = add(self.total_paid, reward);
                opening.usdi_paid = true;
            }
        }
        if let Some(tier) = bonus_tier {
            let mut entries = self.reward_entries();
            let item = &mut entries[tier];
            let amount = item.reward.amount.0;
            item.in_flight = sub(item.in_flight, amount);
            if transfer_succeeded_at(u64::from(usdi_due)) {
                item.funds = sub(item.funds, amount);
                item.reserved = sub(item.reserved, amount);
                opening.bonus_paid = true;
            }
            self.store_entries(&entries);
        }
        let success = opening.usdi_paid && (opening.bonus.is_none() || opening.bonus_paid);
        opening.status = if success {
            self.pending_fees = sub(self.pending_fees, self.fee());
            self.fees = add(self.fees, self.fee());
            self.completed = self.completed.checked_add(1).expect("Count overflow");
            self.pending = self.pending.checked_sub(1).expect("Pending underflow");
            self.active.remove(&opening.account);
            Status::Completed
        } else {
            Status::Claimable
        };
        self.openings.insert(&opening.id, &opening);
        self.bump();
        event(
            if success {
                "payout_completed"
            } else {
                "payout_failed"
            },
            self.opening_view(&opening),
        );
        success
    }
    #[payable]
    pub fn withdraw_treasury(&mut self, amount: U128) {
        assert_one_yocto();
        self.assert_owner();
        require!(
            env::prepaid_gas() >= Gas::from_tgas(60),
            "Attach at least 60 Tgas"
        );
        require!(
            self.treasury_transfer.is_none(),
            "Treasury transfer pending"
        );
        require!(
            amount.0 > 0 && amount.0 <= self.fees,
            "Only vested fees are withdrawable"
        );
        self.fees = sub(self.fees, amount.0);
        self.treasury_attempt = self
            .treasury_attempt
            .checked_add(1)
            .expect("Attempt overflow");
        self.treasury_transfer = Some(TreasuryTransfer {
            amount: amount.0,
            attempt: self.treasury_attempt,
        });
        ext_token::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(TRANSFER_GAS)
            .ft_transfer(
                self.treasury.clone(),
                amount,
                Some(format!("Vested {} fees", self.case_id())),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_treasury(U64(self.treasury_attempt)),
            )
            .detach();
    }
    #[private]
    pub fn on_treasury(&mut self, attempt: U64) -> bool {
        self.assert_private();
        let Some(transfer) = self.treasury_transfer.as_ref() else {
            return false;
        };
        if transfer.attempt != attempt.0 {
            return false;
        }
        require!(
            env::promise_results_count() == 1,
            "Expected one transfer result"
        );
        let amount = transfer.amount;
        let success = transfer_succeeded();
        self.treasury_transfer = None;
        if !success {
            self.fees = add(self.fees, amount);
        }
        event(
            "treasury_settled",
            json!({"attempt":attempt.0.to_string(),"amount":amount.to_string(),"success":success}),
        );
        success
    }
}

#[near]
impl FungibleTokenReceiver for CasePool {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let predecessor = env::predecessor_account_id();
        if predecessor != self.token {
            let mut entries = self.reward_entries();
            if let Some(item) = entries
                .iter_mut()
                .find(|item| item.reward.token_contract_id == predecessor)
            {
                if msg.len() <= 128
                    && matches!(
                        near_sdk::serde_json::from_str::<Payment>(&msg),
                        Ok(Payment::Fund)
                    )
                    && (sender_id == self.owner || sender_id == self.treasury)
                    && amount.0 > 0
                    && item.funds.checked_add(amount.0).is_some()
                {
                    item.funds = add(item.funds, amount.0);
                    self.store_entries(&entries);
                    self.bump();
                    event(
                        "bonus_funded",
                        json!({"case_id":self.case_id(),"token_contract_id":predecessor,"sender_id":sender_id,"amount":amount.0.to_string()}),
                    );
                    return PromiseOrValue::Value(U128(0));
                }
                return PromiseOrValue::Value(amount);
            }
            env::panic_str("Only the official USDI token or a configured reward token");
        }
        if msg.len() > 1_024 {
            return PromiseOrValue::Value(amount);
        }
        let Ok(payment) = near_sdk::serde_json::from_str::<Payment>(&msg) else {
            return PromiseOrValue::Value(amount);
        };
        match payment {
            Payment::Fund => {
                if (sender_id != self.owner && sender_id != self.treasury)
                    || amount.0 == 0
                    || self.pool.checked_add(amount.0).is_none()
                {
                    return PromiseOrValue::Value(amount);
                }
                self.pool = add(self.pool, amount.0);
                self.bump();
                event(
                    "pool_funded",
                    json!({"sender_id":sender_id,"amount":amount.0.to_string()}),
                );
            }
            Payment::Open {
                case_id,
                nonce,
                quote,
            } => {
                let now = env::block_height();
                if amount.0 != self.price()
                    || case_id != self.case_id()
                    || self.admission_error().is_some()
                    || self.active.get(&sender_id).is_some()
                    || nonce.0 != self.next_nonce(&sender_id)
                    || quote.revision.0 != self.revision
                    || quote.expires_at.0 < now
                    || quote.expires_at.0 > now.saturating_add(300)
                    || self.credits.get(&sender_id).unwrap_or(0) < Self::opening_cost()
                    || env::prepaid_gas() < Gas::from_tgas(110)
                {
                    event(
                        "payment_refunded",
                        json!({"sender_id":sender_id,"reason":"Invalid, stale, paused, busy, or unfunded opening"}),
                    );
                    return PromiseOrValue::Value(amount);
                }
                let storage_before = env::storage_usage();
                let odds = self.odds();
                let id = self.next_id;
                self.next_id = self.next_id.checked_add(1).expect("Opening ID overflow");
                let opening = Opening {
                    id,
                    account: sender_id.clone(),
                    nonce: nonce.0,
                    previous: self.latest.get(&sender_id),
                    accepted_height: now,
                    revision: self.revision,
                    odds: [odds.common, odds.rare, odds.legendary],
                    status: Status::RandomnessPending,
                    reward: None,
                    draw: None,
                    attempt: 0,
                    bonus: None,
                    usdi_paid: false,
                    bonus_paid: false,
                };
                self.pool = add(self.pool, self.contribution());
                self.pending_fees = add(self.pending_fees, self.fee());
                self.reserved = add(self.reserved, self.maximum_reward());
                let mut entries = self.reward_entries();
                for item in &mut entries {
                    item.reserved = add(item.reserved, item.reward.amount.0);
                }
                self.store_entries(&entries);
                require!(
                    self.pool >= self.reserved,
                    "Insufficient maximum reward reserve"
                );
                self.pending = self.pending.checked_add(1).expect("Count overflow");
                self.credits.insert(
                    &sender_id,
                    &sub(
                        self.credits.get(&sender_id).unwrap_or(0),
                        Self::opening_cost(),
                    ),
                );
                self.openings.insert(&id, &opening);
                self.active.insert(&sender_id, &id);
                self.latest.insert(&sender_id, &id);
                require!(
                    u128::from(env::storage_usage().saturating_sub(storage_before))
                        <= OPENING_BYTES - 128,
                    "Opening exceeded prepaid storage budget"
                );
                self.bump();
                self.schedule_draw(id);
                event("opening_accepted", self.opening_view(&opening));
            }
        }
        // Consume synchronously. A later detached payout failure must not make
        // the FT resolver refund an already accepted and reserved opening.
        PromiseOrValue::Value(U128(0))
    }
}

impl CasePool {
    fn configure_rewards(&mut self, reward_tokens: [AccountId; 3]) {
        for (i, token) in reward_tokens.iter().enumerate() {
            require!(
                token.as_str().ends_with(".testnet")
                    && token != &self.token
                    && token != &env::current_account_id()
                    && !reward_tokens[..i].contains(token),
                "Use distinct Testnet reward contracts"
            );
        }
        self.bonuses = Some(reward_tokens.map(bonus::Inventory::new));
    }

    fn read_opening(&self, id: u64) -> Option<Opening> {
        self.openings
            .get(&id)
            .or_else(|| self.legacy_openings.as_ref()?.get(id))
    }

    fn available(&self) -> u128 {
        sub(self.pool, self.reserved)
    }
    fn treasury_pending(&self) -> u128 {
        self.treasury_transfer.as_ref().map_or(0, |x| x.amount)
    }
    fn opening_cost() -> u128 {
        env::storage_byte_cost()
            .as_yoctonear()
            .checked_mul(OPENING_BYTES)
            .expect("Storage overflow")
    }
    fn account_cost() -> u128 {
        env::storage_byte_cost()
            .as_yoctonear()
            .checked_mul(ACCOUNT_BYTES)
            .expect("Storage overflow")
    }
    fn next_nonce(&self, account: &AccountId) -> u64 {
        self.latest
            .get(account)
            .and_then(|id| self.read_opening(id))
            .map_or(0, |o| o.nonce.checked_add(1).expect("Nonce overflow"))
    }
    fn admission_error(&self) -> Option<&'static str> {
        if self.paused {
            return Some("Case paused");
        }
        if self.available() < self.maximum_reward() {
            return Some("Pool needs enough USDI for the maximum reward");
        }
        if self
            .reward_entries()
            .iter()
            .any(|item| item.available() < item.reward.amount.0)
        {
            return Some("Bonus inventory needs funding");
        }
        let limit = match self.pool_health() {
            iroh_economics::Health::Healthy => 64,
            iroh_economics::Health::Caution => 16,
            iroh_economics::Health::Critical => 4,
        };
        if self.pending >= limit {
            return Some("Pool concurrency limit reached");
        }
        None
    }
    fn opening_view(&self, o: &Opening) -> Value {
        json!({"case_id":self.case_id(),"case_name":self.case_name(),
            "tier":o.draw.map(|draw|["Common","Rare","Legendary"][bonus::tier(draw,o.odds)]),
            "opening_id":o.id.to_string(),"account_id":o.account,"nonce":o.nonce.to_string(),
            "accepted_height":o.accepted_height.to_string(),"accepted_revision":o.revision.to_string(),
            "common":o.odds[0],"rare":o.odds[1],"legendary":o.odds[2],"denominator":DENOMINATOR,
            "status":o.status,"reward":o.reward.map(|v|v.to_string()),"draw":o.draw,"attempt":o.attempt.to_string(),
            "usdi_paid":o.usdi_paid,"bonus_paid":o.bonus_paid,
            "bonus":o.bonus.map(|tier| self.entry_view(usize::from(tier))),
            "reserved":if o.usdi_paid { "0".to_string() } else { o.reward.unwrap_or(self.maximum_reward()).to_string() }})
    }
    fn schedule_draw(&self, id: u64) {
        ext_self::ext(env::current_account_id())
            .with_static_gas(DRAW_GAS)
            .resolve_opening(U64(id))
            .detach();
    }
    fn send_payout(&mut self, opening: &mut Opening) {
        require!(opening.status == Status::Claimable, "Reward not claimable");
        let reward = opening.reward.expect("Stored reward");
        opening.attempt = opening.attempt.checked_add(1).expect("Attempt overflow");
        opening.status = Status::Paying;
        let mut transfer = None;
        if !opening.usdi_paid {
            self.in_flight = add(self.in_flight, reward);
            transfer = Some(Self::transfer_reward(self.token.clone(), opening, reward));
        }
        if let Some(tier) = opening
            .bonus
            .filter(|_| !opening.bonus_paid)
            .map(usize::from)
        {
            let mut entries = self.reward_entries();
            let item = &mut entries[tier];
            let amount = item.reward.amount.0;
            item.in_flight = add(item.in_flight, amount);
            let extra =
                Self::transfer_reward(item.reward.token_contract_id.clone(), opening, amount);
            transfer = Some(match transfer {
                Some(base) => base.and(extra),
                None => extra,
            });
            self.store_entries(&entries);
        }
        self.openings.insert(&opening.id, opening);
        transfer
            .expect("An unpaid reward")
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_payout(U64(opening.id), U64(opening.attempt)),
            )
            .detach();
    }
    fn transfer_reward(token: AccountId, opening: &Opening, amount: u128) -> Promise {
        ext_token::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(TRANSFER_GAS)
            .ft_transfer(
                opening.account.clone(),
                U128(amount),
                Some(format!("Iroh case opening {}", opening.id)),
            )
    }
    fn assert_private(&self) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Private callback"
        );
    }
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Owner only");
    }
    fn bump(&mut self) {
        self.revision = self.revision.checked_add(1).expect("Revision overflow");
    }
}
fn transfer_succeeded() -> bool {
    transfer_succeeded_at(0)
}
fn transfer_succeeded_at(index: u64) -> bool {
    match env::promise_result_checked(index, 16) {
        Ok(_) => true,
        Err(near_sdk::PromiseError::Failed) => false,
        Err(near_sdk::PromiseError::TooLong(_)) => {
            env::panic_str("Unexpected token response; transfer remains in flight")
        }
        Err(_) => env::panic_str("Unknown token response; transfer remains in flight"),
    }
}
fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).expect("Accounting overflow")
}
fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b).expect("Accounting underflow")
}
fn event(name: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"iroh_case","version":"1.0.0","event":name,"data":[data]})
    ));
}

mod randomness {
    use super::*;
    pub fn bonus_bit(id: u64, accepted_height: u64) -> bool {
        let mut input = b"iroh:dragon-tea:bonus:v1".to_vec();
        input.extend_from_slice(&env::random_seed_array());
        input.extend_from_slice(env::current_account_id().as_bytes());
        input.extend_from_slice(&id.to_le_bytes());
        input.extend_from_slice(&accepted_height.to_le_bytes());
        env::sha256_array(&input)[0] & 1 == 1
    }
    pub fn bonus_candidate(id: u64, accepted_height: u64, count: u64) -> Option<u64> {
        let mut input = b"iroh:case:bonus-candidate:v1".to_vec();
        input.extend_from_slice(&env::random_seed_array());
        input.extend_from_slice(env::current_account_id().as_bytes());
        input.extend_from_slice(&id.to_le_bytes());
        input.extend_from_slice(&accepted_height.to_le_bytes());
        let bound = u64::MAX - u64::MAX % count;
        for counter in 0u8..4 {
            input.push(counter);
            let hash = env::sha256_array(&input);
            let value = u64::from_le_bytes(hash[..8].try_into().expect("Eight bytes"));
            if value < bound {
                return Some(value % count);
            }
        }
        None
    }
    pub fn draw(id: u64, accepted_height: u64) -> Option<u32> {
        let mut input = env::random_seed_array().to_vec();
        input.extend_from_slice(env::current_account_id().as_bytes());
        input.extend_from_slice(&id.to_le_bytes());
        input.extend_from_slice(&accepted_height.to_le_bytes());
        let bound = u64::MAX - u64::MAX % u64::from(DENOMINATOR);
        for counter in 0_u8..4 {
            input.push(counter);
            let hash = env::sha256_array(&input);
            let value = u64::from_le_bytes(hash[..8].try_into().expect("Eight hash bytes"));
            if value < bound {
                return Some((value % u64::from(DENOMINATOR)) as u32);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod configured_tests;
