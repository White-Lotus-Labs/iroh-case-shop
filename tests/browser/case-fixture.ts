import { expect, type Page } from '@playwright/test';
import testnet from '../../config/contracts.testnet.json' with { type: 'json' };
import { FAKE_WALLET } from './wallet-fixture';
import { caseCatalog } from '../../src/case/catalog';
import {
  caseFixture,
  newCaseScenario,
  type CaseScenario,
} from '../case-fixture-data';

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
const encoding = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64');

export async function mockCaseTestnet(page: Page) {
  const calls: Call[] = [];
  const receipts = new Map<string, Call>();
  const chain = {
    ...newCaseScenario(),
    claimed: false,
    claimFinal: true,
    bonuses: false,
    redirectClaim: false,
    reject: false,
  };
  const cases = new Map<string, CaseScenario>(
    caseCatalog.map(({ id }) => [id, newCaseScenario()]),
  );
  cases.set('dragon-tea', chain);
  function forCase(id: string) {
    const state = cases.get(id);
    if (!state) throw new Error('Unknown fixture case: ' + id);
    return state;
  }
  const caseForAccount = (account: string) =>
    caseCatalog.find(({ contractId }) => contractId === account);
  const advance = (call: Call) => {
    const action = call.actions[0]?.params;
    if (action?.methodName === 'claim_starter') chain.claimed = true;
    if (action?.methodName === 'storage_deposit') {
      const definition = caseForAccount(call.receiverId);
      if (definition) forCase(definition.id).stored = true;
    }
  };

  await page.exposeFunction('mockCaseSign', (call: Call) => {
    calls.push(call);
    if (chain.reject) return { reject: true };
    let index = calls.length,
      encoded = '';
    const alphabet =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    while (index > 0) {
      encoded = alphabet[index % 58] + encoded;
      index = Math.floor(index / 58);
    }
    const hash = '1'.repeat(32 - encoded.length) + encoded;
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

  await page.route('**/api/case-history?**', (route) =>
    route.fulfill({
      json: {
        accountId:
          new URL(route.request().url()).searchParams.get('account') ?? player,
        transactions: [],
        nextCursor: null,
        source: 'Indexer reference, not receipt-verified',
      },
    }),
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
      const target =
        isOpen &&
        'receiver_id' in action.args &&
        typeof action.args.receiver_id === 'string'
          ? caseForAccount(action.args.receiver_id)
          : undefined;
      const state = target ? forCase(target.id) : chain;
      const amount =
        isOpen &&
        'amount' in action.args &&
        typeof action.args.amount === 'string'
          ? action.args.amount
          : '0';
      const final = isOpen
        ? state.openFinal
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
          state.fail && isOpen
            ? { Failure: { ActionError: 'fixture' } }
            : {
                SuccessValue: isOpen
                  ? encoding(state.refund ? '0' : amount)
                  : action.methodName === 'claim_starter'
                    ? encoding('1000000000')
                    : '',
              },
      };
    } else if (method === 'query') {
      const args = JSON.parse(
        Buffer.from(params.args_base64, 'base64').toString(),
      );
      const definition = caseForAccount(params.account_id);
      let data: Record<string, unknown>;
      if (definition) {
        data = caseFixture(
          definition,
          forCase(definition.id),
          args.account_id ?? player,
        );
      } else {
        const bonus = caseCatalog
          .flatMap(({ bonusRewards }) => bonusRewards)
          .find(
            ({ token_contract_id }) => token_contract_id === params.account_id,
          );
        const isUsdi = params.account_id === testnet.tokenContractId;
        expect(
          isUsdi || bonus !== undefined,
          'known fixture token contract',
        ).toBe(true);
        const receiver = caseForAccount(args.account_id);
        let balance = chain.claimed ? 1000000000n : 0n;
        if (isUsdi) {
          if (receiver)
            balance = BigInt(
              caseFixture(receiver, forCase(receiver.id), player).get_pool
                .expected_balance_max,
            );
          else
            for (const entry of caseCatalog) {
              const state = forCase(entry.id);
              if (state.stage !== 'sealed') balance -= BigInt(entry.price);
              if (state.stage === 'paid')
                balance += BigInt(entry.rewards[2].amount);
            }
        } else {
          balance = 0n;
          if (receiver)
            balance = BigInt(
              caseFixture(
                receiver,
                forCase(receiver.id),
                player,
              ).get_reward_inventory.find(
                ({ token_contract_id }) =>
                  token_contract_id === params.account_id,
              )?.funds ?? '0',
            );
          else
            for (const entry of caseCatalog) {
              const state = forCase(entry.id);
              const selected = entry.bonusRewards.find(
                ({ tier }) => tier === 'Legendary',
              );
              if (
                state.stage === 'paid' &&
                state.bonuses &&
                selected &&
                selected.token_contract_id === params.account_id
              )
                balance += BigInt(selected.amount);
            }
        }
        data = {
          ft_balance_of: balance.toString(),
          has_claimed: chain.claimed,
          claim_storage_cost: claimCost,
          storage_balance_of:
            isUsdi && !chain.claimed
              ? null
              : { total: claimCost, available: '0' },
          storage_balance_bounds: { min: claimCost, max: claimCost },
          ft_metadata: {
            symbol: isUsdi ? 'USDI' : bonus?.token_symbol,
            name: isUsdi ? 'USD Iroh' : bonus?.display_name,
            decimals: isUsdi ? 6 : bonus?.token_decimals,
          },
        };
      }
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
  return { calls, chain, forCase };
}
