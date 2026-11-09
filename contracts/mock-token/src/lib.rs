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
use near_sdk::collections::LazyOption;
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{AccountId, NearToken, PanicOnDefault, PromiseOrValue, env, near, require};

const NOTICE: &str =
    r#"{"description":"Unofficial Iroh Case Shop Testnet mock. No monetary value."}"#;

#[near(serializers = [json])]
pub enum MockAsset {
    SHITZU,
    RHEA,
    AURORA,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockToken {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
}

#[near]
impl MockToken {
    #[init]
    #[private]
    pub fn new(asset: MockAsset, owner_id: AccountId) -> Self {
        let account = env::current_account_id();
        require!(account.as_str().ends_with(".testnet"), "Testnet only");
        require!(
            env::predecessor_account_id() == account,
            "Token account must initialize"
        );
        require!(
            owner_id.as_str().ends_with(".testnet") && owner_id != account,
            "Use a separate Testnet inventory owner"
        );
        let (name, symbol) = match asset {
            MockAsset::SHITZU => ("Test Shitzu", "SHITZU"),
            MockAsset::RHEA => ("Test Rhea", "RHEA"),
            MockAsset::AURORA => ("Test Aurora", "AURORA"),
        };
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.into(), name: name.into(), symbol: symbol.into(),
            decimals: 6, icon: None,
            reference: Some("data:application/json,%7B%22description%22%3A%22Unofficial%20Iroh%20Case%20Shop%20Testnet%20mock.%20No%20monetary%20value.%22%7D".into()),
            reference_hash: Some(Base64VecU8(env::sha256(NOTICE.as_bytes()))),
        };
        metadata.assert_valid();
        let mut token = FungibleToken::new(b"t");
        let supply = U128(100_000 * 1_000_000);
        token.internal_register_account(&owner_id);
        token.internal_deposit(&owner_id, supply.0);
        FtMint {
            owner_id: &owner_id,
            amount: supply,
            memo: Some("Fixed supply, unofficial Testnet mock"),
        }
        .emit();
        Self {
            token,
            metadata: LazyOption::new(b"m", Some(&metadata)),
        }
    }
}

#[near]
impl FungibleTokenCore for MockToken {
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
impl FungibleTokenResolver for MockToken {
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
impl StorageManagement for MockToken {
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
impl FungibleTokenMetadataProvider for MockToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().expect("Metadata initialized")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};

    #[test]
    fn each_asset_has_a_fixed_test_supply_and_metadata() {
        let current: AccountId = "mock.testnet".parse().unwrap();
        let owner: AccountId = "owner.testnet".parse().unwrap();
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(current.clone())
                .predecessor_account_id(current)
                .build()
        );
        let token = MockToken::new(MockAsset::AURORA, owner.clone());
        assert_eq!(token.ft_balance_of(owner), U128(100_000_000_000));
        assert_eq!(token.ft_total_supply(), U128(100_000_000_000));
        assert_eq!(token.ft_metadata().symbol, "AURORA");
        assert_eq!(token.ft_metadata().name, "Test Aurora");
        assert_eq!(token.ft_metadata().decimals, 6);
    }

    #[test]
    #[should_panic(expected = "Token account must initialize")]
    fn public_caller_cannot_initialize_and_assign_supply() {
        testing_env!(
            VMContextBuilder::new()
                .current_account_id("mock.testnet".parse().unwrap())
                .predecessor_account_id("attacker.testnet".parse().unwrap())
                .build()
        );
        MockToken::new(MockAsset::RHEA, "attacker.testnet".parse().unwrap());
    }
}
