use anyhow::{Context, Result, bail, ensure};
use near_workspaces::operations::Function;
use near_workspaces::types::{Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract};
use serde_json::{Value, json};
use std::path::Path;

const STARTER: u128 = 1_000_000_000;
const PRICE: u128 = 1_000_000;
const CONTRIBUTION: u128 = 950_000;
const FEE: u128 = 50_000;

fn number(value: &Value, field: &str) -> Result<u128> {
    value[field]
        .as_str()
        .with_context(|| format!("Missing string field {field}: {value}"))?
        .parse()
        .with_context(|| format!("Invalid integer field {field}"))
}

async fn view(contract: &Contract, method: &str, args: Value) -> Result<Value> {
    Ok(contract.view(method).args_json(args).await?.json()?)
}

async fn balance(token: &Contract, account: &Account) -> Result<u128> {
    let value = view(token, "ft_balance_of", json!({"account_id": account.id()})).await?;
    Ok(value
        .as_str()
        .context("Token balance is not a string")?
        .parse()?)
}

async fn supply(token: &Contract) -> Result<u128> {
    let value = view(token, "ft_total_supply", json!({})).await?;
    Ok(value.as_str().context("Supply is not a string")?.parse()?)
}

async fn claim(account: &Account, token: &Contract) -> Result<()> {
    let cost = view(
        token,
        "claim_storage_cost",
        json!({"account_id": account.id()}),
    )
    .await?;
    let cost: u128 = cost
        .as_str()
        .context("Claim storage cost is not a string")?
        .parse()?;
    account
        .call(token.id(), "claim_starter")
        .args_json(json!({}))
        .deposit(NearToken::from_yoctonear(cost))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?
        .into_result()?;
    ensure!(
        balance(token, account).await? == STARTER,
        "Wrong starter allocation"
    );
    ensure!(
        view(token, "has_claimed", json!({"account_id":account.id()})).await? == true,
        "Permanent faucet marker was not recorded"
    );
    Ok(())
}

async fn prepay(account: &Account, game: &Contract) -> Result<()> {
    let pool = view(game, "get_pool", json!({})).await?;
    let cost = number(&pool, "storage_account_cost")?
        .checked_add(
            number(&pool, "storage_per_opening")?
                .checked_mul(8)
                .context("Storage overflow")?,
        )
        .context("Storage overflow")?;
    account
        .call(game.id(), "storage_deposit")
        .args_json(json!({}))
        .deposit(NearToken::from_yoctonear(cost))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

fn message(quote: &Value) -> String {
    json!({"action":"open", "case_id":"dragon-tea", "nonce":quote["nonce"],
        "quote":{"revision":quote["revision"], "expires_at":quote["expires_at"]}})
    .to_string()
}

async fn transfer_call(
    account: &Account,
    token: &Contract,
    game: &Contract,
    amount: u128,
    msg: String,
) -> Result<u128> {
    let outcome = account
        .call(token.id(), "ft_transfer_call")
        .args_json(
            json!({"receiver_id":game.id(),"amount":amount.to_string(),"memo":null,"msg":msg}),
        )
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(250))
        .transact()
        .await?
        .into_result()
        .context("ft_transfer_call or a receipt failed")?;
    let used: String = outcome.json()?;
    Ok(used.parse()?)
}

async fn settle(account: &Account, game: &Contract) -> Result<Value> {
    for _ in 0..12 {
        let history = view(
            game,
            "get_history",
            json!({"account_id":account.id(),"limit":1}),
        )
        .await?;
        let opening = history
            .as_array()
            .and_then(|items| items.first())
            .context("Payment produced no persisted opening")?
            .clone();
        match opening["status"]
            .as_str()
            .context("Missing opening status")?
        {
            "Completed" => return Ok(opening),
            "RandomnessPending" => {
                account
                    .call(game.id(), "advance_opening")
                    .args_json(json!({"opening_id":opening["opening_id"]}))
                    .deposit(NearToken::from_yoctonear(1))
                    .gas(Gas::from_tgas(150))
                    .transact()
                    .await?
                    .into_result()?;
            }
            "Paying" => tokio::time::sleep(std::time::Duration::from_millis(250)).await,
            "Claimable" => bail!("Genuine payout failed and remains reserved: {opening}"),
            status => bail!("Unexpected opening status {status}"),
        }
    }
    bail!("Opening did not settle after bounded receipt recovery")
}

async fn reconcile(token: &Contract, game: &Contract) -> Result<Value> {
    let pool = view(game, "get_pool", json!({})).await?;
    let book = number(&pool, "pool_funds")?
        + number(&pool, "pending_fees")?
        + number(&pool, "treasury_available")?
        + number(&pool, "treasury_in_flight")?;
    ensure!(
        number(&pool, "in_flight_payouts")? == 0,
        "Payout still in flight"
    );
    ensure!(
        number(&pool, "treasury_in_flight")? == 0,
        "Treasury still in flight"
    );
    ensure!(
        number(&pool, "reserved_rewards")? == 0,
        "Reward reservation did not clear"
    );
    ensure!(pool["pending_openings"] == 0, "An opening remains pending");
    ensure!(
        balance(token, game.as_account()).await? == book,
        "Real USDI balance differs from book accounting: {pool}"
    );
    ensure!(
        number(&pool, "expected_balance_min")? == book
            && number(&pool, "expected_balance_max")? == book,
        "Quiescent reconciliation bounds differ"
    );
    Ok(pool)
}

#[tokio::main]
async fn main() -> Result<()> {
    // sandbox() is a fresh local chain. No Testnet RPC, local wallet, saved key,
    // user credentials or environment configuration is used by this program.
    let worker = near_workspaces::sandbox()
        .await
        .context("Could not start local NEAR Sandbox")?;
    let namespace = worker
        .create_tla("testnet".parse()?, SecretKey::from_random(KeyType::ED25519))
        .await?
        .into_result()?;
    let owner = namespace
        .create_subaccount("owner")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let alice = namespace
        .create_subaccount("alice")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let bob = namespace
        .create_subaccount("bob")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let treasury = namespace
        .create_subaccount("treasury")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let token_account = namespace
        .create_subaccount("usdi")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let game_account = namespace
        .create_subaccount("case")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let target =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/wasm32-unknown-unknown/release");
    let token = token_account
        .deploy(&std::fs::read(target.join("iroh_usdi.wasm")).context("Build USDI wasm first")?)
        .await?
        .into_result()?;
    let game = game_account
        .deploy(
            &std::fs::read(target.join("iroh_case_pool.wasm"))
                .context("Build case-pool wasm first")?,
        )
        .await?
        .into_result()?;
    owner
        .call(token.id(), "new")
        .args_json(json!({"owner_id":owner.id()}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    owner
        .call(game.id(), "new")
        .args_json(json!({"owner_id":owner.id(),"token_id":token.id(),"treasury_id":treasury.id()}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    ensure!(
        supply(&token).await? == STARTER,
        "Bootstrap supply is not exactly 1,000 USDI"
    );
    ensure!(
        balance(&token, &owner).await? == STARTER,
        "Bootstrap is not held by owner"
    );
    let metadata = view(&token, "ft_metadata", json!({})).await?;
    ensure!(
        metadata["symbol"] == "USDI" && metadata["decimals"] == 6,
        "Incorrect token metadata"
    );
    let bounds = view(&token, "storage_balance_bounds", json!({})).await?;
    let registration = number(&bounds, "min")?;
    owner
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id":game.id(),"registration_only":true}))
        .deposit(NearToken::from_yoctonear(registration))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    ensure!(
        transfer_call(
            &owner,
            &token,
            &game,
            STARTER,
            json!({"action":"fund"}).to_string()
        )
        .await?
            == STARTER,
        "Real bootstrap funding was refunded"
    );
    ensure!(
        number(&reconcile(&token, &game).await?, "pool_funds")? == STARTER,
        "Pool was not funded with real tokens"
    );
    claim(&alice, &token).await?;
    ensure!(
        supply(&token).await? == STARTER * 2,
        "Faucet supply is incorrect"
    );
    let duplicate = alice
        .call(token.id(), "claim_starter")
        .args_json(json!({}))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?;
    ensure!(duplicate.is_failure(), "Duplicate faucet claim succeeded");
    ensure!(
        balance(&token, &alice).await? == STARTER && supply(&token).await? == STARTER * 2,
        "Duplicate claim changed balance or supply"
    );
    prepay(&alice, &game).await?;
    let quote = view(&game, "get_quote", json!({"account_id":alice.id()})).await?;
    ensure!(
        quote["can_open"] == true,
        "Funded opening quote unavailable: {quote}"
    );
    ensure!(
        transfer_call(&alice, &token, &game, PRICE, message(&quote)).await? == PRICE,
        "Valid payment was refunded"
    );
    let opening = settle(&alice, &game).await?;
    let reward = number(&opening, "reward")?;
    ensure!(
        [100_000, 1_000_000, 5_000_000].contains(&reward),
        "Unknown reward tier"
    );
    ensure!(
        balance(&token, &alice).await? == STARTER - PRICE + reward,
        "Payout did not reach real Alice token balance"
    );
    ensure!(
        view(
            &game,
            "get_account_opening",
            json!({"account_id":alice.id()})
        )
        .await?
        .is_null(),
        "Completed opening remains active"
    );
    let after = reconcile(&token, &game).await?;
    ensure!(
        number(&after, "pool_funds")? == STARTER + CONTRIBUTION - reward,
        "Pool changed by incorrect amount"
    );
    ensure!(
        number(&after, "treasury_available")? == FEE && number(&after, "pending_fees")? == 0,
        "Completed fee did not vest exactly once"
    );
    println!(
        "PASS genuine receipt pipeline: opening {}, reward {} units",
        opening["opening_id"], reward
    );

    let alice_before = balance(&token, &alice).await?;
    let quote = view(&game, "get_quote", json!({"account_id":alice.id()})).await?;
    ensure!(
        transfer_call(&alice, &token, &game, PRICE + 1, message(&quote)).await? == 0,
        "Wrong amount was not fully refunded"
    );
    let mut stale = quote;
    stale["revision"] = (number(&stale, "revision")?
        .checked_sub(1)
        .context("Expected nonzero revision")?)
    .to_string()
    .into();
    ensure!(
        transfer_call(&alice, &token, &game, PRICE, message(&stale)).await? == 0,
        "Stale quote was not fully refunded"
    );
    ensure!(
        balance(&token, &alice).await? == alice_before,
        "Rejected payments changed Alice balance"
    );
    ensure!(
        reconcile(&token, &game).await? == after,
        "Rejected payments charged fees or changed pool state"
    );
    let unauthorized = alice
        .call(game.id(), "ft_on_transfer")
        .args_json(json!({"sender_id":alice.id(),"amount":PRICE.to_string(),"msg":message(&stale)}))
        .max_gas()
        .transact()
        .await?;
    ensure!(
        unauthorized.is_failure(),
        "A forged token payment was accepted"
    );
    println!("PASS full refunds and forged-token authorization on local receipts");

    claim(&bob, &token).await?;
    prepay(&bob, &game).await?;
    let mut total_rewards = reward;
    for account in [&bob, &alice, &bob] {
        let before = balance(&token, account).await?;
        let quote = view(&game, "get_quote", json!({"account_id":account.id()})).await?;
        ensure!(
            transfer_call(account, &token, &game, PRICE, message(&quote)).await? == PRICE,
            "Sequential opening was refunded"
        );
        let opening = settle(account, &game).await?;
        let reward = number(&opening, "reward")?;
        ensure!(
            balance(&token, account).await? == before - PRICE + reward,
            "Sequential payout balance mismatch"
        );
        total_rewards += reward;
        reconcile(&token, &game).await?;
    }
    let final_pool = reconcile(&token, &game).await?;
    ensure!(
        number(&final_pool, "pool_funds")? == STARTER + CONTRIBUTION * 4 - total_rewards,
        "Multi-account pool conservation failed"
    );
    ensure!(
        number(&final_pool, "treasury_available")? == FEE * 4,
        "Multi-account fee conservation failed"
    );
    ensure!(
        supply(&token).await? == STARTER * 3,
        "Transfers unexpectedly changed supply"
    );
    println!(
        "PASS 4 completed real openings across 2 accounts; supply, reward and fee conservation"
    );

    let alice_before = balance(&token, &alice).await?;
    let bob_before = balance(&token, &bob).await?;
    let alice_quote = view(&game, "get_quote", json!({"account_id":alice.id()})).await?;
    let bob_quote = view(&game, "get_quote", json!({"account_id":bob.id()})).await?;
    ensure!(
        alice_quote["revision"] == bob_quote["revision"],
        "Race quotes differ"
    );
    let (alice_used, bob_used) = tokio::join!(
        transfer_call(&alice, &token, &game, PRICE, message(&alice_quote)),
        transfer_call(&bob, &token, &game, PRICE, message(&bob_quote))
    );
    let alice_used = alice_used?;
    let bob_used = bob_used?;
    ensure!(
        [0, PRICE].contains(&alice_used)
            && [0, PRICE].contains(&bob_used)
            && alice_used + bob_used == PRICE,
        "Exact-revision concurrent quotes must consume one payment and refund the other"
    );
    let winner = if alice_used == PRICE { &alice } else { &bob };
    let race_opening = settle(winner, &game).await?;
    let race_reward = number(&race_opening, "reward")?;
    ensure!(
        balance(&token, &alice).await?
            == alice_before - alice_used + if alice_used == PRICE { race_reward } else { 0 },
        "Concurrent Alice balance mismatch"
    );
    ensure!(
        balance(&token, &bob).await?
            == bob_before - bob_used + if bob_used == PRICE { race_reward } else { 0 },
        "Concurrent Bob balance mismatch"
    );
    total_rewards += race_reward;
    let final_pool = reconcile(&token, &game).await?;
    ensure!(
        number(&final_pool, "pool_funds")? == STARTER + CONTRIBUTION * 5 - total_rewards,
        "Concurrent pool conservation failed"
    );
    ensure!(
        number(&final_pool, "treasury_available")? == FEE * 5,
        "Concurrent rejected opening charged a fee"
    );
    println!(
        "PASS concurrent genuine payments: one accepted, one stale quote fully refunded; 5 completed openings total"
    );

    // Both actions run before any receiver receipt. Unregistering guarantees a
    // genuine failed payout without timing assumptions or a fake token.
    let bob_before = balance(&token, &bob).await?;
    let supply_before = supply(&token).await?;
    let quote = view(&game, "get_quote", json!({"account_id":bob.id()})).await?;
    bob.batch(token.id())
        .call(Function::new("ft_transfer_call")
            .args_json(json!({"receiver_id":game.id(),"amount":PRICE.to_string(),"memo":null,"msg":message(&quote)}))
            .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(285)))
        .call(Function::new("storage_unregister").args_json(json!({"force":true}))
            .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(15)))
        .transact().await?.into_result()?;
    ensure!(
        view(&token, "storage_balance_of", json!({"account_id":bob.id()}))
            .await?
            .is_null(),
        "Batch did not unregister Bob's FT storage"
    );
    ensure!(
        view(&token, "has_claimed", json!({"account_id":bob.id()})).await? == true,
        "Unregistering erased permanent faucet eligibility"
    );
    let mut failed = None;
    for _ in 0..12 {
        let opening = view(&game, "get_account_opening", json!({"account_id":bob.id()})).await?;
        match opening["status"].as_str() {
            Some("Claimable") => {
                failed = Some(opening);
                break;
            }
            Some("RandomnessPending") => {
                bob.call(game.id(), "advance_opening")
                    .args_json(json!({"opening_id":opening["opening_id"]}))
                    .deposit(NearToken::from_yoctonear(1))
                    .gas(Gas::from_tgas(150))
                    .transact()
                    .await?
                    .into_result()?;
            }
            Some("Paying") => tokio::time::sleep(std::time::Duration::from_millis(250)).await,
            _ => bail!("Expected a reserved failed payout, got {opening}"),
        }
    }
    let failed = failed.context("Payout failure did not become Claimable")?;
    let failed_reward = number(&failed, "reward")?;
    let failed_pool = view(&game, "get_pool", json!({})).await?;
    ensure!(
        number(&failed_pool, "reserved_rewards")? == failed_reward
            && number(&failed_pool, "pending_fees")? == FEE
            && number(&failed_pool, "treasury_available")? == FEE * 5
            && number(&failed_pool, "in_flight_payouts")? == 0,
        "Confirmed failed payout did not retain a funded reservation and escrowed fee"
    );
    ensure!(
        balance(&token, game.as_account()).await?
            == number(&failed_pool, "pool_funds")?
                + number(&failed_pool, "pending_fees")?
                + number(&failed_pool, "treasury_available")?,
        "Failed payout assets do not cover all obligations"
    );
    let expected_supply = supply_before - (bob_before - PRICE);
    ensure!(
        supply(&token).await? == expected_supply,
        "Force unregister burned an incorrect amount"
    );
    let duplicate = bob
        .call(token.id(), "claim_starter")
        .args_json(json!({}))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?;
    ensure!(
        duplicate.is_failure() && supply(&token).await? == expected_supply,
        "Unregistering enabled a second faucet claim"
    );
    bob.call(token.id(), "storage_deposit")
        .args_json(json!({"registration_only":true}))
        .deposit(NearToken::from_yoctonear(registration))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    bob.call(game.id(), "retry_payout")
        .args_json(json!({"opening_id":failed["opening_id"]}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?
        .into_result()?;
    let retried = settle(&bob, &game).await?;
    ensure!(
        retried["reward"] == failed["reward"]
            && retried["draw"] == failed["draw"]
            && retried["attempt"] == "2",
        "Retry changed the frozen draw or used the wrong attempt"
    );
    ensure!(
        balance(&token, &bob).await? == failed_reward && supply(&token).await? == expected_supply,
        "Retried payout was absent, duplicated, minted, or incorrectly refunded"
    );
    let final_pool = reconcile(&token, &game).await?;
    ensure!(
        number(&final_pool, "pool_funds")?
            == STARTER + CONTRIBUTION * 6 - total_rewards - failed_reward
            && number(&final_pool, "treasury_available")? == FEE * 6,
        "Retried payout or fee was charged more than once"
    );
    println!(
        "PASS actual payout failure after atomic FT unregistration: funded Claimable reward, permanent faucet marker, and same-draw attempt2 retry; 6 completed openings total"
    );
    println!(
        "LOCAL SANDBOX ONLY: no public deployment or public-network wallet signatures performed"
    );
    Ok(())
}
