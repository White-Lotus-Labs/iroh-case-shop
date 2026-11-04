use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::{PromiseResult, testing_env};
use std::panic::{AssertUnwindSafe, catch_unwind};

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn context(predecessor: &str, deposit: u128) -> VMContextBuilder {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(account("usdi.testnet"))
        .signer_account_id(account(predecessor))
        .predecessor_account_id(account(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit));
    testing_env!(context.build());
    context
}

fn contract() -> Usdi {
    context("owner.testnet", 0);
    Usdi::new(account("owner.testnet"))
}

fn claim(contract: &mut Usdi, claimant: &str) {
    let required = contract.claim_storage_cost(account(claimant)).0;
    context(claimant, required);
    assert_eq!(contract.claim_starter(), U128(1_000_000_000));
}

#[test]
fn initializes_finite_bootstrap_and_test_currency_metadata() {
    let contract = contract();
    assert_eq!(
        contract.ft_balance_of(account("owner.testnet")),
        U128(1_000_000_000)
    );
    assert_eq!(contract.ft_total_supply(), U128(1_000_000_000));
    let metadata = contract.ft_metadata();
    assert_eq!(metadata.name, "USD Iroh");
    assert_eq!(metadata.symbol, "USDI");
    assert_eq!(metadata.decimals, 6);
    assert!(metadata.reference.unwrap().contains("test-currency"));
    assert!(get_logs().iter().any(|log| log.contains("ft_mint")));
}

#[test]
fn initialization_rejects_mainnet_contract_and_owner() {
    let mut ctx = context("owner.testnet", 0);
    ctx.current_account_id(account("usdi.near"));
    testing_env!(ctx.build());
    assert!(catch_unwind(|| Usdi::new(account("owner.testnet"))).is_err());
    context("owner.testnet", 0);
    assert!(catch_unwind(|| Usdi::new(account("owner.near"))).is_err());
}

#[test]
fn initialization_accepts_implicit_owner() {
    context("owner.testnet", 0);
    let owner = account(&"a".repeat(64));
    let contract = Usdi::new(owner.clone());
    assert_eq!(contract.ft_balance_of(owner), U128(1_000_000_000));
}

#[test]
fn first_claim_registers_and_mints_to_predecessor_with_events() {
    let mut contract = contract();
    let mut ctx = context(
        "alice.testnet",
        contract.claim_storage_cost(account("alice.testnet")).0,
    );
    ctx.signer_account_id(account("relay.testnet"));
    testing_env!(ctx.build());
    let before = env::storage_usage();
    contract.claim_starter();
    assert_eq!(
        contract.ft_balance_of(account("alice.testnet")),
        U128(1_000_000_000)
    );
    assert_eq!(contract.ft_balance_of(account("relay.testnet")), U128(0));
    assert_eq!(contract.ft_total_supply(), U128(2_000_000_000));
    assert!(contract.has_claimed(account("alice.testnet")));
    assert!(
        contract
            .storage_balance_of(account("alice.testnet"))
            .is_some()
    );
    assert!(
        env::storage_usage() - before <= contract.token.account_storage_usage + CLAIM_STORAGE_BYTES
    );
    let logs = get_logs();
    assert!(
        logs.iter()
            .any(|log| log.contains("ft_mint") && log.contains("alice.testnet"))
    );
    assert!(logs.iter().any(|log| log.contains("\"event\":\"claimed\"")));
    assert!(get_created_receipts().is_empty());
}

#[test]
fn insufficient_deposit_changes_no_state_or_receipts() {
    let mut contract = contract();
    let cost = contract.claim_storage_cost(account("alice.testnet")).0;
    context("alice.testnet", cost - 1);
    assert!(catch_unwind(AssertUnwindSafe(|| contract.claim_starter())).is_err());
    assert!(!contract.has_claimed(account("alice.testnet")));
    assert!(
        contract
            .storage_balance_of(account("alice.testnet"))
            .is_none()
    );
    assert_eq!(contract.ft_total_supply(), U128(1_000_000_000));
    assert!(get_created_receipts().is_empty());
}

#[test]
fn duplicates_are_atomic_and_accounts_claim_independently() {
    let mut contract = contract();
    claim(&mut contract, "alice.testnet");
    let before = contract.ft_total_supply();
    context("alice.testnet", 10u128.pow(24));
    assert!(catch_unwind(AssertUnwindSafe(|| contract.claim_starter())).is_err());
    assert_eq!(contract.ft_total_supply(), before);
    assert_eq!(
        contract.ft_balance_of(account("alice.testnet")),
        U128(1_000_000_000)
    );
    assert!(get_created_receipts().is_empty());
    claim(&mut contract, "bob.testnet");
    assert_eq!(contract.ft_total_supply(), U128(3_000_000_000));
}

#[test]
fn claim_credits_registered_accounts_and_refunds_only_excess() {
    let mut contract = contract();
    let registration = contract.storage_balance_bounds().min.as_yoctonear();
    context("alice.testnet", registration);
    contract.storage_deposit(None, Some(true));
    let cost = contract.claim_storage_cost(account("alice.testnet")).0;
    assert_eq!(
        cost,
        u128::from(CLAIM_STORAGE_BYTES) * env::storage_byte_cost().as_yoctonear()
    );
    context("alice.testnet", cost + 123);
    contract.claim_starter();
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, account("alice.testnet"));
    assert!(
        matches!(receipts[0].actions.as_slice(), [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == 123)
    );
}

#[test]
fn transfers_and_unregister_preserve_permanent_claim() {
    let mut contract = contract();
    claim(&mut contract, "alice.testnet");
    context("alice.testnet", 1);
    contract.ft_transfer(account("owner.testnet"), U128(1_000_000_000), None);
    assert_eq!(
        contract.ft_balance_of(account("owner.testnet")),
        U128(2_000_000_000)
    );
    assert!(contract.storage_unregister(None));
    assert!(
        contract
            .storage_balance_of(account("alice.testnet"))
            .is_none()
    );
    assert!(contract.has_claimed(account("alice.testnet")));
    context(
        "alice.testnet",
        contract.claim_storage_cost(account("alice.testnet")).0,
    );
    assert!(catch_unwind(AssertUnwindSafe(|| contract.claim_starter())).is_err());
    assert_eq!(contract.ft_total_supply(), U128(2_000_000_000));
}

#[test]
fn overflow_is_rejected_before_registering_or_marking_claimed() {
    let mut contract = contract();
    contract.token.total_supply = u128::MAX;
    let cost = contract.claim_storage_cost(account("alice.testnet")).0;
    context("alice.testnet", cost);
    assert!(catch_unwind(AssertUnwindSafe(|| contract.claim_starter())).is_err());
    assert!(!contract.has_claimed(account("alice.testnet")));
    assert!(
        contract
            .storage_balance_of(account("alice.testnet"))
            .is_none()
    );
    assert_eq!(contract.ft_total_supply(), U128(u128::MAX));
}

#[test]
fn resolver_refunds_receiver_failure_using_standard_accounting() {
    let mut contract = contract();
    claim(&mut contract, "alice.testnet");
    context("owner.testnet", 1);
    contract.ft_transfer(account("alice.testnet"), U128(7), None);
    let ctx = context("usdi.testnet", 0);
    testing_env!(
        ctx.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    assert_eq!(
        contract.ft_resolve_transfer(account("owner.testnet"), account("alice.testnet"), U128(7)),
        U128(0)
    );
    assert_eq!(
        contract.ft_balance_of(account("owner.testnet")),
        U128(1_000_000_000)
    );
    assert_eq!(
        contract.ft_balance_of(account("alice.testnet")),
        U128(1_000_000_000)
    );
}

#[test]
fn resolver_rejects_external_callers_before_mutation() {
    let mut contract = contract();
    claim(&mut contract, "alice.testnet");
    context("alice.testnet", 0);
    assert!(
        catch_unwind(AssertUnwindSafe(|| contract.ft_resolve_transfer(
            account("owner.testnet"),
            account("alice.testnet"),
            U128(7)
        )))
        .is_err()
    );
    assert_eq!(
        contract.ft_balance_of(account("owner.testnet")),
        U128(1_000_000_000)
    );
    assert_eq!(
        contract.ft_balance_of(account("alice.testnet")),
        U128(1_000_000_000)
    );
}

#[test]
fn standard_transfer_requires_one_yocto_and_registered_receiver() {
    let mut contract = contract();
    context("owner.testnet", 0);
    assert!(
        catch_unwind(AssertUnwindSafe(|| contract.ft_transfer(
            account("alice.testnet"),
            U128(1),
            None
        )))
        .is_err()
    );
    assert_eq!(contract.ft_total_supply(), U128(1_000_000_000));
    context("owner.testnet", 1);
    assert!(
        catch_unwind(AssertUnwindSafe(|| contract.ft_transfer(
            account("alice.testnet"),
            U128(1),
            None
        )))
        .is_err()
    );
}

#[test]
fn maximum_length_claim_storage_is_covered_and_registration_fully_refundable() {
    let mut contract = contract();
    let claimant = "b".repeat(64);
    let cost = contract.claim_storage_cost(account(&claimant)).0;
    let refundable = contract.storage_balance_bounds().min.as_yoctonear();
    assert_eq!(
        cost,
        refundable + 256 * env::storage_byte_cost().as_yoctonear()
    );
    context(&claimant, cost);
    let before = env::storage_usage();
    contract.claim_starter();
    assert!(
        u128::from(env::storage_usage() - before) * env::storage_byte_cost().as_yoctonear() <= cost
    );
    assert_eq!(
        contract
            .storage_balance_of(account(&claimant))
            .unwrap()
            .total
            .as_yoctonear(),
        refundable
    );
    context(&claimant, 1);
    assert!(contract.storage_unregister(Some(true)));
    assert_eq!(contract.ft_total_supply(), U128(1_000_000_000));
    assert!(contract.has_claimed(account(&claimant)));
    assert_eq!(get_created_receipts().len(), 1);
    assert!(
        matches!(get_created_receipts()[0].actions.as_slice(), [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == refundable + 1)
    );
}

#[test]
fn transfer_call_schedules_receiver_and_private_resolver_and_partial_refund() {
    let mut contract = contract();
    claim(&mut contract, "alice.testnet");
    context("owner.testnet", 1);
    assert!(matches!(
        contract.ft_transfer_call(
            account("alice.testnet"),
            U128(7),
            None,
            "opening".to_string()
        ),
        PromiseOrValue::Promise(_)
    ));
    assert_eq!(
        contract.ft_balance_of(account("owner.testnet")),
        U128(999_999_993)
    );
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[0].receiver_id, account("alice.testnet"));
    assert_eq!(receipts[1].receiver_id, account("usdi.testnet"));
    assert!(
        matches!(receipts[0].actions.as_slice(), [MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. }]
        if method_name == b"ft_on_transfer" && attached_deposit.as_yoctonear() == 0
        && near_sdk::serde_json::from_slice::<near_sdk::serde_json::Value>(args).unwrap() == near_sdk::serde_json::json!({"sender_id":"owner.testnet","amount":"7","msg":"opening"}))
    );
    assert!(
        matches!(receipts[1].actions.as_slice(), [MockAction::FunctionCallWeight { method_name, .. }] if method_name == b"ft_resolve_transfer")
    );
    let ctx = context("usdi.testnet", 0);
    testing_env!(
        ctx.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(b"\"3\"".to_vec())]
    );
    assert_eq!(
        contract.ft_resolve_transfer(account("owner.testnet"), account("alice.testnet"), U128(7)),
        U128(4)
    );
    assert_eq!(
        contract.ft_balance_of(account("owner.testnet")),
        U128(999_999_996)
    );
    assert_eq!(
        contract.ft_balance_of(account("alice.testnet")),
        U128(1_000_000_004)
    );
    assert_eq!(contract.ft_total_supply(), U128(2_000_000_000));
}

#[test]
fn standard_storage_registration_refunds_excess_and_withdraw_has_no_available_balance() {
    let mut contract = contract();
    let cost = contract.storage_balance_bounds().min;
    context("payer.testnet", cost.as_yoctonear() + 987);
    let balance = contract.storage_deposit(Some(account("alice.testnet")), Some(true));
    assert_eq!(balance.total, cost);
    assert_eq!(balance.available, NearToken::from_yoctonear(0));
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, account("payer.testnet"));
    assert!(
        matches!(receipts[0].actions.as_slice(), [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == 987)
    );
    context("alice.testnet", 1);
    assert_eq!(contract.storage_withdraw(None).available.as_yoctonear(), 0);
    assert!(get_created_receipts().is_empty());
}

#[test]
fn unregistered_claim_cost_covers_standard_refundable_minimum_and_refunds_excess_once() {
    let mut contract = contract();
    assert_eq!(contract.token.account_storage_usage, 125);
    let cost = contract.claim_storage_cost(account("alice.testnet")).0;
    assert_eq!(cost, 381 * env::storage_byte_cost().as_yoctonear());
    context("alice.testnet", cost + 321);
    contract.claim_starter();
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, account("alice.testnet"));
    assert!(
        matches!(receipts[0].actions.as_slice(), [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == 321)
    );
}
