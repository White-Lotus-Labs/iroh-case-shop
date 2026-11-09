'use client';

import Link from 'next/link';
import { WalletMenu } from '../ui/wallet/WalletMenu';
import { formatUnits, percent } from './client';
import { ChainReadStatus } from './ChainReadStatus';
import { CaseActivity } from './CaseActivity';
import { useCaseController } from './useCaseController';

export function Cases() {
  const controller = useCaseController();
  const { available, accountId, reads, pool, storageAmount, refresh } =
    controller;
  const accountQuote = controller.odds;
  const oddsRead = accountId ? reads.quote : reads.publicOdds;
  const odds = oddsRead?.value;
  const balance = reads.balance?.value;
  const claimed = reads.claimed?.value;
  const cost = reads.claimCost?.value;
  const storage = reads.storage?.value;
  const registration = reads.tokenRegistration?.value;
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
      {!available && (
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
              disabled={!controller.canOpen}
              onClick={controller.open}
            >
              Open Dragon Tea · 1 USDI
            </button>
            <p className="cases-fine">
              {!available
                ? 'Available after Testnet deployment.'
                : !accountId
                  ? 'Connect your Testnet wallet to continue.'
                  : (accountQuote?.reason ??
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
              {balance !== undefined ? formatUnits(balance) : '—'}{' '}
              <small>USDI</small>
            </div>
            <p>
              {accountId ??
                'Connect a NEAR Testnet wallet. Your account stays yours.'}
            </p>
            <button disabled={!controller.canClaim} onClick={controller.claim}>
              {claimed
                ? 'Starter USDI already claimed'
                : 'Claim 1,000 starter USDI'}
            </button>
            <p className="cases-fine">
              One permanent claim per account.{' '}
              {cost !== undefined
                ? `Attach ${formatUnits(cost, 24)} Testnet NEAR for token registration and claim storage, plus gas.`
                : 'Native Testnet NEAR storage cost is read from the token contract before signing.'}
            </p>
            {available && accountId && (
              <>
                <ChainReadStatus
                  label="USDI balance"
                  read={reads.balance}
                  retry={refresh}
                />
                <ChainReadStatus
                  label="claim eligibility"
                  read={reads.claimed}
                  retry={refresh}
                />
                {claimed === false && (
                  <ChainReadStatus
                    label="claim storage cost"
                    read={reads.claimCost}
                    retry={refresh}
                  />
                )}
                <ChainReadStatus
                  label="USDI registration"
                  read={reads.tokenRegistration}
                  retry={refresh}
                />
              </>
            )}
            {claimed && registration?.tokenRegistered === false && (
              <div>
                <p>
                  Your USDI token account is unregistered. Register it to
                  receive a pending reward; your starter claim stays permanent.
                </p>
                <button
                  disabled={!controller.canRegister}
                  onClick={controller.registerToken}
                >
                  Register USDI account
                </button>
                <p className="cases-fine">
                  Attach {formatUnits(registration.tokenStorageCost, 24)}{' '}
                  Testnet NEAR for standard token storage, plus gas.
                </p>
              </div>
            )}
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
                ? `Expected reward ${formatUnits(odds.expected_numerator, 12)} USDI. Probabilities total 100%.`
                : 'Reward tiers are fixed. Live probabilities appear only after a finalized contract read.'}
            </p>
            {available && (
              <ChainReadStatus
                label="case odds"
                read={oddsRead}
                retry={refresh}
              />
            )}
          </section>
          <section className="cases-panel">
            <h2>Native NEAR storage</h2>
            <p>
              Each opening prepays a separate history budget. This is additional
              to its 1 USDI price and transaction gas.
            </p>
            <p className="cases-fine">
              {storage !== undefined
                ? `Remaining credit: ${formatUnits(storage, 24)} NEAR. `
                : ''}
              {storageAmount
                ? `This deposit attaches ${formatUnits(storageAmount, 24)} Testnet NEAR, including the account registration budget. Any unused registration budget stays as case storage credit.`
                : 'The contract will supply the exact deposit amount.'}
            </p>
            {available && accountId && (
              <ChainReadStatus
                label="case storage"
                read={reads.storage}
                retry={refresh}
              />
            )}
            <button
              disabled={!controller.canPrepay}
              onClick={controller.prepayStorage}
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
            {pool
              ? `${pool.paused ? 'PAUSED · ' : ''}${pool.health.toUpperCase()}`
              : 'NO CHAIN DATA'}
          </span>
        </div>
        {available && (
          <>
            <ChainReadStatus
              label="case details"
              read={reads.caseInfo}
              retry={refresh}
            />
            <ChainReadStatus
              label="pool data"
              read={reads.pool}
              retry={refresh}
            />
          </>
        )}
        <dl>
          {[
            ['Pool funds', pool?.pool_funds],
            ['Reserved rewards', pool?.reserved_rewards],
            ['Available liquidity', pool?.available],
            ['Target reserve', pool?.target],
            ['Total rewards paid', pool?.total_paid],
            ['Vested platform fees', pool?.treasury_available],
            ['Unvested fees', pool?.pending_fees],
            ['Payouts in flight', pool?.in_flight_payouts],
            ['Treasury in flight', pool?.treasury_in_flight],
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
          {pool
            ? `${pool.pending_openings} pending openings · ${pool.completed_payouts} completed payouts. Book balance range during outgoing payouts: ${formatUnits(pool.expected_balance_min)} to ${formatUnits(pool.expected_balance_max)} USDI. Pending incoming transfers or unallocated tokens can add surplus.`
            : 'Rewards come from funded liquidity. No reserve is assumed before deployment.'}{' '}
          Healthy ≥ 800, Caution ≥ 500, Critical below 500 USDI available. All
          tiers require funded maximum-reward reserves.
        </p>
      </section>
      <CaseActivity controller={controller} />
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
