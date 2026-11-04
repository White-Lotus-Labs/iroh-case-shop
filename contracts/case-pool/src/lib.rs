use iroh_economics::{
    CONTRIBUTION, DENOMINATOR, FEE, MAX_REWARD, PRICE, TARGET, distribution, health,
};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{Value, json};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, PromiseOrValue, assert_one_yocto, env, ext_contract,
    near, require,
};

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
            openings: LookupMap::new(b"o"),
            active: LookupMap::new(b"a"),
            latest: LookupMap::new(b"l"),
            credits: LookupMap::new(b"c"),
        }
    }

    pub fn get_case(&self) -> Value {
        json!({"case_id":"dragon-tea", "name":"Dragon Tea Case", "token_id":self.token,
            "price":PRICE.to_string(), "pool_contribution":CONTRIBUTION.to_string(), "platform_fee":FEE.to_string(),
            "target":TARGET.to_string(), "probability_denominator":DENOMINATOR,
            "rewards":[{"tier":"Common","amount":"100000"},{"tier":"Rare","amount":"1000000"},{"tier":"Legendary","amount":"5000000"}],
            "randomness":"NEAR protocol randomness; Testnet demonstration, not production-grade VRF",
            "quote_policy":"Exact revision, zero slippage; stale quotes are fully refunded"})
    }
    pub fn get_pool(&self) -> Value {
        let book = add(
            add(self.pool, self.pending_fees),
            add(self.fees, self.treasury_pending()),
        );
        let flights = add(self.in_flight, self.treasury_pending());
        json!({"pool_funds":self.pool.to_string(),"reserved_rewards":self.reserved.to_string(),
            "available":self.available().to_string(),"target":TARGET.to_string(),"health":health(self.available()),
            "pending_fees":self.pending_fees.to_string(),"treasury_available":self.fees.to_string(),
            "treasury_in_flight":self.treasury_pending().to_string(),"in_flight_payouts":self.in_flight.to_string(),
            "pending_openings":self.pending,"completed_payouts":self.completed.to_string(),"total_paid":self.total_paid.to_string(),
            "revision":self.revision.to_string(),"paused":self.paused,"can_open":self.admission_error().is_none(),
            "storage_per_opening":Self::opening_cost().to_string(),"storage_account_cost":Self::account_cost().to_string(),
            "expected_balance_min":sub(book, flights).to_string(),"expected_balance_max":book.to_string()})
    }
    pub fn get_quote(&self, account_id: AccountId) -> Value {
        let odds = distribution(self.available());
        let error = self.admission_error().or_else(|| {
            if self.active.get(&account_id).is_some() {
                Some("Finish the pending opening first")
            } else if self.credits.get(&account_id).unwrap_or(0) < Self::opening_cost() {
                Some("Prepay case storage in NEAR")
            } else {
                None
            }
        });
        json!({"case_id":"dragon-tea","revision":self.revision.to_string(),"expires_at":env::block_height().checked_add(120).expect("Height overflow").to_string(),
            "nonce":self.next_nonce(&account_id).to_string(),"common":odds.common,"rare":odds.rare,"legendary":odds.legendary,
            "denominator":DENOMINATOR,"target_ev":odds.target_ev.to_string(),"expected_numerator":odds.expected_numerator().to_string(),
            "available":self.available().to_string(),"can_open":error.is_none(),"reason":error})
    }
    pub fn get_opening(&self, opening_id: U64) -> Option<Value> {
        self.openings
            .get(&opening_id.0)
            .map(|o| self.opening_view(&o))
    }
    pub fn get_account_opening(&self, account_id: AccountId) -> Option<Value> {
        self.active
            .get(&account_id)
            .and_then(|id| self.openings.get(&id))
            .map(|o| self.opening_view(&o))
    }
    pub fn get_history(&self, account_id: AccountId, limit: u32) -> Vec<Value> {
        let mut id = self.latest.get(&account_id);
        let mut result = Vec::new();
        for _ in 0..limit.min(20) {
            let Some(opening) = id.and_then(|id| self.openings.get(&id)) else {
                break;
            };
            id = opening.previous;
            result.push(self.opening_view(&opening));
        }
        result
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
        let opening = self.openings.get(&opening_id.0).expect("Unknown opening");
        require!(
            opening.status == Status::RandomnessPending,
            "Draw already selected"
        );
        self.schedule_draw(opening_id.0);
    }
    #[payable]
    pub fn retry_payout(&mut self, opening_id: U64) {
        assert_one_yocto();
        require!(
            env::prepaid_gas() >= Gas::from_tgas(60),
            "Attach at least 60 Tgas"
        );
        let mut opening = self.openings.get(&opening_id.0).expect("Unknown opening");
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
        let Some(mut opening) = self.openings.get(&opening_id.0) else {
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
        let reward = if draw < opening.odds[0] {
            100_000
        } else if draw < opening.odds[0] + opening.odds[1] {
            1_000_000
        } else {
            MAX_REWARD
        };
        opening.reward = Some(reward);
        opening.draw = Some(draw);
        opening.status = Status::Claimable;
        self.reserved = sub(self.reserved, sub(MAX_REWARD, reward));
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
        let Some(mut opening) = self.openings.get(&opening_id.0) else {
            return false;
        };
        if opening.status != Status::Paying || opening.attempt != attempt.0 {
            return false;
        }
        require!(
            env::promise_results_count() == 1,
            "Expected one transfer result"
        );
        let reward = opening.reward.expect("Reserved reward");
        let success = transfer_succeeded();
        self.in_flight = sub(self.in_flight, reward);
        if success {
            self.pool = sub(self.pool, reward);
            self.reserved = sub(self.reserved, reward);
            self.pending_fees = sub(self.pending_fees, FEE);
            self.fees = add(self.fees, FEE);
            self.total_paid = add(self.total_paid, reward);
            self.completed = self.completed.checked_add(1).expect("Count overflow");
            self.pending = self.pending.checked_sub(1).expect("Pending underflow");
            self.active.remove(&opening.account);
            opening.status = Status::Completed;
        } else {
            opening.status = Status::Claimable;
        }
        self.openings.insert(&opening.id, &opening);
        self.bump();
        event(
            if success {
                "payout_completed"
            } else {
                "payout_failed"
            },
            json!({"opening_id":opening.id.to_string(),"attempt":attempt.0.to_string(),"reward":reward.to_string()}),
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
                Some("Vested Dragon Tea fees".into()),
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
        require!(
            env::predecessor_account_id() == self.token,
            "Only the official USDI token"
        );
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
                if amount.0 != PRICE
                    || case_id != "dragon-tea"
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
                let odds = distribution(self.available());
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
                };
                self.pool = add(self.pool, CONTRIBUTION);
                self.pending_fees = add(self.pending_fees, FEE);
                self.reserved = add(self.reserved, MAX_REWARD);
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
            .and_then(|id| self.openings.get(&id))
            .map_or(0, |o| o.nonce.checked_add(1).expect("Nonce overflow"))
    }
    fn admission_error(&self) -> Option<&'static str> {
        if self.paused {
            return Some("Case paused");
        }
        if self.available() < MAX_REWARD {
            return Some("Pool needs at least 5 USDI available");
        }
        let limit = match health(self.available()) {
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
        json!({"opening_id":o.id.to_string(),"account_id":o.account,"nonce":o.nonce.to_string(),
            "accepted_height":o.accepted_height.to_string(),"accepted_revision":o.revision.to_string(),
            "common":o.odds[0],"rare":o.odds[1],"legendary":o.odds[2],"denominator":DENOMINATOR,
            "status":o.status,"reward":o.reward.map(|v|v.to_string()),"draw":o.draw,"attempt":o.attempt.to_string(),
            "reserved":if o.status == Status::Completed { "0".to_string() } else { o.reward.unwrap_or(MAX_REWARD).to_string() }})
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
        self.in_flight = add(self.in_flight, reward);
        self.openings.insert(&opening.id, opening);
        ext_token::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(TRANSFER_GAS)
            .ft_transfer(
                opening.account.clone(),
                U128(reward),
                Some(format!("Dragon Tea opening {}", opening.id)),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_payout(U64(opening.id), U64(opening.attempt)),
            )
            .detach();
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
    match env::promise_result_checked(0, 16) {
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
