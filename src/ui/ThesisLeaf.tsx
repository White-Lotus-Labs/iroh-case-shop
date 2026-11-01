'use client';
import { useId, useState, type ReactNode } from 'react';
import { formatMoney, shortenAddress } from '../leaderboard/model';
import type {
  Section,
  ThesisId,
  Ticker,
  TickerDetail,
  TickerSignal,
} from '../thesis/types';
import { formatRelative, isDust, shopErrorText } from './deckModel';

// Reuse a loaded detail for a few minutes, so reopening an asset is instant.
// The shop saves new readings every hour, so a tab left open still refreshes.
const DETAIL_REUSE_MS = 5 * 60 * 1000;
const detailCache = new Map<
  string,
  { loadedAt: number; pending: Promise<TickerDetail> }
>();

/** An error the shop reported, safe to show as is. */
class DetailError extends Error {}

function loadDetail(thesisId: ThesisId, symbol: string) {
  const key = `${thesisId}/${symbol}`;
  const cached = detailCache.get(key);
  if (cached && Date.now() - cached.loadedAt < DETAIL_REUSE_MS)
    return cached.pending;
  const pending = fetch(
    `/api/theses/${thesisId}/${encodeURIComponent(symbol)}`,
    { cache: 'no-store' },
  ).then(async (response) => {
    if (response.ok) return (await response.json()) as TickerDetail;
    throw new DetailError(await shopErrorText(response));
  });
  detailCache.set(key, { loadedAt: Date.now(), pending });
  pending.catch(() => {
    if (detailCache.get(key)?.pending === pending) detailCache.delete(key);
  });
  return pending;
}

const ASSET_CLASS: Record<Ticker['assetClass'], string> = {
  crypto: 'Crypto',
  stock: 'Stock token',
  native: 'Native',
};

function Figure({
  signal,
  offline,
}: {
  signal: TickerSignal | undefined;
  offline: boolean;
}) {
  if (offline || !signal)
    return (
      <span className="leaf-figure" data-dir="none">
        <span className="leaf-amount">Offline</span>
        <span className="leaf-unit">no Nansen data</span>
      </span>
    );
  if (signal.status !== 'ok' || signal.smartMoneyNetFlowUsd === null)
    return (
      <span className="leaf-figure" data-dir="none">
        <span className="leaf-amount">
          {signal.status === 'error' ? 'No data' : 'Quiet'}
        </span>
        <span className="leaf-unit">
          {signal.status === 'error'
            ? 'Nansen did not respond'
            : 'no smart-money activity'}
        </span>
      </span>
    );
  const value = signal.smartMoneyNetFlowUsd;
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return (
    <span className="leaf-figure" data-dir={dir}>
      <span className="leaf-amount">
        <span className="leaf-glyph" aria-hidden="true">
          {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'}
        </span>
        {formatMoney(value, true)}
      </span>
      <span className="leaf-unit">
        {signal.source === 'position-intelligence'
          ? 'smart-money net long · open perps'
          : 'smart-money net flow · 7d'}
      </span>
    </span>
  );
}

function who(address: string, label: string | null) {
  return label?.trim() || shortenAddress(address);
}

function DetailSection<T>({
  title,
  section,
  okOnly = false,
  wide = false,
  children,
}: {
  title: string;
  section: Section<T>;
  okOnly?: boolean;
  wide?: boolean;
  children: (data: T) => ReactNode;
}) {
  if (section.status === 'not-applicable') return null;
  if (okOnly && section.status !== 'ok') return null;
  return (
    <section
      className="leaf-section"
      data-status={section.status}
      data-wide={wide ? 'true' : undefined}
    >
      <h5 className="leaf-section-title">{title}</h5>
      {section.status === 'ok' ? (
        children(section.data)
      ) : section.status === 'empty' ? (
        <p className="leaf-quiet">Nansen has no smart-money data here.</p>
      ) : (
        <p className="leaf-unavailable">Unavailable · {section.reason}</p>
      )}
    </section>
  );
}

function Money({
  value,
  signed = false,
}: {
  value: number | null;
  signed?: boolean;
}) {
  return <span className="leaf-money">{formatMoney(value, signed)}</span>;
}

function Detail({ detail, now }: { detail: TickerDetail; now: number }) {
  return (
    <>
      <p className="leaf-live">
        <span className="leaf-live-dot" aria-hidden="true" />
        Saved Nansen readings · updated {formatRelative(detail.fetchedAt, now)}
        {detail.stale && <span className="deck-stale">Stale</span>}
      </p>
      <div className="leaf-sections">
        <DetailSection
          title="Who is buying and selling"
          section={detail.movements}
          wide
        >
          {(moves) => {
            const buyers = moves.buyers.filter((b) => !isDust(b.boughtUsd));
            const sellers = moves.sellers.filter((m) => !isDust(m.soldUsd));
            const recent = moves.recent.filter((t) => !isDust(t.valueUsd));
            return !buyers.length && !sellers.length && !recent.length ? (
              <p className="leaf-quiet">
                No smart-money buys or sells in the last 7 days.
              </p>
            ) : (
              <>
                <div className="leaf-columns">
                  <div>
                    <p className="leaf-sub">Top buyers</p>
                    {buyers.length ? (
                      <ul className="leaf-list">
                        {buyers.map((b) => (
                          <li key={`b-${b.address}`}>
                            <span className="leaf-who">
                              {who(b.address, b.label)}
                            </span>
                            <span className="leaf-pos">
                              <Money value={b.boughtUsd} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="leaf-none">
                        No smart-money buyers in the last 7 days.
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="leaf-sub">Top sellers</p>
                    {sellers.length ? (
                      <ul className="leaf-list">
                        {sellers.map((s) => (
                          <li key={`s-${s.address}`}>
                            <span className="leaf-who">
                              {who(s.address, s.label)}
                            </span>
                            <span className="leaf-neg">
                              <Money value={s.soldUsd} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="leaf-none">
                        No smart-money sellers in the last 7 days.
                      </p>
                    )}
                  </div>
                </div>
                {recent.length > 0 && (
                  <>
                    <p className="leaf-sub">Recent smart-money trades</p>
                    <ul className="leaf-list leaf-trades">
                      {recent.map((t, i) => (
                        <li key={`${t.txHash ?? t.trader}-${i}`}>
                          <span className="leaf-action" data-action={t.action}>
                            {t.action === 'buy' ? 'Buy' : 'Sell'}
                          </span>
                          <span className="leaf-who">
                            {who(t.trader, t.label)}
                          </span>
                          <Money value={t.valueUsd} />
                          <span className="leaf-time">
                            {formatRelative(t.at, now)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            );
          }}
        </DetailSection>

        <DetailSection title="Smart-money holders" section={detail.holders}>
          {({ totalHolders, smartMoney }) => (
            <>
              <p className="leaf-stat">
                <strong>
                  {totalHolders === null
                    ? '—'
                    : totalHolders.toLocaleString('en-US')}
                </strong>{' '}
                holders
              </p>
              {smartMoney.length ? (
                <>
                  <p className="leaf-sub">Top smart-money holders</p>
                  <ul className="leaf-list">
                    {smartMoney.map((h) => (
                      <li key={h.address}>
                        <span className="leaf-who">
                          {who(h.address, h.label)}
                        </span>
                        <Money value={h.valueUsd} />
                        <span
                          className={
                            (h.change7dPct ?? 0) >= 0 ? 'leaf-pos' : 'leaf-neg'
                          }
                        >
                          {h.change7dPct === null
                            ? '—'
                            : `${h.change7dPct > 0 ? '+' : ''}${h.change7dPct.toFixed(1)}% 7d`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="leaf-none">No smart-money holders on record.</p>
              )}
            </>
          )}
        </DetailSection>

        <DetailSection
          title="Supply not yet circulating"
          section={detail.supply}
          okOnly
        >
          {({ notCirculatingPct }) =>
            notCirculatingPct === null ? (
              <p className="leaf-none">Supply split not reported.</p>
            ) : (
              <>
                <div
                  className="leaf-bar"
                  role="img"
                  aria-label={`${notCirculatingPct.toFixed(1)}% of supply is not yet circulating`}
                >
                  <span
                    style={{
                      width: `${Math.min(100, Math.max(0, notCirculatingPct))}%`,
                    }}
                  />
                </div>
                <p className="leaf-stat">
                  <strong>{notCirculatingPct.toFixed(1)}%</strong> of total
                  supply is still locked or unissued
                </p>
              </>
            )
          }
        </DetailSection>

        <DetailSection title="Perpetuals positioning" section={detail.perps}>
          {({ smartLongUsd, smartShortUsd, recent }) => {
            const trades = recent.filter((t) => !isDust(t.valueUsd));
            const long = Math.max(0, smartLongUsd ?? 0);
            const short = Math.max(0, smartShortUsd ?? 0);
            const longPct =
              long + short > 0 ? (long / (long + short)) * 100 : 50;
            return (
              <>
                <div
                  className="leaf-perp-bar"
                  role="img"
                  aria-label={`Smart money long ${formatMoney(smartLongUsd)}, short ${formatMoney(smartShortUsd)}`}
                >
                  <span
                    className="leaf-perp-long"
                    style={{ width: `${longPct}%` }}
                  />
                  <span className="leaf-perp-short" />
                </div>
                <p className="leaf-perp-legend">
                  <span className="leaf-pos">
                    Long {formatMoney(smartLongUsd)}
                  </span>
                  <span className="leaf-neg">
                    Short {formatMoney(smartShortUsd)}
                  </span>
                </p>
                {trades.length > 0 && (
                  <>
                    <p className="leaf-sub">Recent perp trades</p>
                    <ul className="leaf-list leaf-trades">
                      {trades.map((t, i) => (
                        <li key={`${t.trader}-${i}`}>
                          <span
                            className="leaf-action"
                            data-action={t.side === 'long' ? 'buy' : 'sell'}
                          >
                            {t.side === 'long' ? 'Long' : 'Short'}
                          </span>
                          <span className="leaf-who">
                            {who(t.trader, t.label)} · {t.action}
                          </span>
                          <Money value={t.valueUsd} />
                          <span className="leaf-time">
                            {formatRelative(t.at, now)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            );
          }}
        </DetailSection>
      </div>
    </>
  );
}

type DetailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; detail: TickerDetail }
  | { status: 'error'; reason: string };

export function ThesisLeaf({
  thesisId,
  ticker,
  signal,
  offline,
  now,
}: {
  thesisId: ThesisId;
  ticker: Ticker;
  signal: TickerSignal | undefined;
  offline: boolean;
  now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<DetailState>({ status: 'idle' });
  const panelId = useId();

  const fetchDetail = () => {
    setState({ status: 'loading' });
    loadDetail(thesisId, ticker.symbol).then(
      (detail) => setState({ status: 'ok', detail }),
      (error: unknown) =>
        setState({
          status: 'error',
          // Never show raw text such as 'Failed to fetch' or a JSON SyntaxError.
          reason:
            error instanceof DetailError
              ? error.message
              : 'Nansen is unavailable right now.',
        }),
    );
  };

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && (state.status === 'idle' || state.status === 'error'))
      fetchDetail();
  };

  return (
    <li className="leaf" data-expanded={expanded ? 'true' : 'false'}>
      <h4 className="leaf-heading">
        <button
          type="button"
          className="leaf-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={toggle}
        >
          <span className="leaf-symbol">{ticker.symbol}</span>
          <span className="leaf-name">
            {ticker.name}
            <span className="leaf-class">{ASSET_CLASS[ticker.assetClass]}</span>
          </span>
          <Figure signal={signal} offline={offline} />
          <span className="leaf-chevron" aria-hidden="true" />
        </button>
      </h4>
      <div id={panelId} className="leaf-detail" hidden={!expanded}>
        {state.status === 'loading' || state.status === 'idle' ? (
          <div className="leaf-loading" role="status">
            <span className="plaque-shimmer" />
            <span className="plaque-shimmer plaque-shimmer--short" />
            <span className="sr-only">
              Loading saved Nansen readings for {ticker.symbol}…
            </span>
          </div>
        ) : state.status === 'error' ? (
          <p className="leaf-unavailable" role="status">
            Unavailable · {state.reason}{' '}
            <button type="button" className="leaf-retry" onClick={fetchDetail}>
              Try again
            </button>
          </p>
        ) : (
          <Detail detail={state.detail} now={now} />
        )}
      </div>
    </li>
  );
}
