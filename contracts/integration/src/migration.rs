use super::*;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use near_workspaces::Worker;
use near_workspaces::network::Sandbox;

async fn copy_contract(
    worker: &Worker<Sandbox>,
    account: Account,
    snapshot: &Path,
) -> Result<Contract> {
    let wasm = std::fs::read(snapshot.join(format!("{}.wasm", account.id())))?;
    let state: Value = serde_json::from_slice(&std::fs::read(
        snapshot.join(format!("{}-state.json", account.id())),
    )?)?;
    let rows = state["result"]["values"]
        .as_array()
        .context("Expected RPC state rows")?;
    let mut patch = worker.patch(account.id());
    for row in rows {
        let key = STANDARD.decode(row["key"].as_str().context("Missing key")?)?;
        let value = STANDARD.decode(row["value"].as_str().context("Missing value")?)?;
        patch = patch.state(&key, &value);
    }
    let contract = account.deploy(&wasm).await?.into_result()?;
    patch.transact().await?;
    Ok(contract)
}

async fn pause(owner: &Account, game: &Contract, paused: bool) -> Result<()> {
    owner
        .call(game.id(), "set_paused")
        .args_json(json!({"paused":paused}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn register_for(owner: &Account, token: &Contract, account: &Account) -> Result<()> {
    let deposit = number(
        &view(token, "storage_balance_bounds", json!({})).await?,
        "min",
    )?;
    owner
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id":account.id(),"registration_only":true}))
        .deposit(NearToken::from_yoctonear(deposit))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn claimable(owner: &Account, game: &Contract) -> Result<Value> {
    for _ in 0..12 {
        let row = view(
            game,
            "get_account_opening",
            json!({"account_id":owner.id()}),
        )
        .await?;
        match row["status"].as_str() {
            Some("Claimable") => return Ok(row),
            Some("RandomnessPending") => {
                owner
                    .call(game.id(), "advance_opening")
                    .args_json(json!({"opening_id":row["opening_id"]}))
                    .deposit(NearToken::from_yoctonear(1))
                    .gas(Gas::from_tgas(100))
                    .transact()
                    .await?
                    .into_result()?;
            }
            Some("Paying") => tokio::time::sleep(std::time::Duration::from_millis(250)).await,
            _ => bail!("Expected an unpaid opening, got {row}"),
        }
    }
    bail!("Payout failure did not become Claimable")
}

fn legacy_fields(mut row: Value) -> Value {
    let obj = row.as_object_mut().expect("Opening object");
    for key in ["bonus", "bonus_paid", "usdi_paid"] {
        obj.remove(key);
    }
    row
}

pub(super) async fn rehearse(snapshot: &Path) -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let namespace = worker
        .create_tla("testnet".parse()?, SecretKey::from_random(KeyType::ED25519))
        .await?
        .into_result()?;
    let owner = namespace
        .create_subaccount("needmore_1_near")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let game_account = namespace
        .create_subaccount("cases-needmore-1-near")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let usdi_account = namespace
        .create_subaccount("usdi-needmore-1-near")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let game = copy_contract(&worker, game_account, snapshot).await?;
    let usdi = copy_contract(&worker, usdi_account, snapshot).await?;
    let history_args = json!({"account_id":owner.id(),"limit":20});
    let account_args = json!({"account_id":owner.id()});
    let history = view(&game, "get_history", history_args.clone()).await?;
    let old = history
        .as_array()
        .context("Legacy history must be an array")?;
    ensure!(!old.is_empty() && old.iter().all(|row| row["status"] == "Completed"));
    let starting_pool = reconcile(&usdi, &game).await?;
    println!(
        "PASS copied deployed V1 code and state; {} settled openings and {} USDI base units reconcile",
        old.len(),
        number(&starting_pool, "expected_balance_max")?
    );

    let target =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/wasm32-unknown-unknown/release");
    let candidate = std::fs::read(target.join("iroh_case_pool.wasm"))?;
    let rewards = [
        "iroh-test-shitzu.testnet",
        "iroh-test-rhea.testnet",
        "iroh-test-aurora.testnet",
    ];
    let migrate = |revision: Value| {
        Function::new("migrate_v1")
            .args_json(json!({"reward_tokens":rewards,"expected_revision":revision}))
            .gas(Gas::from_tgas(100))
    };
    let unpaused = game
        .as_account()
        .batch(game.id())
        .deploy(&candidate)
        .call(migrate(starting_pool["revision"].clone()))
        .transact()
        .await?;
    ensure!(unpaused.is_failure(), "Unpaused migration must fail");
    ensure!(view(&game, "get_pool", json!({})).await? == starting_pool);
    ensure!(view(&game, "get_history", history_args.clone()).await? == history);
    println!("PASS failed atomic batch leaves V1 code and state readable");

    prepay(&owner, &game).await?;
    let quote = view(&game, "get_quote", account_args.clone()).await?;
    // Both USDI actions execute before the case receiver receipt. The old payout
    // must fail because the recipient has removed their token registration.
    owner.batch(usdi.id())
        .call(Function::new("ft_transfer_call")
            .args_json(json!({"receiver_id":game.id(),"amount":PRICE.to_string(),"memo":null,"msg":message(&quote)}))
            .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(285)))
        .call(Function::new("storage_unregister").args_json(json!({"force":true}))
            .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(15)))
        .transact().await?.into_result()?;
    let pending = claimable(&owner, &game).await?;
    pause(&owner, &game, true).await?;
    let before = view(&game, "get_pool", json!({})).await?;
    let old_state = worker.view_state(game.id()).await?;
    let before_balance = balance(&usdi, game.as_account()).await?;
    let before_credit = view(&game, "storage_balance_of", account_args.clone()).await?;
    let before_quote = view(&game, "get_quote", account_args.clone()).await?;
    let before_history = view(&game, "get_history", history_args.clone()).await?;
    ensure!(
        number(&before, "in_flight_payouts")? == 0
            && number(&before, "reserved_rewards")? == number(&pending, "reward")?
    );

    let wrong_revision = game
        .as_account()
        .batch(game.id())
        .deploy(&candidate)
        .call(migrate(starting_pool["revision"].clone()))
        .transact()
        .await?;
    ensure!(
        wrong_revision.is_failure(),
        "Stale migration revision was accepted"
    );
    ensure!(worker.view_state(game.id()).await? == old_state);
    ensure!(view(&game, "get_pool", json!({})).await? == before);

    let migrated = game
        .as_account()
        .batch(game.id())
        .deploy(&candidate)
        .call(migrate(before["revision"].clone()))
        .transact()
        .await?
        .into_result()
        .context("Atomic migration must preserve live V1 state and a funded claimable payout")?;
    let after = view(&game, "get_pool", json!({})).await?;
    let mut expected = before.clone();
    expected["revision"] = json!((number(&before, "revision")? + 1).to_string());
    ensure!(
        after == expected,
        "USDI pool changed during migration: {after}"
    );
    ensure!(balance(&usdi, game.as_account()).await? == before_balance);
    ensure!(view(&game, "storage_balance_of", account_args.clone()).await? == before_credit);
    let after_quote = view(&game, "get_quote", account_args.clone()).await?;
    for field in [
        "nonce",
        "common",
        "rare",
        "legendary",
        "denominator",
        "target_ev",
        "expected_numerator",
    ] {
        ensure!(
            after_quote[field] == before_quote[field],
            "Quote field {field} changed"
        );
    }
    let mut new_state = worker.view_state(game.id()).await?;
    new_state.remove(b"STATE".as_slice());
    let mut old_state = old_state;
    old_state.remove(b"STATE".as_slice());
    ensure!(
        new_state == old_state,
        "Migration changed existing child records or indexes"
    );
    let after_history = view(&game, "get_history", history_args.clone()).await?;
    ensure!(
        after_history
            .as_array()
            .unwrap()
            .iter()
            .cloned()
            .map(legacy_fields)
            .collect::<Vec<_>>()
            == *before_history.as_array().unwrap()
    );
    ensure!(
        after_history
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["bonus"].is_null())
    );
    ensure!(
        legacy_fields(view(&game, "get_account_opening", account_args.clone()).await?) == pending
    );
    println!(
        "PASS atomic migration preserved history, raw child records, credits, quote odds and USDI book. Gas {}",
        migrated.total_gas_burnt.as_gas()
    );

    register_for(&owner, &usdi, &owner).await?;
    owner
        .call(game.id(), "retry_payout")
        .args_json(json!({"opening_id":pending["opening_id"]}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(60))
        .transact()
        .await?
        .into_result()?;
    let retried = settle(&owner, &game).await?;
    ensure!(
        retried["reward"] == pending["reward"]
            && retried["draw"] == pending["draw"]
            && retried["attempt"] == "2"
            && retried["bonus"].is_null()
    );
    ensure!(balance(&usdi, &owner).await? == number(&pending, "reward")?);
    let duplicate = owner
        .call(game.id(), "retry_payout")
        .args_json(json!({"opening_id":pending["opening_id"]}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(60))
        .transact()
        .await?;
    ensure!(duplicate.is_failure(), "Completed legacy opening retried");
    let settled_pool = reconcile(&usdi, &game).await?;
    ensure!(
        number(&settled_pool, "pool_funds")?
            == number(&before, "pool_funds")? - number(&pending, "reward")?
            && number(&settled_pool, "treasury_available")?
                == number(&before, "treasury_available")? + FEE
    );
    let bootstrap = namespace
        .create_subaccount("migration-player")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    claim(&bootstrap, &usdi).await?;
    bootstrap
        .call(usdi.id(), "ft_transfer")
        .args_json(json!({"receiver_id":owner.id(),"amount":"20000000"}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?
        .into_result()?;
    let before_refund = balance(&usdi, &owner).await?;
    ensure!(transfer_call(&owner, &usdi, &game, PRICE, message(&quote)).await? == 0);
    ensure!(balance(&usdi, &owner).await? == before_refund);
    ensure!(view(&game, "get_pool", json!({})).await? == settled_pool);
    println!(
        "PASS legacy retry used 60 Tgas, paid once, and preserved draw; stale V1 payment was fully refunded"
    );

    verify_activation(
        &namespace,
        &owner,
        &game,
        &usdi,
        &target,
        &rewards,
        &history_args,
        &retried,
        old,
    )
    .await?;

    let v1_wasm = std::fs::read(snapshot.join(format!("{}.wasm", game.id())))?;
    game.as_account().deploy(&v1_wasm).await?.into_result()?;
    ensure!(
        game.view("get_pool").args_json(json!({})).await.is_err(),
        "Old code unexpectedly interpreted the migrated root"
    );
    println!("PASS redeploying V1 code alone cannot recover migrated state");
    Ok(())
}

async fn verify_activation(
    namespace: &Account,
    owner: &Account,
    game: &Contract,
    usdi: &Contract,
    target: &Path,
    reward_ids: &[&str; 3],
    history_args: &Value,
    retried: &Value,
    old: &[Value],
) -> Result<()> {
    let mock_wasm = std::fs::read(target.join("iroh_mock_token.wasm"))?;
    let empty = view(game, "get_reward_inventory", json!({})).await?;
    for (item, id) in empty
        .as_array()
        .context("Missing migrated catalog")?
        .iter()
        .zip(reward_ids)
    {
        ensure!(item["token_contract_id"] == *id && item["funds"] == "0");
    }
    let mut mocks = Vec::new();
    for ((id, asset), quantity) in reward_ids.iter().zip(["SHITZU", "RHEA", "AURORA"]).zip([
        5_000_000_000u128,
        500_000_000,
        100_000_000,
    ]) {
        let name = id
            .strip_suffix(".testnet")
            .context("Testnet token required")?;
        let account = namespace
            .create_subaccount(name)
            .initial_balance(NearToken::from_near(5))
            .transact()
            .await?
            .into_result()?;
        let token = account.deploy(&mock_wasm).await?.into_result()?;
        token
            .call("new")
            .args_json(json!({"asset":asset,"owner_id":owner.id()}))
            .gas(Gas::from_tgas(50))
            .transact()
            .await?
            .into_result()?;
        register_for(game.as_account(), &token, game.as_account()).await?;
        ensure!(
            transfer_call(
                owner,
                &token,
                game,
                quantity,
                json!({"action":"fund"}).to_string()
            )
            .await?
                == quantity
        );
        ensure!(balance(&token, game.as_account()).await? == quantity);
        owner
            .call(token.id(), "storage_unregister")
            .args_json(json!({"force":true}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(30))
            .transact()
            .await?
            .into_result()?;
        mocks.push(token);
    }
    let initial_inventory = view(game, "get_reward_inventory", json!({})).await?;
    pause(owner, game, false).await?;
    let user_args = json!({"account_id":owner.id()});
    for _ in 0..16 {
        prepay(owner, game).await?;
        let quote = view(game, "get_quote", user_args.clone()).await?;
        ensure!(quote["can_open"] == true);
        let before_usdi = balance(usdi, owner).await?;
        ensure!(transfer_call(owner, usdi, game, PRICE, message(&quote)).await? == PRICE);
        let mut opening = Value::Null;
        for _ in 0..12 {
            opening = view(game, "get_history", history_args.clone()).await?[0].clone();
            match opening["status"].as_str() {
                Some("Completed" | "Claimable") => break,
                Some("RandomnessPending") => {
                    owner
                        .call(game.id(), "advance_opening")
                        .args_json(json!({"opening_id":opening["opening_id"]}))
                        .deposit(NearToken::from_yoctonear(1))
                        .gas(Gas::from_tgas(100))
                        .transact()
                        .await?
                        .into_result()?;
                }
                Some("Paying") => tokio::time::sleep(std::time::Duration::from_millis(250)).await,
                _ => bail!("Unexpected status {opening}"),
            }
        }
        ensure!(
            opening["usdi_paid"] == true
                && balance(usdi, owner).await? == before_usdi - PRICE + number(&opening, "reward")?
        );
        if opening["bonus"].is_null() {
            ensure!(opening["status"] == "Completed");
            continue;
        }
        let tier = reward_ids
            .iter()
            .position(|id| opening["bonus"]["token_contract_id"] == *id)
            .context("Unknown selected bonus token")?;
        let token = &mocks[tier];
        let amount = number(&opening["bonus"], "amount")?;
        let funded = number(&initial_inventory[tier], "funds")?;
        ensure!(opening["status"] == "Claimable" && opening["bonus_paid"] == false);
        ensure!(
            balance(token, owner).await? == 0 && balance(token, game.as_account()).await? == funded
        );
        let reserved = view(game, "get_reward_inventory", json!({})).await?;
        for (i, item) in reserved
            .as_array()
            .context("Expected inventory")?
            .iter()
            .enumerate()
        {
            ensure!(number(item, "reserved")? == if i == tier { amount } else { 0 });
            ensure!(number(item, "in_flight")? == 0);
        }
        register_for(owner, token, owner).await?;
        let paid_usdi = balance(usdi, owner).await?;
        owner
            .call(game.id(), "retry_payout")
            .args_json(json!({"opening_id":opening["opening_id"]}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(90))
            .transact()
            .await?
            .into_result()?;
        let paid = settle(owner, game).await?;
        ensure!(paid["bonus_paid"] == true && paid["draw"] == opening["draw"]);
        ensure!(balance(usdi, owner).await? == paid_usdi);
        ensure!(
            balance(token, owner).await? == amount
                && balance(token, game.as_account()).await? == funded - amount
        );
        let ending_inventory = view(game, "get_reward_inventory", json!({})).await?;
        ensure!(
            number(&ending_inventory[tier], "funds")? == funded - amount
                && number(&ending_inventory[tier], "reserved")? == 0
        );
        reconcile(usdi, game).await?;
        let history = view(game, "get_history", history_args.clone()).await?;
        let rows = history.as_array().context("Missing history")?;
        let start = rows
            .len()
            .checked_sub(old.len() + 1)
            .context("Lost history")?;
        ensure!(
            &rows[start] == retried
                && rows[start + 1..]
                    .iter()
                    .cloned()
                    .map(legacy_fields)
                    .eq(old.iter().cloned())
        );
        ensure!(number(&rows[start - 1], "nonce")? == number(retried, "nonce")? + 1);
        println!(
            "PASS migrated case accepted real inventory and a new linked opening; bonus failure reserved one leg and retry paid only that token"
        );
        return Ok(());
    }
    bail!("No bonus selected in 16 Sandbox openings")
}
