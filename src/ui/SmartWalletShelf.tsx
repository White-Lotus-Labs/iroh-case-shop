'use client';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  BOARD_BLURB,
  BOARD_INTRO,
  BOARD_LABELS,
  BOARD_METRICS,
  BOARD_SOURCE,
  LEADERBOARD_BOARDS,
  METRIC_LABELS,
  type LeaderboardBoard,
  type LeaderboardMetric,
} from '../leaderboard/boards';
import {
  chainLabel,
  formatMoney,
  formatRoi,
  formatWinRate,
  shortenAddress,
  type SmartWalletLeaderboardEntry,
  type SmartWalletLeaderboardSnapshot,
} from '../leaderboard/model';
import type { NansenAvailability } from '../nansen/availability';
import {
  SHELF_CAST_NAME,
  SHELF_GUEST_NAME,
  shelfIdentityForRank,
} from './shelfIdentities';
import { formatRelative } from './deckModel';
import { shelfLabel } from './shelfLabels';

const snapshotCache = new Map<string, SmartWalletLeaderboardSnapshot>();

function viewKey(board: LeaderboardBoard, metric: LeaderboardMetric) {
  return `${board}:${metric}`;
}

function isSnapshot(value: unknown): value is SmartWalletLeaderboardSnapshot {
  return (
    !!value &&
    typeof value === 'object' &&
    'source' in value &&
    value.source === 'nansen' &&
    'entries' in value &&
    Array.isArray(value.entries) &&
    'fetchedAt' in value &&
    typeof value.fetchedAt === 'string' &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'string' &&
    'stale' in value &&
    typeof value.stale === 'boolean'
  );
}

/** Meme rows carry chains: EVM addresses open every chain, the rest open Solana. */
function nansenProfilerUrl({ address, chains }: SmartWalletLeaderboardEntry) {
  const chain = chains
    ? address.startsWith('0x')
      ? 'all'
      : 'solana'
    : 'hyperliquid';
  return `https://app.nansen.ai/profiler?address=${encodeURIComponent(address)}&chain=${chain}`;
}

function tone(value: number | null) {
  return value === null || value === 0 ? 'flat' : value > 0 ? 'up' : 'down';
}

function Portrait({ rank }: { rank: number }) {
  const identity = shelfIdentityForRank(rank);
  const index = identity?.portraitIndex ?? 9;
  return (
    <span className="wallet-portrait-frame">
      <span
        className="wallet-portrait"
        role="img"
        aria-label={identity?.name ?? SHELF_GUEST_NAME}
        style={{
          backgroundPosition: `${(index % 5) * 25}% ${index < 5 ? 0 : 100}%`,
        }}
      />
    </span>
  );
}

function RoiChip({ roi }: { roi: number | null }) {
  return (
    <span className={`wallet-roi wallet-roi-${tone(roi)}`}>
      <span className="sr-only">ROI </span>
      {formatRoi(roi)}
    </span>
  );
}

function WalletActions({
  entry,
  labelled = false,
}: {
  entry: SmartWalletLeaderboardEntry;
  labelled?: boolean;
}) {
  const { address } = entry;
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copy === 'idle') return;
    const timer = window.setTimeout(() => setCopy('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [copy]);
  return (
    <div className="wallet-actions">
      <button
        type="button"
        className="wallet-action"
        aria-label={`Copy wallet address ${address}`}
        title="Copy wallet address"
        onClick={() => {
          if (!navigator.clipboard) return setCopy('failed');
          navigator.clipboard.writeText(address).then(
            () => setCopy('copied'),
            () => setCopy('failed'),
          );
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" />
        </svg>
      </button>
      <a
        className={`wallet-action${labelled ? ' wallet-action-text' : ''}`}
        href={nansenProfilerUrl(entry)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Research this wallet in Nansen (new tab)"
        title="Research this wallet in Nansen"
      >
        {labelled && <span aria-hidden="true">Research in Nansen</span>}
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M9 2.5h4.5V7M13.5 2.5 7 9M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
        </svg>
      </a>
      <span className="wallet-copied" role="status" data-state={copy}>
        {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Copy failed' : ''}
      </span>
    </div>
  );
}

function formatCount(value: number | null | undefined) {
  return value == null ? '—' : Math.round(value).toLocaleString('en-US');
}

function eyebrow(rank: number, metric: LeaderboardMetric) {
  return metric === 'wins'
    ? `#${rank} by 30-day PnL`
    : `#${rank} · ${METRIC_LABELS[metric]}`;
}

/** The open spirit: headline numbers plus the trading detail Nansen returns with the leaderboard. */
const SpiritCard = forwardRef<
  HTMLElement,
  { entry: SmartWalletLeaderboardEntry; metric: LeaderboardMetric }
>(function SpiritCard({ entry, metric }, ref) {
  const name = shelfIdentityForRank(entry.rank)?.name ?? SHELF_GUEST_NAME;
  const label = shelfLabel(entry.displayName, entry.address);
  const positions = entry.positions ?? [];
  const topTokens = entry.topTokens ?? [];
  const hasTrading = [
    entry.realizedPnl,
    entry.unrealizedPnl,
    entry.volume,
    entry.trades,
  ].some((value) => value != null);
  return (
    <article
      ref={ref}
      className="wallet-hero"
      data-testid="top-wallet"
      tabIndex={-1}
      aria-label={`Rank ${entry.rank}, ${name}${label ? `, ${label}` : ''}`}
    >
      <div className="wallet-hero-portrait">
        <Portrait rank={entry.rank} />
        <span className="wallet-seal" aria-hidden="true">
          {entry.rank}
        </span>
      </div>
      <div className="wallet-hero-body">
        <p className="wallet-hero-eyebrow">{eyebrow(entry.rank, metric)}</p>
        <h2>{name}</h2>
        {label && <p className="wallet-label">{label}</p>}
        {entry.chains && (
          <p className="wallet-chains">
            {entry.chains.map((chain) => (
              <span key={chain} className="wallet-chain">
                {chainLabel(chain)}
              </span>
            ))}
            {entry.entity && (
              <span
                className="wallet-chain"
                title="A Nansen entity that trades on Solana and EVM"
              >
                Entity
                <span className="sr-only"> that trades on Solana and EVM</span>
              </span>
            )}
          </p>
        )}
        <dl className="wallet-hero-metrics">
          <div>
            <dt>30-day PnL</dt>
            <dd className={`wallet-tone-${tone(entry.pnl)}`}>
              {formatMoney(entry.pnl, true)}
            </dd>
          </div>
          <div>
            <dt>ROI</dt>
            <dd>
              <RoiChip roi={entry.roi} />
            </dd>
          </div>
          {entry.chains ? (
            <div>
              <dt>Win rate</dt>
              <dd>{formatWinRate(entry.winRate)}</dd>
            </div>
          ) : (
            <div>
              <dt>Account value</dt>
              <dd>{formatMoney(entry.accountValue)}</dd>
            </div>
          )}
        </dl>
        {hasTrading && (
          <dl className="wallet-hero-trading">
            <div>
              <dt>Realized</dt>
              <dd className={`wallet-tone-${tone(entry.realizedPnl ?? null)}`}>
                {formatMoney(entry.realizedPnl ?? null, true)}
              </dd>
            </div>
            <div>
              <dt>Unrealized</dt>
              <dd
                className={`wallet-tone-${tone(entry.unrealizedPnl ?? null)}`}
              >
                {formatMoney(entry.unrealizedPnl ?? null, true)}
              </dd>
            </div>
            {entry.tokens != null ? (
              <div>
                <dt>Tokens traded</dt>
                <dd>{formatCount(entry.tokens)}</dd>
              </div>
            ) : (
              <div>
                <dt>30-day volume</dt>
                <dd>{formatMoney(entry.volume ?? null)}</dd>
              </div>
            )}
            <div>
              <dt>Trades</dt>
              <dd>{formatCount(entry.trades)}</dd>
            </div>
          </dl>
        )}
        {positions.length > 0 && (
          <div className="wallet-positions">
            <p className="wallet-positions-head">Largest open positions</p>
            <ul>
              {positions.map((position) => (
                <li key={`${position.coin}:${position.side}`}>
                  <strong>{position.coin}</strong>
                  <span className={`wallet-side wallet-side-${position.side}`}>
                    {position.side}
                  </span>
                  <span className="wallet-position-value">
                    {formatMoney(position.valueUsd)}
                  </span>
                  <span
                    className={`wallet-position-pnl wallet-tone-${tone(position.unrealizedPnl)}`}
                  >
                    <span className="sr-only">Unrealized PnL </span>
                    {formatMoney(position.unrealizedPnl, true)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {topTokens.length > 0 && (
          <div className="wallet-positions">
            <p className="wallet-positions-head">Top tokens traded</p>
            <ul>
              {topTokens.map((token) => (
                <li key={`${token.symbol}:${token.chain}`}>
                  <strong>{token.symbol}</strong>
                  <span className="wallet-position-value">
                    {chainLabel(token.chain)}
                  </span>
                  <span
                    className={`wallet-position-pnl wallet-tone-${tone(token.pnl)}`}
                  >
                    <span className="sr-only">Realized PnL </span>
                    {formatMoney(token.pnl, true)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {entry.entityTotal && (
          <div className="wallet-positions">
            <p className="wallet-positions-head">
              {entry.entity} · all wallets and chains
            </p>
            <dl className="wallet-hero-trading">
              <div>
                <dt>Realized</dt>
                <dd
                  className={`wallet-tone-${tone(entry.entityTotal.realizedPnl)}`}
                >
                  {formatMoney(entry.entityTotal.realizedPnl, true)}
                </dd>
              </div>
              <div>
                <dt>Tokens traded</dt>
                <dd>{formatCount(entry.entityTotal.tokens)}</dd>
              </div>
              <div>
                <dt>Trades</dt>
                <dd>{formatCount(entry.entityTotal.trades)}</dd>
              </div>
            </dl>
            {entry.entityTotal.topTokens.length > 0 && (
              <ul>
                {entry.entityTotal.topTokens.map((token) => (
                  <li key={`${token.symbol}:${token.chain}`}>
                    <strong>{token.symbol}</strong>
                    <span className="wallet-position-value">
                      {chainLabel(token.chain)}
                    </span>
                    <span
                      className={`wallet-position-pnl wallet-tone-${tone(token.pnl)}`}
                    >
                      <span className="sr-only">Realized PnL </span>
                      {formatMoney(token.pnl, true)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="wallet-hero-address">
          <code title={entry.address}>{shortenAddress(entry.address)}</code>
          <WalletActions entry={entry} labelled />
        </div>
      </div>
    </article>
  );
});

function WalletRow({
  entry,
  leaderPnl,
  onSelect,
}: {
  entry: SmartWalletLeaderboardEntry;
  leaderPnl: number | null;
  onSelect: () => void;
}) {
  const name = shelfIdentityForRank(entry.rank)?.name ?? SHELF_GUEST_NAME;
  const label = shelfLabel(entry.displayName, entry.address);
  const share =
    entry.pnl !== null && leaderPnl
      ? Math.min(1, Math.abs(entry.pnl) / Math.abs(leaderPnl))
      : 0;
  return (
    <li className="wallet-row" data-rank={entry.rank}>
      <button
        type="button"
        className="wallet-row-main"
        aria-expanded={false}
        onClick={onSelect}
      >
        <span className="wallet-seal">
          <span className="sr-only">Rank </span>
          {entry.rank}
        </span>
        <Portrait rank={entry.rank} />
        <span className="wallet-who">
          <span className="wallet-name">{name}</span>
          {label ? (
            <span className="wallet-label">{label}</span>
          ) : (
            <span className="wallet-address" title={entry.address}>
              {shortenAddress(entry.address)}
            </span>
          )}
        </span>
        <span className="wallet-pnl">
          <span className={`wallet-pnl-value wallet-tone-${tone(entry.pnl)}`}>
            <span className="sr-only">PnL </span>
            {formatMoney(entry.pnl, true)}
          </span>
          <span className="wallet-bar" aria-hidden="true">
            <span
              className={`wallet-tone-${tone(entry.pnl)}`}
              style={{ width: `${(share * 100).toFixed(1)}%` }}
            />
          </span>
        </span>
        <RoiChip roi={entry.roi} />
        {entry.chains ? (
          <span className="wallet-value">
            <span className="sr-only">Win rate </span>
            {formatWinRate(entry.winRate)}
          </span>
        ) : (
          <span className="wallet-value">
            <span className="sr-only">Account value </span>
            {formatMoney(entry.accountValue)}
          </span>
        )}
      </button>
      <WalletActions entry={entry} />
    </li>
  );
}

function FreshnessPopover({
  board,
  snapshot,
  updated,
  onClose,
}: {
  board: LeaderboardBoard;
  snapshot: SmartWalletLeaderboardSnapshot | null;
  updated: string;
  onClose: () => void;
}) {
  return (
    <div
      className="leaderboard-freshness-popover"
      role="region"
      aria-label="Data freshness explanation"
    >
      <div className="leaderboard-freshness-head">
        <strong>Data Freshness &amp; Source</strong>
        <button
          type="button"
          className="leaderboard-freshness-close"
          onClick={onClose}
          aria-label="Close freshness info"
        >
          ✕
        </button>
      </div>
      <p>
        {board === 'meme'
          ? "Rankings use Nansen's 30-day Smart Money PnL leaderboard, sorted by realized PnL and filtered here to wallets that trade mostly memecoins. Every row ranks on its own wallet's numbers; an entity card also shows that entity's total across its Solana and EVM wallets."
          : `Rankings use Nansen's 30-day ${BOARD_SOURCE[board]} leaderboard (${BOARD_BLURB[board]}).`}{' '}
        Illustrated names are visual aliases—not claims about wallet owners.
      </p>
      <p>The shop saves this ranking and refreshes it about every 4 hours.</p>
      <p className="leaderboard-freshness-age">
        {snapshot ? `Snapshot updated ${updated}.` : 'Loading…'}
      </p>
    </div>
  );
}

export function SmartWalletShelf({ nansen }: { nansen: NansenAvailability }) {
  const [board, setBoard] = useState<LeaderboardBoard>('perps');
  const [metric, setMetric] = useState<LeaderboardMetric>('wins');
  const [snapshot, setSnapshot] =
    useState<SmartWalletLeaderboardSnapshot | null>(
      () => snapshotCache.get(viewKey('perps', 'wins')) ?? null,
    );
  const [loading, setLoading] = useState(
    !snapshotCache.get(viewKey('perps', 'wins')),
  );
  const [error, setError] = useState<string | null>(null);
  const [freshnessAnchor, setFreshnessAnchor] = useState<
    'header' | 'footer' | null
  >(null);
  const [selectedRank, setSelectedRank] = useState(1);
  const [revealed, setRevealed] = useState(() => snapshotCache.size > 0);
  const requestId = useRef(0);
  const openCard = useRef<HTMLElement>(null);
  const movedFocus = useRef(false);

  const toggleFreshness = useCallback((anchor: 'header' | 'footer') => {
    setFreshnessAnchor((prev) => (prev === anchor ? null : anchor));
  }, []);

  useEffect(() => {
    if (!freshnessAnchor) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // An open account menu takes its own Escape.
      if ((e.target as Element).closest?.('.account-menu[open]')) return;
      // Capture phase: Escape closes the popover and keeps the panel open.
      e.stopPropagation();
      setFreshnessAnchor(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [freshnessAnchor]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    const key = viewKey(board, metric);
    const cached = snapshotCache.get(key) ?? null;
    setSnapshot(cached);
    if (cached) setRevealed(true);
    setLoading(!cached);
    setError(null);
    let safeError = 'Smart Wallet leaderboard is temporarily unavailable.';
    try {
      const params = new URLSearchParams();
      if (board !== 'perps') params.set('board', board);
      if (metric !== 'wins') params.set('metric', metric);
      const query = params.toString();
      const response = await fetch(
        query
          ? `/api/smart-wallet-leaderboard?${query}`
          : '/api/smart-wallet-leaderboard',
        { cache: 'no-store' },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        if (
          body &&
          typeof body === 'object' &&
          'error' in body &&
          typeof body.error === 'string'
        )
          safeError = body.error;
        throw new Error('Request failed');
      }
      if (!isSnapshot(body)) throw new Error('Invalid snapshot');
      if (id !== requestId.current) return;
      snapshotCache.set(key, body);
      setRevealed(true);
      setSnapshot(body);
    } catch {
      if (id !== requestId.current) return;
      setError(safeError);
      const stale = snapshotCache.get(key);
      if (stale && Date.now() >= Date.parse(stale.expiresAt)) {
        const next = { ...stale, stale: true, refreshError: safeError };
        snapshotCache.set(key, next);
        setSnapshot(next);
      } else if (!cached) setSnapshot(null);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [board, metric]);

  useEffect(() => {
    setSelectedRank(1);
  }, [board, metric]);

  // The clicked row's button unmounts when it opens, so hand focus to the open card.
  useEffect(() => {
    if (!movedFocus.current) return;
    movedFocus.current = false;
    openCard.current?.focus({ preventScroll: true });
    openCard.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedRank]);

  const openSpirit = (rank: number) => {
    movedFocus.current = true;
    setSelectedRank(rank);
  };

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!snapshot || snapshot.stale) return;
    const remaining = Date.parse(snapshot.expiresAt) - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(
      () => void load(),
      Math.min(remaining, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [snapshot, load]);

  const entries = snapshot?.entries.slice(0, 10) ?? [];
  const leader = entries[0];
  const unconfigured = nansen === 'unavailable' && !snapshot && !revealed;
  const updated = snapshot ? formatRelative(snapshot.fetchedAt) : '';
  return (
    <div className="parchment-hanger" data-testid="leaderboard-parchment">
      <div className="parchment-rod" aria-hidden="true" />
      <div className="leaderboard-parchment">
        <div className="leaderboard-controls">
          {/* Toggle buttons, not tabs: there is one shared list, no tab panels. */}
          <div
            className="leaderboard-tabs"
            role="group"
            aria-label="Leaderboard boards"
          >
            {LEADERBOARD_BOARDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={board === id}
                className="leaderboard-tab"
                onClick={() => {
                  setBoard(id);
                  if (!BOARD_METRICS[id].includes(metric)) setMetric('wins');
                }}
              >
                {BOARD_LABELS[id]}
              </button>
            ))}
          </div>
          <label className="leaderboard-metric">
            <span className="sr-only">Rank by</span>
            <select
              value={metric}
              onChange={(event) =>
                setMetric(event.target.value as LeaderboardMetric)
              }
              aria-label="Rank by"
            >
              {BOARD_METRICS[board].map((id) => (
                <option key={id} value={id}>
                  {METRIC_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <header className="leaderboard-head">
          <span className="leaderboard-mark" aria-hidden="true">
            茶
          </span>
          {!unconfigured && (
            <>
              <p className="leaderboard-eyebrow">{SHELF_CAST_NAME}</p>
              <h1>
                Top {board === 'meme' ? 'Meme' : BOARD_SOURCE[board]} Traders by{' '}
                <em>
                  {metric === 'wins' ? '30-Day PnL' : METRIC_LABELS[metric]}
                </em>
              </h1>
              <p className="leaderboard-intro">
                {BOARD_INTRO[board]} Each spirit is a visual alias—not a claim
                about the wallet owner.
              </p>
              <div className="leaderboard-meta">
                <span>{BOARD_BLURB[board]}</span>
                <span className="leaderboard-attribution">
                  <span>
                    Powered by <strong>Nansen</strong>
                  </span>
                  <button
                    type="button"
                    className="leaderboard-info-btn"
                    onClick={() => toggleFreshness('header')}
                    aria-label="Explain data freshness"
                    aria-expanded={freshnessAnchor === 'header'}
                    title="Data freshness info"
                  >
                    <span aria-hidden="true">i</span>
                  </button>
                </span>
              </div>
              {freshnessAnchor === 'header' && (
                <FreshnessPopover
                  board={board}
                  snapshot={snapshot}
                  updated={updated}
                  onClose={() => setFreshnessAnchor(null)}
                />
              )}
            </>
          )}
        </header>
        {snapshot?.stale && (
          <p className="leaderboard-stale" role="status">
            Updated {updated} · showing the last saved copy.
          </p>
        )}
        {leader ? (
          <div className="leaderboard-content" aria-busy={loading}>
            <div className="wallet-list-head" aria-hidden="true">
              <span>Spirit</span>
              <span>30-day PnL</span>
              <span>ROI</span>
              <span>{board === 'meme' ? 'Win rate' : 'Account value'}</span>
            </div>
            <ol
              className="wallet-list"
              aria-label="Top ten traders"
              data-testid="rank-grid"
            >
              {entries.map((entry) =>
                entry.rank === selectedRank ? (
                  <li
                    key={entry.address}
                    className="wallet-row is-open"
                    data-rank={entry.rank}
                    data-selected="true"
                  >
                    <SpiritCard ref={openCard} entry={entry} metric={metric} />
                  </li>
                ) : (
                  <WalletRow
                    key={entry.address}
                    entry={entry}
                    leaderPnl={leader.pnl}
                    onSelect={() => openSpirit(entry.rank)}
                  />
                ),
              )}
            </ol>
            {snapshot!.entries.length < 10 && (
              <p className="leaderboard-note">
                {board === 'meme'
                  ? `Only ${snapshot!.entries.length} of Nansen's top Smart Money earners trade mostly memecoins this period.`
                  : `Nansen returned ${snapshot!.entries.length} ranked wallets for this period.`}
              </p>
            )}
            {board === 'meme' && metric === 'roi' && (
              <p className="leaderboard-note">
                ROI ranks only the top 100 Smart Money earners by realized PnL.
              </p>
            )}
          </div>
        ) : loading ? (
          <p className="leaderboard-message" role="status">
            Loading saved Nansen readings…
          </p>
        ) : unconfigured ? (
          <div className="leaderboard-message">
            <p>Nansen research is offline.</p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : error ? (
          <div className="leaderboard-message" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : (
          <p className="leaderboard-message">
            No {BOARD_SOURCE[board]} traders were returned for this period.
          </p>
        )}
        {!unconfigured && (
          <>
            {freshnessAnchor === 'footer' && (
              <FreshnessPopover
                board={board}
                snapshot={snapshot}
                updated={updated}
                onClose={() => setFreshnessAnchor(null)}
              />
            )}
            <footer className="leaderboard-foot">
              <div className="leaderboard-foot-brand">
                <span>
                  Illustrated ranks by White Lotus Labs · Wallet intelligence by
                  Nansen
                </span>
                <button
                  type="button"
                  className="leaderboard-info-btn"
                  onClick={() => toggleFreshness('footer')}
                  aria-label="Explain data freshness"
                  aria-expanded={freshnessAnchor === 'footer'}
                  title="Data freshness info"
                >
                  <span aria-hidden="true">i</span>
                </button>
              </div>
              {snapshot && <span>Updated {updated}</span>}
              {/* A server-stale row only re-reads the same saved copy. */}
              {error && snapshot && (
                <button type="button" onClick={() => void load()}>
                  Try again
                </button>
              )}
            </footer>
          </>
        )}
      </div>
      <div className="parchment-rod parchment-rod-bottom" aria-hidden="true" />
    </div>
  );
}
