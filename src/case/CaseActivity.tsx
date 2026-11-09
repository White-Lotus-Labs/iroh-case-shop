import { formatUnits, percent, rewardTier, type Opening } from './client';
import { ChainReadStatus } from './ChainReadStatus';
import type { CaseController } from './useCaseController';

const lifecycle = {
  RandomnessPending: 'Randomness pending',
  Paying: 'Payout in flight',
  Claimable: 'Payout failed · reward claimable',
  Completed: 'Payout completed',
};
export function CaseActivity({
  controller,
  showNotice = true,
}: {
  controller: CaseController;
  showNotice?: boolean;
}) {
  const {
    accountId,
    reads,
    active,
    history,
    accountPending,
    loading,
    signing,
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
        <button disabled={!available} onClick={() => void refresh()}>
          Refresh chain state
        </button>
      </div>
      {loading && <p role="status">Updating available Testnet data…</p>}
      {showNotice && <CaseTransactionNotice controller={controller} />}
      {accountPending && (
        <div className="cases-pending">
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
                    reads.tokenRegistration?.value?.tokenRegistered !== true)
                }
                onClick={() => recover(active)}
              >
                {active.status === 'Claimable'
                  ? 'Retry the confirmed failed payout'
                  : 'Advance the pending draw'}
              </button>
              {active.status === 'Claimable' &&
                !reads.tokenRegistration?.value?.tokenRegistered && (
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
      {available && accountId && (
        <>
          <ChainReadStatus
            label="active opening"
            read={reads.active}
            retry={refresh}
          />
          <ChainReadStatus
            label="opening history"
            read={reads.history}
            retry={refresh}
          />
        </>
      )}
      {history
        ?.filter((opening) => opening.opening_id !== active?.opening_id)
        .map((opening) => (
          <OpeningResult key={opening.opening_id} opening={opening} />
        ))}
      {(!accountId ||
        (reads.active?.status === 'ready' &&
          reads.history?.status === 'ready' &&
          !active &&
          !history?.length)) && (
        <p className="cases-empty">
          {accountId
            ? 'No finalized openings found for this account.'
            : 'Your finalized openings and accepted odds will appear here.'}
        </p>
      )}
    </section>
  );
}

export function CaseTransactionNotice({
  controller,
}: {
  controller: CaseController;
}) {
  const { accountPending, message, error, receiptError, refresh } = controller;
  if (!message && !error && !accountPending) return null;
  return (
    <div aria-live="polite">
      {message && <p className="cases-message">{message}</p>}
      {error && (
        <p role="alert" className="cases-error">
          {error}
        </p>
      )}
      {accountPending && (
        <p>
          {accountPending.hash
            ? 'Transaction submitted, awaiting finalized confirmation.'
            : 'Wallet confirmation or submission is unconfirmed. Check the wallet before taking another action.'}
        </p>
      )}
      {accountPending && receiptError && (
        <>
          <p role="alert">
            Could not confirm the transaction yet. {receiptError}
          </p>
          <button type="button" onClick={refresh}>
            Retry transaction status
          </button>
        </>
      )}
    </div>
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
