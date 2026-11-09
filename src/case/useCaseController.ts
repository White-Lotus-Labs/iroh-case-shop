'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet } from '../ui/wallet/WalletProvider';
import {
  WalletPreflightError,
  type WalletFunctionCall,
} from '../ui/wallet/nearConnector';
import {
  CaseClient,
  configuredDeployment,
  claimCall,
  storageCall,
  tokenRegistrationCall,
  openCall,
  recoverCall,
  walletTransactionHash,
  transactionHash,
  type Opening,
} from './client';
import {
  actionObserved,
  pendingKey,
  pendingTarget,
  readPending,
  type PendingAction,
} from './pending';
import { useCaseReads } from './useCaseReads';

const client = configuredDeployment
  ? new CaseClient(configuredDeployment)
  : null;
type PendingState =
  | { accountId: string; action: PendingAction | null }
  | { accountId: string; error: string };

function errorMessage(error: unknown) {
  return error instanceof Error &&
    /RPC|response|Malformed|probability|accounting|match|Transaction|Contract|contract|finality|Saved/.test(
      error.message,
    )
    ? error.message
    : 'Could not complete the request. Check your wallet and refresh chain state before trying again.';
}

export function useCaseController() {
  const wallet = useWallet();
  const accountId = wallet.status === 'connected' ? wallet.accountId : null;
  const { reads, loading, refresh, afterMutation } = useCaseReads(
    client,
    accountId,
  );
  const [pending, setPending] = useState<PendingState | null>(null);
  const [signing, setSigning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [hashInput, setHashInput] = useState('');
  const session = useRef<AbortController | null>(null);
  const signingRef = useRef(false);
  const checkReceipt = useRef<() => void>(() => {});
  const liveAccount = useRef(accountId);
  liveAccount.current = accountId;
  const currentPending = pending?.accountId === accountId ? pending : null;
  const accountPending =
    currentPending && 'action' in currentPending ? currentPending.action : null;

  useEffect(() => {
    const owner = new AbortController();
    session.current = owner;
    signingRef.current = false;
    setSigning(false);
    setMessage(null);
    setError(null);
    setReceiptError(null);
    setHashInput('');
    if (client && accountId) {
      try {
        const action = readPending(
          localStorage,
          pendingKey(client.config, accountId),
        );
        if (action && action.accountId !== accountId)
          throw new Error('Saved transaction belongs to another account.');
        setPending({ accountId, action });
      } catch (cause) {
        setPending({ accountId, error: errorMessage(cause) });
      }
    } else {
      setPending(null);
    }
    return () => owner.abort();
  }, [accountId]);

  const active = reads.active?.value;
  const history = reads.history?.value;
  const observed =
    accountId &&
    accountPending &&
    !accountPending.hash &&
    actionObserved(accountPending, {
      accountId,
      claimed:
        reads.claimed?.status === 'ready' ? reads.claimed.value : undefined,
      active: reads.active?.status === 'ready' ? reads.active.value : undefined,
      history:
        reads.history?.status === 'ready' ? reads.history.value : undefined,
    });

  useEffect(() => {
    if (!client || !accountId || !accountPending || !observed) return;
    const callbackHash = new URL(window.location.href).searchParams.get(
      'transactionHashes',
    );
    // Prefer verifying a callback receipt when the wallet supplied one.
    if (callbackHash) {
      try {
        transactionHash(callbackHash);
        return;
      } catch {
        // A malformed callback cannot replace a finalized contract observation.
      }
    }
    const key = pendingKey(client.config, accountId);
    try {
      const saved = readPending(localStorage, key);
      if (
        saved?.hash ||
        saved?.afterBlockHeight !== accountPending.afterBlockHeight ||
        saved?.action !== accountPending.action ||
        saved.nonce !== accountPending.nonce ||
        saved.openingId !== accountPending.openingId
      )
        return;
      localStorage.removeItem(key);
      setPending({ accountId, action: null });
      setError(null);
      setMessage('Your action was found in finalized contract state.');
      afterMutation();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [accountId, accountPending, observed, afterMutation]);

  // Receipt verification is independent of the view reads and never broadcasts a transaction.
  useEffect(() => {
    if (!client || !accountId || !accountPending) return;
    const rpc = client;
    const signer = accountId;
    const intent = accountPending;
    const key = pendingKey(rpc.config, signer);
    const scope = new AbortController();
    const url = new URL(window.location.href);
    const callbackHash =
      intent.hash === null ? url.searchParams.get('transactionHashes') : null;
    const hash = intent.hash ?? callbackHash;
    if (!hash) return;
    let timer = 0;
    let running = false;
    let done = false;
    let checks = 0;

    async function check() {
      if (running || done || scope.signal.aborted) return;
      window.clearTimeout(timer);
      running = true;
      checks++;
      try {
        const original = localStorage.getItem(key);
        const saved = readPending(localStorage, key);
        if (
          !saved ||
          saved.accountId !== signer ||
          saved.hash !== intent.hash ||
          saved.action !== intent.action ||
          saved.afterBlockHeight !== intent.afterBlockHeight
        )
          return;
        const result = await rpc.transaction(
          transactionHash(hash),
          signer,
          scope.signal,
          pendingTarget(rpc.config, intent),
        );
        if (scope.signal.aborted || liveAccount.current !== signer) return;
        if (localStorage.getItem(key) !== original) return;
        // Clear the saved intent only after verifying the original transaction.
        localStorage.removeItem(key);
        done = true;
        afterMutation();
        setPending({ accountId: signer, action: null });
        setReceiptError(null);
        setMessage(
          result.refunded
            ? 'The opening was refunded in full. No draw was accepted.'
            : result.success
              ? 'Transaction finalized successfully on Testnet.'
              : 'Transaction failed on chain. No automatic resubmission was made. Refresh before trying again.',
        );
        if (
          callbackHash &&
          new URL(window.location.href).searchParams.get(
            'transactionHashes',
          ) === callbackHash
        ) {
          const current = new URL(window.location.href);
          current.searchParams.delete('transactionHashes');
          window.history.replaceState(window.history.state, '', current);
        }
      } catch (cause) {
        if (!scope.signal.aborted && liveAccount.current === signer)
          setReceiptError(errorMessage(cause));
      } finally {
        running = false;
        if (!done && !scope.signal.aborted && checks < 3)
          timer = window.setTimeout(() => {
            if (document.visibilityState === 'visible') void check();
          }, 18000);
      }
    }

    checkReceipt.current = () => void check();
    void check();
    return () => {
      scope.abort();
      window.clearTimeout(timer);
      checkReceipt.current = () => {};
    };
  }, [accountId, accountPending, afterMutation]);

  async function submit(
    action: PendingAction['action'],
    call: WalletFunctionCall,
    nonce: string | null = null,
    openingId: string | null = null,
  ) {
    const owner = session.current;
    if (!client || !accountId || !owner || signingRef.current || disabled)
      return;
    const signer = accountId;
    const key = pendingKey(client.config, signer);
    const isCurrent = () =>
      liveAccount.current === signer && !owner.signal.aborted;
    let intent: PendingAction | null = null;
    let serialized: string | null = null;
    signingRef.current = true;
    setSigning(true);
    setError(null);
    setMessage('Confirm this Testnet transaction in your wallet.');
    try {
      const afterBlockHeight = await client.finalBlockHeight(owner.signal);
      if (!isCurrent()) return;
      const previous = readPending(localStorage, key);
      if (previous) {
        setPending({ accountId: signer, action: previous });
        throw new WalletPreflightError(
          'A saved submission must be resolved before signing.',
        );
      }
      intent = {
        accountId: signer,
        action,
        hash: null,
        nonce,
        openingId,
        call,
        afterBlockHeight,
      };
      serialized = JSON.stringify(intent);
      localStorage.setItem(key, serialized);
      setPending({ accountId: signer, action: intent });
      const outcome: unknown = await wallet.signFunctionCall(call, isCurrent);
      const hash = walletTransactionHash(outcome);
      if (localStorage.getItem(key) !== serialized) return;
      const submitted = { ...intent, hash };
      localStorage.setItem(key, JSON.stringify(submitted));
      if (isCurrent()) {
        setPending({ accountId: signer, action: submitted });
        setMessage(
          'Submitted to Testnet. Waiting for finalized receipts; do not resubmit.',
        );
      }
    } catch (cause) {
      const cancelled =
        cause instanceof Error &&
        /user rejected|cancell?ed|denied/i.test(cause.message);
      const preflight =
        cause instanceof WalletPreflightError || intent === null;
      if (
        (cancelled || preflight) &&
        serialized !== null &&
        localStorage.getItem(key) === serialized
      ) {
        localStorage.removeItem(key);
        if (isCurrent()) setPending({ accountId: signer, action: null });
      }
      if (isCurrent()) {
        if (preflight) {
          setMessage(null);
          setError(
            cause instanceof WalletPreflightError
              ? cause.message
              : errorMessage(cause),
          );
        } else if (cancelled) {
          setMessage('Wallet confirmation cancelled.');
        } else {
          setError(
            'The wallet did not return a verifiable submission. Check the wallet and refresh before signing again.',
          );
          setMessage(
            'Submission is unconfirmed. An uncertain transaction is never resubmitted automatically.',
          );
        }
      }
    } finally {
      if (isCurrent()) {
        signingRef.current = false;
        setSigning(false);
        refresh();
      }
    }
  }

  async function attachHash() {
    const owner = session.current;
    if (
      !client ||
      !accountPending ||
      accountPending.hash ||
      !accountId ||
      !owner ||
      signingRef.current
    )
      return;
    const signer = accountId;
    const key = pendingKey(client.config, signer);
    signingRef.current = true;
    setSigning(true);
    try {
      const hash = transactionHash(hashInput.trim());
      await client.transaction(
        hash,
        signer,
        owner.signal,
        pendingTarget(client.config, accountPending),
      );
      if (owner.signal.aborted || liveAccount.current !== signer) return;
      const saved = readPending(localStorage, key);
      if (
        saved?.hash ||
        saved?.afterBlockHeight !== accountPending.afterBlockHeight ||
        saved.action !== accountPending.action
      )
        return;
      const action = { ...accountPending, hash };
      localStorage.setItem(key, JSON.stringify(action));
      setPending({ accountId: signer, action });
      setHashInput('');
      setError(null);
    } catch (cause) {
      if (!owner.signal.aborted && liveAccount.current === signer)
        setError(errorMessage(cause));
    } finally {
      if (!owner.signal.aborted && liveAccount.current === signer) {
        signingRef.current = false;
        setSigning(false);
      }
    }
  }

  const disabled =
    !client ||
    !currentPending ||
    'error' in currentPending ||
    signing ||
    wallet.busy !== null ||
    !!accountPending;
  const caseInfo = reads.caseInfo?.value;
  const pool = reads.pool?.value;
  const odds = reads.quote?.value;
  const storageAmount = pool
    ? (
        BigInt(pool.storage_per_opening) + BigInt(pool.storage_account_cost)
      ).toString()
    : null;
  const canClaim =
    !disabled &&
    reads.claimed?.status === 'ready' &&
    !reads.claimed.value &&
    reads.claimCost?.status === 'ready';
  const canRegister =
    !disabled &&
    reads.tokenRegistration?.status === 'ready' &&
    reads.tokenRegistration.value.tokenRegistered === false;
  const canPrepay =
    !disabled &&
    reads.pool?.status === 'ready' &&
    reads.caseInfo?.status === 'ready';
  const canOpen =
    !disabled &&
    reads.caseInfo?.status === 'ready' &&
    reads.pool?.status === 'ready' &&
    reads.quote?.status === 'ready' &&
    reads.balance?.status === 'ready' &&
    reads.active?.status === 'ready' &&
    !active &&
    reads.tokenRegistration?.status === 'ready' &&
    reads.tokenRegistration.value.tokenRegistered &&
    reads.quote.value.can_open &&
    reads.quote.value.revision === reads.pool.value.revision &&
    reads.quote.value.available === reads.pool.value.available &&
    BigInt(reads.balance.value) >= BigInt(reads.caseInfo.value.price);

  return {
    accountId,
    reads,
    caseInfo,
    pool,
    active,
    history,
    odds,
    storageAmount,
    disabled,
    canOpen,
    canClaim,
    canRegister,
    canPrepay,
    accountPending,
    loading,
    signing,
    message: currentPending ? message : null,
    receiptError: currentPending ? receiptError : null,
    error:
      currentPending && 'error' in currentPending
        ? currentPending.error
        : error,
    hashInput,
    setHashInput,
    available: client !== null,
    refresh() {
      refresh();
      checkReceipt.current();
    },
    attachHash,
    claim() {
      if (canClaim && client && reads.claimCost?.value !== undefined)
        void submit('claim', claimCall(client.config, reads.claimCost.value));
    },
    registerToken() {
      const cost = reads.tokenRegistration?.value?.tokenStorageCost;
      if (canRegister && client && cost != null)
        void submit(
          'token-storage',
          tokenRegistrationCall(client.config, cost),
        );
    },
    prepayStorage() {
      if (canPrepay && client && pool)
        void submit('storage', storageCall(client.config, pool));
    },
    open() {
      if (canOpen && client && odds)
        void submit('open', openCall(client.config, odds), odds.nonce);
    },
    recover(opening: Opening) {
      if (
        disabled ||
        !client ||
        reads.active?.status !== 'ready' ||
        active !== opening
      )
        return;
      if (
        opening.status === 'Claimable' &&
        reads.tokenRegistration?.status === 'ready' &&
        reads.tokenRegistration.value.tokenRegistered
      )
        void submit(
          'retry',
          recoverCall(client.config, opening),
          null,
          opening.opening_id,
        );
      else if (opening.status === 'RandomnessPending')
        void submit(
          'advance',
          recoverCall(client.config, opening),
          null,
          opening.opening_id,
        );
    },
  };
}

export type CaseController = ReturnType<typeof useCaseController>;
