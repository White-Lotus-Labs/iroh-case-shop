import { describe, expect, it } from 'vitest';
import {
  formatReward,
  parseBonusReward,
  parseOpening,
  type Deployment,
} from '../src/case/client';
import {
  historyTime,
  openingHistory,
  readSavedHistory,
  saveVerifiedReceipt,
} from '../src/case/history';
import type { PendingAction } from '../src/case/pending';

const deployment: Deployment = {
  network: 'testnet',
  rpcUrl: 'https://rpc.testnet.fastnear.com',
  tokenContractId: 'usdi.testnet',
  caseContractId: 'case.testnet',
};
const aurora = {
  reward_id: 'bonus-aurora',
  token_contract_id: 'mock-aurora.testnet',
  token_symbol: 'AURORA',
  token_decimals: 6,
  amount: '1000000',
  display_name: 'Test Aurora',
  tier: 'Legendary',
  chance_in_tier_bps: 5000,
  available: '8000000',
  reserved: '2000000',
  in_flight: '1000000',
  funds: '10000000',
};

describe('bonus rewards and history', () => {
  it('formats the contract amount and rejects inconsistent reserve data', () => {
    expect(formatReward(parseBonusReward(aurora))).toBe('1 AURORA');
    expect(
      formatReward({
        amount: '1200300000000',
        token_decimals: 12,
        token_symbol: 'RHEA',
      }),
    ).toBe('1.2003 RHEA');
    expect(() => parseBonusReward({ ...aurora, in_flight: '2000001' })).toThrow(
      /inventory/,
    );
  });

  it('renders paid and reserved legs without inventing a transaction hash', () => {
    const opening = parseOpening({
      common: 277778,
      rare: 672222,
      legendary: 50000,
      denominator: 1000000,
      opening_id: '1',
      account_id: 'alice.testnet',
      nonce: '0',
      accepted_height: '201',
      accepted_revision: '1',
      status: 'Claimable',
      reward: '5000000',
      draw: 985000,
      attempt: '1',
      reserved: '0',
      bonus: aurora,
      usdi_paid: true,
      bonus_paid: false,
    });
    expect(openingHistory(deployment, opening)).toMatchObject([
      {
        type: 'Case purchase',
        amount: '1 USDI',
        status: 'Accepted',
        hash: null,
      },
      {
        type: 'Token payout',
        amount: '5 USDI',
        status: 'Paid',
        hash: null,
        sender: 'case.testnet',
      },
      {
        type: 'Reward selected',
        amount: '1 AURORA',
        status: 'Retry available',
        hash: null,
        rarity: 'Legendary',
      },
    ]);
  });

  it('retains and deduplicates verified receipts by signer and deployment', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    const intent: PendingAction = {
      accountId: 'alice.testnet',
      action: 'claim',
      hash: null,
      nonce: null,
      openingId: null,
      afterBlockHeight: '200',
      call: {
        receiverId: 'usdi.testnet',
        methodName: 'claim_starter',
        args: {},
        gas: '50000000000000',
        deposit: '1',
      },
    };
    const hash = '2'.repeat(32);
    const receipt = {
      hash,
      success: true,
      inclusion: { height: '201', timestamp: '1794251526278507638' },
      returnValue: btoa('"1000000000"'),
    };
    saveVerifiedReceipt(deployment, intent, receipt, storage);
    saveVerifiedReceipt(deployment, intent, receipt, storage);
    expect(
      readSavedHistory(deployment, 'alice.testnet', storage),
    ).toMatchObject([
      {
        hash,
        amount: '1000 USDI',
        method: 'claim_starter',
        height: '201',
        receiver: 'usdi.testnet',
      },
    ]);
    expect(historyTime(receipt.inclusion.timestamp)).toBe(
      '2026-11-09T19:12:06.278Z',
    );
    expect(readSavedHistory(deployment, 'bob.testnet', storage)).toEqual([]);
  });
});
