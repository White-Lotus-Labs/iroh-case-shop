'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

const client = configuredDeployment
  ? new CaseClient(configuredDeployment)
  : null;
type ChainState = Awaited<ReturnType<CaseClient['publicState']>> & {
  account: Awaited<ReturnType<CaseClient['account']>> | null;
  guestOdds: Awaited<ReturnType<CaseClient['publicOdds']>> | null;
};
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
  const [chain, setChain] = useState<ChainState | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [pendingError, setPendingError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hashInput, setHashInput] = useState('');
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const signingRef = useRef(false);
  const liveAccount = useRef(accountId);
  liveAccount.current = accountId;
  const account =
    chain?.account?.accountId === accountId ? chain.account : null;
  const accountPending = pending?.accountId === accountId ? pending : null;

  const refresh = useCallback(async () => {
    if (!client || signingRef.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    setLoading(true);
    setPendingError(true);
    try {
      const [publicState, data, guestOdds] = await Promise.all([
        client.publicState(controller.signal),
        accountId
          ? client.account(accountId, controller.signal)
          : Promise.resolve(null),
        accountId
          ? Promise.resolve(null)
          : client.publicOdds(controller.signal),
      ]);
      if (data?.active) {
        const opening = await client.opening(
          data.active.opening_id,
          controller.signal,
        );
        if (opening && opening.account_id !== accountId)
          throw new Error('Opening does not match this account.');
        data.active = opening;
      }
      if (current !== generation.current || liveAccount.current !== accountId)
        return;
      setError(null);
      setChain({ ...publicState, account: data, guestOdds });
      if (accountId && data) {
        const key = pendingKey(client.config, accountId);
        const saved = readPending(localStorage, key);
        if (saved && saved.accountId !== accountId)
          throw new Error('Saved transaction belongs to another account.');
        setPendingError(false);
        setPending(saved);
        if (saved) {
          if (!saved.hash && actionObserved(saved, data)) {
            localStorage.removeItem(key);
            setPending(null);
            setMessage('Your action was found in finalized contract state.');
          } else if (saved.hash) {
            const result = await client.transaction(
              saved.hash,
              accountId,
              controller.signal,
              pendingTarget(client.config, saved),
            );
            if (
              current !== generation.current ||
              liveAccount.current !== accountId
            )
              return;
            localStorage.removeItem(key);
            setPending(null);
            setMessage(
              result.refunded
                ? 'The opening was refunded in full. No draw was accepted.'
                : result.success
                  ? 'Transaction finalized. Contract state refreshed; an opening is accepted only when it appears below.'
                  : 'Transaction failed on chain. No automatic resubmission was made. Refresh before trying again.',
            );
            // Read after FINAL, not just after wallet approval or an optimistic receipt.
            const [nextPublic, nextAccount] = await Promise.all([
              client.publicState(controller.signal),
              client.account(accountId, controller.signal),
            ]);
            if (
              current === generation.current &&
              liveAccount.current === accountId
            )
              setChain({
                ...nextPublic,
                account: nextAccount,
                guestOdds: null,
              });
          }
        }
      }
    } catch (cause) {
      if (
        current !== generation.current ||
        controller.signal.aborted ||
        liveAccount.current !== accountId
      )
        return;
      setError(errorMessage(cause));
      if (cause instanceof Error && /Saved|saved/.test(cause.message))
        setPendingError(true);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    generation.current++;
    request.current?.abort();
    setPending(null);
    setPendingError(false);
    setMessage(null);
    setError(null);
    setHashInput('');
    setSigning(false);
    signingRef.current = false;
    void refresh();
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 12000);
    return () => {
      generation.current++;
      request.current?.abort();
      window.removeEventListener('focus', focus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function submit(
    action: PendingAction['action'],
    call: WalletFunctionCall,
    nonce: string | null = null,
    openingId: string | null = null,
  ) {
    if (
      !client ||
      !accountId ||
      signingRef.current ||
      accountPending ||
      pendingError
    )
      return;
    const signer = accountId;
    const key = pendingKey(client.config, signer);
    let intent: PendingAction | null = null;
    signingRef.current = true;
    setSigning(true);
    setError(null);
    setMessage('Confirm this Testnet transaction in your wallet.');
    request.current?.abort();
    const preparation = ++generation.current;
    const isCurrent = () =>
      liveAccount.current === signer && generation.current === preparation;
    try {
      // A finalized block boundary distinguishes this request from older identical calls.
      const afterBlockHeight = await client.finalBlockHeight();
      if (!isCurrent()) return;
      intent = {
        accountId: signer,
        action,
        hash: null,
        nonce,
        openingId,
        call,
        afterBlockHeight,
      };
      // Save the public intent before a wallet can navigate away. Failed persistence stops signing.
      localStorage.setItem(key, JSON.stringify(intent));
      setPending(intent);
      const outcome: unknown = await wallet.signFunctionCall(call, isCurrent);
      const hash = walletTransactionHash(outcome);
      const submitted = { ...intent, hash };
      localStorage.setItem(key, JSON.stringify(submitted));
      if (liveAccount.current === signer) {
        setPending(submitted);
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
      if (cancelled || preflight) localStorage.removeItem(key);
      if (liveAccount.current === signer) {
        if (preflight) {
          setPending(null);
          setMessage(null);
          setError(
            cause instanceof WalletPreflightError
              ? cause.message
              : errorMessage(cause),
          );
        } else if (cancelled) {
          setPending(null);
          setMessage('Wallet confirmation cancelled.');
        } else {
          setError(
            'The wallet did not return a verifiable submission. Check the wallet and refresh before signing again.',
          );
          setMessage(
            'Submission is unconfirmed. Check your wallet, then refresh. An uncertain transaction is never resubmitted automatically.',
          );
        }
      }
    } finally {
      if (liveAccount.current === signer) {
        signingRef.current = false;
        setSigning(false);
        void refresh();
      }
    }
  }

  async function attachHash() {
    if (!client || !accountPending || !accountId) return;
    try {
      const hash = transactionHash(hashInput.trim());
      // A hash must first be proven to belong to this account on Testnet.
      await client.transaction(
        hash,
        accountId,
        undefined,
        pendingTarget(client.config, accountPending),
      );
      if (liveAccount.current !== accountId) return;
      const saved = { ...accountPending, hash };
      localStorage.setItem(
        pendingKey(client.config, accountId),
        JSON.stringify(saved),
      );
      setPending(saved);
      setHashInput('');
      void refresh();
    } catch (cause) {
      if (liveAccount.current === accountId) setError(errorMessage(cause));
    }
  }

  const disabled =
    !client ||
    !account ||
    loading ||
    signing ||
    wallet.busy !== null ||
    !!accountPending ||
    pendingError ||
    !!error;
  const active = account?.active;
  const storageAmount = chain
    ? (
        BigInt(chain.pool.storage_per_opening) +
        BigInt(chain.pool.storage_account_cost)
      ).toString()
    : null;
  const odds = account?.quote;

  const canOpen =
    !disabled &&
    !!odds?.can_open &&
    !!chain &&
    !!account?.tokenRegistered &&
    BigInt(account.balance) >= BigInt(chain.caseInfo.price);
  return {
    accountId,
    account,
    chain,
    active,
    odds,
    storageAmount,
    disabled,
    canOpen,
    accountPending,
    loading,
    signing,
    message,
    error,
    hashInput,
    setHashInput,
    available: client !== null,
    refresh,
    attachHash,
    claim() {
      if (!disabled && client && account?.claimed === false)
        void submit('claim', claimCall(client.config, account.claimCost));
    },
    registerToken() {
      if (!disabled && client && account && !account.tokenRegistered)
        void submit(
          'token-storage',
          tokenRegistrationCall(client.config, account.tokenStorageCost),
        );
    },
    prepayStorage() {
      if (!disabled && client && chain)
        void submit('storage', storageCall(client.config, chain.pool));
    },
    open() {
      if (canOpen && client && odds)
        void submit('open', openCall(client.config, odds), odds.nonce);
    },
    recover(opening: Opening) {
      if (disabled || !client || active !== opening) return;
      if (opening.status === 'Claimable' && account?.tokenRegistered)
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
