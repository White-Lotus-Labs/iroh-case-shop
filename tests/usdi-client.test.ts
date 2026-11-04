import { describe, expect, it } from 'vitest';
import type { NearWalletBase } from '@hot-labs/near-connect';
import {
  CaseClient,
  deployment,
  formatUnits,
  integer,
  openCall,
  claimCall,
  storageCall,
  tokenRegistrationCall,
  parseOpening,
  parsePool,
  parseQuote,
  recoverCall,
  walletTransactionHash,
  type AccountData,
} from '../src/case/client';
import {
  actionObserved,
  pendingKey,
  readPending,
  type PendingAction,
} from '../src/case/pending';
import {
  signTestnetFunctionCall,
  type WalletFunctionCall,
} from '../src/ui/wallet/nearConnector';

const config = {
  network: 'testnet',
  rpcUrl: 'https://rpc.testnet.near.org',
  tokenContractId: 'usdi.example.testnet',
  caseContractId: 'cases.example.testnet',
} satisfies NonNullable<ReturnType<typeof deployment>>;
const quote = {
  case_id: 'dragon-tea',
  revision: '9007199254740993',
  expires_at: '9007199254741113',
  nonce: '9007199254740994',
  common: 700000,
  rare: 250000,
  legendary: 50000,
  denominator: 1000000,
  target_ev: '570000',
  expected_numerator: '570000000000',
  available: '1000000000',
  can_open: true,
  reason: null,
};
const opening = {
  opening_id: '0',
  account_id: 'alice.testnet',
  nonce: '9007199254740994',
  accepted_height: '100',
  accepted_revision: '9007199254740993',
  common: 700000,
  rare: 250000,
  legendary: 50000,
  denominator: 1000000,
  status: 'Claimable',
  reward: '1000000',
  draw: 800000,
  attempt: '1',
  reserved: '1000000',
};
const pool = {
  pool_funds: '1000000000',
  reserved_rewards: '5000000',
  available: '995000000',
  target: '1000000000',
  health: 'Healthy',
  pending_fees: '50000',
  treasury_available: '50000',
  treasury_in_flight: '0',
  in_flight_payouts: '1000000',
  pending_openings: 1,
  completed_payouts: '2',
  total_paid: '1100000',
  revision: '4',
  paused: false,
  can_open: true,
  storage_per_opening: '20480000000000000000000',
  storage_account_cost: '2560000000000000000000',
  expected_balance_min: '999100000',
  expected_balance_max: '1000100000',
};
const hash = '11111111111111111111111111111111';
const rpcResponse = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 'iroh-cases', result }));
const encoded = (value: unknown) => ({
  result: Array.from(new TextEncoder().encode(JSON.stringify(value))),
  logs: [],
});

function fakeWallet(accounts = [{ accountId: 'alice.testnet' }]) {
  const signed: unknown[] = [];
  const wallet: NearWalletBase = {
    manifest: {
      id: 'unit-wallet',
      platform: [],
      name: 'Unit wallet',
      icon: '',
      description: '',
      website: '',
      version: '1',
      executor: '',
      type: 'injected',
      permissions: {},
      features: {
        signMessage: false,
        signTransaction: true,
        signAndSendTransaction: true,
        signAndSendTransactions: true,
        signInWithoutAddKey: true,
        signInAndSignMessage: false,
        signInWithFunctionCallKey: false,
        signDelegateActions: false,
        mainnet: false,
        testnet: true,
      },
    },
    async getAccounts() {
      return accounts;
    },
    async signIn() {
      return accounts;
    },
    async signOut() {},
    async signInAndSignMessage() {
      throw new Error('Unsupported');
    },
    async signMessage() {
      throw new Error('Unsupported');
    },
    async signDelegateActions() {
      throw new Error('Unsupported');
    },
    async signAndSendTransaction(params) {
      signed.push(params);
      return { transaction: { hash }, status: { SuccessValue: '' } };
    },
    async signAndSendTransactions() {
      throw new Error('Unsupported');
    },
  };
  return { wallet, signed };
}

describe('USDI exact amounts and actions', () => {
  it('attaches the contract claim cost and an explicit storage credit budget', () => {
    expect(claimCall(config, '3810000000000000000000')).toEqual({
      receiverId: 'usdi.example.testnet',
      methodName: 'claim_starter',
      args: {},
      gas: '50000000000000',
      deposit: '3810000000000000000000',
    });
    expect(storageCall(config, parsePool(pool))).toEqual({
      receiverId: 'cases.example.testnet',
      methodName: 'storage_deposit',
      args: {},
      gas: '30000000000000',
      deposit: '23040000000000000000000',
    });
  });

  it('formats integer balances without floating point loss', () => {
    expect(formatUnits('9007199254740993123456')).toBe(
      '9007199254740993.123456',
    );
    expect(formatUnits('20480000000000000000000', 24)).toBe('0.02048');
    expect(() => integer('1e6')).toThrow('integer');
    expect(() => integer('340282366920938463463374607431768211456')).toThrow(
      'integer',
    );
  });
  it('authorizes exactly one USDI using string nonce/revision and no caller entropy', () => {
    expect(openCall(config, parseQuote(quote))).toEqual({
      receiverId: 'usdi.example.testnet',
      methodName: 'ft_transfer_call',
      args: {
        receiver_id: 'cases.example.testnet',
        amount: '1000000',
        msg: '{"action":"open","case_id":"dragon-tea","nonce":"9007199254740994","quote":{"revision":"9007199254740993","expires_at":"9007199254741113"}}',
      },
      gas: '250000000000000',
      deposit: '1',
    });
    expect(() =>
      openCall(
        config,
        parseQuote({ ...quote, can_open: false, reason: 'Pool paused' }),
      ),
    ).toThrow('Pool paused');
  });
  it('only retries confirmed failures and preserves a fixed reward', () => {
    expect(recoverCall(config, parseOpening(opening))).toEqual({
      receiverId: 'cases.example.testnet',
      methodName: 'retry_payout',
      args: { opening_id: '0' },
      gas: '150000000000000',
      deposit: '1',
    });
    expect(() =>
      recoverCall(config, parseOpening({ ...opening, status: 'Paying' })),
    ).toThrow('cannot be retried');
    expect(() =>
      recoverCall(
        config,
        parseOpening({ ...opening, status: 'Completed', reserved: '0' }),
      ),
    ).toThrow('cannot be retried');
  });
  it('rejects invalid odds, malformed integer amounts and inconsistent accounting', () => {
    expect(parseQuote(quote).nonce).toBe('9007199254740994');
    expect(parsePool(pool).available).toBe('995000000');
    expect(() => parseQuote({ ...quote, legendary: 50001 })).toThrow(
      'distribution',
    );
    expect(() => parsePool({ ...pool, available: '1000000000' })).toThrow(
      'accounting',
    );
    expect(() => parseOpening({ ...opening, reward: null })).toThrow('result');
  });
  it('keeps undeployed configuration explicit and rejects mainnet contracts', () => {
    expect(
      deployment({ ...config, tokenContractId: null, caseContractId: null }),
    ).toBeNull();
    expect(deployment(config)).toEqual(config);
    expect(() =>
      deployment({ ...config, tokenContractId: 'usdi.near' }),
    ).toThrow('.testnet');
    expect(() => deployment({ ...config, network: 'mainnet' })).toThrow(
      'Testnet',
    );
  });
});

describe('missing token registration recovery', () => {
  it('registers through NEP-145 without attempting a second starter mint', () => {
    expect(tokenRegistrationCall(config, '1250000000000000000000')).toEqual({
      receiverId: config.tokenContractId,
      methodName: 'storage_deposit',
      args: { registration_only: true },
      gas: '30000000000000',
      deposit: '1250000000000000000000',
    });
  });
});

describe('finalized RPC reads', () => {
  it('rejects an older identical storage transaction before the saved submission boundary', async () => {
    const call = storageCall(config, parsePool(pool));
    const expected = { ...call, afterBlockHeight: '100' };
    const client = new CaseClient(config, async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (request.method === 'block')
        return rpcResponse({ header: { hash, height: 99 } });
      return rpcResponse({
        final_execution_status: 'FINAL',
        transaction: {
          hash,
          signer_id: 'alice.testnet',
          receiver_id: call.receiverId,
          actions: [
            {
              FunctionCall: {
                method_name: call.methodName,
                deposit: call.deposit,
                gas: 30000000000000,
                args: btoa('{}'),
              },
            },
          ],
        },
        transaction_outcome: { block_hash: hash },
        status: { SuccessValue: '' },
      });
    });
    await expect(
      client.transaction(hash, 'alice.testnet', undefined, {
        ...expected,
        afterBlockHeight: '100',
      }),
    ).rejects.toThrow('submission');
  });

  it('verifies a newer transaction with the exact call and semantically equal arguments', async () => {
    const call = openCall(config, parseQuote(quote));
    const expected = { ...call, afterBlockHeight: '100' };
    const client = new CaseClient(config, async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (request.method === 'block')
        return rpcResponse({ header: { hash, height: 101 } });
      return rpcResponse({
        final_execution_status: 'FINAL',
        transaction: {
          hash,
          signer_id: 'alice.testnet',
          receiver_id: call.receiverId,
          actions: [
            {
              FunctionCall: {
                method_name: call.methodName,
                deposit: call.deposit,
                gas: 250000000000000,
                args: btoa(
                  JSON.stringify(
                    Object.fromEntries(Object.entries(call.args).reverse()),
                  ),
                ),
              },
            },
          ],
        },
        transaction_outcome: { block_hash: hash },
        status: { SuccessValue: '' },
      });
    });
    expect(
      await client.transaction(hash, 'alice.testnet', undefined, {
        ...expected,
        afterBlockHeight: '100',
      }),
    ).toEqual({ hash, success: true });
  });

  it('reads the finalized block before requesting a wallet signature', async () => {
    const client = new CaseClient(config, async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        method: 'block',
        params: { finality: 'final' },
      });
      return rpcResponse({ header: { height: 276222164 } });
    });
    expect(await client.finalBlockHeight()).toBe('276222164');
  });

  it.each([
    { name: 'older storage deposit amount', deposit: '1', args: {} },
    {
      name: 'different storage arguments',
      deposit: '23040000000000000000000',
      args: { account_id: 'bob.testnet' },
    },
  ])(
    'rejects a hash for $name even when receiver and method match',
    async ({ deposit, args }) => {
      const expected = storageCall(config, parsePool(pool));
      const client = new CaseClient(config, async () =>
        rpcResponse({
          final_execution_status: 'FINAL',
          transaction: {
            hash,
            signer_id: 'alice.testnet',
            receiver_id: expected.receiverId,
            actions: [
              {
                FunctionCall: {
                  method_name: expected.methodName,
                  deposit,
                  gas: 30000000000000,
                  args: btoa(JSON.stringify(args)),
                },
              },
            ],
          },
          status: { SuccessValue: '' },
        }),
      );
      await expect(
        client.transaction(hash, 'alice.testnet', undefined, {
          ...expected,
          afterBlockHeight: '100',
        }),
      ).rejects.toThrow('pending contract action');
    },
  );
  it('rejects an unrelated FT transfer call to another case contract', async () => {
    const expected = openCall(config, parseQuote(quote));
    const client = new CaseClient(config, async () =>
      rpcResponse({
        final_execution_status: 'FINAL',
        transaction: {
          hash,
          signer_id: 'alice.testnet',
          receiver_id: expected.receiverId,
          actions: [
            {
              FunctionCall: {
                method_name: expected.methodName,
                deposit: '1',
                gas: 250000000000000,
                args: btoa(
                  JSON.stringify({
                    ...expected.args,
                    receiver_id: 'other-cases.testnet',
                  }),
                ),
              },
            },
          ],
        },
        status: { SuccessValue: '' },
      }),
    );
    await expect(
      client.transaction(hash, 'alice.testnet', undefined, {
        ...expected,
        afterBlockHeight: '100',
      }),
    ).rejects.toThrow('pending contract action');
  });

  it('binds a recovered hash to the expected contract method', async () => {
    const call = claimCall(config, '3810000000000000000000');
    const client = new CaseClient(config, async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (request.method === 'block')
        return rpcResponse({ header: { hash, height: 101 } });
      return rpcResponse({
        final_execution_status: 'FINAL',
        transaction: {
          hash,
          signer_id: 'alice.testnet',
          receiver_id: call.receiverId,
          actions: [
            {
              FunctionCall: {
                method_name: call.methodName,
                deposit: call.deposit,
                gas: 50000000000000,
                args: btoa('{}'),
              },
            },
          ],
        },
        transaction_outcome: { block_hash: hash },
        status: { SuccessValue: '' },
      });
    });
    expect(
      await client.transaction(hash, 'alice.testnet', undefined, {
        ...call,
        afterBlockHeight: '100',
      }),
    ).toEqual({ hash, success: true });
    await expect(
      client.transaction(hash, 'alice.testnet', undefined, {
        ...call,
        methodName: 'ft_transfer_call',
        afterBlockHeight: '100',
      }),
    ).rejects.toThrow('pending contract action');
    expect(() =>
      walletTransactionHash({ transaction: { hash }, status: { done: true } }),
    ).toThrow('status');
  });

  it('reads UTF-8 contract JSON at finality final', async () => {
    let payload: unknown;
    const request: typeof fetch = async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return rpcResponse(encoded('9007199254740993123456'));
    };
    const client = new CaseClient(config, request);
    expect(
      await client.view(config.tokenContractId, 'ft_balance_of', {
        account_id: 'alice.testnet',
      }),
    ).toBe('9007199254740993123456');
    expect(payload).toEqual({
      jsonrpc: '2.0',
      id: 'iroh-cases',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: 'usdi.example.testnet',
        method_name: 'ft_balance_of',
        args_base64: 'eyJhY2NvdW50X2lkIjoiYWxpY2UudGVzdG5ldCJ9',
      },
    });
  });
  it.each([
    { error: { code: -32000, message: 'RPC failure' } },
    { result: { error: 'Execution failed' } },
    { result: { result: [256] } },
    { result: { result: [255] } },
    { result: { result: [110] } },
    {},
  ])('rejects malformed or failed RPC data %j', async (response) => {
    const client = new CaseClient(
      config,
      async () => new Response(JSON.stringify(response)),
    );
    await expect(
      client.view(config.tokenContractId, 'ft_balance_of', {}),
    ).rejects.toThrow();
  });
  it('discovers pending and bounded history from chain for the current account', async () => {
    const values: Record<string, unknown> = {
      ft_balance_of: '1000000000',
      has_claimed: true,
      claim_storage_cost: '2560000000000000000000',
      storage_balance_of: '20480000000000000000000',
      storage_balance_bounds: {
        min: '1250000000000000000000',
        max: '1250000000000000000000',
      },
      get_quote: quote,
      get_account_opening: opening,
      get_history: [opening],
    };
    let expectedAccount = 'alice.testnet';
    let tokenStorage: unknown = null;
    const client = new CaseClient(config, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.params.method_name === 'get_history')
        expect(JSON.parse(atob(body.params.args_base64))).toEqual({
          account_id: expectedAccount,
          limit: 10,
        });
      if (
        body.params.method_name === 'storage_balance_of' &&
        body.params.account_id === config.tokenContractId
      )
        return rpcResponse(encoded(tokenStorage));
      return rpcResponse(encoded(values[body.params.method_name]));
    });
    const result = await client.account('alice.testnet');
    expect(result.balance).toBe('1000000000');
    expect(result.tokenRegistered).toBe(false);
    expect(result.tokenStorageCost).toBe('1250000000000000000000');
    tokenStorage = { total: '1250000000000000000000', available: '0' };
    expect((await client.account('alice.testnet')).tokenRegistered).toBe(true);
    expect(result.active?.opening_id).toBe('0');
    expect(result.history[0]?.reward).toBe('1000000');
    expectedAccount = 'bob.testnet';
    await expect(client.account('bob.testnet')).rejects.toThrow(
      'another account',
    );
  });
  it('rechecks unknown wallet output via tx FINAL before reporting completion', async () => {
    const signer = fakeWallet();
    const outcome: unknown = await signTestnetFunctionCall(
      signer.wallet,
      'alice.testnet',
      openCall(config, parseQuote(quote)),
    );
    const returnedHash = walletTransactionHash(outcome);
    const client = new CaseClient(config, async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        jsonrpc: '2.0',
        id: 'iroh-cases',
        method: 'tx',
        params: {
          tx_hash: hash,
          sender_account_id: 'alice.testnet',
          wait_until: 'FINAL',
        },
      });
      return rpcResponse({
        final_execution_status: 'FINAL',
        transaction: { hash, signer_id: 'alice.testnet' },
        status: { SuccessValue: '' },
      });
    });
    expect(await client.transaction(returnedHash, 'alice.testnet')).toEqual({
      hash,
      success: true,
    });
    expect(signer.signed).toHaveLength(1);
  });
  it('retains submission on non-final and timed-out confirmations without signing again', async () => {
    const signer = fakeWallet();
    const result: unknown = await signTestnetFunctionCall(
      signer.wallet,
      'alice.testnet',
      openCall(config, parseQuote(quote)),
    );
    const submitted = walletTransactionHash(result);
    let reads = 0;
    const client = new CaseClient(config, async () => {
      reads++;
      if (reads === 1)
        return rpcResponse({
          final_execution_status: 'EXECUTED_OPTIMISTIC',
          transaction: { hash, signer_id: 'alice.testnet' },
          status: { SuccessValue: '' },
        });
      if (reads === 2)
        return new Response(
          JSON.stringify({ error: { cause: { name: 'TIMEOUT_ERROR' } } }),
        );
      return rpcResponse({
        final_execution_status: 'FINAL',
        transaction: { hash, signer_id: 'alice.testnet' },
        status: { SuccessValue: '' },
      });
    });
    await expect(
      client.transaction(submitted, 'alice.testnet'),
    ).rejects.toThrow('finality');
    await expect(
      client.transaction(submitted, 'alice.testnet'),
    ).rejects.toThrow('RPC');
    expect(await client.transaction(submitted, 'alice.testnet')).toEqual({
      hash,
      success: true,
    });
    expect(signer.signed).toHaveLength(1);
    expect(reads).toBe(3);
  });
  it('distinguishes finalized execution failures and rejects another signer', async () => {
    const client = new CaseClient(config, async () =>
      rpcResponse({
        final_execution_status: 'FINAL',
        transaction: { hash, signer_id: 'alice.testnet' },
        status: { Failure: { error: 'failed' } },
      }),
    );
    expect(await client.transaction(hash, 'alice.testnet')).toEqual({
      hash,
      success: false,
    });
    await expect(client.transaction(hash, 'bob.testnet')).rejects.toThrow(
      'match',
    );
    expect(() => walletTransactionHash({ status: 'done' })).toThrow();
  });
});

describe('wallet account and recoverable public intents', () => {
  it('rejects an account change during the asynchronous account preflight', async () => {
    const signer = fakeWallet();
    let current = true;
    signer.wallet.getAccounts = async () => {
      await Promise.resolve();
      current = false;
      return [{ accountId: 'alice.testnet' }];
    };
    await expect(
      signTestnetFunctionCall(
        signer.wallet,
        'alice.testnet',
        openCall(config, parseQuote(quote)),
        () => current,
      ),
    ).rejects.toThrow('account changed');
    expect(signer.signed).toEqual([]);
  });

  const call: WalletFunctionCall = {
    receiverId: 'usdi.example.testnet',
    methodName: 'claim_starter',
    args: {},
    gas: '50000000000000',
    deposit: '2560000000000000000000',
  };
  it('signs only a fresh live Testnet account with explicit attached deposit', async () => {
    const signer = fakeWallet();
    expect(
      walletTransactionHash(
        await signTestnetFunctionCall(signer.wallet, 'alice.testnet', call),
      ),
    ).toBe(hash);
    expect(signer.signed).toEqual([
      {
        network: 'testnet',
        signerId: 'alice.testnet',
        receiverId: 'usdi.example.testnet',
        actions: [
          {
            type: 'FunctionCall',
            params: {
              methodName: 'claim_starter',
              args: {},
              gas: '50000000000000',
              deposit: '2560000000000000000000',
            },
          },
        ],
      },
    ]);
    await expect(
      signTestnetFunctionCall(signer.wallet, 'bob.testnet', call),
    ).rejects.toThrow('account changed');
    await expect(
      signTestnetFunctionCall(signer.wallet, 'alice.testnet', {
        ...call,
        receiverId: 'token.near',
      }),
    ).rejects.toThrow('Testnet');
    expect(signer.signed).toHaveLength(1);
  });
  it('restores an account-scoped pending hash and detects accepted openings from chain', () => {
    const pending: PendingAction = {
      accountId: 'alice.testnet',
      action: 'open',
      hash,
      nonce: '9007199254740994',
      openingId: null,
      call: openCall(config, parseQuote(quote)),
      afterBlockHeight: '99',
    };
    const key = pendingKey(config, 'alice.testnet');
    expect(key).toBe(
      'iroh-cases:testnet:usdi.example.testnet:cases.example.testnet:alice.testnet',
    );
    expect(
      readPending({ getItem: () => JSON.stringify(pending) }, key),
    ).toEqual(pending);
    const account: AccountData = {
      accountId: 'alice.testnet',
      balance: '0',
      claimed: true,
      claimCost: '0',
      storage: '0',
      tokenRegistered: true,
      tokenStorageCost: '1250000000000000000000',
      quote: parseQuote(quote),
      active: parseOpening(opening),
      history: [],
    };
    expect(actionObserved(pending, account)).toBe(true);
    expect(
      actionObserved(pending, { ...account, accountId: 'bob.testnet' }),
    ).toBe(false);
    expect(
      actionObserved({ ...pending, nonce: '9007199254740995' }, account),
    ).toBe(false);
    expect(() =>
      readPending({ getItem: () => '{"action":"open"}' }, key),
    ).toThrow('Saved');
  });
});
