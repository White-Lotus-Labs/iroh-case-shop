'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet } from '../ui/wallet/WalletProvider';
import { CaseClient } from './client';
import { WalletHistory } from './WalletHistory';
import { caseById, liveCaseClients } from './catalog';
import {
  historyTime,
  mergeHistory,
  openingHistory,
  readSavedHistory,
  type HistoryEntry,
} from './history';

const clients = liveCaseClients().map(
  ({ definition, config }) => new CaseClient(config, undefined, definition),
);
type Results = { account: string; entries: HistoryEntry[]; error?: string };
type HistorySource = {
  contractId: string;
  caseId: string;
  nextCursor: string | null;
  complete: boolean;
  paginated: boolean;
  loading: boolean;
  error?: string;
};

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
  const [pages, setPages] = useState<{
    account: string;
    sources: HistorySource[];
  } | null>(null);
  const pageSession = useRef<AbortController | null>(null);
  const pageBusy = useRef(new Set<string>());

  useEffect(() => {
    if (!account || !clients.length) return;
    const scope = new AbortController();
    pageSession.current = scope;
    pageBusy.current.clear();
    setPages({ account, sources: [] });
    try {
      setSaved({
        account,
        entries: clients.flatMap((client) =>
          readSavedHistory(client.config, account, localStorage),
        ),
      });
    } catch {
      setSaved({
        account,
        entries: [],
        error: 'Saved transaction receipts could not be read in this browser.',
      });
    }
    const signer = account;
    const entries: HistoryEntry[] = [];
    const errors: string[] = [];
    setResult(null);
    const queue = [...clients];
    async function worker() {
      while (queue.length && !scope.signal.aborted) {
        const client = queue.shift();
        if (!client) return;
        try {
          const page = await client.historyPage(signer, null, scope.signal);
          const openings = page.openings;
          if (!scope.signal.aborted)
            setPages((previous) => ({
              account: signer,
              sources: [
                ...(previous?.account === signer ? previous.sources : []),
                {
                  contractId: client.config.caseContractId,
                  caseId: client.definition.id,
                  nextCursor: page.nextCursor,
                  complete: page.complete,
                  paginated: page.paginated,
                  loading: false,
                },
              ],
            }));
          entries.push(
            ...openings.flatMap((opening) =>
              openingHistory(client.config, opening, client.definition),
            ),
          );
        } catch {
          if (!scope.signal.aborted)
            errors.push(
              `${client.definition.name}: finalized history unavailable.`,
            );
        }
        if (!scope.signal.aborted)
          setResult({
            account: signer,
            entries: [...entries],
            ...(errors.length ? { error: errors.join(' ') } : {}),
          });
      }
    }
    void Promise.all([worker(), worker()]);
    return () => scope.abort();
  }, [account, request]);

  async function loadOlder(source: HistorySource) {
    const owner = pageSession.current;
    const client = clients.find(
      ({ config }) => config.caseContractId === source.contractId,
    );
    const cursor = source.nextCursor;
    if (
      !account ||
      !client ||
      !owner ||
      owner.signal.aborted ||
      !cursor ||
      pageBusy.current.has(source.contractId)
    )
      return;
    const signer = account;
    pageBusy.current.add(source.contractId);
    const update = (change: Partial<HistorySource>) =>
      setPages((previous) =>
        previous?.account === signer
          ? {
              ...previous,
              sources: previous.sources.map((item) =>
                item.contractId === source.contractId
                  ? { ...item, ...change }
                  : item,
              ),
            }
          : previous,
      );
    update({ loading: true, error: undefined });
    try {
      const page = await client.historyPage(signer, cursor, owner.signal);
      if (owner.signal.aborted) return;
      const older = page.openings.flatMap((opening) =>
        openingHistory(client.config, opening, client.definition),
      );
      setResult((previous) =>
        previous?.account === signer
          ? {
              ...previous,
              entries: [
                ...new Map(
                  [...previous.entries, ...older].map((entry) => [
                    entry.id,
                    entry,
                  ]),
                ).values(),
              ],
            }
          : previous,
      );
      update({
        nextCursor: page.nextCursor,
        complete: page.complete,
        paginated: page.paginated,
        loading: false,
      });
    } catch {
      if (!owner.signal.aborted)
        update({
          loading: false,
          error: 'Could not load older finalized openings. Retry this page.',
        });
    } finally {
      if (!owner.signal.aborted) pageBusy.current.delete(source.contractId);
    }
  }

  const chain = result?.account === account ? result : null;
  const local = saved?.account === account ? saved : null;
  const entries = mergeHistory(chain?.entries ?? [], local?.entries ?? []);
  const historySources = pages?.account === account ? pages.sources : [];
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
                value={
                  selected.caseId
                    ? `${caseById(selected.caseId).name} (${selected.caseId})`
                    : null
                }
              />
              <Detail
                label="Case contract"
                value={selected.caseContract ?? null}
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
            {account && !chain && clients.length > 0 && (
              <p role="status">Reading finalized case activity…</p>
            )}
            {account && clients.length === 0 && (
              <p role="status">The Testnet case is not configured.</p>
            )}
            {chain?.error && <p role="alert">{chain.error}</p>}
            {local?.error && <p role="alert">{local.error}</p>}
            {account && clients.length > 0 && (
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
            <p className="cases-fine">
              Opening history comes from finalized case records. Saved receipts
              include up to 60 transactions per case in this browser. Other
              wallet transfers can be inspected separately through the public
              indexer below.
            </p>
            {historySources.map((source) => (
              <div key={source.contractId} className="shelf-history-source">
                {source.error && (
                  <p role="alert">
                    {caseById(source.caseId).name}: {source.error}
                  </p>
                )}
                {source.nextCursor ? (
                  <button
                    type="button"
                    disabled={source.loading}
                    onClick={() => void loadOlder(source)}
                  >
                    {source.loading
                      ? 'Reading older openings…'
                      : `Load older ${caseById(source.caseId).name} openings`}
                  </button>
                ) : (
                  <p className="cases-fine">
                    {caseById(source.caseId).name}:{' '}
                    {source.complete
                      ? 'All opening records loaded.'
                      : 'Legacy contract returns the latest 20 openings. Older records require its history pagination upgrade.'}
                  </p>
                )}
              </div>
            ))}
            <ul className="shelf-activity-rows">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.type}</strong>
                    <span>
                      {entry.caseId ? `${caseById(entry.caseId).name} · ` : ''}
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
            <WalletHistory
              account={account}
              refreshKey={request}
              client={clients[0] ?? null}
            />
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
