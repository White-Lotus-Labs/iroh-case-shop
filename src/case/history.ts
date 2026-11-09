import {
  formatReward,
  integer,
  rewardTier,
  transactionHash,
  type CaseClient,
  type Deployment,
  type Opening,
} from './client';
import { pendingKey, type PendingAction } from './pending';

type Receipt = Awaited<ReturnType<CaseClient['transaction']>>;
type ReceiptStatus = 'Finalized' | 'Refunded' | 'Failed';

export type HistoryEntry = {
  id: string;
  type: string;
  status: string;
  amount: string | null;
  token: string;
  tokenContract: string;
  caseId: 'dragon-tea' | null;
  openingId?: string;
  nonce?: string;
  reward?: string;
  hash: string | null;
  height: string;
  timestamp: string | null;
  sender: string;
  receiver: string;
  method: string;
  rarity?: string;
  source: 'Saved verified receipt' | 'Finalized case contract';
};

const receiptActions = {
  claim: 'Starter claim',
  open: 'Case purchase',
  storage: 'Case storage registration',
  'token-storage': 'USDI registration',
  'bonus-storage': 'Bonus token registration',
  advance: 'Advance case draw',
  retry: 'Retry case payout',
} as const;

function historyKey(config: Deployment, account: string) {
  return `${pendingKey(config, account)}:receipts`;
}

function amountFromReceipt(intent: PendingAction, receipt: Receipt) {
  if (intent.action === 'open') return '1 USDI';
  if (
    intent.action !== 'claim' ||
    !receipt.success ||
    !('returnValue' in receipt)
  )
    return null;
  try {
    const amount = integer(JSON.parse(atob(receipt.returnValue ?? '')));
    return formatReward({ amount, token_decimals: 6, token_symbol: 'USDI' });
  } catch {
    return null;
  }
}

export function saveVerifiedReceipt(
  config: Deployment,
  intent: PendingAction,
  receipt: Receipt,
  store: Pick<Storage, 'getItem' | 'setItem'>,
) {
  if (!receipt.inclusion) return;
  const caseAction =
    intent.action === 'open' ||
    intent.action === 'storage' ||
    intent.action === 'advance' ||
    intent.action === 'retry';
  const action = intent.action;
  const token =
    action === 'open' || action === 'claim' || action === 'token-storage'
      ? 'USDI'
      : action === 'storage'
        ? 'NEAR'
        : '';
  const status: ReceiptStatus = receipt.refunded
    ? 'Refunded'
    : receipt.success
      ? 'Finalized'
      : 'Failed';
  const entry = {
    id: receipt.hash,
    hash: receipt.hash,
    type: receiptActions[action],
    status,
    amount: amountFromReceipt(intent, receipt),
    token,
    tokenContract:
      token === 'USDI'
        ? config.tokenContractId
        : action === 'bonus-storage'
          ? intent.call.receiverId
          : '',
    caseId: caseAction ? 'dragon-tea' : null,
    openingId: intent.openingId ?? undefined,
    nonce: intent.nonce ?? undefined,
    sender: intent.accountId,
    receiver: intent.call.receiverId,
    method: intent.call.methodName,
    height: receipt.inclusion.height,
    timestamp: receipt.inclusion.timestamp,
    source: 'Saved verified receipt',
  } satisfies HistoryEntry;
  const previous = readSavedHistory(config, intent.accountId, store);
  store.setItem(
    historyKey(config, intent.accountId),
    JSON.stringify(
      [entry, ...previous.filter((old) => old.id !== entry.id)].slice(0, 60),
    ),
  );
}

export function readSavedHistory(
  config: Deployment,
  account: string,
  store: Pick<Storage, 'getItem'>,
): HistoryEntry[] {
  const raw = store.getItem(historyKey(config, account));
  if (!raw || raw.length > 120_000) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(decoded)) return [];
  return decoded
    .filter((item): item is HistoryEntry => {
      if (
        !item ||
        typeof item !== 'object' ||
        item.sender !== account ||
        item.source !== 'Saved verified receipt' ||
        item.id !== item.hash ||
        !['Finalized', 'Failed', 'Refunded'].includes(item.status) ||
        ![null, 'dragon-tea'].includes(item.caseId) ||
        !(item.amount === null || typeof item.amount === 'string') ||
        !(
          item.timestamp === null ||
          (typeof item.timestamp === 'string' &&
            /^\d{1,20}$/.test(item.timestamp))
        ) ||
        !['type', 'token', 'tokenContract', 'receiver', 'method'].every(
          (key) => typeof item[key] === 'string',
        )
      )
        return false;
      try {
        transactionHash(item.hash);
        integer(item.height, 64);
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, 60);
}

export function openingHistory(
  config: Deployment,
  opening: Opening,
): HistoryEntry[] {
  const base = {
    caseId: 'dragon-tea',
    openingId: opening.opening_id,
    hash: null,
    height: opening.accepted_height,
    timestamp: null,
    sender: config.caseContractId,
    receiver: opening.account_id,
    rarity: opening.reward ? rewardTier(opening.reward) : undefined,
    source: 'Finalized case contract',
  } as const;
  const purchase = {
    ...base,
    id: `purchase-${opening.opening_id}`,
    type: 'Case purchase',
    status: 'Accepted',
    nonce: opening.nonce,
    sender: opening.account_id,
    receiver: config.caseContractId,
    token: 'USDI',
    tokenContract: config.tokenContractId,
    amount: '1 USDI',
    method: 'ft_on_transfer',
    reward: opening.reward
      ? [
          formatReward({
            amount: opening.reward,
            token_decimals: 6,
            token_symbol: 'USDI',
          }),
          ...(opening.bonus ? [formatReward(opening.bonus)] : []),
        ].join(' + ')
      : undefined,
  } satisfies HistoryEntry;
  if (!opening.reward) return [purchase];
  const rewards = [
    {
      token: 'USDI',
      tokenContract: config.tokenContractId,
      amount: opening.reward,
      decimals: 6,
      paid: opening.usdiPaid,
    },
  ];
  if (opening.bonus)
    rewards.push({
      token: opening.bonus.token_symbol,
      tokenContract: opening.bonus.token_contract_id,
      amount: opening.bonus.amount,
      decimals: opening.bonus.token_decimals,
      paid: opening.bonusPaid,
    });
  return [
    purchase,
    ...rewards.map(
      (reward): HistoryEntry => ({
        ...base,
        id: `opening-${opening.opening_id}-${reward.token}`,
        type: reward.paid ? 'Token payout' : 'Reward selected',
        status: reward.paid
          ? 'Paid'
          : opening.status === 'Claimable'
            ? 'Retry available'
            : 'Pending payout',
        amount: formatReward({
          amount: reward.amount,
          token_decimals: reward.decimals,
          token_symbol: reward.token,
        }),
        token: reward.token,
        tokenContract: reward.tokenContract,
        method: reward.paid ? 'ft_transfer' : 'resolve_opening',
      }),
    ),
  ];
}

export function mergeHistory(chain: HistoryEntry[], saved: HistoryEntry[]) {
  const accepted = new Map(
    chain
      .filter((entry) => entry.type === 'Case purchase')
      .map((entry) => [entry.nonce, entry]),
  );
  const matched = new Set<string>();
  const receipts = saved.map((receipt) => {
    const purchase =
      receipt.status === 'Finalized' &&
      receipt.type === 'Case purchase' &&
      receipt.nonce !== undefined
        ? accepted.get(receipt.nonce)
        : undefined;
    if (!purchase) return receipt;
    matched.add(purchase.id);
    return {
      ...receipt,
      openingId: purchase.openingId,
      rarity: purchase.rarity,
      reward: purchase.reward,
    };
  });
  return [...chain.filter((entry) => !matched.has(entry.id)), ...receipts].sort(
    (a, b) =>
      BigInt(a.height) > BigInt(b.height)
        ? -1
        : BigInt(a.height) < BigInt(b.height)
          ? 1
          : 0,
  );
}

export function historyTime(timestamp: string | null) {
  if (!timestamp) return null;
  const date = new Date(Number(BigInt(timestamp) / 1_000_000n));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
