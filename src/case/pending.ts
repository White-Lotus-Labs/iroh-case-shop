import {
  integer,
  transactionHash,
  parseFunctionCall,
  type Deployment,
  type AccountData,
} from './client';
import type { WalletFunctionCall } from '../ui/wallet/nearConnector';

export type PendingAction = {
  accountId: string;
  action: 'claim' | 'storage' | 'open' | 'advance' | 'retry';
  hash: string | null;
  nonce: string | null;
  openingId: string | null;
  call: WalletFunctionCall;
  afterBlockHeight: string;
};
export function pendingKey(config: Deployment, accountId: string) {
  return `iroh-cases:testnet:${config.tokenContractId}:${config.caseContractId}:${accountId}`;
}
export function readPending(
  store: Pick<Storage, 'getItem'>,
  key: string,
): PendingAction | null {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    throw new Error(
      'Saved transaction information is unavailable. Check your wallet before signing again.',
    );
  }
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      'Saved transaction information is invalid. Check your wallet before signing again.',
    );
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('accountId' in value) ||
    typeof value.accountId !== 'string' ||
    !('action' in value) ||
    (value.action !== 'claim' &&
      value.action !== 'storage' &&
      value.action !== 'open' &&
      value.action !== 'advance' &&
      value.action !== 'retry') ||
    !('hash' in value) ||
    !('nonce' in value) ||
    !('openingId' in value) ||
    !('call' in value) ||
    !('afterBlockHeight' in value)
  )
    throw new Error(
      'Saved transaction information is invalid. Check your wallet before signing again.',
    );
  return {
    call: parseFunctionCall(value.call),
    afterBlockHeight: integer(value.afterBlockHeight, 64),
    accountId: value.accountId,
    action: value.action,
    hash: value.hash === null ? null : transactionHash(value.hash),
    nonce: value.nonce === null ? null : integer(value.nonce, 64),
    openingId: value.openingId === null ? null : integer(value.openingId, 64),
  };
}
export function actionObserved(pending: PendingAction, data: AccountData) {
  if (pending.accountId !== data.accountId) return false;
  if (pending.action === 'claim') return data.claimed;
  // A balance alone cannot identify which storage transaction succeeded.
  if (pending.action === 'open')
    return [data.active, ...data.history].some(
      (opening) => opening?.nonce === pending.nonce,
    );
  if (pending.action === 'advance' || pending.action === 'retry')
    return [data.active, ...data.history].some(
      (opening) =>
        opening?.opening_id === pending.openingId &&
        opening.status === 'Completed',
    );
  return false;
}

export function pendingTarget(config: Deployment, pending: PendingAction) {
  const action = pending.action;
  const methodName = {
    claim: 'claim_starter',
    storage: 'storage_deposit',
    open: 'ft_transfer_call',
    advance: 'advance_opening',
    retry: 'retry_payout',
  }[action];
  const receiverId =
    action === 'claim' || action === 'open'
      ? config.tokenContractId
      : config.caseContractId;
  if (
    pending.call.receiverId !== receiverId ||
    pending.call.methodName !== methodName
  ) {
    throw new Error('Saved transaction does not match its contract action.');
  }
  return { ...pending.call, afterBlockHeight: pending.afterBlockHeight };
}
