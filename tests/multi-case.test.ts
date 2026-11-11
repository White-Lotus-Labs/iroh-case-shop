import { describe, expect, it } from 'vitest';
import { caseCatalog, caseById, deploymentForCase } from '../src/case/catalog';
import {
  CaseClient,
  openCall,
  parseCase,
  parseOpening,
  parseQuote,
  type Deployment,
} from '../src/case/client';
import { mergeHistory, openingHistory } from '../src/case/history';
import { pendingTarget, type PendingAction } from '../src/case/pending';

const deployment: Deployment = {
  network: 'testnet',
  rpcUrl: 'https://rpc.testnet.near.org',
  tokenContractId: 'usdi.testnet',
  caseContractId: 'bamboo.testnet',
};
const quote = {
  case_id: 'bamboo-mist',
  common: 700000,
  rare: 250000,
  legendary: 50000,
  denominator: 1000000,
  revision: '1',
  expires_at: '320',
  nonce: '0',
  target_ev: '465000',
  expected_numerator: '465000000000',
  available: '1000000000',
  can_open: true,
  reason: null,
};

describe('independent tea cases', () => {
  it('keeps five distinct exact prices and planned cases unavailable for signing', () => {
    expect(caseCatalog.map(({ price }) => price)).toEqual([
      '500000',
      '1000000',
      '2000000',
      '5000000',
      '10000000',
    ]);
    expect(caseCatalog.map(({ id }) => id)).toEqual([
      'bamboo-mist',
      'dragon-tea',
      'moon-spirit',
      'phoenix-flame',
      'uncles-secret-reserve',
    ]);
    expect(deploymentForCase(caseById('bamboo-mist'))).toBeNull();
    expect(caseById('dragon-tea')).toMatchObject({
      deploymentStatus: 'verified-live',
      bonusDeploymentStatus: 'planned',
    });
  });
  it('binds exact signing amount and case identity to the chosen definition', () => {
    const bamboo = caseById('bamboo-mist');
    const call = openCall(deployment, parseQuote(quote, bamboo), bamboo);
    expect(call.args).toMatchObject({
      receiver_id: 'bamboo.testnet',
      amount: '500000',
    });
    expect(JSON.parse(String(call.args.msg))).toMatchObject({
      case_id: 'bamboo-mist',
      nonce: '0',
    });
    expect(() => parseQuote(quote)).toThrow(/case/i);
    expect(() => openCall(deployment, parseQuote(quote, bamboo))).toThrow(
      /case/i,
    );
  });
  it('rejects a misreported expected return and a draw inconsistent with the recorded reward', () => {
    const bamboo = caseById('bamboo-mist');
    expect(() =>
      parseQuote({ ...quote, expected_numerator: '1' }, bamboo),
    ).toThrow(/expected/i);
    const result = {
      common: 700000,
      rare: 250000,
      legendary: 50000,
      denominator: 1000000,
      opening_id: '0',
      account_id: 'alice.testnet',
      nonce: '0',
      accepted_height: '201',
      accepted_revision: '1',
      status: 'Completed',
      reward: '1000000',
      draw: 1,
      attempt: '1',
      reserved: '0',
    };
    expect(() => parseOpening(result)).toThrow(/draw/i);
    expect(() => parseOpening({ ...result, draw: 1000000 })).toThrow(/draw/i);
  });
  it('validates reward metadata against the selected case, retaining legacy Dragon defaults', () => {
    const bamboo = caseById('bamboo-mist');
    const raw = {
      case_id: bamboo.id,
      name: bamboo.name,
      token_id: 'usdi.testnet',
      price: bamboo.price,
      pool_contribution: bamboo.poolContribution,
      platform_fee: bamboo.platformFee,
      probability_denominator: 1000000,
      randomness: 'NEAR protocol randomness',
      quote_policy: 'Exact revision',
      rewards: bamboo.rewards,
      bonus_rewards: bamboo.bonusRewards.map((reward, index) => ({
        ...reward,
        reward_id: `bonus-${index}`,
        chance_in_tier_bps: 5000,
        candidates_in_tier: bamboo.bonusRewards.filter(
          (candidate) => candidate.tier === reward.tier,
        ).length,
        funds: '0',
        available: '0',
        reserved: '0',
        in_flight: '0',
      })),
    };
    expect(parseCase(raw, bamboo).price).toBe('500000');
    expect(() => parseCase({ ...raw, price: '1000000' }, bamboo)).toThrow(
      /economics/,
    );
    expect(() =>
      parseCase(
        {
          ...raw,
          rewards: [
            ...raw.rewards.slice(0, 2),
            { tier: 'Legendary', amount: '999' },
          ],
        },
        bamboo,
      ),
    ).toThrow(/reward/);
  });
  it('never merges identical opening IDs and nonces across separate contracts', () => {
    const dragon = caseById('dragon-tea');
    const opening = parseOpening({
      common: 700000,
      rare: 250000,
      legendary: 50000,
      denominator: 1000000,
      opening_id: '0',
      account_id: 'alice.testnet',
      nonce: '0',
      accepted_height: '201',
      accepted_revision: '1',
      status: 'Completed',
      reward: '1000000',
      draw: 700000,
      attempt: '1',
      reserved: '0',
    });
    const one = openingHistory(
      { ...deployment, caseContractId: 'dragon-one.testnet' },
      opening,
      dragon,
    );
    const two = openingHistory(
      { ...deployment, caseContractId: 'dragon-two.testnet' },
      opening,
      dragon,
    );
    expect(new Set([...one, ...two].map(({ id }) => id)).size).toBe(4);
    const receipt = {
      ...one[0],
      id: '2'.repeat(32),
      hash: '2'.repeat(32),
      status: 'Finalized',
      source: 'Saved verified receipt' as const,
    };
    const result = mergeHistory(two, [receipt]);
    expect(result.filter(({ type }) => type === 'Case purchase')).toHaveLength(
      2,
    );
  });
  it.each(caseCatalog)(
    'uses exact rewards and decimals for $name',
    (definition) => {
      const denominator = 1000000;
      const distribution = {
        common: 700000,
        rare: 250000,
        legendary: 50000,
        denominator,
      };
      const expected = definition.rewards.reduce(
        (sum, reward) =>
          sum +
          BigInt(reward.amount) * BigInt(distribution[reward.probability]),
        0n,
      );
      const parsed = parseQuote(
        {
          ...quote,
          ...distribution,
          case_id: definition.id,
          expected_numerator: expected.toString(),
        },
        definition,
      );
      expect(
        openCall(
          { ...deployment, caseContractId: definition.contractId },
          parsed,
          definition,
        ).args.amount,
      ).toBe(definition.price);
      for (const [index, reward] of definition.rewards.entries()) {
        const bonus = definition.bonusRewards.find(
          (candidate) => candidate.tier === reward.tier,
        );
        const opening = parseOpening(
          {
            ...distribution,
            case_id: definition.id,
            tier: reward.tier,
            opening_id: '0',
            account_id: 'alice.testnet',
            nonce: '0',
            accepted_height: '201',
            accepted_revision: '1',
            status: 'Completed',
            reward: reward.amount,
            draw: [0, 700000, 950000][index],
            attempt: '1',
            reserved: '0',
            usdi_paid: true,
            bonus_paid: !!bonus,
            bonus: bonus
              ? {
                  ...bonus,
                  reward_id: `bonus-${index}`,
                  chance_in_tier_bps: 5000,
                  candidates_in_tier: definition.bonusRewards.filter(
                    (candidate) => candidate.tier === bonus.tier,
                  ).length,
                  funds: bonus.amount,
                  available: bonus.amount,
                  reserved: '0',
                  in_flight: '0',
                }
              : null,
          },
          definition,
        );
        const entries = openingHistory(
          { ...deployment, caseContractId: definition.contractId },
          opening,
          definition,
        );
        expect(entries[0]).toMatchObject({
          caseId: definition.id,
          caseContract: definition.contractId,
        });
        expect(opening.tier).toBe(reward.tier);
        if (bonus) expect(entries[2].token).toBe(bonus.token_symbol);
      }
    },
  );
  it('rejects a recovered intent for a different case even when USDI is shared', () => {
    const pending: PendingAction = {
      accountId: 'alice.testnet',
      action: 'open',
      hash: null,
      nonce: '0',
      openingId: null,
      afterBlockHeight: '200',
      call: openCall(
        deployment,
        parseQuote(quote, caseById('bamboo-mist')),
        caseById('bamboo-mist'),
      ),
    };
    expect(() =>
      pendingTarget(
        { ...deployment, caseContractId: 'other.testnet' },
        pending,
      ),
    ).toThrow(/case/i);
  });
  it('pages finalized case history without accepting another account or a repeating cursor', async () => {
    const dragon = caseById('dragon-tea');
    const record = {
      common: 700000,
      rare: 250000,
      legendary: 50000,
      denominator: 1000000,
      opening_id: '3',
      account_id: 'alice.testnet',
      nonce: '0',
      accepted_height: '201',
      accepted_revision: '1',
      status: 'Completed',
      reward: '1000000',
      draw: 700000,
      attempt: '1',
      reserved: '0',
    };
    let cursor: string | null = '2';
    const client = new CaseClient(deployment, async (_input, init) => {
      const { params } = JSON.parse(String(init?.body));
      const value =
        params.method_name === 'get_case'
          ? {
              case_id: dragon.id,
              name: dragon.name,
              token_id: deployment.tokenContractId,
              price: dragon.price,
              pool_contribution: dragon.poolContribution,
              platform_fee: dragon.platformFee,
              probability_denominator: 1000000,
              randomness: 'NEAR',
              quote_policy: 'Exact revision',
              rewards: dragon.rewards,
              bonus_rewards: [],
              history_pagination: true,
            }
          : { openings: [record], next_cursor: cursor };
      return new Response(
        JSON.stringify({
          result: {
            result: [...new TextEncoder().encode(JSON.stringify(value))],
          },
        }),
      );
    });
    await expect(
      client.historyPage('alice.testnet', null),
    ).resolves.toMatchObject({
      nextCursor: '2',
      paginated: true,
      complete: false,
      openings: [{ opening_id: '3' }],
    });
    cursor = '3';
    await expect(client.historyPage('alice.testnet', null)).rejects.toThrow(
      /cursor/i,
    );
    cursor = '2';
    await expect(client.historyPage('bob.testnet', null)).rejects.toThrow(
      /account/i,
    );
  });
});
