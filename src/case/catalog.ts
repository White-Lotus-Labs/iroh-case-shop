import registry from '../../config/cases.testnet.json';
import publicConfig from '../../config/contracts.testnet.json';
import type { Deployment } from './client';

export type RewardTier = 'Common' | 'Rare' | 'Legendary';
export type TierProbability = 'common' | 'rare' | 'legendary';
export type CaseReward = {
  tier: RewardTier;
  amount: string;
  probability: TierProbability;
};
export type CatalogBonus = {
  token_contract_id: string;
  token_symbol: string;
  display_name: string;
  token_decimals: number;
  amount: string;
  tier: RewardTier;
};
export type CaseDefinition = {
  id: string;
  name: string;
  contractId: string;
  deploymentStatus: string;
  bonusDeploymentStatus: 'planned' | 'verified-live';
  theme: string;
  description: string;
  price: string;
  poolContribution: string;
  platformFee: string;
  target: string;
  rewards: CaseReward[];
  bonusRewards: CatalogBonus[];
};

function testnetId(id: string) {
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(id) || id.length > 64)
    throw new Error('Case registry requires Testnet account IDs.');
  return id;
}
function money(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) >= 2n ** 128n)
    throw new Error('Invalid case registry amount.');
  return value;
}
function tier(index: number): RewardTier {
  if (index === 0) return 'Common';
  if (index === 1) return 'Rare';
  if (index === 2) return 'Legendary';
  throw new Error('Invalid case registry tier.');
}
function probability(index: number): TierProbability {
  if (index === 0) return 'common';
  if (index === 1) return 'rare';
  if (index === 2) return 'legendary';
  throw new Error('Invalid case registry tier.');
}

if (registry.network !== 'testnet')
  throw new Error('Only Testnet cases are allowed.');
export const caseCatalog: CaseDefinition[] = registry.cases.map((entry) => {
  const config = entry.config;
  if (
    entry.bonusDeploymentStatus !== 'planned' &&
    entry.bonusDeploymentStatus !== 'verified-live'
  )
    throw new Error('Unknown bonus deployment status.');
  if (
    entry.id !== config.case_id ||
    entry.name !== config.name ||
    config.economy.rewards.length !== 3
  )
    throw new Error('Inconsistent case registry identity.');
  const price = BigInt(money(config.economy.price));
  if (price <= 0n || price % 20n !== 0n)
    throw new Error('Invalid exact case price.');
  return {
    id: entry.id,
    name: entry.name,
    contractId: testnetId(entry.contractId),
    deploymentStatus: entry.deploymentStatus,
    bonusDeploymentStatus: entry.bonusDeploymentStatus,
    theme: entry.theme,
    description: entry.description,
    price: price.toString(),
    poolContribution: ((price * 95n) / 100n).toString(),
    platformFee: ((price * 5n) / 100n).toString(),
    target: money(config.economy.target),
    rewards: config.economy.rewards.map((amount, index) => ({
      tier: tier(index),
      amount: money(amount),
      probability: probability(index),
    })),
    bonusRewards: config.bonus_rewards.map((bonus) => {
      if (
        !Number.isInteger(bonus.token_decimals) ||
        bonus.token_decimals < 0 ||
        bonus.token_decimals > 24
      )
        throw new Error('Invalid mock token decimals.');
      return {
        ...bonus,
        token_contract_id: testnetId(bonus.token_contract_id),
        amount: money(bonus.amount),
        tier: tier(bonus.tier),
      };
    }),
  };
});
if (
  new Set(caseCatalog.map(({ id }) => id)).size !== caseCatalog.length ||
  new Set(caseCatalog.map(({ contractId }) => contractId)).size !==
    caseCatalog.length
)
  throw new Error('Duplicate case registry entry.');
export function caseById(id: string): CaseDefinition {
  const result = caseCatalog.find((entry) => entry.id === id);
  if (!result) throw new Error('Unknown tea case.');
  return result;
}
export const dragonCase = caseById('dragon-tea');
export function deploymentForCase(
  definition: CaseDefinition,
): Deployment | null {
  if (definition.deploymentStatus !== 'verified-live') return null;
  if (definition.id === 'dragon-tea') {
    if (publicConfig.network !== 'testnet')
      throw new Error('Only Testnet is supported.');
    return {
      network: 'testnet',
      rpcUrl: publicConfig.rpcUrl,
      tokenContractId: testnetId(publicConfig.tokenContractId),
      caseContractId: testnetId(publicConfig.caseContractId),
    };
  }
  return {
    network: 'testnet',
    rpcUrl: publicConfig.rpcUrl,
    tokenContractId: testnetId(registry.tokenContractId),
    caseContractId: definition.contractId,
  };
}
export const liveCaseClients = () =>
  caseCatalog.flatMap((definition) => {
    const config = deploymentForCase(definition);
    return config ? [{ definition, config }] : [];
  });
