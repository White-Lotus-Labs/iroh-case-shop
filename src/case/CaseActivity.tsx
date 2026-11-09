import { formatUnits, percent, rewardTier, type Opening } from './client';
import type { CaseController } from './useCaseController';

const lifecycle = {
  RandomnessPending: 'Randomness pending',
  Paying: 'Payout in flight',
  Claimable: 'Payout failed · reward claimable',
  Completed: 'Payout completed',
};
export function CaseActivity({ controller }: { controller: CaseController }) {
  const {
    account,
    active,
    accountPending,
    loading,
    signing,
    message,
    error,
    hashInput,
    setHashInput,
    available,
    disabled,
    refresh,
    attachHash,
    recover,
  } = controller;
  return (
    <section
      className="cases-panel cases-activity"
      aria-labelledby="activity-title"
    >
      <div className="cases-panel-heading">
        <h2 id="activity-title">Your latest brews</h2>
        <button
          disabled={!available || loading || signing}
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
                If the wallet navigated away, return here and refresh. Accepted
                openings are also recovered from contract state. An unresolved
                submission blocks new signing.
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
                disabled={
                  disabled ||
                  (active.status === 'Claimable' &&
                    account?.tokenRegistered !== true)
                }
                onClick={() => recover(active)}
              >
                {active.status === 'Claimable'
                  ? 'Retry the confirmed failed payout'
                  : 'Advance the pending draw'}
              </button>
              {active.status === 'Claimable' && !account?.tokenRegistered && (
                <p>
                  Register your USDI account above before retrying. The reward
                  stays reserved.
                </p>
              )}
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
          ? `${rewardTier(opening.reward)} · ${formatUnits(opening.reward)} USDI`
          : 'Draw pending'}
      </strong>
    </article>
  );
}
