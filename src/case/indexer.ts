import type { CaseClient } from './client';

export const INDEXER_SOURCE = 'Indexer reference, not receipt-verified';
export const INDEXER_PAGE_SIZE = 10;
export type IndexedTransaction = {
  hash: string;
  signerId: string;
  receiverId: string;
  actions: string[];
  blockHeight: string;
  timestamp: string;
  indexerStatus: 'success' | 'failure' | 'unknown';
  source: typeof INDEXER_SOURCE;
};
export type IndexerPage = {
  accountId: string;
  transactions: IndexedTransaction[];
  nextCursor: string | null;
  source: typeof INDEXER_SOURCE;
};
export type IndexedVerification = {
  hash: string;
  signerId: string;
  receiverId: string;
  actions: string[];
  status: 'success' | 'failure';
  blockHeight: string;
  timestamp: string;
  receiptIds: string[];
  transfers: {
    tokenContractId: string;
    oldOwnerId: string;
    newOwnerId: string;
    amount: string;
    memo: string | null;
  }[];
  source: 'Finalized RPC receipt verification';
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Malformed history response.');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.length || value.length > max)
    throw new Error('Malformed history text.');
  return value;
}
function account(value: unknown): string {
  const id = text(value, 64);
  if (id.length < 2 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id))
    throw new Error('Malformed NEAR account.');
  return id;
}
export function indexerAccount(value: unknown): string {
  const id = account(value);
  if (!id.endsWith('.testnet'))
    throw new Error('A .testnet account is required.');
  return id;
}
function hash(value: unknown): string {
  const result = text(value, 44);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result))
    throw new Error('Malformed transaction or receipt hash.');
  return result;
}
function integer(value: unknown): string {
  const result =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : text(value, 39);
  if (!/^(0|[1-9][0-9]*)$/.test(result) || BigInt(result) >= 2n ** 128n)
    throw new Error('Malformed history integer.');
  return result;
}
function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error('Malformed or oversized history list.');
  return value;
}
export function indexerCursor(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const cursor = text(value, 1024);
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(cursor))
    throw new Error('Invalid history cursor.');
  return cursor;
}
export function parseIndexedPage(raw: unknown, accountId: string): IndexerPage {
  const page = object(raw);
  return {
    accountId: indexerAccount(accountId),
    transactions: list(page.data, INDEXER_PAGE_SIZE).map((item) => {
      const row = object(item),
        block = object(row.block),
        outcomes = object(row.outcomes);
      return {
        hash: hash(row.transaction_hash),
        signerId: account(row.signer_account_id),
        receiverId: account(row.receiver_account_id),
        actions: list(row.actions, 100).map((rawAction) => {
          const action = object(rawAction);
          return text(
            action.action === 'FUNCTION_CALL' ? action.method : action.action,
            128,
          );
        }),
        blockHeight: integer(block.block_height),
        timestamp: integer(block.block_timestamp),
        indexerStatus:
          outcomes.status === true
            ? 'success'
            : outcomes.status === false
              ? 'failure'
              : 'unknown',
        source: INDEXER_SOURCE,
      };
    }),
    nextCursor: indexerCursor(object(page.meta).next_page),
    source: INDEXER_SOURCE,
  };
}

function parseProxyPage(raw: unknown, accountId: string): IndexerPage {
  const page = object(raw);
  if (page.accountId !== accountId || page.source !== INDEXER_SOURCE)
    throw new Error('History response belongs to another account.');
  return {
    accountId,
    transactions: list(page.transactions, INDEXER_PAGE_SIZE).map((item) => {
      const row = object(item);
      if (
        row.source !== INDEXER_SOURCE ||
        !['success', 'failure', 'unknown'].includes(String(row.indexerStatus))
      )
        throw new Error('Malformed history provenance.');
      return {
        hash: hash(row.hash),
        signerId: account(row.signerId),
        receiverId: account(row.receiverId),
        actions: list(row.actions, 100).map((action) => text(action, 128)),
        blockHeight: integer(row.blockHeight),
        timestamp: integer(row.timestamp),
        indexerStatus:
          row.indexerStatus === 'success'
            ? 'success'
            : row.indexerStatus === 'failure'
              ? 'failure'
              : 'unknown',
        source: INDEXER_SOURCE,
      };
    }),
    nextCursor: indexerCursor(page.nextCursor),
    source: INDEXER_SOURCE,
  };
}
export async function fetchIndexedHistory(
  accountId: string,
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<IndexerPage> {
  const params = new URLSearchParams({ account: indexerAccount(accountId) });
  const next = indexerCursor(cursor);
  if (next) params.set('cursor', next);
  const response = await fetch(`/api/case-history?${params}`, {
    signal,
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'History indexer rate limit reached. Keep these results and retry later.'
        : `History indexer unavailable (HTTP ${response.status}).`,
    );
  return parseProxyPage(await response.json(), accountId);
}

type Outcome = {
  id: string;
  executor: string;
  receiptIds: string[];
  status: 'success' | 'failure' | 'forwarded';
  forwardedId: string | null;
  logs: string[];
};
function status(raw: unknown): {
  status: Outcome['status'];
  forwardedId: string | null;
} {
  const value = object(raw);
  if (Object.keys(value).length !== 1)
    throw new Error('Malformed execution status.');
  if ('Failure' in value) {
    object(value.Failure);
    return { status: 'failure', forwardedId: null };
  }
  if (typeof value.SuccessValue === 'string')
    return { status: 'success', forwardedId: null };
  if (typeof value.SuccessReceiptId === 'string')
    return { status: 'forwarded', forwardedId: hash(value.SuccessReceiptId) };
  throw new Error('Execution outcome is not final.');
}
function outcome(raw: unknown): Outcome {
  const record = object(raw),
    value = object(record.outcome);
  const parsed = status(value.status);
  const receiptIds = list(value.receipt_ids, 256).map(hash);
  if (
    new Set(receiptIds).size !== receiptIds.length ||
    (parsed.forwardedId && !receiptIds.includes(parsed.forwardedId))
  )
    throw new Error('Malformed receipt references.');
  return {
    id: hash(record.id),
    executor: account(value.executor_id),
    ...parsed,
    receiptIds,
    logs: list(value.logs, 1024).map((log) =>
      typeof log === 'string' && log.length <= 8192 ? log : text(log, 8192),
    ),
  };
}
function transfers(receipt: Outcome): IndexedVerification['transfers'] {
  if (receipt.status === 'failure') return [];
  const result: IndexedVerification['transfers'] = [];
  for (const log of receipt.logs) {
    if (!log.startsWith('EVENT_JSON:')) continue;
    // Unrelated application logs are not token evidence. Ignore malformed events.
    try {
      const event = object(JSON.parse(log.slice('EVENT_JSON:'.length)));
      if (
        event.standard !== 'nep141' ||
        event.version !== '1.0.0' ||
        event.event !== 'ft_transfer'
      )
        continue;
      for (const raw of list(event.data, 100)) {
        const data = object(raw);
        result.push({
          tokenContractId: receipt.executor,
          oldOwnerId: account(data.old_owner_id),
          newOwnerId: account(data.new_owner_id),
          amount: integer(data.amount),
          memo:
            data.memo === undefined || data.memo === null
              ? null
              : text(data.memo, 1024),
        });
      }
    } catch {
      continue;
    }
  }
  return result;
}

async function historicalRpc(
  rpc: CaseClient['rpc'],
  method: string,
  params: object,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    return await rpc(method, params, signal);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    // Ordinary Testnet nodes prune historical transactions. Retry only reads at
    // the fixed public archival node, with the same requested hash or block.
    const response = await fetch('https://archival-rpc.testnet.near.org', {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'iroh-historical-read',
        method,
        params,
      }),
    });
    if (!response.ok)
      throw new Error(
        `Archival Testnet RPC unavailable (HTTP ${response.status}).`,
      );
    if (!response.body) throw new Error('Missing archival RPC response.');
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let bytes = 0,
      json = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2_000_000)
          throw new Error('Oversized archival RPC response.');
        json += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      await reader.cancel();
    }
    const body = object(JSON.parse(json + decoder.decode()));
    if ('error' in body || !('result' in body))
      throw new Error('Archival Testnet RPC could not retrieve this history.');
    return body.result;
  }
}

export async function verifyIndexedTransaction(
  row: IndexedTransaction,
  rpc: CaseClient['rpc'],
  signal?: AbortSignal,
): Promise<IndexedVerification> {
  const result = object(
    await historicalRpc(
      rpc,
      'tx',
      {
        tx_hash: hash(row.hash),
        sender_account_id: account(row.signerId),
        wait_until: 'FINAL',
      },
      signal,
    ),
  );
  const tx = object(result.transaction);
  if (
    result.final_execution_status !== 'FINAL' ||
    tx.hash !== row.hash ||
    tx.signer_id !== row.signerId ||
    tx.receiver_id !== row.receiverId
  )
    throw new Error(
      'Indexed transaction identity or finality could not be verified.',
    );
  const actions = list(tx.actions, 100).map((raw) => {
    if (typeof raw === 'string') return text(raw, 128);
    const action = object(raw),
      names = Object.keys(action);
    if (names.length !== 1) throw new Error('Malformed transaction action.');
    return names[0] === 'FunctionCall'
      ? text(object(action.FunctionCall).method_name, 128)
      : text(names[0], 128);
  });
  const terminal = status(result.status);
  if (terminal.status === 'forwarded')
    throw new Error('Transaction result is not final.');
  const transactionOutcome = outcome(result.transaction_outcome);
  if (
    transactionOutcome.id !== row.hash ||
    transactionOutcome.executor !== row.signerId
  )
    throw new Error('Transaction outcome does not match its signer.');
  const receipts = list(result.receipts_outcome, 256).map(outcome);
  const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  if (byId.size !== receipts.length || byId.has(row.hash))
    throw new Error('Duplicate receipt outcome.');
  const visited = new Set<string>();
  const pending = [...transactionOutcome.receiptIds];
  while (pending.length) {
    const id = pending.pop();
    if (!id || visited.has(id)) throw new Error('Repeating receipt graph.');
    const receipt = byId.get(id);
    if (!receipt) throw new Error('Receipt verification is incomplete.');
    visited.add(id);
    pending.push(...receipt.receiptIds);
  }
  if (visited.size !== receipts.length)
    throw new Error('Unrelated receipt outcome.');
  const inclusionHash = hash(object(result.transaction_outcome).block_hash);
  const header = object(
    object(
      await historicalRpc(rpc, 'block', { block_id: inclusionHash }, signal),
    ).header,
  );
  if (header.hash !== inclusionHash)
    throw new Error('Transaction inclusion block does not match.');
  return {
    hash: row.hash,
    signerId: row.signerId,
    receiverId: row.receiverId,
    actions,
    status:
      terminal.status === 'failure' ||
      transactionOutcome.status === 'failure' ||
      receipts.some((receipt) => receipt.status === 'failure')
        ? 'failure'
        : 'success',
    blockHeight: integer(header.height),
    timestamp: integer(header.timestamp_nanosec),
    receiptIds: receipts.map((receipt) => receipt.id),
    transfers: receipts.flatMap(transfers),
    source: 'Finalized RPC receipt verification',
  };
}
