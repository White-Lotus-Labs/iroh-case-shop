'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet } from '../ui/wallet/WalletProvider';
import { ChainReadStatus } from './ChainReadStatus';
import { CaseActivity, CaseTransactionNotice } from './CaseActivity';
import { formatUnits, percent, rewardTier, formatReward } from './client';
import { RewardReel, TokenSeal } from './RewardReel';
import { useCaseController, type CaseController } from './useCaseController';
import {
  caseCatalog,
  caseById,
  dragonCase,
  type CaseDefinition,
} from './catalog';

function TeaCoffer({
  revealed = false,
  definition = dragonCase,
}: {
  revealed?: boolean;
  definition?: CaseDefinition;
}) {
  const index = caseCatalog.indexOf(definition);
  const crest = ['竹', '龍', '月', '凰', '秘'][index] ?? '茶';
  return (
    <div
      className="tea-coffer"
      data-revealed={revealed}
      data-case={definition.id}
      aria-hidden="true"
    >
      <span className="tea-coffer-moon" />
      <span className="tea-coffer-halo" />
      <span className="tea-coffer-steam">
        <i />
        <i />
        <i />
      </span>
      <span className="tea-coffer-box">
        <span className="tea-coffer-lid">
          <b className="tea-coffer-crest">{crest}</b>
        </span>
        <span className="tea-coffer-front">
          <i /> <b className="tea-coffer-clasp">茶</b> <i />
        </span>
      </span>
      <span className="tea-coffer-edition">
        No. {String(index + 1).padStart(2, '0')} ·{' '}
        {definition.name.replace(' Case', '')}
      </span>
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
  const [selected, setSelected] = useState(dragonCase);
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const id = params.get('teaCase') ?? params.get('collection');
    if (id && caseCatalog.some((entry) => entry.id === id))
      setSelected(caseById(id));
  }, []);
  return (
    <TeaCaseView
      key={selected.id}
      definition={selected}
      inspecting={inspecting}
      onInspect={onInspect}
      onSelect={(definition) => {
        setSelected(definition);
        const url = new URL(window.location.href);
        url.searchParams.set('teaCase', definition.id);
        window.history.replaceState(window.history.state, '', url);
        onInspect(true);
      }}
    />
  );
}

function TeaCaseView({
  definition,
  inspecting,
  onInspect,
  onSelect,
}: {
  definition: CaseDefinition;
  inspecting: boolean;
  onInspect: (inspect: boolean) => void;
  onSelect: (definition: CaseDefinition) => void;
}) {
  const controller = useCaseController(definition);
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
      : controller.signing
        ? undefined
        : history?.[0]);
  const revealed = opening?.reward !== null && opening?.reward !== undefined;
  const rewardSymbols = [
    'USDI' as const,
    ...(caseInfo?.bonusRewards.map((reward) => reward.token_symbol) ?? []),
  ];
  const winner = opening?.bonus?.token_symbol ?? 'USDI';
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
            {inspecting ? definition.name : 'The Tea Collection'}
          </h1>
          <p>
            {inspecting
              ? definition.description
              : 'Every brew holds a different fortune.'}
          </p>
        </header>

        {!inspecting ? (
          <div className="tea-catalog-collection">
            {caseCatalog.map((entry, index) => (
              <article
                className="tea-catalog-card"
                key={entry.id}
                data-case={entry.id}
              >
                <TeaCoffer definition={entry} />
                <div className="tea-catalog-card-copy">
                  <p className="tea-catalog-kicker">
                    Case No. {String(index + 1).padStart(2, '0')} ·{' '}
                    {entry.deploymentStatus === 'verified-live'
                      ? 'Testnet'
                      : 'Awaiting deployment'}
                  </p>
                  <h2>{entry.name}</h2>
                  <p>{entry.description}</p>
                  <p className="tea-catalog-price">
                    {formatUnits(entry.price)} USDI
                  </p>
                  <ul
                    className="tea-catalog-tier-list"
                    aria-label={`${entry.name} reward tiers`}
                  >
                    {entry.rewards.map(({ tier }) => (
                      <li key={tier}>{tier}</li>
                    ))}
                  </ul>
                  <p className="tea-catalog-token-preview">
                    Bonus preview ·{' '}
                    {entry.bonusRewards
                      .map(({ token_symbol }) => token_symbol)
                      .join(' · ')}
                  </p>
                  {entry.deploymentStatus === 'verified-live' &&
                    entry.bonusDeploymentStatus === 'planned' && (
                      <p className="tea-catalog-token-preview">
                        Bonus upgrade awaiting approval
                      </p>
                    )}
                  <button
                    type="button"
                    className="tea-catalog-primary"
                    onClick={() => onSelect(entry)}
                  >
                    Inspect {entry.name} <span aria-hidden="true">→</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : !controller.available ? (
          <PlannedCasePreview definition={definition} />
        ) : (
          <>
            <div className="tea-catalog-detail">
              <div>
                <TeaCoffer
                  key={opening?.opening_id ?? 'sealed'}
                  revealed={revealed}
                  definition={definition}
                />
                <div className="tea-catalog-reveal" aria-live="polite">
                  {opening?.reward ? (
                    <>
                      <RewardReel
                        key={`${definition.id}:${accountId}:${opening.opening_id}:${winner}`}
                        symbols={
                          rewardSymbols.includes(winner)
                            ? rewardSymbols
                            : [...rewardSymbols, winner]
                        }
                        winner={winner}
                        tier={rewardTier(opening.reward, definition) ?? ''}
                      />
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
                        {rewardTier(opening.reward, definition)} ·{' '}
                        {formatUnits(opening.reward)} USDI
                      </p>
                      {opening.bonus &&
                        opening.usdiPaid &&
                        opening.status !== 'Completed' && (
                          <p>USDI payout confirmed.</p>
                        )}
                      {opening.bonus && (
                        <p className="tea-catalog-reward tea-bonus-reward">
                          <TokenSeal symbol={opening.bonus.token_symbol} />
                          {formatReward(opening.bonus)} bonus ·{' '}
                          {opening.bonusPaid ? 'Paid' : 'Reserved'}
                        </p>
                      )}
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
                {caseInfo && caseInfo.bonusRewards.length > 0 && (
                  <section
                    className="tea-bonus-table"
                    aria-label="Testnet bonus rewards"
                  >
                    <h3>Testnet bonus rewards</h3>
                    <p>
                      Each rarity has a 50% bonus chance alongside USDI.
                      Candidates within that rarity share the bonus chance
                      equally. These unofficial test tokens have no monetary
                      value.
                    </p>
                    <ul>
                      {caseInfo.bonusRewards.map((reward) => (
                        <li key={reward.reward_id} data-tier={reward.tier}>
                          <TokenSeal symbol={reward.token_symbol} />
                          <span>
                            <strong>{formatReward(reward)}</strong>
                            <small>
                              {reward.tier} · 50% ÷ {reward.candidatesInTier} in
                              tier ·{' '}
                              {formatUnits(
                                reward.available,
                                reward.token_decimals,
                              )}{' '}
                              available
                              {odds && (
                                <span className="tea-token-chance">
                                  {' '}
                                  · Exact token chance{' '}
                                  {
                                    odds[
                                      definition.rewards.find(
                                        ({ tier }) => tier === reward.tier,
                                      )?.probability ?? 'common'
                                    ]
                                  }{' '}
                                  / {2_000_000 * reward.candidatesInTier} per
                                  opening
                                </span>
                              )}
                            </small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
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
                  Expected USDI reward{' '}
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

function PlannedCasePreview({ definition }: { definition: CaseDefinition }) {
  return (
    <div className="tea-catalog-planned" aria-label="Case deployment preview">
      <TeaCoffer definition={definition} />
      <div>
        <h2>Awaiting verified Testnet deployment</h2>
        <p>
          This case is prepared locally. Live probabilities, balances and
          inventory are unavailable until its contract is deployed, funded and
          verified.
        </p>
        <p>
          Planned opening price:{' '}
          <strong>{formatUnits(definition.price)} USDI</strong>.{' '}
          {formatUnits(definition.poolContribution)} USDI goes to this case's
          reward pool and {formatUnits(definition.platformFee)} USDI is the
          platform fee.
        </p>
        <h3>Planned USDI rewards</h3>
        <dl>
          {definition.rewards.map(({ tier, amount }) => (
            <div key={tier}>
              <dt>{tier}</dt>
              <dd>{formatUnits(amount)} USDI</dd>
            </div>
          ))}
        </dl>
        <h3>Planned bonus collection</h3>
        <p>
          A 50% bonus chance in each tier, with equal selection among that
          tier's candidates. These are unofficial Iroh Testnet mocks with no
          monetary value.
        </p>
        <ul>
          {definition.bonusRewards.map((reward) => (
            <li key={`${reward.tier}:${reward.token_contract_id}`}>
              <TokenSeal symbol={reward.token_symbol} /> {formatReward(reward)}{' '}
              · {reward.tier}
            </li>
          ))}
        </ul>
        {definition.bonusRewards.some(({ token_symbol }) =>
          /NEAR|LINEAR/i.test(token_symbol),
        ) && (
          <p>
            Derivative mocks provide no staking, yield, redemption or backing.
          </p>
        )}
        <button type="button" className="tea-catalog-primary" disabled>
          Open Case · {formatUnits(definition.price)} USDI
        </button>
      </div>
    </div>
  );
}
