// Borsh layout of the deployed V1 (case source at 4ef8689). Field order and
// types are part of the on-chain format. The legacy maps use the SDK's
// collections::LookupMap, which stores its prefix in the root, not its values.
use super::*;

#[near(serializers = [borsh])]
struct OpeningV1 {
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

impl From<OpeningV1> for Opening {
    fn from(old: OpeningV1) -> Self {
        Self {
            id: old.id,
            account: old.account,
            nonce: old.nonce,
            previous: old.previous,
            accepted_height: old.accepted_height,
            revision: old.revision,
            odds: old.odds,
            status: old.status,
            reward: old.reward,
            draw: old.draw,
            attempt: old.attempt,
            bonus: None,
            usdi_paid: old.status == Status::Completed,
            bonus_paid: false,
        }
    }
}

#[near(serializers = [borsh])]
pub(super) struct LegacyOpenings {
    pub(super) end: u64,
    openings: LookupMap<u64, OpeningV1>,
}

impl LegacyOpenings {
    pub(super) fn get(&self, id: u64) -> Option<Opening> {
        if id >= self.end {
            return None;
        }
        self.openings.get(&id).map(Opening::from)
    }
}

#[near(serializers = [borsh])]
struct CasePoolV1 {
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
    openings: LookupMap<u64, OpeningV1>,
    active: LookupMap<AccountId, u64>,
    latest: LookupMap<AccountId, u64>,
    credits: LookupMap<AccountId, u128>,
}

#[near]
impl CasePool {
    /// Install the new code and call this method in one self-signed batch.
    /// Legacy claimable and undrawn openings keep their USDI-only obligations.
    #[init(ignore_state)]
    #[private]
    pub fn migrate_v1(reward_tokens: [AccountId; 3], expected_revision: U64) -> Self {
        require!(
            env::current_account_id().as_str().ends_with(".testnet"),
            "Testnet deployment only"
        );
        let old: CasePoolV1 = env::state_read().expect("Missing V1 case state");
        require!(old.paused, "Pause V1 admissions before migration");
        require!(old.revision == expected_revision.0, "V1 revision changed");
        require!(
            old.in_flight == 0 && old.treasury_transfer.is_none(),
            "Wait for V1 transfers to settle"
        );
        let mut case = Self {
            owner: old.owner,
            token: old.token,
            treasury: old.treasury,
            pool: old.pool,
            reserved: old.reserved,
            pending_fees: old.pending_fees,
            fees: old.fees,
            in_flight: old.in_flight,
            treasury_transfer: old.treasury_transfer,
            treasury_attempt: old.treasury_attempt,
            total_paid: old.total_paid,
            completed: old.completed,
            pending: old.pending,
            paused: old.paused,
            revision: old.revision,
            next_id: old.next_id,
            openings: LookupMap::new(b"v"),
            active: old.active,
            latest: old.latest,
            credits: old.credits,
            bonuses: None,
            legacy_openings: Some(LegacyOpenings {
                end: old.next_id,
                openings: old.openings,
            }),
        };
        case.configure_rewards(reward_tokens);
        case.bump();
        case
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
    use near_sdk::{PromiseResult, RuntimeFeesConfig, testing_env};

    fn id(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn case_context() -> near_sdk::VMContext {
        VMContextBuilder::new()
            .current_account_id(id("case.testnet"))
            .predecessor_account_id(id("case.testnet"))
            .block_height(12)
            .random_seed([7; 32])
            .build()
    }

    fn legacy_pending() -> CasePoolV1 {
        testing_env!(case_context());
        let player = id("player.testnet");
        let mut openings = LookupMap::new(b"o");
        let mut active = LookupMap::new(b"a");
        let mut latest = LookupMap::new(b"l");
        openings.insert(
            &0,
            &OpeningV1 {
                id: 0,
                account: player.clone(),
                nonce: 0,
                previous: None,
                accepted_height: 10,
                revision: 6,
                odds: [DENOMINATOR, 0, 0],
                status: Status::RandomnessPending,
                reward: None,
                draw: None,
                attempt: 0,
            },
        );
        active.insert(&player, &0);
        latest.insert(&player, &0);
        CasePoolV1 {
            owner: id("owner.testnet"),
            token: id("usdi.testnet"),
            treasury: id("treasury.testnet"),
            pool: TARGET,
            reserved: MAX_REWARD,
            pending_fees: FEE,
            fees: 0,
            in_flight: 0,
            treasury_transfer: None,
            treasury_attempt: 0,
            total_paid: 0,
            completed: 0,
            pending: 1,
            paused: true,
            revision: 8,
            next_id: 1,
            openings,
            active,
            latest,
            credits: LookupMap::new(b"c"),
        }
    }

    fn reward_ids() -> [AccountId; 3] {
        [
            id("shitzu.testnet"),
            id("rhea.testnet"),
            id("aurora.testnet"),
        ]
    }

    #[test]
    fn undrawn_v1_opening_only_uses_usdi_after_migration() {
        env::state_write(&legacy_pending());
        let mut case = CasePool::migrate_v1(reward_ids(), U64(8));
        assert!(case.resolve_opening(U64(0)));
        let row = case.get_opening(U64(0)).unwrap();
        assert_eq!(row["status"], "Paying");
        assert_eq!(row["reward"], "100000");
        assert!(row["bonus"].is_null());
        assert_eq!(get_created_receipts().len(), 2);
        assert!(
            case.get_reward_inventory()
                .iter()
                .all(|item| item["reserved"] == "0")
        );

        testing_env!(
            case_context(),
            near_sdk::test_vm_config(),
            RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Successful(vec![])]
        );
        assert!(case.on_payout(U64(0), U64(1)));
        assert!(!case.on_payout(U64(0), U64(1)));
        assert_eq!(case.get_pool()["total_paid"], "100000");
        assert_eq!(case.get_pool()["pending_openings"], 0);
        assert_eq!(case.get_opening(U64(0)).unwrap()["status"], "Completed");
    }

    #[test]
    #[should_panic(expected = "Wait for V1 transfers to settle")]
    fn migration_rejects_an_in_flight_legacy_payout() {
        let mut old = legacy_pending();
        old.in_flight = 100_000;
        env::state_write(&old);
        CasePool::migrate_v1(reward_ids(), U64(8));
    }

    #[test]
    #[should_panic(expected = "Wait for V1 transfers to settle")]
    fn migration_rejects_an_in_flight_legacy_treasury_transfer() {
        let mut old = legacy_pending();
        old.treasury_transfer = Some(TreasuryTransfer {
            amount: FEE,
            attempt: 1,
        });
        env::state_write(&old);
        CasePool::migrate_v1(reward_ids(), U64(8));
    }
}
