import { expect, type Page } from '@playwright/test';
import testnet from '../../config/contracts.testnet.json' with { type: 'json' };
import { FAKE_WALLET } from './wallet-fixture';

type Call = {
  network: string;
  signerId: string;
  receiverId: string;
  actions: Array<{
    type: string;
    params: { methodName: string; args: object; gas: string; deposit: string };
  }>;
};

const player = 'tea-guest.testnet';
const claimCost = '1250000000000000000000';
const caseCost = '20480000000000000000000';
const caseAccountCost = '2560000000000000000000';
const encoding = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64');
const distribution = {
  common: 277778,
  rare: 672222,
  legendary: 50000,
  denominator: 1000000,
};

export async function mockCaseTestnet(page: Page) {
  const calls: Call[] = [];
  const receipts = new Map<string, Call>();
  const chain = {
    claimed: false,
    stored: false,
    stage: 'sealed' as 'sealed' | 'drawn' | 'paid',
    openFinal: false,
    claimFinal: true,
    bonuses: false,
    redirectClaim: false,
    reject: false,
    refund: false,
    fail: false,
  };
  const advance = (call: Call) => {
    const action = call.actions[0]?.params;
    if (action?.methodName === 'claim_starter') chain.claimed = true;
    if (action?.methodName === 'storage_deposit') chain.stored = true;
  };

  await page.exposeFunction('mockCaseSign', (call: Call) => {
    calls.push(call);
    if (chain.reject) return { reject: true };
    const hash = '1'.repeat(31) + String(calls.length + 1);
    receipts.set(hash, call);
    return {
      transaction: { hash },
      status: { SuccessReceiptId: hash },
      redirect:
        chain.redirectClaim &&
        call.actions[0].params.methodName === 'claim_starter',
    };
  });
  await page.addInitScript(
    FAKE_WALLET.replace(
      'signAndSendTransaction: false',
      'signAndSendTransaction: true',
    ).replace(
      "async signAndSendTransaction() {\n        throw new Error('not supported');\n      }",
      "async signAndSendTransaction(call) {\n        const result = await window.mockCaseSign(call);\n        if (result.reject) throw new Error('User rejected');\n        if (result.redirect) {\n          const url = new URL(window.location.href);\n          url.searchParams.set('transactionHashes', result.transaction.hash);\n          window.location.assign(url);\n          return new Promise(() => {});\n        }\n        return result;\n      }",
    ),
  );
  await page.route('**/repository/manifest.json', (route) =>
    route.fulfill({ json: { version: '1.0.0', wallets: [] } }),
  );

  await page.route(testnet.rpcUrl + '/', async (route) => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const { method, params } = route.request().postDataJSON();
    let result: unknown;
    if (method === 'block') {
      result = {
        header: params.block_id
          ? {
              hash: params.block_id,
              height: 201,
              timestamp_nanosec: '1794251526278507638',
            }
          : { height: 200 },
      };
    } else if (method === 'tx') {
      const call = receipts.get(params.tx_hash);
      if (!call) throw new Error('Unknown fixture receipt');
      const action = call.actions[0].params;
      const isOpen = action.methodName === 'ft_transfer_call';
      const final = isOpen
        ? chain.openFinal
        : action.methodName === 'claim_starter'
          ? chain.claimFinal
          : true;
      if (final) advance(call);
      result = {
        transaction: {
          hash: params.tx_hash,
          signer_id: call.signerId,
          receiver_id: call.receiverId,
          actions: [
            {
              FunctionCall: {
                method_name: action.methodName,
                args: encoding(action.args),
                deposit: action.deposit,
                gas: action.gas,
              },
            },
          ],
        },
        transaction_outcome: { block_hash: '2'.repeat(32) },
        final_execution_status: final ? 'FINAL' : 'EXECUTED',
        status:
          chain.fail && isOpen
            ? { Failure: { ActionError: 'fixture' } }
            : {
                SuccessValue: isOpen
                  ? encoding(chain.refund ? '0' : '1000000')
                  : action.methodName === 'claim_starter'
                    ? encoding('1000000000')
                    : '',
              },
      };
    } else if (method === 'query') {
      const isToken = params.account_id === testnet.tokenContractId;
      const args = JSON.parse(
        Buffer.from(params.args_base64, 'base64').toString(),
      );
      const drew = chain.stage !== 'sealed';
      const paid = chain.stage === 'paid';
      const revision = drew ? '2' : '1';
      const funds = drew ? (paid ? '995950000' : '1000950000') : '1000000000';
      const available = drew ? '995950000' : funds;
      const bonuses = [
        ['SHITZU', 'Common', '50000000', 'Test Shitzu'],
        ['RHEA', 'Rare', '5000000', 'Test Rhea'],
        ['AURORA', 'Legendary', '1000000', 'Test Aurora'],
      ].map(([symbol, tier, amount, name]) => ({
        reward_id: `bonus-${symbol.toLowerCase()}`,
        token_contract_id: `iroh-test-${symbol.toLowerCase()}.testnet`,
        token_symbol: symbol,
        token_decimals: 6,
        amount,
        display_name: name,
        tier,
        chance_in_tier_bps: 5000,
        funds: '500000000',
        available: '500000000',
        reserved: '0',
        in_flight: '0',
      }));
      const opening = {
        ...distribution,
        opening_id: '1',
        account_id: player,
        nonce: '0',
        accepted_height: '201',
        accepted_revision: '1',
        status: paid ? 'Completed' : 'Paying',
        reward: '5000000',
        ...(chain.bonuses
          ? { bonus: bonuses[2], bonus_paid: paid, usdi_paid: paid }
          : {}),
        draw: 985000,
        attempt: '1',
        reserved: paid ? '0' : '5000000',
      };
      const data: Record<string, unknown> = {
        get_case: {
          case_id: 'dragon-tea',
          name: 'Dragon Tea Case',
          token_id: testnet.tokenContractId,
          price: '1000000',
          pool_contribution: '950000',
          platform_fee: '50000',
          probability_denominator: 1000000,
          randomness: 'NEAR protocol randomness',
          quote_policy: 'Exact revision',
          ...(chain.bonuses ? { bonus_rewards: bonuses } : {}),
          rewards: [
            { tier: 'Common', amount: '100000' },
            { tier: 'Rare', amount: '1000000' },
            { tier: 'Legendary', amount: '5000000' },
          ],
        },
        get_pool: {
          pool_funds: funds,
          reserved_rewards: drew && !paid ? '5000000' : '0',
          available,
          target: '1000000000',
          health: 'Healthy',
          pending_fees: drew && !paid ? '50000' : '0',
          treasury_available: paid ? '50000' : '0',
          treasury_in_flight: '0',
          in_flight_payouts: drew && !paid ? '5000000' : '0',
          pending_openings: drew && !paid ? 1 : 0,
          completed_payouts: paid ? '1' : '0',
          total_paid: paid ? '5000000' : '0',
          revision,
          paused: false,
          can_open: true,
          storage_per_opening: caseCost,
          storage_account_cost: caseAccountCost,
          expected_balance_min: drew ? '996000000' : funds,
          expected_balance_max:
            drew && !paid ? '1001000000' : paid ? '996000000' : funds,
        },
        get_quote: {
          ...distribution,
          ...(drew ? { common: 278228, rare: 672177, legendary: 49595 } : {}),
          case_id: 'dragon-tea',
          revision,
          expires_at: '320',
          nonce: drew ? '1' : '0',
          target_ev: drew ? '947975' : '950000',
          expected_numerator: drew ? '947974800000' : '949999800000',
          available,
          can_open: args.account_id === player && chain.stored && !drew,
          reason: chain.stored ? null : 'Prepay case storage in NEAR',
        },
        ft_balance_of: paid
          ? '1004000000'
          : drew
            ? '999000000'
            : chain.claimed
              ? '1000000000'
              : '0',
        has_claimed: chain.claimed,
        claim_storage_cost: claimCost,
        storage_balance_of: isToken
          ? chain.claimed
            ? { total: claimCost, available: '0' }
            : null
          : chain.stored && !drew
            ? caseCost
            : '0',
        storage_balance_bounds: { min: claimCost, max: claimCost },
        get_account_opening: drew && !paid ? opening : null,
        get_opening: drew ? opening : null,
        get_history: drew ? [opening] : [],
      };
      expect(data).toHaveProperty(params.method_name);
      result = {
        result: [...Buffer.from(JSON.stringify(data[params.method_name]))],
        logs: [],
      };
    } else {
      throw new Error('Unexpected fixture method: ' + method);
    }
    await route.fulfill({
      json: { jsonrpc: '2.0', id: 'iroh-cases', result },
      headers,
    });
  });
  return { calls, chain };
}
