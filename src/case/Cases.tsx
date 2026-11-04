'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WalletMenu } from '../ui/wallet/WalletMenu';
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
  openCall,
  recoverCall,
  formatUnits,
  percent,
  walletTransactionHash,
  transactionHash,
  type AccountData,
  type Pool,
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
type ChainState = { pool: Pool; account: AccountData | null };
const lifecycle = {
  RandomnessPending: 'Randomness pending',
  Paying: 'Payout in flight',
  Claimable: 'Payout failed · reward claimable',
  Completed: 'Payout completed',
};
function errorMessage(error: unknown) {
  return error instanceof Error &&
    /RPC|response|Malformed|probability|accounting|match|Transaction|Contract|contract|finality|Saved/.test(
      error.message,
    )
    ? error.message
    : 'Could not complete the request. Check your wallet and refresh chain state before trying again.';
}

export function Cases() {
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
    setError(null);
    setPendingError(true);
    try {
      const [publicState, data] = await Promise.all([
        client.publicState(controller.signal),
        accountId
          ? client.account(accountId, controller.signal)
          : Promise.resolve(null),
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
      setChain({ pool: publicState.pool, account: data });
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
              result.success
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
              setChain({ pool: nextPublic.pool, account: nextAccount });
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
  return (
    <main className="cases-page">
      <header className="cases-header">
        <Link href="/" className="cases-brand">
          <span aria-hidden="true">◒</span> Iroh&apos;s Case Shop
        </Link>
        <div>
          <span className="cases-network">NEAR TESTNET</span>
          <WalletMenu />
        </div>
      </header>
      <div className="cases-intro">
        <p className="cases-eyebrow">A LITTLE LUCK, A WARM CUP</p>
        <h1>Let the tea leaves decide.</h1>
        <p>
          One Dragon Tea case. Three possible rewards.
          <br />A pool that sets its odds in the open.
        </p>
      </div>
      {!client && (
        <section className="cases-notice" aria-label="Deployment status">
          <span className="cases-seal" aria-hidden="true">
            準備
          </span>
          <div>
            <h2>Testnet contracts are not deployed</h2>
            <p>
              No USDI balance, pool reserve, odds or result is available yet.
              Claiming and opening remain disabled.
            </p>
            <p>
              Deploy and initialize both contracts, register and fund the pool,
              then set the genuine public contract IDs in{' '}
              <code>config/contracts.testnet.json</code>. See{' '}
              <code>docs/usdi-testnet-deployment.md</code> for the deployment
              steps.
            </p>
          </div>
        </section>
      )}
      <div className="cases-layout">
        <section className="cases-card" aria-labelledby="dragon-title">
          <div className="cases-illustration" aria-hidden="true">
            <div className="cases-orbit" />
            <span className="cases-dragon">龍</span>
            <div className="cases-tea">
              <span />
              <span />
              <span />
              <i />
            </div>
            <span className="cases-stamp">
              DRAGON TEA
              <br />壹 · 茶
            </span>
          </div>
          <div className="cases-card-body">
            <p className="cases-eyebrow">THE FIRST BREW · CASE 001</p>
            <h2 id="dragon-title">Dragon Tea Case</h2>
            <p>A small ritual with a chance of something rare.</p>
            <div className="cases-price">
              <strong>
                1 <small>USDI</small>
              </strong>
              <span>
                0.95 to the reward pool
                <br />
                0.05 platform fee
              </span>
            </div>
            <button
              className="cases-primary"
              disabled={
                disabled ||
                !odds?.can_open ||
                BigInt(account?.balance ?? '0') < 1000000n
              }
              onClick={() => {
                if (client && odds)
                  void submit(
                    'open',
                    openCall(client.config, odds),
                    odds.nonce,
                  );
              }}
            >
              Open Dragon Tea · 1 USDI
            </button>
            <p className="cases-fine">
              {!client
                ? 'Available after Testnet deployment.'
                : !accountId
                  ? 'Connect your Testnet wallet to continue.'
                  : (odds?.reason ??
                    'Exact quote revision. Stale or expired quotes refund the full payment.')}
            </p>
          </div>
        </section>
        <div className="cases-details">
          <section className="cases-panel" aria-labelledby="balance-title">
            <div className="cases-panel-heading">
              <h2 id="balance-title">Your tea money</h2>
              <span className="cases-tag">TEST CURRENCY</span>
            </div>
            <div className="cases-balance">
              {account ? formatUnits(account.balance) : '—'} <small>USDI</small>
            </div>
            <p>
              {accountId ??
                'Connect a NEAR Testnet wallet. Your account stays yours.'}
            </p>
            <button
              disabled={disabled || account?.claimed !== false}
              onClick={() => {
                if (client && account)
                  void submit(
                    'claim',
                    claimCall(client.config, account.claimCost),
                  );
              }}
            >
              {account?.claimed
                ? 'Starter USDI already claimed'
                : 'Claim 1,000 starter USDI'}
            </button>
            <p className="cases-fine">
              One permanent claim per account.{' '}
              {account
                ? `Attach ${formatUnits(account.claimCost, 24)} Testnet NEAR for token registration and claim storage, plus gas.`
                : 'Native Testnet NEAR storage cost is read from the token contract before signing.'}
            </p>
          </section>
          <section className="cases-panel">
            <div className="cases-panel-heading">
              <h2>The odds of this brew</h2>
              <span className="cases-tag">
                {odds ? `REVISION ${odds.revision}` : 'AWAITING CHAIN'}
              </span>
            </div>
            <div className="cases-odds">
              {(['Common', 'Rare', 'Legendary'] as const).map((tier, index) => (
                <div className={`cases-tier tier-${index}`} key={tier}>
                  <span>{tier}</span>
                  <strong>
                    {['0.1', '1', '5'][index]} <small>USDI</small>
                  </strong>
                  <b>
                    {odds
                      ? percent(
                          index === 0
                            ? odds.common
                            : index === 1
                              ? odds.rare
                              : odds.legendary,
                        )
                      : '—'}
                  </b>
                </div>
              ))}
            </div>
            <p className="cases-fine">
              {odds
                ? `Quote expires at block ${odds.expires_at}. Expected reward ${formatUnits(odds.expected_numerator, 12)} USDI; target ${formatUnits(odds.target_ev)} USDI. Probabilities total 100%.`
                : 'Reward tiers are fixed. Live probabilities appear only after a finalized contract read.'}
            </p>
          </section>
          <section className="cases-panel">
            <h2>Native NEAR storage</h2>
            <p>
              Each opening prepays a separate history budget. This is additional
              to its 1 USDI price and transaction gas.
            </p>
            <p className="cases-fine">
              {account
                ? `Remaining credit: ${formatUnits(account.storage, 24)} NEAR. `
                : ''}
              {storageAmount
                ? `This deposit attaches ${formatUnits(storageAmount, 24)} Testnet NEAR, including the account registration budget. Any unused registration budget stays as case storage credit.`
                : 'The contract will supply the exact deposit amount.'}
            </p>
            <button
              disabled={disabled}
              onClick={() => {
                if (client && chain)
                  void submit(
                    'storage',
                    storageCall(client.config, chain.pool),
                  );
              }}
            >
              Prepay one opening&apos;s storage
            </button>
          </section>
        </div>
      </div>
      <section className="cases-panel cases-pool" aria-label="Pool dashboard">
        <div className="cases-panel-heading">
          <h2>A pool you can inspect</h2>
          <span className="cases-tag">
            {chain
              ? `${chain.pool.paused ? 'PAUSED · ' : ''}${chain.pool.health.toUpperCase()}`
              : 'NO CHAIN DATA'}
          </span>
        </div>
        <dl>
          {[
            ['Pool funds', chain?.pool.pool_funds],
            ['Reserved rewards', chain?.pool.reserved_rewards],
            ['Available liquidity', chain?.pool.available],
            ['Target reserve', chain?.pool.target],
            ['Total rewards paid', chain?.pool.total_paid],
            ['Vested platform fees', chain?.pool.treasury_available],
            ['Unvested fees', chain?.pool.pending_fees],
            ['Payouts in flight', chain?.pool.in_flight_payouts],
            ['Treasury in flight', chain?.pool.treasury_in_flight],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {value ? formatUnits(value) : '—'} <small>USDI</small>
              </dd>
            </div>
          ))}
        </dl>
        <p className="cases-fine">
          {chain
            ? `${chain.pool.pending_openings} pending openings · ${chain.pool.completed_payouts} completed payouts. Book balance range during outgoing payouts: ${formatUnits(chain.pool.expected_balance_min)} to ${formatUnits(chain.pool.expected_balance_max)} USDI. Pending incoming transfers or unallocated tokens can add surplus.`
            : 'Rewards come from funded liquidity. No reserve is assumed before deployment.'}{' '}
          Healthy ≥ 800, Caution ≥ 500, Critical below 500 USDI available. All
          tiers require funded maximum-reward reserves.
        </p>
      </section>
      <section
        className="cases-panel cases-activity"
        aria-labelledby="activity-title"
      >
        <div className="cases-panel-heading">
          <h2 id="activity-title">Your latest brews</h2>
          <button
            disabled={!client || loading || signing}
            onClick={() => void refresh()}
          >
            {loading ? 'Reading Testnet…' : 'Refresh chain state'}
          </button>
        </div>
        <div aria-live="polite">
          {message && <p className="cases-message">{message}</p>}
          {error && (
            <p role="alert" className="cases-error">
              {error}
            </p>
          )}
        </div>
        {accountPending && (
          <div className="cases-pending">
            <p>
              {accountPending.hash
                ? 'Transaction submitted, awaiting finalized confirmation.'
                : 'Wallet confirmation or submission is unconfirmed. Check the wallet before taking another action.'}
            </p>
            {accountPending.hash ? (
              <p className="cases-hash">Transaction: {accountPending.hash}</p>
            ) : (
              <>
                <label htmlFor="case-tx-hash">
                  Resume with the transaction hash shown in your wallet
                </label>
                <div className="cases-hash-input">
                  <input
                    id="case-tx-hash"
                    value={hashInput}
                    onChange={(event) => setHashInput(event.target.value)}
                    autoComplete="off"
                  />
                  <button
                    onClick={() => void attachHash()}
                    disabled={!hashInput || signing}
                  >
                    Check transaction
                  </button>
                </div>
                <p className="cases-fine">
                  If the wallet navigated away, return here and refresh.
                  Accepted openings are also recovered from contract state. An
                  unresolved submission blocks new signing.
                </p>
              </>
            )}
          </div>
        )}
        {active && (
          <div className="cases-active">
            <OpeningResult opening={active} />
            {(active.status === 'RandomnessPending' ||
              active.status === 'Claimable') && (
              <>
                <button
                  disabled={disabled}
                  onClick={() => {
                    if (client)
                      void submit(
                        active.status === 'Claimable' ? 'retry' : 'advance',
                        recoverCall(client.config, active),
                        null,
                        active.opening_id,
                      );
                  }}
                >
                  {active.status === 'Claimable'
                    ? 'Retry the confirmed failed payout'
                    : 'Advance the pending draw'}
                </button>
                <p className="cases-fine">
                  Attaches 1 yoctoNEAR plus gas. A retry preserves the selected
                  reward and accepted odds.
                </p>
              </>
            )}
            {active.status === 'Paying' && (
              <p>
                Waiting for the transfer callback. An in-flight payout cannot be
                retried.
              </p>
            )}
          </div>
        )}
        {account?.history
          .filter((opening) => opening.opening_id !== active?.opening_id)
          .map((opening) => (
            <OpeningResult key={opening.opening_id} opening={opening} />
          ))}
        {!active && !account?.history.length && (
          <p className="cases-empty">
            {account
              ? 'No finalized openings found for this account.'
              : 'Your finalized openings and accepted odds will appear here.'}
          </p>
        )}
      </section>
      <footer className="cases-footer">
        <p>
          USDI is a Testnet currency with no USD backing and no real monetary
          value.
        </p>
        <p>
          Draws use NEAR protocol randomness in a later receipt. This
          demonstration is not production-grade VRF or provably fair gambling.
        </p>
        <Link href="/">Return to the tea shop →</Link>
      </footer>
    </main>
  );
}
function OpeningResult({ opening }: { opening: Opening }) {
  return (
    <article className="cases-opening">
      <div>
        <span className="cases-eyebrow">BREW #{opening.opening_id}</span>
        <h3>{lifecycle[opening.status]}</h3>
        <p>
          Accepted odds · Common {percent(opening.common)} · Rare{' '}
          {percent(opening.rare)} · Legendary {percent(opening.legendary)}
        </p>
        <p className="cases-fine">
          Revision {opening.accepted_revision} · Block {opening.accepted_height}{' '}
          · Attempt {opening.attempt}
        </p>
      </div>
      <strong>
        {opening.reward
          ? `${opening.reward === '100000' ? 'Common' : opening.reward === '1000000' ? 'Rare' : 'Legendary'} · ${formatUnits(opening.reward)} USDI`
          : 'Draw pending'}
      </strong>
    </article>
  );
}
