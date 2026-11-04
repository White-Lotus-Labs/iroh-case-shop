use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::collections::{LazyOption, LookupMap};
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{
    AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise, PromiseOrValue, env, near,
};

const STARTER_AMOUNT: u128 = 1_000_000_000;
// A maximum-length AccountId plus the LookupMap prefix, key hash and value use
// fewer than 256 bytes. This charge remains locked after FT unregistration.
const CLAIM_STORAGE_BYTES: u64 = 256;
const TEST_CURRENCY_METADATA: &str =
    r#"{"description":"USDI is a test-currency with no USD backing and no real monetary value."}"#;

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Token,
    Metadata,
    Claimed,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Usdi {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    claimed: LookupMap<AccountId, bool>,
}

#[near]
impl Usdi {
    /// Creates a Testnet token with exactly 1,000 USDI for initial pool funding.
    /// There is no owner mint method; subsequent issuance is only the faucet.
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        assert!(
            env::current_account_id().as_str().ends_with(".testnet"),
            "USDI may only be initialized on a .testnet account"
        );
        let owner_is_testnet = owner_id.as_str().ends_with(".testnet");
        let owner_is_implicit =
            owner_id.as_str().len() == 64 && owner_id.as_bytes().iter().all(u8::is_ascii_hexdigit);
        assert!(
            owner_is_testnet || owner_is_implicit,
            "Owner must be a Testnet or implicit account"
        );

        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "USD Iroh".to_string(),
            symbol: "USDI".to_string(),
            icon: None,
            reference: Some("data:application/json,%7B%22description%22%3A%22USDI%20is%20a%20test-currency%20with%20no%20USD%20backing%20and%20no%20real%20monetary%20value.%22%7D".to_string()),
            reference_hash: Some(Base64VecU8(env::sha256(TEST_CURRENCY_METADATA.as_bytes()))),
            decimals: 6,
        };
        metadata.assert_valid();
        let mut contract = Self {
            token: FungibleToken::new(StorageKey::Token),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            claimed: LookupMap::new(StorageKey::Claimed),
        };
        contract.token.internal_register_account(&owner_id);
        contract.token.internal_deposit(&owner_id, STARTER_AMOUNT);
        FtMint {
            owner_id: &owner_id,
            amount: U128(STARTER_AMOUNT),
            memo: Some(
                "Finite Testnet pool funding bootstrap; no USD backing or real monetary value",
            ),
        }
        .emit();
        contract
    }

    pub fn has_claimed(&self, account_id: AccountId) -> bool {
        self.claimed.get(&account_id).unwrap_or(false)
    }

    /// Native NEAR required for FT registration, if needed, and the permanent
    /// claim marker. The return value is yoctoNEAR, not USDI.
    pub fn claim_storage_cost(&self, account_id: AccountId) -> U128 {
        let registration = if self.token.storage_balance_of(account_id).is_some() {
            0
        } else {
            self.token.storage_balance_bounds().min.as_yoctonear()
        };
        U128(
            u128::from(CLAIM_STORAGE_BYTES)
                .checked_mul(env::storage_byte_cost().as_yoctonear())
                .and_then(|permanent| permanent.checked_add(registration))
                .expect("Claim storage cost overflow"),
        )
    }

    /// Mints exactly 1,000 USDI once per predecessor account, permanently.
    #[payable]
    pub fn claim_starter(&mut self) -> U128 {
        let account_id = env::predecessor_account_id();
        assert!(
            !self.has_claimed(account_id.clone()),
            "Starter USDI already claimed"
        );
        let cost = self.claim_storage_cost(account_id.clone()).0;
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(
            deposit >= cost,
            "Insufficient attached NEAR for claim storage"
        );
        assert!(
            self.token
                .total_supply
                .checked_add(STARTER_AMOUNT)
                .is_some(),
            "USDI total supply overflow"
        );

        if self.token.storage_balance_of(account_id.clone()).is_none() {
            self.token.internal_register_account(&account_id);
        }
        self.claimed.insert(&account_id, &true);
        self.token.internal_deposit(&account_id, STARTER_AMOUNT);
        FtMint {
            owner_id: &account_id,
            amount: U128(STARTER_AMOUNT),
            memo: Some("One-time Testnet starter claim; no real monetary value"),
        }
        .emit();
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({
                "standard": "usdi", "version": "1.0.0", "event": "claimed",
                "data": [{ "account_id": account_id, "amount": U128(STARTER_AMOUNT) }]
            })
        ));
        if deposit > cost {
            Promise::new(account_id)
                .transfer(NearToken::from_yoctonear(deposit - cost))
                .detach();
        }
        U128(STARTER_AMOUNT)
    }
}

#[near]
impl FungibleTokenCore for Usdi {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Usdi {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "Resolver is private"
        );
        self.token
            .ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}

#[near]
impl StorageManagement for Usdi {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.storage_unregister(force)
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Usdi {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().expect("Metadata initialized")
    }
}

#[cfg(test)]
mod tests;
