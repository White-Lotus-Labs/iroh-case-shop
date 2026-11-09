'use client';

import { useEffect, useRef } from 'react';
import { useWallet } from '../ui/wallet/WalletProvider';
import { ChainReadStatus } from './ChainReadStatus';
import { CaseActivity, CaseTransactionNotice } from './CaseActivity';
import { formatUnits, percent, rewardTier } from './client';
import { useCaseController, type CaseController } from './useCaseController';

function TeaCoffer({ revealed = false }: { revealed?: boolean }) {
  return (
    <div className="tea-coffer" data-revealed={revealed} aria-hidden="true">
      <span className="tea-coffer-moon" />
      <span className="tea-coffer-halo" />
      <span className="tea-coffer-steam">
        <i />
        <i />
        <i />
      </span>
      <span className="tea-coffer-box">
        <span className="tea-coffer-lid">龍</span>
        <span className="tea-coffer-front">
          <i /> 茶 <i />
        </span>
      </span>
      <span className="tea-coffer-edition">No. 01 · Longjing</span>
    </div>
  );
}

export function TeaCaseCatalog({
  inspecting,
  onInspect,
}: {
  inspecting: boolean;
  onInspect: (inspect: boolean) => void;
}) {
  const controller = useCaseController();
  const { caseInfo, pool, reads, accountId, active, history, error } =
    controller;
  const oddsRead = accountId ? reads.quote : reads.publicOdds;
  const quote = oddsRead?.value;
  const odds =
    quote?.revision === pool?.revision && quote?.available === pool?.available
      ? quote
      : null;
  const opening =
    active ??
    (controller.accountPending?.action === 'open'
      ? history?.find(({ nonce }) => nonce === controller.accountPending?.nonce)
      : history?.[0]);
  const revealed = opening?.reward !== null && opening?.reward !== undefined;
  const paper = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    paper.current?.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [inspecting]);

  return (
    <section
      ref={paper}
      className="tea-case-catalog"
      aria-label={inspecting ? 'Case inspection' : 'Tea collection'}
      tabIndex={0}
    >
      <div
        className="tea-catalog-view"
        key={inspecting ? 'inspect' : 'collection'}
      >
        <header className="tea-catalog-heading">
          {inspecting ? (
            <button
              type="button"
              className="tea-catalog-back"
              onClick={() => onInspect(false)}
            >
              ← Back to Collection
            </button>
          ) : (
            <p className="tea-catalog-kicker">The Host’s collection · 茶</p>
          )}
          <h1 ref={heading} tabIndex={-1}>
            {inspecting
              ? (caseInfo?.name ?? 'Dragon Tea Case')
              : 'The Tea Collection'}
          </h1>
          <p>
            {inspecting
              ? 'Uncle’s first brew, sealed in a lacquered tea chest.'
              : 'Every brew holds a different fortune.'}
          </p>
        </header>

        {!inspecting ? (
          <article className="tea-catalog-card">
            <TeaCoffer />
            <div className="tea-catalog-card-copy">
              <p className="tea-catalog-kicker">Case No. 01 · Longjing</p>
              <h2>{caseInfo?.name ?? 'Dragon Tea Case'}</h2>
              <p>
                A little luck, a warm cup, and the chance of a rare treasure.
              </p>
              <p className="tea-catalog-price">
                {caseInfo
                  ? formatUnits(caseInfo.price) + ' USDI'
                  : reads.caseInfo?.status === 'error' || !controller.available
                    ? 'Price unavailable'
                    : 'Reading Testnet price…'}
              </p>
              {controller.available &&
                !caseInfo &&
                reads.caseInfo?.status === 'error' && (
                  <ChainReadStatus
                    label="case details"
                    read={reads.caseInfo}
                    retry={controller.refresh}
                  />
                )}
              {caseInfo && (
                <ul className="tea-catalog-tier-list" aria-label="Reward tiers">
                  {caseInfo.rewards.map(({ tier }) => (
                    <li key={tier}>{tier}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="tea-catalog-primary"
                onClick={() => onInspect(true)}
              >
                Inspect Dragon Tea Case <span aria-hidden="true">→</span>
              </button>
            </div>
          </article>
        ) : (
          <>
            <div className="tea-catalog-detail">
              <div>
                <TeaCoffer
                  key={opening?.opening_id ?? 'sealed'}
                  revealed={revealed}
                />
                <div className="tea-catalog-reveal" aria-live="polite">
                  {opening?.reward ? (
                    <>
                      <p className="tea-catalog-kicker">
                        Brew #{opening.opening_id} ·{' '}
                        {opening.status === 'Completed'
                          ? 'Payout confirmed'
                          : 'Payment pending'}
                      </p>
                      <p
                        className="tea-catalog-reward"
                        key={opening.opening_id}
                      >
                        {rewardTier(opening.reward)} ·{' '}
                        {formatUnits(opening.reward)} USDI
                      </p>
                      {opening.status === 'Claimable' && (
                        <p>
                          The transfer failed. Your reward is reserved and can
                          be retried below.
                        </p>
                      )}
                    </>
                  ) : opening ? (
                    <p>
                      Draw pending. The tea chest opens when Testnet confirms
                      the result.
                    </p>
                  ) : controller.signing ? (
                    <p className="tea-catalog-waiting">
                      Waiting for wallet authorization…
                    </p>
                  ) : controller.accountPending?.action === 'open' ? (
                    <p className="tea-catalog-waiting">
                      Waiting for a finalized draw on Testnet…
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="tea-catalog-odds">
                <h2>What’s inside</h2>
                {caseInfo ? (
                  <dl>
                    {caseInfo.rewards.map(({ tier, amount, probability }) => (
                      <div key={tier} data-tier={probability}>
                        <dt>{tier}</dt>
                        <dd>{formatUnits(amount)} USDI</dd>
                        <dd>{odds ? percent(odds[probability]) : '—'}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {controller.available && (
                  <>
                    <ChainReadStatus
                      label="case details"
                      read={reads.caseInfo}
                      retry={controller.refresh}
                    />
                    <ChainReadStatus
                      label="pool data"
                      read={reads.pool}
                      retry={controller.refresh}
                    />
                    <ChainReadStatus
                      label="case odds"
                      read={oddsRead}
                      retry={controller.refresh}
                    />
                  </>
                )}
                <p>
                  Expected reward{' '}
                  <strong>
                    {odds
                      ? formatUnits(odds.expected_numerator, 12) + ' USDI'
                      : '—'}
                  </strong>
                </p>
                <div className="tea-catalog-pool">
                  <span data-health={pool?.health}>
                    {pool?.paused ? 'Paused · ' : ''}
                    {pool?.health ?? 'Awaiting Testnet'}
                  </span>
                  <span>
                    {pool
                      ? formatUnits(pool.available) + ' USDI available'
                      : 'Pool balance unavailable'}
                  </span>
                </div>
                {!odds && pool && oddsRead?.status === 'ready' && (
                  <p>
                    Waiting for odds and pool reserves from the same revision.
                  </p>
                )}
                <CaseOpenAction
                  controller={controller}
                  hasOdds={Boolean(odds)}
                  settled={opening?.status === 'Completed'}
                />
              </div>
            </div>
            <CaseWalletActions controller={controller} />
            {pool && (
              <details className="tea-catalog-pool-details">
                <summary>Pool and quote details</summary>
                <p>
                  {formatUnits(pool.pool_funds)} USDI in the pool ·{' '}
                  {formatUnits(pool.reserved_rewards)} USDI reserved · Revision{' '}
                  {pool.revision}
                </p>
                <p>
                  Stale or expired quotes are refunded in full. Draws use NEAR
                  protocol randomness in a later receipt.
                </p>
              </details>
            )}
          </>
        )}
        {(inspecting || error || controller.accountPending) && (
          <CaseActivity controller={controller} showNotice={!inspecting} />
        )}
        <footer className="tea-catalog-foot">
          NEAR TESTNET · USDI is test currency with no real monetary value.
        </footer>
      </div>
    </section>
  );
}

function CaseWalletActions({ controller }: { controller: CaseController }) {
  const wallet = useWallet();
  const {
    accountId,
    reads,
    pool,
    storageAmount,
    canClaim,
    canPrepay,
    canRegister,
  } = controller;
  const balance = reads.balance?.value;
  const claimed = reads.claimed?.value;
  const cost = reads.claimCost?.value;
  const registration = reads.tokenRegistration?.value;
  const storage = reads.storage?.value;
  const needsStorage =
    storage !== undefined &&
    pool &&
    BigInt(storage) < BigInt(pool.storage_per_opening);
  return (
    <section className="tea-catalog-wallet" aria-label="Your tea money">
      <div className="tea-catalog-wallet-head">
        <h2>Your tea money</h2>
        <strong>
          {balance !== undefined ? formatUnits(balance) : '—'} USDI
        </strong>
      </div>
      <p>
        {accountId ??
          'Connect a NEAR Testnet wallet to claim starter USDI or open a case.'}
      </p>
      {!accountId && (
        <button
          type="button"
          onClick={() => void wallet.connect()}
          disabled={wallet.status === 'initializing' || wallet.busy !== null}
        >
          {wallet.busy === 'connect' ? 'Connecting…' : 'Connect Wallet'}
        </button>
      )}
      <CaseTransactionNotice controller={controller} />
      {wallet.error && !accountId && <p role="alert">{wallet.error}</p>}
      {accountId && controller.available && (
        <>
          <ChainReadStatus
            label="USDI balance"
            read={reads.balance}
            retry={controller.refresh}
          />
          <ChainReadStatus
            label="claim eligibility"
            read={reads.claimed}
            retry={controller.refresh}
          />
          <ChainReadStatus
            label="USDI registration"
            read={reads.tokenRegistration}
            retry={controller.refresh}
          />
          <ChainReadStatus
            label="case storage"
            read={reads.storage}
            retry={controller.refresh}
          />
        </>
      )}
      {claimed === false && (
        <>
          <button type="button" disabled={!canClaim} onClick={controller.claim}>
            Claim 1,000 USDI
          </button>
          {cost !== undefined && (
            <p>
              One claim per account. Attaches {formatUnits(cost, 24)} Testnet
              NEAR for registration and claim storage, plus gas.
            </p>
          )}
          <ChainReadStatus
            label="claim storage cost"
            read={reads.claimCost}
            retry={controller.refresh}
          />
        </>
      )}
      {claimed && <p>Starter USDI already claimed.</p>}
      {claimed && registration?.tokenRegistered === false && (
        <>
          <button
            type="button"
            disabled={!canRegister}
            onClick={controller.registerToken}
          >
            Register USDI account
          </button>
          <p>
            Attaches {formatUnits(registration.tokenStorageCost, 24)} Testnet
            NEAR for token storage, plus gas.
          </p>
        </>
      )}
      {needsStorage && storageAmount && (
        <>
          <button
            type="button"
            disabled={!canPrepay}
            onClick={controller.prepayStorage}
          >
            Prepay opening storage
          </button>
          <p>
            Attaches {formatUnits(storageAmount, 24)} Testnet NEAR for case
            storage, plus gas. Unused registration funds stay as storage credit.
          </p>
        </>
      )}
    </section>
  );
}

function CaseOpenAction({
  controller,
  hasOdds,
  settled,
}: {
  controller: CaseController;
  hasOdds: boolean;
  settled: boolean;
}) {
  const { accountId, caseInfo, reads, odds, canOpen } = controller;
  const balance = reads.balance?.value;
  const price = caseInfo ? formatUnits(caseInfo.price) + ' USDI' : null;
  return (
    <div className="tea-catalog-open">
      <button
        type="button"
        className="tea-catalog-primary"
        onClick={controller.open}
        disabled={!canOpen || !hasOdds}
      >
        {settled ? 'Open Another Case' : 'Open Case'}
        {price && ` · ${price}`}
      </button>
      {caseInfo && (
        <p>
          {formatUnits(caseInfo.poolContribution)} USDI to the pool ·{' '}
          {formatUnits(caseInfo.platformFee)} USDI platform fee · 1 yoctoNEAR
          plus gas.
        </p>
      )}
      {accountId && odds?.reason && <p>{odds.reason}</p>}
      {balance !== undefined &&
        caseInfo &&
        BigInt(balance) < BigInt(caseInfo.price) && (
          <p>Your USDI balance is below the case price.</p>
        )}
    </div>
  );
}
