import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../src/app/api/case-history/route';
import {
  parseIndexedPage,
  verifyIndexedTransaction,
} from '../src/case/indexer';

// Public Nearblocks Testnet response, read 2026-11-11. No transaction was sent.
const hash = '2eUx4YuZNt1DwbzA2JbLUU8uFnTQUeSh5KqNrFVCa6sp';
const receipt = '4'.repeat(44);
const blockHash = '474LXTb5rrfyNLpdNjnMEyHEGwCpGxujoYQsZPsCEMnh';
const raw = {
  data: [
    {
      transaction_hash: hash,
      signer_account_id: 'needmore_1_near.testnet',
      receiver_account_id: 'usdi-needmore-1-near.testnet',
      actions: [{ action: 'FUNCTION_CALL', method: 'ft_transfer_call' }],
      block: {
        block_hash: blockHash,
        block_height: '276969563',
        block_timestamp: '1794256316498593417',
      },
      outcomes: { status: true },
    },
  ],
  meta: { next_page: 'eyJpbmRleCI6MH0=' },
};
const row = () =>
  parseIndexedPage(raw, 'needmore_1_near.testnet').transactions[0]!;
function rpcResult() {
  return {
    final_execution_status: 'FINAL',
    transaction: {
      hash,
      signer_id: 'needmore_1_near.testnet',
      receiver_id: 'usdi-needmore-1-near.testnet',
      actions: [
        {
          FunctionCall: {
            method_name: 'ft_transfer_call',
            args: '',
            gas: 1,
            deposit: '1',
          },
        },
      ],
    },
    status: { SuccessValue: '' },
    transaction_outcome: {
      id: hash,
      block_hash: blockHash,
      outcome: {
        executor_id: 'needmore_1_near.testnet',
        status: { SuccessReceiptId: receipt },
        receipt_ids: [receipt],
        logs: [],
      },
    },
    receipts_outcome: [
      {
        id: receipt,
        outcome: {
          executor_id: 'usdi-needmore-1-near.testnet',
          status: { SuccessValue: '' },
          receipt_ids: [],
          logs: [
            'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{"old_owner_id":"needmore_1_near.testnet","new_owner_id":"case.testnet","amount":"1000000"}]}',
          ],
        },
      },
    ],
  };
}
const block = {
  header: {
    hash: blockHash,
    height: 276969563,
    timestamp_nanosec: '1794256316498593417',
  },
};
afterEach(() => vi.unstubAllGlobals());

describe('read-only Testnet history indexer', () => {
  it('keeps external references explicitly unverified and validates their fields', () => {
    expect(row()).toMatchObject({
      hash,
      actions: ['ft_transfer_call'],
      source: 'Indexer reference, not receipt-verified',
    });
    expect(() =>
      parseIndexedPage(
        { ...raw, data: [{ ...raw.data[0], transaction_hash: 'fabricated' }] },
        'needmore_1_near.testnet',
      ),
    ).toThrow();
  });
  it('uses the fixed v3 endpoint and documented next cursor', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      urls.push(String(input));
      return Response.json({ ...raw, meta: { next_page: 'eyJpbmRleCI6MX0=' } });
    });
    const response = await GET(
      new Request(
        'http://localhost/api/case-history?account=needmore_1_near.testnet&cursor=eyJpbmRleCI6MH0%3D',
      ),
    );
    expect(response.status).toBe(200);
    expect(urls).toEqual([
      'https://api-testnet.nearblocks.io/v3/accounts/needmore_1_near.testnet/txns?limit=10&next=eyJpbmRleCI6MH0%3D',
    ]);
    expect(await response.json()).toMatchObject({
      nextCursor: 'eyJpbmRleCI6MX0=',
      transactions: [{ hash }],
    });
  });
  it('refuses an upstream cursor that repeats the requested page', async () => {
    vi.stubGlobal('fetch', async () => Response.json(raw));
    expect(
      (
        await GET(
          new Request(
            'http://localhost/api/case-history?account=needmore_1_near.testnet&cursor=eyJpbmRleCI6MH0%3D',
          ),
        )
      ).status,
    ).toBe(502);
  });
  it('rejects non-Testnet accounts and malformed cursors before fetching', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    for (const query of [
      'account=alice.near',
      'account=alice.testnet&cursor=https://evil.test',
      'account=alice.testnet&cursor=%7B%7D',
    ]) {
      expect(
        (await GET(new Request(`http://localhost/api/case-history?${query}`)))
          .status,
      ).toBe(400);
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('reports rate limiting and oversized upstream bodies without substituting history', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 429 }));
    expect(
      (
        await GET(
          new Request(
            'http://localhost/api/case-history?account=alice.testnet',
          ),
        )
      ).status,
    ).toBe(429);
    vi.stubGlobal('fetch', async () => new Response('x'.repeat(300_000)));
    expect(
      (
        await GET(
          new Request(
            'http://localhost/api/case-history?account=alice.testnet',
          ),
        )
      ).status,
    ).toBe(502);
  });
  it('verifies finalized receipt graph, inclusion and token contract from the receipt executor', async () => {
    const result = await verifyIndexedTransaction(row(), async (method) =>
      method === 'tx' ? rpcResult() : block,
    );
    expect(result).toMatchObject({
      status: 'success',
      blockHeight: '276969563',
      receiptIds: [receipt],
      transfers: [
        {
          tokenContractId: 'usdi-needmore-1-near.testnet',
          amount: '1000000',
          oldOwnerId: 'needmore_1_near.testnet',
          newOwnerId: 'case.testnet',
        },
      ],
    });
  });
  it('uses the fixed archival Testnet RPC when the configured RPC cannot observe old transactions', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      async (input: string | URL | Request, init?: RequestInit) => {
        urls.push(String(input));
        const request = JSON.parse(String(init?.body));
        return Response.json({
          result: request.method === 'tx' ? rpcResult() : block,
        });
      },
    );
    const result = await verifyIndexedTransaction(row(), async () => {
      throw new Error('NOT_OBSERVED');
    });
    expect(result.status).toBe('success');
    expect(urls).toEqual([
      'https://archival-rpc.testnet.near.org',
      'https://archival-rpc.testnet.near.org',
    ]);
  });
  it('does not retry cancellation through an archival provider', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await expect(
      verifyIndexedTransaction(
        row(),
        async () => {
          throw new Error('aborted');
        },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('does not turn receipt failure into whole transaction success or a successful transfer', async () => {
    const result = rpcResult();
    Object.assign(result.receipts_outcome[0]!.outcome, {
      status: { Failure: { ActionError: {} } },
    });
    const verified = await verifyIndexedTransaction(row(), async (method) =>
      method === 'tx' ? result : block,
    );
    expect(verified.status).toBe('failure');
    expect(verified.transfers).toEqual([]);
  });
  it('refuses missing receipts, changed identity, nonfinal results and unrelated receipts', async () => {
    for (const change of [
      (r: ReturnType<typeof rpcResult>) => {
        r.receipts_outcome = [];
      },
      (r: ReturnType<typeof rpcResult>) => {
        r.transaction.signer_id = 'attacker.testnet';
      },
      (r: ReturnType<typeof rpcResult>) => {
        r.final_execution_status = 'EXECUTED';
      },
      (r: ReturnType<typeof rpcResult>) => {
        r.receipts_outcome[0]!.id = '5'.repeat(44);
      },
    ]) {
      const result = rpcResult();
      change(result);
      await expect(
        verifyIndexedTransaction(row(), async (method) =>
          method === 'tx' ? result : block,
        ),
      ).rejects.toThrow();
    }
  });
});

// Stripped public archival RPC fixture. IDs, actions, logs and graph are unchanged.
const publicRpc = {
  final_execution_status: 'FINAL',
  transaction: {
    hash: '2eUx4YuZNt1DwbzA2JbLUU8uFnTQUeSh5KqNrFVCa6sp',
    signer_id: 'needmore_1_near.testnet',
    receiver_id: 'usdi-needmore-1-near.testnet',
    actions: [
      {
        FunctionCall: {
          args: 'eyJyZWNlaXZlcl9pZCI6ImNhc2VzLW5lZWRtb3JlLTEtbmVhci50ZXN0bmV0IiwiYW1vdW50IjoiMTAwMDAwMCIsIm1zZyI6IntcImFjdGlvblwiOlwib3BlblwiLFwiY2FzZV9pZFwiOlwiZHJhZ29uLXRlYVwiLFwibm9uY2VcIjpcIjNcIixcInF1b3RlXCI6e1wicmV2aXNpb25cIjpcIjEwXCIsXCJleHBpcmVzX2F0XCI6XCIyNzY5Njk2NjhcIn19In0=',
          deposit: '1',
          gas: 250000000000000,
          method_name: 'ft_transfer_call',
        },
      },
    ],
  },
  status: {
    SuccessValue: 'IjEwMDAwMDAi',
  },
  transaction_outcome: {
    id: '2eUx4YuZNt1DwbzA2JbLUU8uFnTQUeSh5KqNrFVCa6sp',
    block_hash: '474LXTb5rrfyNLpdNjnMEyHEGwCpGxujoYQsZPsCEMnh',
    outcome: {
      executor_id: 'needmore_1_near.testnet',
      status: {
        SuccessReceiptId: 'EJohfh9CGiiwGnafLpAyRoDSbTwrghMtBXiThy4BfU6Y',
      },
      receipt_ids: ['EJohfh9CGiiwGnafLpAyRoDSbTwrghMtBXiThy4BfU6Y'],
      logs: [],
    },
  },
  receipts_outcome: [
    {
      id: 'EJohfh9CGiiwGnafLpAyRoDSbTwrghMtBXiThy4BfU6Y',
      outcome: {
        executor_id: 'usdi-needmore-1-near.testnet',
        status: {
          SuccessReceiptId: 'FPGnbckCSAQWSaHvyWDmteBxBzoDg7g32Db95fqNYDVZ',
        },
        receipt_ids: [
          '4dtoykHa4hC1Cpi5QoB1CPyQYdyyQJx9fZ6rwgSNXeVm',
          'FPGnbckCSAQWSaHvyWDmteBxBzoDg7g32Db95fqNYDVZ',
          'HrifYXCdEQcQzXtgSqckspSexv2MQ8TzmkDut7FQzFgh',
        ],
        logs: [
          'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{"old_owner_id":"needmore_1_near.testnet","new_owner_id":"cases-needmore-1-near.testnet","amount":"1000000"}]}',
        ],
      },
    },
    {
      id: '4dtoykHa4hC1Cpi5QoB1CPyQYdyyQJx9fZ6rwgSNXeVm',
      outcome: {
        executor_id: 'cases-needmore-1-near.testnet',
        status: {
          SuccessValue: 'IjAi',
        },
        receipt_ids: [
          'EYMn48syGcPcbT3CqSqpNdYMsTFmoAu6GH7hDyfpsPU3',
          'D5m9A4RSTynkorgja3U2hUftueXHdkqqMseVoWjTx1EU',
        ],
        logs: [
          'EVENT_JSON:{"standard":"iroh_case","version":"1.0.0","event":"opening_accepted","data":[{"opening_id":"3","account_id":"needmore_1_near.testnet","nonce":"3","accepted_height":"276969565","accepted_revision":"10","common":278239,"rare":672176,"legendary":49585,"denominator":1000000,"status":"RandomnessPending","reward":null,"draw":null,"attempt":"0","reserved":"5000000"}]}',
        ],
      },
    },
    {
      id: 'EYMn48syGcPcbT3CqSqpNdYMsTFmoAu6GH7hDyfpsPU3',
      outcome: {
        executor_id: 'cases-needmore-1-near.testnet',
        status: {
          SuccessValue: 'dHJ1ZQ==',
        },
        receipt_ids: [
          'Br1v3LJanH7dumQpaFTBvCB5bejeniuaZ334csw4EHwo',
          '7iVQFXtmCwnHKHCX9m91BFTXdEe3EmPKDieeUr1KACnn',
          'AyNbx7Bqboabx25MxVasVZqSYZsyyRmzh6Chy6KUJ1Br',
        ],
        logs: [
          'EVENT_JSON:{"standard":"iroh_case","version":"1.0.0","event":"reward_selected","data":[{"opening_id":"3","reward":"1000000","draw":688758}]}',
        ],
      },
    },
    {
      id: 'Br1v3LJanH7dumQpaFTBvCB5bejeniuaZ334csw4EHwo',
      outcome: {
        executor_id: 'usdi-needmore-1-near.testnet',
        status: {
          SuccessValue: '',
        },
        receipt_ids: ['3NzGCihmzXiEwJ9Xge9mgFZBtbq39uQzM36eobkULGpZ'],
        logs: [
          'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{"old_owner_id":"cases-needmore-1-near.testnet","new_owner_id":"needmore_1_near.testnet","amount":"1000000","memo":"Dragon Tea opening 3"}]}',
        ],
      },
    },
    {
      id: '3NzGCihmzXiEwJ9Xge9mgFZBtbq39uQzM36eobkULGpZ',
      outcome: {
        executor_id: 'needmore_1_near.testnet',
        status: {
          SuccessValue: '',
        },
        receipt_ids: [],
        logs: [],
      },
    },
    {
      id: '7iVQFXtmCwnHKHCX9m91BFTXdEe3EmPKDieeUr1KACnn',
      outcome: {
        executor_id: 'cases-needmore-1-near.testnet',
        status: {
          SuccessValue: 'dHJ1ZQ==',
        },
        receipt_ids: ['FzUziKe2n9ymtYZFgt98GY7JaWWuCeYqQhnFrM8TQx8T'],
        logs: [
          'EVENT_JSON:{"standard":"iroh_case","version":"1.0.0","event":"payout_completed","data":[{"opening_id":"3","attempt":"1","reward":"1000000"}]}',
        ],
      },
    },
    {
      id: 'FzUziKe2n9ymtYZFgt98GY7JaWWuCeYqQhnFrM8TQx8T',
      outcome: {
        executor_id: 'needmore_1_near.testnet',
        status: {
          SuccessValue: '',
        },
        receipt_ids: [],
        logs: [],
      },
    },
    {
      id: 'AyNbx7Bqboabx25MxVasVZqSYZsyyRmzh6Chy6KUJ1Br',
      outcome: {
        executor_id: 'needmore_1_near.testnet',
        status: {
          SuccessValue: '',
        },
        receipt_ids: [],
        logs: [],
      },
    },
    {
      id: 'D5m9A4RSTynkorgja3U2hUftueXHdkqqMseVoWjTx1EU',
      outcome: {
        executor_id: 'needmore_1_near.testnet',
        status: {
          SuccessValue: '',
        },
        receipt_ids: [],
        logs: [],
      },
    },
    {
      id: 'FPGnbckCSAQWSaHvyWDmteBxBzoDg7g32Db95fqNYDVZ',
      outcome: {
        executor_id: 'usdi-needmore-1-near.testnet',
        status: {
          SuccessValue: 'IjEwMDAwMDAi',
        },
        receipt_ids: ['8nQYTQ8Gve6NvSTwuDgSvBoJfYeR77mRjV8vRksqz6kQ'],
        logs: [],
      },
    },
    {
      id: '8nQYTQ8Gve6NvSTwuDgSvBoJfYeR77mRjV8vRksqz6kQ',
      outcome: {
        executor_id: 'needmore_1_near.testnet',
        status: {
          SuccessValue: '',
        },
        receipt_ids: [],
        logs: [],
      },
    },
    {
      id: 'HrifYXCdEQcQzXtgSqckspSexv2MQ8TzmkDut7FQzFgh',
      outcome: {
        executor_id: 'needmore_1_near.testnet',
        status: {
          SuccessValue: '',
        },
        receipt_ids: [],
        logs: [],
      },
    },
  ],
};
const publicBlock = {
  header: {
    hash: '474LXTb5rrfyNLpdNjnMEyHEGwCpGxujoYQsZPsCEMnh',
    height: 276969563,
    timestamp_nanosec: '1794256316498593417',
  },
};
it('verifies the actual public transaction including logs from successful forwarded receipts', async () => {
  const result = await verifyIndexedTransaction(row(), async (method) =>
    method === 'tx' ? publicRpc : publicBlock,
  );
  expect(result.status).toBe('success');
  expect(result.receiptIds).toHaveLength(12);
  expect(result.transfers).toEqual([
    {
      tokenContractId: 'usdi-needmore-1-near.testnet',
      oldOwnerId: 'needmore_1_near.testnet',
      newOwnerId: 'cases-needmore-1-near.testnet',
      amount: '1000000',
      memo: null,
    },
    {
      tokenContractId: 'usdi-needmore-1-near.testnet',
      oldOwnerId: 'cases-needmore-1-near.testnet',
      newOwnerId: 'needmore_1_near.testnet',
      amount: '1000000',
      memo: 'Dragon Tea opening 3',
    },
  ]);
});
