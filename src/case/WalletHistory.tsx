'use client';

import { useEffect, useRef, useState } from 'react';
import type { CaseClient } from './client';
import {
  fetchIndexedHistory,
  verifyIndexedTransaction,
  type IndexedTransaction,
} from './indexer';
import { historyTime } from './history';

type WalletPage = {
  account: string;
  rows: IndexedTransaction[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
};
type Verification = Awaited<ReturnType<typeof verifyIndexedTransaction>>;
type TransactionDetail = {
  account: string;
  reference: IndexedTransaction;
  state:
    | { kind: 'loading' }
    | { kind: 'verified'; result: Verification }
    | { kind: 'error'; message: string };
};

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Wallet history is temporarily unavailable.';
}

export function WalletHistory({
  account,
  refreshKey,
  client,
}: {
  account: string | null;
  refreshKey: number;
  client: CaseClient | null;
}) {
  const [page, setPage] = useState<WalletPage | null>(null);
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const session = useRef<AbortController | null>(null);
  const verification = useRef<AbortController | null>(null);
  const fetching = useRef(false);
  const liveAccount = useRef(account);
  liveAccount.current = account;
  const heading = useRef<HTMLHeadingElement>(null);
  const current = page?.account === account ? page : null;
  const selected = detail?.account === account ? detail : null;

  useEffect(() => {
    const owner = new AbortController();
    session.current = owner;
    fetching.current = false;
    verification.current?.abort();
    setDetail(null);
    if (!account) {
      setPage(null);
      return () => owner.abort();
    }
    const signer = account;
    setPage({
      account: signer,
      rows: [],
      nextCursor: null,
      loading: true,
      error: null,
    });
    fetching.current = true;
    void fetchIndexedHistory(signer, null, owner.signal)
      .then(
        (result) => {
          if (!owner.signal.aborted && liveAccount.current === signer)
            setPage({
              account: signer,
              rows: result.transactions,
              nextCursor: result.nextCursor,
              loading: false,
              error: null,
            });
        },
        (error: unknown) => {
          if (!owner.signal.aborted && liveAccount.current === signer)
            setPage({
              account: signer,
              rows: [],
              nextCursor: null,
              loading: false,
              error: message(error),
            });
        },
      )
      .finally(() => {
        if (!owner.signal.aborted) fetching.current = false;
      });
    return () => {
      owner.abort();
      verification.current?.abort();
    };
  }, [account, refreshKey]);

  useEffect(() => {
    if (selected) heading.current?.focus();
  }, [selected?.reference.hash]);

  async function loadPage(cursor: string | null) {
    const owner = session.current;
    if (!account || !owner || owner.signal.aborted || fetching.current) return;
    const signer = account;
    fetching.current = true;
    setPage((previous) =>
      previous?.account === signer
        ? { ...previous, loading: true, error: null }
        : previous,
    );
    try {
      const result = await fetchIndexedHistory(signer, cursor, owner.signal);
      if (owner.signal.aborted || liveAccount.current !== signer) return;
      setPage((previous) => ({
        account: signer,
        rows: [
          ...new Map(
            [
              ...(cursor && previous?.account === signer ? previous.rows : []),
              ...result.transactions,
            ].map((row) => [row.hash, row]),
          ).values(),
        ],
        nextCursor: result.nextCursor,
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (!owner.signal.aborted && liveAccount.current === signer)
        setPage((previous) =>
          previous?.account === signer
            ? { ...previous, loading: false, error: message(error) }
            : previous,
        );
    } finally {
      if (!owner.signal.aborted) fetching.current = false;
    }
  }

  async function inspect(reference: IndexedTransaction) {
    if (!account) return;
    const signer = account;
    verification.current?.abort();
    const owner = new AbortController();
    verification.current = owner;
    setDetail({ account: signer, reference, state: { kind: 'loading' } });
    if (!client) {
      setDetail({
        account: signer,
        reference,
        state: {
          kind: 'error',
          message: 'Testnet RPC verification is unavailable.',
        },
      });
      return;
    }
    try {
      const result = await verifyIndexedTransaction(
        reference,
        client.rpc.bind(client),
        owner.signal,
      );
      const involved =
        result.signerId === signer ||
        result.receiverId === signer ||
        result.transfers.some(
          (transfer) =>
            transfer.oldOwnerId === signer || transfer.newOwnerId === signer,
        );
      if (!involved)
        throw new Error(
          'Finalized receipts do not establish that this wallet participated in the indexed transaction.',
        );
      if (!owner.signal.aborted && liveAccount.current === signer)
        setDetail({
          account: signer,
          reference,
          state: { kind: 'verified', result },
        });
    } catch (error) {
      if (!owner.signal.aborted && liveAccount.current === signer)
        setDetail({
          account: signer,
          reference,
          state: { kind: 'error', message: message(error) },
        });
    }
  }

  if (!account) return null;
  return (
    <section
      className="shelf-wallet-history"
      aria-label="Indexed wallet history"
    >
      {selected ? (
        <>
          <button
            type="button"
            onClick={() => {
              verification.current?.abort();
              setDetail(null);
            }}
          >
            ← Back to wallet references
          </button>
          <h2 ref={heading} tabIndex={-1}>
            Wallet transaction details
          </h2>
          <dl>
            <Field label="Transaction hash" value={selected.reference.hash} />
            <Field
              label="Indexer status"
              value={selected.reference.indexerStatus}
            />
          </dl>
          {selected.state.kind === 'loading' && (
            <p role="status">
              Verifying the transaction and receipt graph at finality…
            </p>
          )}
          {selected.state.kind === 'error' && (
            <>
              <p role="alert">
                Receipt verification unavailable. {selected.state.message}
              </p>
              <p>
                This remains an indexer reference. It has not been added to the
                verified case ledger.
              </p>
              <button
                type="button"
                onClick={() => void inspect(selected.reference)}
              >
                Retry receipt verification
              </button>
            </>
          )}
          {selected.state.kind === 'verified' && (
            <>
              <p className="shelf-verification-status">
                Finalized receipt verification: {selected.state.result.status}
              </p>
              <dl>
                <Field
                  label="Verification source"
                  value={selected.state.result.source}
                />
                <Field label="Signer" value={selected.state.result.signerId} />
                <Field
                  label="Receiver"
                  value={selected.state.result.receiverId}
                />
                <Field
                  label="Actions"
                  value={selected.state.result.actions.join(', ')}
                />
                <Field
                  label="Finalized block"
                  value={selected.state.result.blockHeight}
                />
                <Field
                  label="Timestamp (UTC)"
                  value={
                    historyTime(selected.state.result.timestamp) ??
                    'Unavailable'
                  }
                />
              </dl>
              <h3>Verified token transfer events</h3>
              {!selected.state.result.transfers.length && (
                <p>
                  No NEP-141 transfer event was verified in the finalized
                  receipts.
                </p>
              )}
              <ul>
                {selected.state.result.transfers.map((transfer, index) => (
                  <li key={index}>
                    <dl>
                      <Field
                        label="Token contract"
                        value={transfer.tokenContractId}
                      />
                      <Field label="From" value={transfer.oldOwnerId} />
                      <Field label="To" value={transfer.newOwnerId} />
                      <Field
                        label="Amount"
                        value={`${transfer.amount} raw token units`}
                      />
                      {transfer.memo && (
                        <Field label="Memo" value={transfer.memo} />
                      )}
                    </dl>
                  </li>
                ))}
              </ul>
              <details>
                <summary>Verified receipt IDs</summary>
                <ul>
                  {selected.state.result.receiptIds.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
          <a
            href={`https://testnet.nearblocks.io/txns/${selected.reference.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction on NearBlocks ↗
          </a>
        </>
      ) : (
        <>
          <h2>Wallet transaction references</h2>
          <p>
            These public indexer references are separate from the case ledger.
            Open Details to verify a transaction and its receipts against
            finalized Testnet RPC state. Indexer coverage may be delayed or
            incomplete.
          </p>
          {(!current || current.loading) && (
            <p role="status">Reading indexed wallet activity…</p>
          )}
          {current?.error && (
            <p role="alert">Indexer history unavailable. {current.error}</p>
          )}
          {current &&
            !current.loading &&
            !current.error &&
            !current.rows.length && (
              <p>No wallet transaction references were returned.</p>
            )}
          <ul className="shelf-indexer-rows">
            {current?.rows.map((row) => (
              <li key={row.hash}>
                <div>
                  <strong>{row.actions.join(', ') || 'Transaction'}</strong>
                  <p>
                    {row.signerId} → {row.receiverId}
                  </p>
                  <small>
                    Indexer reports {row.indexerStatus}. Not receipt-verified.
                    Block {row.blockHeight}.
                  </small>
                </div>
                <button
                  type="button"
                  aria-label={`Details for wallet transaction ${row.hash}`}
                  onClick={() => void inspect(row)}
                >
                  Details
                </button>
              </li>
            ))}
          </ul>
          {current && (
            <button
              type="button"
              disabled={current.loading}
              onClick={() => void loadPage(current.nextCursor)}
            >
              {current.error
                ? 'Retry indexed wallet history'
                : current.nextCursor
                  ? 'Load more wallet references'
                  : 'Refresh wallet references'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
