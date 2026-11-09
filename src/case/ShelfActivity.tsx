'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet } from '../ui/wallet/WalletProvider';
import { CaseClient, configuredDeployment } from './client';
import {
  historyTime,
  mergeHistory,
  openingHistory,
  readSavedHistory,
  type HistoryEntry,
} from './history';

const rpc = configuredDeployment ? new CaseClient(configuredDeployment) : null;
type Results = { account: string; entries: HistoryEntry[]; error?: string };

export function ShelfActivity({ onTraders }: { onTraders: () => void }) {
  const wallet = useWallet();
  const account = wallet.status === 'connected' ? wallet.accountId : null;
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<Results | null>(null);
  const [saved, setSaved] = useState<Results | null>(null);
  const [detail, setDetail] = useState<{ account: string; id: string } | null>(
    null,
  );
  const detailsHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!account || !rpc) return;
    const client = rpc;
    const scope = new AbortController();
    try {
      setSaved({
        account,
        entries: readSavedHistory(client.config, account, localStorage),
      });
    } catch {
      setSaved({
        account,
        entries: [],
        error: 'Saved transaction receipts could not be read in this browser.',
      });
    }
    void client.history(account, scope.signal).then(
      (openings) => {
        if (!scope.signal.aborted)
          setResult({
            account,
            entries: openings.flatMap((opening) =>
              openingHistory(client.config, opening),
            ),
          });
      },
      () => {
        if (!scope.signal.aborted)
          setResult({
            account,
            entries: [],
            error: 'Could not read finalized case activity from Testnet.',
          });
      },
    );
    return () => scope.abort();
  }, [account, request]);

  const chain = result?.account === account ? result : null;
  const local = saved?.account === account ? saved : null;
  const entries = mergeHistory(chain?.entries ?? [], local?.entries ?? []);
  const selected =
    detail?.account === account
      ? entries.find((entry) => entry.id === detail.id)
      : undefined;

  useEffect(() => {
    if (selected?.id) detailsHeading.current?.focus();
  }, [selected?.id]);

  return (
    <div className="parchment-hanger" data-testid="shelf-activity">
      <div className="parchment-rod" aria-hidden="true" />
      <div className="leaderboard-parchment shelf-activity">
        <p className="tea-catalog-kicker">The Shelf · 卷</p>
        {selected ? (
          <>
            <button
              type="button"
              onClick={() => {
                const id = selected.id;
                setDetail(null);
                requestAnimationFrame(() =>
                  document.getElementById(`shelf-detail-${id}`)?.focus(),
                );
              }}
            >
              ← Back to activity
            </button>
            <h2 ref={detailsHeading} tabIndex={-1}>
              {selected.type} details
            </h2>
            <dl>
              <Detail label="Status" value={selected.status} />
              <Detail label="Transaction hash" value={selected.hash} />
              <Detail
                label={
                  selected.hash ? 'Block height' : 'Opening accepted at block'
                }
                value={selected.height}
              />
              <Detail
                label="Timestamp (UTC)"
                value={historyTime(selected.timestamp)}
              />
              <Detail label="Sender" value={selected.sender} />
              <Detail label="Receiver" value={selected.receiver} />
              <Detail
                label="Token contract"
                value={selected.tokenContract || null}
              />
              <Detail label="Action" value={selected.method} />
              <Detail label="Amount" value={selected.amount} />
              <Detail
                label="Case"
                value={selected.caseId ? 'Dragon Tea Case (dragon-tea)' : null}
              />
              <Detail label="Opening ID" value={selected.openingId ?? null} />
              <Detail label="Reward selected" value={selected.reward ?? null} />
              <Detail label="Rarity" value={selected.rarity ?? null} />
              <Detail label="Source" value={selected.source} />
            </dl>
            {selected.hash && (
              <a
                href={`https://testnet.nearblocks.io/txns/${selected.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction on NearBlocks ↗
              </a>
            )}
          </>
        ) : (
          <>
            <h1>Activity Ledger</h1>
            <p>Case rewards and receipts for actions verified by this shop.</p>
            {!account && (
              <p>
                {wallet.status === 'initializing'
                  ? 'Restoring wallet…'
                  : 'Connect a NEAR Testnet wallet to see your activity.'}
              </p>
            )}
            {account && <p className="shelf-account">{account}</p>}
            {account && !chain && rpc && (
              <p role="status">Reading finalized case activity…</p>
            )}
            {account && !rpc && (
              <p role="status">The Testnet case is not configured.</p>
            )}
            {chain?.error && <p role="alert">{chain.error}</p>}
            {local?.error && <p role="alert">{local.error}</p>}
            {account && rpc && (
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setRequest((value) => value + 1);
                }}
                disabled={!chain}
              >
                {chain?.error ? 'Retry case activity' : 'Refresh activity'}
              </button>
            )}
            {account && chain && !chain.error && !entries.length && (
              <p>No recorded case activity or saved receipts.</p>
            )}
            <ul className="shelf-activity-rows">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.type}</strong>
                    <span>
                      {entry.caseId ? 'Dragon Tea Case · ' : ''}
                      {entry.status}
                    </span>
                    <small>
                      {historyTime(entry.timestamp)
                        ?.replace('T', ' ')
                        .replace('Z', ' UTC') ?? `Block ${entry.height}`}
                    </small>
                  </div>
                  <span>{entry.amount ?? entry.token}</span>
                  <button
                    type="button"
                    id={`shelf-detail-${entry.id}`}
                    aria-label={`Details for ${entry.type}`}
                    onClick={() =>
                      account && setDetail({ account, id: entry.id })
                    }
                  >
                    Details
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={onTraders}>
              See the top traders
            </button>
          </>
        )}
      </div>
      <div className="parchment-rod parchment-rod-bottom" aria-hidden="true" />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? 'Unavailable'}</dd>
    </div>
  );
}
