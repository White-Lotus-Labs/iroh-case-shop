use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::{PromiseResult, RuntimeFeesConfig, testing_env};
use std::collections::HashMap;

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn context(predecessor: &str, deposit: u128, height: u64) -> near_sdk::VMContext {
    VMContextBuilder::new()
        .current_account_id(account("case.testnet"))
        .predecessor_account_id(account(predecessor))
        .signer_account_id(account("alice.testnet"))
        .account_balance(NearToken::from_near(100))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .block_height(height)
        .random_seed([7; 32])
        .build()
}
fn set(predecessor: &str, deposit: u128, height: u64) {
    testing_env!(context(predecessor, deposit, height));
}
fn callback(success: bool) {
    testing_env!(
        context("case.testnet", 0, 12),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        HashMap::default(),
        vec![if success {
            PromiseResult::Successful(vec![])
        } else {
            PromiseResult::Failed
        }]
    );
}
fn refund(value: PromiseOrValue<U128>) -> u128 {
    match value {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("Receiver must consume synchronously"),
    }
}
fn new_pool() -> CasePool {
    set("owner.testnet", 0, 10);
    CasePool::new(
        account("owner.testnet"),
        account("usdi.testnet"),
        account("treasury.testnet"),
    )
}
fn funded() -> CasePool {
    let mut pool = new_pool();
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(
            account("owner.testnet"),
            U128(TARGET),
            "{\"action\":\"fund\"}".into()
        )),
        0
    );
    pool
}
fn register(pool: &mut CasePool, user: &str) {
    set(
        user,
        CasePool::account_cost() + CasePool::opening_cost() * 3,
        10,
    );
    pool.storage_deposit();
}
fn message(pool: &CasePool, user: &str) -> String {
    let quote = pool.get_quote(account(user));
    json!({"action":"open","case_id":"dragon-tea","nonce":quote["nonce"],"quote":{"revision":quote["revision"],"expires_at":quote["expires_at"]}}).to_string()
}
fn accept(pool: &mut CasePool, user: &str) -> u64 {
    register(pool, user);
    let msg = message(pool, user);
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(account(user), U128(PRICE), msg)),
        0
    );
    pool.next_id - 1
}
fn draw(pool: &mut CasePool, id: u64) -> u128 {
    set("case.testnet", 0, 11);
    assert!(pool.resolve_opening(U64(id)));
    pool.openings.get(&id).unwrap().reward.unwrap()
}

#[test]
fn pool_is_unfunded_and_cannot_promise_rewards() {
    let mut pool = new_pool();
    register(&mut pool, "alice.testnet");
    let msg = message(&pool, "alice.testnet");
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(account("alice.testnet"), U128(PRICE), msg)),
        PRICE
    );
    assert_eq!(pool.pool, 0);
    assert_eq!(pool.reserved, 0);
    assert_eq!(pool.pending_fees, 0);
    assert_eq!(pool.get_pool()["health"], "Critical");
}
#[test]
fn valid_payment_consumes_once_and_reserves_maximum_without_spending_fees() {
    let mut pool = funded();
    let id = accept(&mut pool, "alice.testnet");
    assert_eq!(id, 0);
    assert_eq!(pool.pool, TARGET + CONTRIBUTION);
    assert_eq!(pool.reserved, MAX_REWARD);
    assert_eq!(pool.pending_fees, FEE);
    assert_eq!(pool.fees, 0);
    assert_eq!(pool.available(), TARGET + CONTRIBUTION - MAX_REWARD);
    let opening = pool.openings.get(&id).unwrap();
    assert_eq!(opening.odds, [277_778, 672_222, 50_000]);
    assert_eq!(opening.status, Status::RandomnessPending);
    assert_eq!(get_created_receipts().len(), 1);
    assert!(get_logs().iter().any(|l| l.contains("opening_accepted")));
}
#[test]
fn stale_quotes_wrong_amounts_cases_nonces_and_malformed_messages_refund() {
    let mut pool = funded();
    register(&mut pool, "alice.testnet");
    let valid = message(&pool, "alice.testnet");
    set("usdi.testnet", 0, 10);
    for amount in [0, 1, PRICE - 1, PRICE + 1, u128::MAX] {
        assert_eq!(
            refund(pool.ft_on_transfer(account("alice.testnet"), U128(amount), valid.clone())),
            amount
        );
    }
    for msg in [
        "{}".into(),
        "oops".into(),
        valid.replace("dragon-tea", "unknown"),
        valid.replace("\"nonce\":\"0\"", "\"nonce\":\"1\""),
        valid.replace("\"revision\":\"1\"", "\"revision\":\"0\""),
    ] {
        assert_eq!(
            refund(pool.ft_on_transfer(account("alice.testnet"), U128(PRICE), msg)),
            PRICE
        );
    }
    assert_eq!(pool.pool, TARGET);
    assert_eq!(pool.pending_fees, 0);
    assert_eq!(pool.pending, 0);
}
#[test]
fn expired_and_excessively_long_quotes_refund() {
    let mut pool = funded();
    register(&mut pool, "alice.testnet");
    let valid = message(&pool, "alice.testnet");
    set("usdi.testnet", 0, 1000);
    assert_eq!(
        refund(pool.ft_on_transfer(account("alice.testnet"), U128(PRICE), valid)),
        PRICE
    );
    assert_eq!(
        refund(pool.ft_on_transfer(account("alice.testnet"), U128(PRICE), " ".repeat(1025))),
        PRICE
    );
}
#[test]
#[should_panic(expected = "Only the official USDI token")]
fn attacker_cannot_forge_ft_payments() {
    let mut pool = funded();
    set("evil.testnet", 0, 10);
    let _ = pool.ft_on_transfer(account("alice.testnet"), U128(PRICE), "{}".into());
}
#[test]
fn unauthorized_funding_is_refunded() {
    let mut pool = new_pool();
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(
            account("alice.testnet"),
            U128(TARGET),
            "{\"action\":\"fund\"}".into()
        )),
        TARGET
    );
    assert_eq!(pool.pool, 0);
}
#[test]
fn pause_and_unregistered_storage_refund_without_fees() {
    let mut pool = funded();
    let msg = message(&pool, "alice.testnet");
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(account("alice.testnet"), U128(PRICE), msg)),
        PRICE
    );
    register(&mut pool, "alice.testnet");
    set("owner.testnet", 1, 10);
    pool.set_paused(true);
    let msg = message(&pool, "alice.testnet");
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(account("alice.testnet"), U128(PRICE), msg)),
        PRICE
    );
    assert_eq!(pool.fees, 0);
}
#[test]
fn deferred_draw_is_unique_and_accepted_odds_survive_pool_changes() {
    let mut pool = funded();
    let id = accept(&mut pool, "alice.testnet");
    let frozen = pool.openings.get(&id).unwrap().odds;
    set("case.testnet", 0, 10);
    assert!(!pool.resolve_opening(U64(id)));
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(
            account("owner.testnet"),
            U128(TARGET),
            "{\"action\":\"fund\"}".into()
        )),
        0
    );
    let reward = draw(&mut pool, id);
    let o = pool.openings.get(&id).unwrap();
    assert_eq!(o.odds, frozen);
    assert_eq!(pool.reserved, reward);
    assert_eq!(pool.in_flight, reward);
    assert_eq!(o.status, Status::Paying);
    assert!(!pool.resolve_opening(U64(id)));
}
#[test]
fn success_callback_releases_once_and_vests_only_completed_fees() {
    let mut pool = funded();
    let id = accept(&mut pool, "alice.testnet");
    let reward = draw(&mut pool, id);
    callback(true);
    assert!(pool.on_payout(U64(id), U64(1)));
    assert_eq!(pool.pool, TARGET + CONTRIBUTION - reward);
    assert_eq!(pool.reserved, 0);
    assert_eq!(pool.pending_fees, 0);
    assert_eq!(pool.fees, FEE);
    assert_eq!(pool.in_flight, 0);
    assert_eq!(pool.total_paid, reward);
    assert_eq!(pool.pending, 0);
    assert!(pool.get_account_opening(account("alice.testnet")).is_none());
    assert!(!pool.on_payout(U64(id), U64(1)));
    assert_eq!(pool.fees, FEE);
    assert_eq!(pool.get_history(account("alice.testnet"), 100).len(), 1);
}
#[test]
fn failed_transfer_stays_funded_and_retry_never_redraws_or_duplicates() {
    let mut pool = funded();
    let id = accept(&mut pool, "alice.testnet");
    let reward = draw(&mut pool, id);
    callback(false);
    assert!(!pool.on_payout(U64(id), U64(1)));
    assert_eq!(pool.reserved, reward);
    assert_eq!(pool.pending_fees, FEE);
    assert_eq!(pool.fees, 0);
    assert_eq!(pool.pool, TARGET + CONTRIBUTION);
    set("alice.testnet", 1, 13);
    pool.retry_payout(U64(id));
    let retry = pool.openings.get(&id).unwrap();
    assert_eq!(retry.reward, Some(reward));
    assert_eq!(retry.attempt, 2);
    callback(true);
    assert!(!pool.on_payout(U64(id), U64(1)));
    assert!(pool.on_payout(U64(id), U64(2)));
    assert_eq!(pool.total_paid, reward);
    assert_eq!(pool.reserved, 0);
}
#[test]
#[should_panic(expected = "Only a confirmed failure can retry")]
fn unknown_in_flight_transfer_cannot_be_retried() {
    let mut pool = funded();
    let id = accept(&mut pool, "alice.testnet");
    draw(&mut pool, id);
    set("alice.testnet", 1, 15);
    pool.retry_payout(U64(id));
}
#[test]
#[should_panic(expected = "Private callback")]
fn payout_callback_is_private() {
    let mut pool = funded();
    set("alice.testnet", 0, 10);
    pool.on_payout(U64(0), U64(0));
}
#[test]
#[should_panic(expected = "Private callback")]
fn draw_callback_is_private() {
    let mut pool = funded();
    set("alice.testnet", 0, 10);
    pool.resolve_opening(U64(0));
}
#[test]
fn concurrent_openings_reserve_funds_and_limit_risk() {
    let mut pool = funded();
    for i in 0..1000 {
        let user = format!("player{i}.testnet");
        register(&mut pool, &user);
        let msg = message(&pool, &user);
        set("usdi.testnet", 0, 10);
        let refunded = refund(pool.ft_on_transfer(account(&user), U128(PRICE), msg));
        assert!(pool.pool >= pool.reserved);
        if i < 50 {
            assert_eq!(refunded, 0)
        } // Availability falls into Caution before 64 admissions.
    }
    assert!(pool.pending <= 64);
    assert!(pool.pending >= 16);
    assert_eq!(pool.reserved, u128::from(pool.pending) * MAX_REWARD);
    assert_eq!(pool.pending_fees, u128::from(pool.pending) * FEE);
}
#[test]
fn one_pending_per_user_and_nonce_prevent_replay() {
    let mut pool = funded();
    let id = accept(&mut pool, "alice.testnet");
    let msg = message(&pool, "alice.testnet");
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(account("alice.testnet"), U128(PRICE), msg)),
        PRICE
    );
    draw(&mut pool, id);
    callback(true);
    pool.on_payout(U64(id), U64(1));
    assert_eq!(pool.get_quote(account("alice.testnet"))["nonce"], "1");
    let msg = message(&pool, "alice.testnet").replace("\"nonce\":\"1\"", "\"nonce\":\"0\"");
    set("usdi.testnet", 0, 14);
    assert_eq!(
        refund(pool.ft_on_transfer(account("alice.testnet"), U128(PRICE), msg)),
        PRICE
    );
}
#[test]
fn critical_and_caution_limits_and_health_recovery() {
    let mut pool = new_pool();
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(
            account("owner.testnet"),
            U128(6_000_000),
            "{\"action\":\"fund\"}".into()
        )),
        0
    );
    accept(&mut pool, "alice.testnet");
    assert_eq!(pool.get_pool()["health"], "Critical");
    assert!(pool.admission_error().is_some());
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(
            account("owner.testnet"),
            U128(TARGET),
            "{\"action\":\"fund\"}".into()
        )),
        0
    );
    assert_eq!(pool.get_pool()["health"], "Healthy");
    assert!(pool.admission_error().is_none());
}
#[test]
fn treasury_uses_only_vested_fees_and_failed_withdrawal_restores_once() {
    let mut pool = funded();
    let id = accept(&mut pool, "alice.testnet");
    draw(&mut pool, id);
    callback(true);
    pool.on_payout(U64(id), U64(1));
    let reserve = pool.pool;
    set("owner.testnet", 1, 15);
    pool.withdraw_treasury(U128(FEE));
    assert_eq!(pool.fees, 0);
    assert_eq!(pool.treasury_pending(), FEE);
    callback(false);
    assert!(!pool.on_treasury(U64(1)));
    assert_eq!(pool.fees, FEE);
    assert!(!pool.on_treasury(U64(1)));
    assert_eq!(pool.fees, FEE);
    set("owner.testnet", 1, 15);
    pool.withdraw_treasury(U128(FEE));
    callback(true);
    assert!(pool.on_treasury(U64(2)));
    assert_eq!(pool.fees, 0);
    assert_eq!(pool.pool, reserve);
}
#[test]
fn reconciliation_bounds_cover_transfers_in_flight_and_equal_at_quiescence() {
    let mut pool = funded();
    let id = accept(&mut pool, "alice.testnet");
    let reward = draw(&mut pool, id);
    let view = pool.get_pool();
    assert_eq!(view["expected_balance_max"], (TARGET + PRICE).to_string());
    assert_eq!(
        view["expected_balance_min"],
        (TARGET + PRICE - reward).to_string()
    );
    callback(true);
    pool.on_payout(U64(id), U64(1));
    let view = pool.get_pool();
    assert_eq!(view["expected_balance_min"], view["expected_balance_max"]);
}
#[test]
#[should_panic(expected = "Testnet deployment only")]
fn mainnet_named_deployment_is_disabled() {
    let ctx = VMContextBuilder::new()
        .current_account_id(account("case.near"))
        .build();
    testing_env!(ctx);
    CasePool::new(
        account("owner.near"),
        account("usdi.near"),
        account("treasury.near"),
    );
}

#[test]
fn bonus_inventory_reserves_all_outcomes_and_retries_only_the_failed_leg() {
    set("case.testnet", 0, 10);
    let mut pool = CasePool::new_with_rewards(
        account("owner.testnet"),
        account("usdi.testnet"),
        account("treasury.testnet"),
        ["shitzu.testnet", "rhea.testnet", "aurora.testnet"].map(account),
    );
    let fund = "{\"action\":\"fund\"}".to_string();
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(account("owner.testnet"), U128(TARGET), fund.clone())),
        0
    );
    register(&mut pool, "alice.testnet");
    let unfunded = message(&pool, "alice.testnet");
    set("usdi.testnet", 0, 10);
    assert_eq!(
        refund(pool.ft_on_transfer(account("alice.testnet"), U128(PRICE), unfunded)),
        PRICE
    );
    for (i, token) in ["shitzu.testnet", "rhea.testnet", "aurora.testnet"]
        .into_iter()
        .enumerate()
    {
        set(token, 0, 10);
        let amount = U128(bonus::amount(i));
        assert_eq!(
            refund(pool.ft_on_transfer(account("alice.testnet"), amount, fund.clone())),
            amount.0
        );
        assert_eq!(
            refund(pool.ft_on_transfer(account("owner.testnet"), amount, fund.clone())),
            0
        );
    }
    let id = accept(&mut pool, "alice.testnet");
    assert!(
        pool.get_reward_inventory()
            .iter()
            .all(|item| item["available"] == "0")
    );
    let mut context = context("case.testnet", 0, 11);
    for seed in 0..=255 {
        context.random_seed = [seed; 32];
        testing_env!(context.clone());
        if randomness::bonus_bit(id, 10) {
            break;
        }
    }
    assert!(pool.resolve_opening(U64(id)));
    let opening = pool.openings.get(&id).unwrap();
    let tier = usize::from(opening.bonus.expect("Test seed selects a bonus"));
    let reward = opening.reward.unwrap();
    let bonus = bonus::amount(tier);
    assert_eq!(
        pool.get_reward_inventory()[tier]["in_flight"],
        bonus.to_string()
    );
    assert_eq!(
        pool.get_reward_inventory()
            .iter()
            .filter(|item| item["reserved"] != "0")
            .count(),
        1
    );
    testing_env!(
        context,
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        HashMap::default(),
        vec![PromiseResult::Successful(vec![]), PromiseResult::Failed]
    );
    assert!(!pool.on_payout(U64(id), U64(1)));
    assert_eq!(pool.total_paid, reward);
    assert_eq!(pool.reserved, 0);
    assert_eq!(pool.pending_fees, FEE);
    assert_eq!(
        pool.get_reward_inventory()[tier]["reserved"],
        bonus.to_string()
    );
    assert_eq!(pool.get_opening(U64(id)).unwrap()["usdi_paid"], true);
    set("alice.testnet", 1, 12);
    pool.retry_payout(U64(id));
    assert_eq!(pool.in_flight, 0);
    assert_eq!(get_created_receipts().len(), 2);
    callback(true);
    assert!(pool.on_payout(U64(id), U64(2)));
    assert_eq!(pool.total_paid, reward);
    assert_eq!(pool.get_reward_inventory()[tier]["funds"], "0");
    assert_eq!(pool.get_opening(U64(id)).unwrap()["bonus_paid"], true);
    assert_eq!(pool.fees, FEE);
}

#[test]
fn bonus_selection_preserves_rarity_boundaries() {
    let odds = [277_778, 672_222, 50_000];
    for (draw, expected) in [
        (0, 0),
        (277_777, 0),
        (277_778, 1),
        (949_999, 1),
        (950_000, 2),
        (999_999, 2),
    ] {
        let tier = bonus::tier(draw, odds);
        assert_eq!(tier, expected);
        assert_eq!(bonus::selected(tier, true, true), Some(expected as u8));
        assert_eq!(bonus::selected(tier, false, true), None);
        assert_eq!(bonus::selected(tier, true, false), None);
    }
}
