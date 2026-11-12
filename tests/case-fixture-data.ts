import publicConfig from '../config/contracts.testnet.json' with { type: 'json' };
import registry from '../config/cases.testnet.json' with { type: 'json' };
import type { CaseDefinition } from '../src/case/catalog';

export type CaseScenario = {
  stored: boolean;
  stage: 'sealed' | 'drawn' | 'paid';
  openFinal: boolean;
  bonuses: boolean;
  refund: boolean;
  fail: boolean;
};

export function newCaseScenario(): CaseScenario {
  return {
    stored: false,
    stage: 'sealed',
    openFinal: false,
    bonuses: true,
    refund: false,
    fail: false,
  };
}

function distribution(definition: CaseDefinition, available: bigint) {
  const config = registry.cases.find(({ id }) => id === definition.id)?.config
    .economy;
  if (!config) throw new Error('Unknown fixture case.');
  let ev: bigint, legendary: bigint;
  if (definition.id === 'dragon-tea') {
    const bounded = available < 2000000000n ? available : 2000000000n;
    const curve = 450000n + bounded / 2000n;
    ev = curve < 600000n ? 600000n : curve > 1400000n ? 1400000n : curve;
    const legendaryCurve = bounded / 10000n - 50000n;
    legendary =
      legendaryCurve < 10000n
        ? 10000n
        : legendaryCurve > 150000n
          ? 150000n
          : legendaryCurve;
  } else {
    const price = BigInt(definition.price),
      target = BigInt(definition.target);
    const bounded = available < target * 2n ? available : target * 2n;
    const first = bounded <= target;
    const startEv = first
      ? (price * BigInt(config.ev_low_bps)) / 10000n
      : BigInt(definition.poolContribution);
    const endEv = first
      ? BigInt(definition.poolContribution)
      : (price * BigInt(config.ev_high_bps)) / 10000n;
    const startL = BigInt(
      first ? config.legendary_low_ppm : config.legendary_target_ppm,
    );
    const endL = BigInt(
      first ? config.legendary_target_ppm : config.legendary_high_ppm,
    );
    const distance = first ? bounded : bounded - target;
    ev = startEv + ((endEv - startEv) * distance) / target;
    legendary = startL + ((endL - startL) * distance) / target;
  }
  const rewards = definition.rewards.map(({ amount }) => BigInt(amount));
  const rare =
    (ev * 1000000n -
      rewards[0] * 1000000n -
      (rewards[2] - rewards[0]) * legendary) /
    (rewards[1] - rewards[0]);
  const common = 1000000n - rare - legendary;
  return {
    common: Number(common),
    rare: Number(rare),
    legendary: Number(legendary),
    denominator: 1000000,
    target_ev: ev.toString(),
    expected_numerator: (
      rewards[0] * common +
      rewards[1] * rare +
      rewards[2] * legendary
    ).toString(),
  };
}

export function caseFixture(
  definition: CaseDefinition,
  state: CaseScenario,
  accountId: string,
) {
  const drew = state.stage !== 'sealed',
    paid = state.stage === 'paid';
  const base = BigInt(definition.target),
    price = BigInt(definition.price),
    contribution = BigInt(definition.poolContribution),
    fee = BigInt(definition.platformFee),
    reward = BigInt(definition.rewards[2].amount);
  const funds = drew ? base + contribution - (paid ? reward : 0n) : base;
  const available = drew ? base + contribution - reward : base;
  const revision = drew ? '2' : '1';
  const selected = definition.bonusRewards.findIndex(
    ({ tier }) => tier === 'Legendary',
  );
  const bonuses = definition.bonusRewards.map((bonus, index) => {
    const amount = BigInt(bonus.amount),
      wasSelected = drew && state.bonuses && index === selected;
    const tokenFunds = amount * 100n - (wasSelected && paid ? amount : 0n);
    const reserved = wasSelected && !paid ? amount : 0n;
    return {
      ...bonus,
      reward_id: `bonus-${bonus.token_symbol.toLowerCase()}-${index}`,
      chance_in_tier_bps: 5000,
      candidates_in_tier: definition.bonusRewards.filter(
        ({ tier }) => tier === bonus.tier,
      ).length,
      funds: tokenFunds.toString(),
      available: (tokenFunds - reserved).toString(),
      reserved: reserved.toString(),
      in_flight: reserved.toString(),
    };
  });
  const opening = {
    ...distribution(definition, base),
    case_id: definition.id,
    tier: 'Legendary',
    opening_id: '1',
    account_id: 'tea-guest.testnet',
    nonce: '0',
    accepted_height: '201',
    accepted_revision: '1',
    status: paid ? 'Completed' : 'Paying',
    reward: reward.toString(),
    draw: 985000,
    attempt: '1',
    reserved: paid ? '0' : reward.toString(),
    ...(state.bonuses
      ? {
          bonus: bonuses[selected] ?? null,
          bonus_paid: paid && selected >= 0,
          usdi_paid: paid,
        }
      : definition.id === 'dragon-tea'
        ? {}
        : { bonus: null, bonus_paid: false, usdi_paid: paid }),
  };
  const canOpen = accountId === 'tea-guest.testnet' && state.stored && !drew;
  const bookMax = drew ? base + price - (paid ? reward : 0n) : base;
  return {
    get_case: {
      case_id: definition.id,
      name: definition.name,
      token_id: publicConfig.tokenContractId,
      price: definition.price,
      pool_contribution: definition.poolContribution,
      platform_fee: definition.platformFee,
      target: definition.target,
      probability_denominator: 1000000,
      randomness: 'NEAR protocol randomness',
      quote_policy: 'Exact revision',
      history_pagination: true,
      rewards: definition.rewards.map(({ tier, amount }) => ({
        tier,
        amount,
        token_contract_id: publicConfig.tokenContractId,
        token_symbol: 'USDI',
        token_decimals: 6,
      })),
      bonus_rewards: bonuses,
    },
    get_pool: {
      pool_funds: funds.toString(),
      reserved_rewards: drew && !paid ? reward.toString() : '0',
      available: available.toString(),
      target: definition.target,
      health: 'Healthy',
      pending_fees: drew && !paid ? fee.toString() : '0',
      treasury_available: paid ? fee.toString() : '0',
      treasury_in_flight: '0',
      in_flight_payouts: drew && !paid ? reward.toString() : '0',
      pending_openings: drew && !paid ? 1 : 0,
      completed_payouts: paid ? '1' : '0',
      total_paid: paid ? reward.toString() : '0',
      revision,
      paused: false,
      can_open: true,
      storage_per_opening: '20480000000000000000000',
      storage_account_cost: '2560000000000000000000',
      expected_balance_min: (
        bookMax - (drew && !paid ? reward : 0n)
      ).toString(),
      expected_balance_max: bookMax.toString(),
    },
    get_quote: {
      ...distribution(definition, available),
      case_id: definition.id,
      revision,
      expires_at: '320',
      nonce: drew ? '1' : '0',
      available: available.toString(),
      can_open: canOpen,
      reason: canOpen
        ? null
        : !state.stored || paid
          ? 'Prepay case storage in NEAR'
          : 'Finish the pending opening first',
    },
    storage_balance_of: state.stored && !drew ? '20480000000000000000000' : '0',
    get_account_opening: drew && !paid ? opening : null,
    get_opening: drew ? opening : null,
    get_history: drew ? [opening] : [],
    get_history_page: { openings: drew ? [opening] : [], next_cursor: null },
    get_reward_inventory: bonuses,
  };
}
