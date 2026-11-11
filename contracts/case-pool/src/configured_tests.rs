use super::*;
use configured::CaseConfig;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{PromiseResult, RuntimeFeesConfig, testing_env};

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn context(predecessor: &str, height: u64) -> near_sdk::VMContext {
    VMContextBuilder::new()
        .current_account_id(account("case.testnet"))
        .predecessor_account_id(account(predecessor))
        .block_height(height)
        .account_balance(NearToken::from_near(100))
        .prepaid_gas(Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(
            if predecessor == "alice.testnet" {
                10u128.pow(24)
            } else {
                0
            },
        ))
        .random_seed([7; 32])
        .build()
}
fn set(predecessor: &str, height: u64) {
    testing_env!(context(predecessor, height));
}
fn config() -> CaseConfig {
    let registry: Value =
        near_sdk::serde_json::from_str(include_str!("../../../config/cases.testnet.json")).unwrap();
    near_sdk::serde_json::from_value(registry["cases"][0]["config"].clone()).unwrap()
}
fn new_case() -> CasePool {
    set("case.testnet", 10);
    CasePool::new_configured(
        account("owner.testnet"),
        account("usdi.testnet"),
        account("treasury.testnet"),
        config(),
    )
}
fn returned(value: PromiseOrValue<U128>) -> u128 {
    match value {
        PromiseOrValue::Value(a) => a.0,
        _ => panic!("Must consume synchronously"),
    }
}
fn fund_and_enable(case: &mut CasePool) {
    set("usdi.testnet", 10);
    assert_eq!(
        returned(case.ft_on_transfer(
            account("owner.testnet"),
            U128(case.target()),
            "{\"action\":\"fund\"}".into()
        )),
        0
    );
    for reward in config().bonus_rewards {
        set(reward.token_contract_id.as_str(), 10);
        assert_eq!(
            returned(case.ft_on_transfer(
                account("owner.testnet"),
                U128(reward.amount.0 * 100),
                "{\"action\":\"fund\"}".into()
            )),
            0
        );
    }
    let mut ctx = context("owner.testnet", 10);
    ctx.attached_deposit = NearToken::from_yoctonear(1);
    testing_env!(ctx);
    case.set_paused(false);
    set("alice.testnet", 10);
    case.storage_deposit();
}
fn message(case: &CasePool) -> String {
    let quote = case.get_quote(account("alice.testnet"));
    json!({"action":"open","case_id":case.case_id(),"nonce":quote["nonce"],"quote":{"revision":quote["revision"],"expires_at":quote["expires_at"]}}).to_string()
}
fn accept(case: &mut CasePool) -> u64 {
    let msg = message(case);
    set("usdi.testnet", 10);
    assert_eq!(
        returned(case.ft_on_transfer(account("alice.testnet"), U128(case.price()), msg)),
        0
    );
    case.next_id - 1
}
fn force_bonus(case: &mut CasePool, id: u64) {
    let mut ctx = context("case.testnet", 11);
    for seed in 0..=255 {
        ctx.random_seed = [seed; 32];
        testing_env!(ctx.clone());
        if randomness::bonus_bit(id, 10) {
            break;
        }
    }
    assert!(case.resolve_opening(U64(id)));
    assert!(case.get_opening(U64(id)).unwrap()["bonus"].is_object());
}
fn finish(case: &mut CasePool, id: u64, attempt: u64, results: Vec<PromiseResult>) -> bool {
    testing_env!(
        context("case.testnet", 12),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
    case.on_payout(U64(id), U64(attempt))
}

#[test]
fn configured_case_starts_paused_with_exact_price_decimals_and_no_inventory() {
    let case = new_case();
    let view = case.get_case();
    assert_eq!(view["case_id"], "bamboo-mist");
    assert_eq!(view["price"], "500000");
    assert_eq!(view["pool_contribution"], "475000");
    assert_eq!(view["platform_fee"], "25000");
    assert_eq!(view["bonus_rewards"][1]["token_decimals"], 24);
    assert_eq!(
        view["bonus_rewards"][1]["amount"],
        "25000000000000000000000000"
    );
    assert_eq!(view["bonus_rewards"][0]["candidates_in_tier"], 2);
    assert_eq!(case.get_pool()["paused"], true);
    assert!(
        case.get_reward_inventory()
            .iter()
            .all(|e| e["funds"] == "0")
    );
}
#[test]
fn configured_admission_reserves_all_candidate_tokens_and_refunds_stale_quote() {
    let mut case = new_case();
    fund_and_enable(&mut case);
    let stale = message(&case);
    let id = accept(&mut case);
    assert_eq!(case.pool, case.target() + 475000);
    assert_eq!(case.reserved, 4000000);
    assert_eq!(case.pending_fees, 25000);
    for entry in case.reward_entries() {
        assert_eq!(entry.reserved, entry.reward.amount.0);
    }
    set("usdi.testnet", 10);
    assert_eq!(
        returned(case.ft_on_transfer(account("bob.testnet"), U128(500000), stale)),
        500000
    );
    assert_eq!(case.next_id, id + 1);
    assert_eq!(
        case.get_pool()["expected_balance_max"],
        (case.target() + 500000).to_string()
    );
    assert_eq!(case.get_quote(account("alice.testnet"))["can_open"], false);
}
#[test]
fn configured_missing_bonus_inventory_cannot_create_an_obligation() {
    let mut case = new_case();
    set("usdi.testnet", 10);
    assert_eq!(
        returned(case.ft_on_transfer(
            account("owner.testnet"),
            U128(case.target()),
            "{\"action\":\"fund\"}".into()
        )),
        0
    );
    let mut ctx = context("owner.testnet", 10);
    ctx.attached_deposit = NearToken::from_yoctonear(1);
    testing_env!(ctx);
    case.set_paused(false);
    set("alice.testnet", 10);
    case.storage_deposit();
    let msg = message(&case);
    set("usdi.testnet", 10);
    assert_eq!(
        returned(case.ft_on_transfer(account("alice.testnet"), U128(500000), msg)),
        500000
    );
    assert_eq!(case.pending, 0);
    assert_eq!(case.reserved, 0);
    assert_eq!(case.pending_fees, 0);
}
#[test]
fn configured_bonus_failure_retries_only_bonus_and_never_changes_result_or_fee() {
    let mut case = new_case();
    fund_and_enable(&mut case);
    let id = accept(&mut case);
    force_bonus(&mut case, id);
    let selected = case.get_opening(U64(id)).unwrap();
    let amount = selected["reward"]
        .as_str()
        .unwrap()
        .parse::<u128>()
        .unwrap();
    assert!(!finish(
        &mut case,
        id,
        1,
        vec![PromiseResult::Successful(vec![]), PromiseResult::Failed]
    ));
    assert_eq!(case.total_paid, amount);
    assert_eq!(case.reserved, 0);
    assert_eq!(case.pending_fees, 25000);
    assert_eq!(case.fees, 0);
    assert_eq!(
        case.reward_entries()
            .iter()
            .filter(|e| e.reserved > 0)
            .count(),
        1
    );
    let mut ctx = context("alice.testnet", 13);
    ctx.attached_deposit = NearToken::from_yoctonear(1);
    testing_env!(ctx);
    case.retry_payout(U64(id));
    assert_eq!(get_created_receipts().len(), 2);
    assert_eq!(case.in_flight, 0);
    assert!(!finish(
        &mut case,
        id,
        1,
        vec![PromiseResult::Successful(vec![])]
    ));
    assert!(finish(
        &mut case,
        id,
        2,
        vec![PromiseResult::Successful(vec![])]
    ));
    assert!(!finish(
        &mut case,
        id,
        2,
        vec![PromiseResult::Successful(vec![])]
    ));
    let complete = case.get_opening(U64(id)).unwrap();
    assert_eq!(complete["reward"], selected["reward"]);
    assert_eq!(complete["draw"], selected["draw"]);
    assert_eq!(
        complete["bonus"],
        case.entry_view(case.openings.get(&id).unwrap().bonus.unwrap() as usize)
    );
    assert_eq!(complete["status"], "Completed");
    assert_eq!(case.total_paid, amount);
    assert_eq!(case.fees, 25000);
    assert!(
        case.reward_entries()
            .iter()
            .all(|e| e.reserved == 0 && e.in_flight == 0)
    );
}
#[test]
fn configured_usdi_failure_keeps_the_same_draw_and_does_not_repeat_paid_bonus() {
    let mut case = new_case();
    fund_and_enable(&mut case);
    let id = accept(&mut case);
    force_bonus(&mut case, id);
    let frozen = case.get_opening(U64(id)).unwrap();
    assert!(!finish(
        &mut case,
        id,
        1,
        vec![PromiseResult::Failed, PromiseResult::Successful(vec![])]
    ));
    assert_eq!(case.total_paid, 0);
    assert!(case.reward_entries().iter().all(|e| e.reserved == 0));
    let mut ctx = context("alice.testnet", 13);
    ctx.attached_deposit = NearToken::from_yoctonear(1);
    testing_env!(ctx);
    case.retry_payout(U64(id));
    assert_eq!(get_created_receipts().len(), 2);
    assert!(finish(
        &mut case,
        id,
        2,
        vec![PromiseResult::Successful(vec![])]
    ));
    let complete = case.get_opening(U64(id)).unwrap();
    assert_eq!(complete["draw"], frozen["draw"]);
    assert_eq!(complete["bonus_paid"], true);
    assert_eq!(case.fees, 25000);
}
#[test]
#[should_panic(expected = "Use distinct Testnet reward contracts")]
fn configured_duplicate_token_ids_are_rejected() {
    set("case.testnet", 10);
    let mut c = config();
    c.bonus_rewards[1].token_contract_id = c.bonus_rewards[0].token_contract_id.clone();
    CasePool::new_configured(
        account("owner.testnet"),
        account("usdi.testnet"),
        account("treasury.testnet"),
        c,
    );
}
#[test]
#[should_panic(expected = "Testnet deployment only")]
fn configured_mainnet_deployment_is_rejected() {
    let mut ctx = context("case.testnet", 10);
    ctx.current_account_id = account("case.near");
    ctx.predecessor_account_id = account("case.near");
    testing_env!(ctx);
    CasePool::new_configured(
        account("owner.testnet"),
        account("usdi.testnet"),
        account("treasury.testnet"),
        config(),
    );
}
#[test]
#[should_panic(expected = "Case account must initialize")]
fn configured_public_initialization_is_rejected() {
    set("alice.testnet", 10);
    CasePool::new_configured(
        account("owner.testnet"),
        account("usdi.testnet"),
        account("treasury.testnet"),
        config(),
    );
}
