//! Full receipt verification against a fresh local chain. Account mappings
//! replace canonical Testnet IDs only inside this Sandbox process.
use super::*;
use std::collections::BTreeMap;

async fn register(owner: &Account, token: &Contract, account: &Account) -> Result<()> {
    let min = number(
        &view(token, "storage_balance_bounds", json!({})).await?,
        "min",
    )?;
    owner
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id":account.id(),"registration_only":true}))
        .deposit(NearToken::from_yoctonear(min))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?
        .into_result()?;
    Ok(())
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
async fn inventory_balances(game: &Contract, tokens: &BTreeMap<String, Contract>) -> Result<()> {
    for row in view(game, "get_reward_inventory", json!({}))
        .await?
        .as_array()
        .context("Inventory must be an array")?
    {
        let id = row["token_contract_id"].as_str().context("Token id")?;
        let token = tokens
            .values()
            .find(|token| token.id().as_str() == id)
            .context("Unknown mock")?;
        ensure!(
            number(row, "reserved")? == 0 && number(row, "in_flight")? == 0,
            "Pending inventory liability"
        );
        ensure!(
            balance(token, game.as_account()).await? == number(row, "funds")?,
            "Inventory differs from actual token balance: {row}"
        );
    }
    Ok(())
}

pub(super) async fn verify() -> Result<()> {
    let registry: Value = serde_json::from_str(include_str!("../../../config/cases.testnet.json"))?;
    let worker = near_workspaces::sandbox()
        .await
        .context("Start local collection Sandbox")?;
    let namespace = worker
        .create_tla("testnet".parse()?, SecretKey::from_random(KeyType::ED25519))
        .await?
        .into_result()?;
    worker
        .root_account()?
        .transfer_near(namespace.id(), NearToken::from_near(300))
        .await?
        .into_result()?;
    let owner = namespace
        .create_subaccount("owner")
        .initial_balance(NearToken::from_near(15))
        .transact()
        .await?
        .into_result()?;
    let treasury = namespace
        .create_subaccount("treasury")
        .initial_balance(NearToken::from_near(15))
        .transact()
        .await?
        .into_result()?;
    let player = namespace
        .create_subaccount("player")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?;
    let target =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/wasm32-unknown-unknown/release");
    let usdi = namespace
        .create_subaccount("usdi")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?
        .deploy(&std::fs::read(target.join("iroh_usdi.wasm"))?)
        .await?
        .into_result()?;
    owner
        .call(usdi.id(), "new")
        .args_json(json!({"owner_id":owner.id()}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    claim(&player, &usdi).await?;
    claim(&treasury, &usdi).await?;
    let cases = registry["cases"].as_array().context("Cases array")?;
    let mut specifications = BTreeMap::<String, (String, u64, String)>::new();
    for row in cases {
        for reward in row["config"]["bonus_rewards"]
            .as_array()
            .context("Bonus array")?
        {
            specifications.insert(
                reward["token_contract_id"]
                    .as_str()
                    .context("Canonical id")?
                    .into(),
                (
                    reward["token_symbol"].as_str().context("Symbol")?.into(),
                    reward["token_decimals"].as_u64().context("Decimals")?,
                    reward["display_name"].as_str().context("Name")?.into(),
                ),
            );
        }
    }
    let wasm = std::fs::read(target.join("iroh_mock_token.wasm"))?;
    let mut tokens = BTreeMap::<String, Contract>::new();
    for (i, (canonical, (symbol, decimals, name))) in specifications.into_iter().enumerate() {
        let token = namespace
            .create_subaccount(&format!("token-{i}"))
            .initial_balance(NearToken::from_near(6))
            .transact()
            .await?
            .into_result()?
            .deploy(&wasm)
            .await?
            .into_result()?;
        token
            .as_account()
            .call(token.id(), "new")
            .args_json(json!({"asset":symbol.to_ascii_uppercase(),"owner_id":owner.id()}))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        let metadata = view(&token, "ft_metadata", json!({})).await?;
        ensure!(
            metadata["symbol"] == symbol
                && metadata["decimals"] == decimals
                && metadata["name"] == name,
            "Mock metadata differs from case registry: {canonical} {metadata}"
        );
        ensure!(
            supply(&token).await? == 100_000u128 * 10u128.pow(decimals as u32),
            "Fixed supply mismatch"
        );
        register(&owner, &token, &player).await?;
        tokens.insert(canonical, token);
    }
    println!(
        "PASS twelve fixed-supply mock contracts, exact registered names/symbols, 6/18/24 decimals on local receipts"
    );
    let game_wasm = std::fs::read(target.join("iroh_case_pool.wasm"))?;
    let mut games = Vec::<(String, Contract, u128)>::new();
    for (i, row) in cases.iter().enumerate() {
        let id = row["id"].as_str().context("Case id")?.to_string();
        let game = namespace
            .create_subaccount(&format!("case-{i}"))
            .initial_balance(NearToken::from_near(10))
            .transact()
            .await?
            .into_result()?
            .deploy(&game_wasm)
            .await?
            .into_result()?;
        let mut config = row["config"].clone();
        for reward in config["bonus_rewards"]
            .as_array_mut()
            .context("Bonus array")?
        {
            let token = tokens
                .get(
                    reward["token_contract_id"]
                        .as_str()
                        .context("Canonical token")?,
                )
                .context("Mapped token")?;
            reward["token_contract_id"] = token.id().as_str().into();
            register(&owner, token, game.as_account()).await?;
        }
        if id == "dragon-tea" {
            let reward_tokens: Vec<_> = config["bonus_rewards"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| r["token_contract_id"].clone())
                .collect();
            game.as_account().call(game.id(),"new_with_rewards")
                .args_json(json!({"owner_id":owner.id(),"token_id":usdi.id(),"treasury_id":treasury.id(),"reward_tokens":reward_tokens}))
                .max_gas().transact().await?.into_result()?;
            pause(&owner, &game, true).await?;
        } else {
            game.as_account().call(game.id(),"new_configured")
                .args_json(json!({"owner_id":owner.id(),"token_id":usdi.id(),"treasury_id":treasury.id(),"config":config}))
                .max_gas().transact().await?.into_result()?;
        }
        let case = view(&game, "get_case", json!({})).await?;
        ensure!(
            case["case_id"] == id
                && case["name"] == row["name"]
                && case["price"] == config["economy"]["price"],
            "Case metadata or price mismatch"
        );
        ensure!(
            view(&game, "get_pool", json!({})).await?["paused"] == true,
            "Fresh case must start paused"
        );
        register(&owner, &usdi, game.as_account()).await?;
        prepay(&player, &game).await?;
        let funding = match id.as_str() {
            "dragon-tea" => 100_000_000,
            "bamboo-mist" => 50_000_000,
            "moon-spirit" => 150_000_000,
            "phoenix-flame" => 300_000_000,
            _ => 500_000_000,
        };
        let funder = if id == "dragon-tea" {
            &owner
        } else {
            &treasury
        };
        ensure!(
            transfer_call(
                funder,
                &usdi,
                &game,
                funding,
                json!({"action":"fund"}).to_string()
            )
            .await?
                == funding
        );
        pause(&owner, &game, false).await?;
        let unfunded = view(&game, "get_quote", json!({"account_id":player.id()})).await?;
        ensure!(
            unfunded["can_open"] == false,
            "Unfunded bonus inventory must block admission"
        );
        ensure!(
            transfer_call(
                &player,
                &usdi,
                &game,
                number(&case, "price")?,
                message(&unfunded)
            )
            .await?
                == 0,
            "Missing inventory payment must fully refund"
        );
        pause(&owner, &game, true).await?;
        for reward in config["bonus_rewards"].as_array().unwrap() {
            let token = tokens
                .values()
                .find(|t| reward["token_contract_id"] == t.id().as_str())
                .context("Reward token")?;
            let amount = number(reward, "amount")? * 100;
            ensure!(
                transfer_call(
                    &owner,
                    token,
                    &game,
                    amount,
                    json!({"action":"fund"}).to_string()
                )
                .await?
                    == amount
            );
        }
        inventory_balances(&game, &tokens).await?;
        reconcile(&usdi, &game).await?;
        pause(&owner, &game, false).await?;
        games.push((id, game, number(&case, "price")?));
    }
    for index in 0..games.len() {
        let (id, game, price) = &games[index];
        let other_before = async {
            let mut rows = Vec::new();
            for (j, (_, other, _)) in games.iter().enumerate() {
                if j != index {
                    rows.push(view(other, "get_reward_inventory", json!({})).await?);
                }
            }
            Ok::<_, anyhow::Error>(rows)
        }
        .await?;
        let mut selected = false;
        for attempt in 0..24u32 {
            if attempt > 0 && attempt % 6 == 0 {
                prepay(&player, game).await?;
            }
            let quote = view(game, "get_quote", json!({"account_id":player.id()})).await?;
            ensure!(
                quote["can_open"] == true,
                "Configured quote unavailable: {id} {quote}"
            );
            let mut before_tokens = BTreeMap::new();
            for token in tokens.values() {
                before_tokens.insert(token.id().to_string(), balance(token, &player).await?);
            }
            let before = balance(&usdi, &player).await?;
            ensure!(
                transfer_call(&player, &usdi, game, *price, message(&quote)).await? == *price,
                "Valid case payment refunded: {id}"
            );
            let opening = settle(&player, game).await?;
            let reward = number(&opening, "reward")?;
            ensure!(
                opening["case_id"] == *id
                    && opening["status"] == "Completed"
                    && opening["tier"].is_string(),
                "Recorded case result mismatch"
            );
            ensure!(
                balance(&usdi, &player).await? == before - *price + reward,
                "Real USDI balance mismatch: {id}"
            );
            let pool = reconcile(&usdi, game).await?;
            ensure!(
                number(&pool, "treasury_available")? == u128::from(attempt + 1) * (*price / 20),
                "Fee vesting mismatch"
            );
            ensure!(
                transfer_call(&player, &usdi, game, *price, message(&quote)).await? == 0,
                "Stale quote did not fully refund"
            );
            let after_stale = reconcile(&usdi, game).await?;
            ensure!(pool == after_stale, "Stale quote changed book");
            inventory_balances(game, &tokens).await?;
            if let Some(token_id) = opening["bonus"]["token_contract_id"].as_str() {
                let token = tokens
                    .values()
                    .find(|t| t.id().as_str() == token_id)
                    .context("Selected mock")?;
                ensure!(
                    opening["bonus_paid"] == true && opening["usdi_paid"] == true,
                    "Payout legs not confirmed"
                );
                ensure!(
                    balance(token, &player).await?
                        == before_tokens[token_id] + number(&opening["bonus"], "amount")?,
                    "Actual selected bonus did not arrive"
                );
                selected = true;
            }
            if selected {
                break;
            }
        }
        ensure!(selected, "No bonus selected in 24 draws: {id}");
        let mut j = 0;
        for (other_index, (_, other, _)) in games.iter().enumerate() {
            if other_index != index {
                ensure!(
                    view(other, "get_reward_inventory", json!({})).await? == other_before[j],
                    "Opening changed another case inventory"
                );
                j += 1;
            }
        }
        println!(
            "PASS {id}: exact price {price}, actual USDI plus bonus payout, recorded roulette tier, stale-quote refund and independent inventory"
        );
    }
    verify_failed_leg(&owner, &player, &usdi, &games[2].1, games[2].2, &tokens).await?;
    println!(
        "PASS five-case collection Sandbox receipts; shared WASM, independent accounts and actual mock token transfers. LOCAL ONLY, no public Testnet signatures."
    );
    Ok(())
}

async fn verify_failed_leg(
    owner: &Account,
    player: &Account,
    usdi: &Contract,
    game: &Contract,
    price: u128,
    tokens: &BTreeMap<String, Contract>,
) -> Result<()> {
    let inventory = view(game, "get_reward_inventory", json!({})).await?;
    for row in inventory.as_array().unwrap() {
        let token = tokens
            .values()
            .find(|t| row["token_contract_id"] == t.id().as_str())
            .unwrap();
        player
            .call(token.id(), "storage_unregister")
            .args_json(json!({"force":true}))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    for _ in 0..24 {
        prepay(player, game).await?;
        let quote = view(game, "get_quote", json!({"account_id":player.id()})).await?;
        let before = balance(usdi, player).await?;
        ensure!(transfer_call(player, usdi, game, price, message(&quote)).await? == price);
        let mut opening = Value::Null;
        for _ in 0..12 {
            opening = view(
                game,
                "get_history",
                json!({"account_id":player.id(),"limit":1}),
            )
            .await?[0]
                .clone();
            match opening["status"].as_str() {
                Some("Completed" | "Claimable") => break,
                Some("RandomnessPending") => {
                    player
                        .call(game.id(), "advance_opening")
                        .args_json(json!({"opening_id":opening["opening_id"]}))
                        .deposit(NearToken::from_yoctonear(1))
                        .gas(Gas::from_tgas(150))
                        .transact()
                        .await?
                        .into_result()?;
                }
                Some("Paying") => tokio::time::sleep(std::time::Duration::from_millis(250)).await,
                _ => bail!("Unexpected recovery state {opening}"),
            }
        }
        ensure!(
            opening["usdi_paid"] == true
                && balance(usdi, player).await? == before - price + number(&opening, "reward")?
        );
        if opening["bonus"].is_null() {
            continue;
        }
        ensure!(opening["status"] == "Claimable" && opening["bonus_paid"] == false);
        let token = tokens
            .values()
            .find(|t| opening["bonus"]["token_contract_id"] == t.id().as_str())
            .context("Failed token")?;
        let usdi_paid_balance = balance(usdi, player).await?;
        register(owner, token, player).await?;
        player
            .call(game.id(), "retry_payout")
            .args_json(json!({"opening_id":opening["opening_id"]}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?
            .into_result()?;
        let paid = settle(player, game).await?;
        ensure!(
            paid["draw"] == opening["draw"]
                && paid["reward"] == opening["reward"]
                && paid["attempt"] == "2"
        );
        ensure!(
            balance(usdi, player).await? == usdi_paid_balance,
            "Retry duplicated USDI"
        );
        ensure!(
            balance(token, player).await? == number(&paid["bonus"], "amount")?,
            "Retry did not pay exact bonus"
        );
        let duplicate = player
            .call(game.id(), "retry_payout")
            .args_json(json!({"opening_id":opening["opening_id"]}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?;
        ensure!(duplicate.is_failure(), "Completed payout retried");
        inventory_balances(game, tokens).await?;
        reconcile(usdi, game).await?;
        println!(
            "PASS configured multi-candidate case: actual bonus transfer failure, reserved liability, same-draw retry paid only the outstanding token and duplicate retry rejected"
        );
        return Ok(());
    }
    bail!("No selected bonus in 24 recovery openings")
}
