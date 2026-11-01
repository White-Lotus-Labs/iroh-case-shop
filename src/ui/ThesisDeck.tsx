'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type Ref,
} from 'react';
import { flushSync } from 'react-dom';
import { formatMoney } from '../leaderboard/model';
import { THESES } from '../thesis/deck';
import type {
  ConvictionLevel,
  DeckSnapshot,
  Thesis,
  ThesisId,
  ThesisSummary,
} from '../thesis/types';
import {
  LEVEL_GLYPH,
  LEVEL_LABEL,
  accumulatingLine,
  buildUncleDraft,
  convictionSentence,
  convictionTitle,
  formatRelative,
  shopErrorText,
  netLabel,
  shareText,
  thesisLink,
  xIntentUrl,
  type DeckState,
} from './deckModel';
import { useMotionBudget } from './motionBudget';
import { ThesisLeaf } from './ThesisLeaf';
import './styles/deck.css';

export interface ThesisDeckProps {
  reduced: boolean;
  initialThesis: ThesisId | null;
  /** A thesis picked outside the panel (a card on the 3D counter). */
  selectedThesis?: ThesisId | null;
  onOpenThesis: (id: ThesisId, conviction: ConvictionLevel | null) => void;
  onCloseThesis: () => void;
  onTalkToUncle: (draft: string) => void;
}

/** The 360w and 600w cuts sit next to the full 900w thesis picture. */
const thesisSrcSet = (image: string) =>
  `${image.replace(/\.webp$/, '-360w.webp')} 360w, ${image.replace(/\.webp$/, '-600w.webp')} 600w, ${image} 900w`;

// Short cover lines keep the title inside the paper band; the full title stays
// in the accessible name and on the reading view.
const COVER_LINES: Partial<
  Record<ThesisId, { title: string; subtitle: string }>
> = {
  robinhood: { title: 'Robinhood Chain', subtitle: 'Tokenization' },
};

const OWN_THESIS_DRAFT = 'Uncle, test my thesis: ';

const TRADING_PLATFORMS = [
  {
    name: 'Arcus',
    logo: '/images/platforms/arcus-help-center.svg',
    wordmark: true,
    dark: false,
    large: false,
    ink: false,
    flush: true,
    wordmarkLogo: null,
    url: 'https://app.arcus.xyz/ref/IROH',
  },
  {
    name: 'FOMO',
    logo: '/images/platforms/fomo-manifest.png',
    wordmark: false,
    dark: false,
    large: false,
    ink: false,
    flush: false,
    wordmarkLogo: '/images/platforms/fomo-wordmark.svg',
    url: 'https://fomo.family/r/0x_iroh',
  },
  {
    name: 'Omni',
    logo: '/images/platforms/omni.svg',
    wordmark: true,
    dark: false,
    large: true,
    ink: false,
    flush: false,
    wordmarkLogo: null,
    url: 'https://omni.variational.io/?ref=OMNIIROH',
  },
  {
    name: 'Hyperliquid',
    logo: '/images/platforms/hyperliquid-wordmark.svg',
    wordmark: true,
    dark: false,
    large: true,
    ink: true,
    flush: false,
    wordmarkLogo: null,
    url: 'https://app.hyperliquid.xyz/join/0XIROH',
  },
] as const;

// The ?thesis= deep link opens its thesis once per page load, not on every
// panel reopen.
let deepLinkConsumed = false;

function withViewTransition(
  instant: boolean,
  update: () => void,
  done?: () => void,
) {
  if (instant || typeof document.startViewTransition !== 'function') {
    update();
    done?.();
    return;
  }
  const root = document.documentElement;
  root.classList.add('thesis-vt');
  const transition = document.startViewTransition(() => flushSync(update));
  void transition.finished.finally(() => {
    root.classList.remove('thesis-vt');
    done?.();
  });
}

function summaryFor(deck: DeckState, id: ThesisId): ThesisSummary | null {
  return deck.status === 'ready'
    ? (deck.snapshot.theses.find((t) => t.id === id) ?? null)
    : null;
}

/**
 * One window, two layouts. `deck` shows the three books on the lacquer stage;
 * `reading` shrinks the same book buttons into a tab strip and fills the
 * panel with one thesis. A view transition carries each book into its tab.
 */
export function ThesisDeck({
  reduced,
  initialThesis,
  selectedThesis = null,
  onOpenThesis,
  onCloseThesis,
  onTalkToUncle,
}: ThesisDeckProps) {
  const budget = useMotionBudget();
  const instantMotion = reduced || budget === 'light';
  const [deck, setDeck] = useState<DeckState>({ status: 'loading' });
  const [readingId, setReadingId] = useState<ThesisId | null>(selectedThesis);
  const [now, setNow] = useState(() => Date.now());
  const books = useRef<Partial<Record<ThesisId, HTMLButtonElement | null>>>({});
  const shelf = useRef<HTMLUListElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const readingRef = useRef(readingId);
  readingRef.current = readingId;
  const focusTitle = useRef(readingId !== null);
  const reported = useRef<ThesisId | null>(null);
  const lastPick = useRef(selectedThesis);

  // Saved readings are served without an API key, so always ask the server.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDeck({ status: 'loading' });
    fetch('/api/theses', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.ok) {
          const snapshot = (await response.json()) as DeckSnapshot;
          setDeck({ status: 'ready', snapshot });
          return;
        }
        setDeck({ status: 'offline', reason: await shopErrorText(response) });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setDeck({
            status: 'offline',
            reason: 'Nansen is unavailable right now.',
          });
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(
    () => () => {
      if (readingRef.current) onCloseThesis();
      reported.current = null;
    },
    [onCloseThesis],
  );

  // The tea pour follows the reading thesis once its conviction is known.
  useEffect(() => {
    if (!readingId || reported.current === readingId) return;
    if (deck.status === 'loading') return;
    reported.current = readingId;
    onOpenThesis(
      readingId,
      summaryFor(deck, readingId)?.conviction.level ?? null,
    );
  }, [readingId, deck, onOpenThesis]);

  useEffect(() => {
    if (!readingId || !focusTitle.current) return;
    focusTitle.current = false;
    title.current?.focus({ preventScroll: true });
  }, [readingId]);

  const show = useCallback(
    (id: ThesisId, moveFocus: boolean) => {
      if (readingRef.current === id) return;
      focusTitle.current = moveFocus;
      withViewTransition(instantMotion, () => setReadingId(id));
    },
    [instantMotion],
  );

  const close = useCallback(() => {
    const id = readingRef.current;
    if (!id) return;
    reported.current = null;
    withViewTransition(instantMotion, () => {
      setReadingId(null);
      books.current[id]?.focus({ preventScroll: true });
    });
    onCloseThesis();
  }, [onCloseThesis, instantMotion]);

  useEffect(() => {
    if (selectedThesis === lastPick.current) return;
    lastPick.current = selectedThesis;
    if (selectedThesis) show(selectedThesis, true);
  }, [selectedThesis, show]);

  useEffect(() => {
    if (deepLinkConsumed || !initialThesis) return;
    deepLinkConsumed = true;
    show(initialThesis, true);
  }, [initialThesis, show]);

  useEffect(() => {
    if (!readingId) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('dialog[open]')) return;
      // An open account menu takes its own Escape.
      if ((event.target as Element).closest?.('.account-menu[open]')) return;
      // Capture phase: Escape returns to the deck and keeps the panel open.
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [readingId, close]);

  // On phones the books sit in a snap carousel; start on the middle one.
  useEffect(() => {
    const row = shelf.current;
    if (row && row.scrollWidth > row.clientWidth)
      row.scrollLeft = (row.scrollWidth - row.clientWidth) / 2;
  }, []);

  const reading = THESES.find((t) => t.id === readingId) ?? null;

  return (
    <div
      className="thesis-deck"
      data-layout={reading ? 'reading' : 'deck'}
      data-reduced={reduced ? 'true' : 'false'}
      data-budget={budget}
    >
      <header className="deck-head">
        <div className="deck-head-title">
          <p className="eyebrow">Three theses · Nansen signals</p>
          <h1 className="deck-title">
            Thesis <em>Desk</em>
          </h1>
          <DeckStatus
            deck={deck}
            now={now}
            onRetry={() => setAttempt((a) => a + 1)}
          />
        </div>
        <button
          type="button"
          className="deck-discuss"
          onClick={() => onTalkToUncle(OWN_THESIS_DRAFT)}
        >
          <span className="deck-discuss-seal" aria-hidden="true">
            茶
          </span>
          Ask Uncle about your own thesis
        </button>
      </header>

      <div className="deck-stage">
        <p className="deck-word" aria-hidden="true">
          Theses
        </p>
        {reading && (
          <button type="button" className="deck-back" onClick={close}>
            <span aria-hidden="true">←</span>
            <span className="deck-back-label">All scrolls</span>
          </button>
        )}
        <ul ref={shelf} className="deck-books" aria-label="Thesis scrolls">
          {THESES.map((thesis, index) => (
            <li key={thesis.id} className="deck-slot" data-slot={index}>
              <ThesisBook
                thesis={thesis}
                deck={deck}
                summary={summaryFor(deck, thesis.id)}
                reduced={reduced}
                light={budget === 'light'}
                current={readingId === thesis.id}
                buttonRef={(node) => {
                  books.current[thesis.id] = node;
                }}
                onOpen={() => show(thesis.id, readingRef.current === null)}
              />
            </li>
          ))}
        </ul>
      </div>

      {reading && (
        <ThesisReading
          key={reading.id}
          thesis={reading}
          summary={summaryFor(deck, reading.id)}
          deck={deck}
          now={now}
          titleRef={title}
          onTalkToUncle={onTalkToUncle}
        />
      )}
    </div>
  );
}

function DeckStatus({
  deck,
  now,
  onRetry,
}: {
  deck: DeckState;
  now: number;
  onRetry: () => void;
}) {
  if (deck.status === 'loading')
    return (
      <p className="deck-status" data-state="loading" role="status">
        Loading saved Nansen readings…
      </p>
    );
  if (deck.status === 'offline')
    return (
      <p className="deck-status" data-state="offline" role="status">
        {deck.reason}{' '}
        <button type="button" className="leaf-retry" onClick={onRetry}>
          Try again
        </button>
      </p>
    );
  return (
    <p className="deck-status" data-state="live">
      Saved Nansen readings · updated{' '}
      {formatRelative(deck.snapshot.fetchedAt, now)}
      {deck.snapshot.stale && <span className="deck-stale">Stale</span>}
    </p>
  );
}

function sealWords(
  thesis: Thesis,
  deck: DeckState,
  summary: ThesisSummary | null,
): string {
  if (deck.status === 'loading') return 'Conviction loading.';
  if (!summary) return 'Conviction offline.';
  const { conviction } = summary;
  return `${convictionTitle(conviction.level)}, ${accumulatingLine(conviction, thesis.tickers.length)}, ${formatMoney(conviction.netFlowUsd, true)} ${netLabel(summary)}.`;
}

function ThesisBook({
  thesis,
  deck,
  summary,
  reduced,
  light,
  current,
  buttonRef,
  onOpen,
}: {
  thesis: Thesis;
  deck: DeckState;
  summary: ThesisSummary | null;
  reduced: boolean;
  light: boolean;
  current: boolean;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onOpen: () => void;
}) {
  const frame = useRef(0);
  const box = useRef<DOMRect | null>(null);
  const onPointerEnter = (event: PointerEvent<HTMLButtonElement>) => {
    if (reduced || light || event.pointerType === 'touch') return;
    box.current = event.currentTarget.getBoundingClientRect();
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (reduced || light || event.pointerType === 'touch') return;
    const el = event.currentTarget;
    const { clientX, clientY } = event;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const cached = box.current;
      if (!cached?.width || !cached.height) return;
      const px = Math.min(
        0.5,
        Math.max(-0.5, (clientX - cached.left) / cached.width - 0.5),
      );
      const py = Math.min(
        0.5,
        Math.max(-0.5, (clientY - cached.top) / cached.height - 0.5),
      );
      el.style.setProperty('--px', px.toFixed(3));
      el.style.setProperty('--py', py.toFixed(3));
    });
  };
  const onPointerLeave = (event: PointerEvent<HTMLButtonElement>) => {
    cancelAnimationFrame(frame.current);
    event.currentTarget.style.removeProperty('--px');
    event.currentTarget.style.removeProperty('--py');
  };
  const style = {
    '--book': thesis.colors.primary,
    '--book-accent': thesis.colors.accent,
    '--book-ink': thesis.colors.ink,
    '--chars': (COVER_LINES[thesis.id] ?? thesis).title.length,
  } as CSSProperties;
  const level = summary?.conviction.level ?? null;
  const cover = COVER_LINES[thesis.id] ?? thesis;

  return (
    <button
      ref={buttonRef}
      type="button"
      className="deck-book"
      data-thesis={thesis.id}
      aria-current={current ? 'true' : undefined}
      style={style}
      aria-label={`Open ${thesis.title}. Scroll ${thesis.numeral}: ${thesis.subtitle}. ${sealWords(thesis, deck, summary)}`}
      onClick={onOpen}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <span
        className="book-frame"
        aria-hidden="true"
        // The name pairs this book with its tab across the layout switch.
        style={{
          viewTransitionName:
            reduced || light ? undefined : `thesis-book-${thesis.id}`,
        }}
      >
        <span className="book-contact" />
        <span className="book-pose">
          <span className="book-tilt">
            <span className="book-shadow" />
            <span className="book-back" />
            <span className="book-pages" />
            <span className="book-top" />
            <span className="book-spine">
              <span className="book-spine-band" />
              <span className="book-spine-title">{thesis.title}</span>
              <span className="book-spine-numeral">{thesis.numeral}</span>
              <span className="book-spine-band" />
            </span>
            <span className="book-cover">
              <img
                className="book-art"
                src={thesis.image}
                srcSet={thesisSrcSet(thesis.image)}
                sizes="(max-width: 760px) 236px, 300px"
                alt=""
                width={900}
                height={1200}
                draggable={false}
              />
              <span className="book-copy">
                <span className="book-kicker">Scroll · {thesis.numeral}</span>
                <span className="book-name">{cover.title}</span>
                <span className="book-sub">{cover.subtitle}</span>
              </span>
              <span className="book-hinge" />
              <span className="book-sheen" />
            </span>
          </span>
        </span>
      </span>
      <span className="book-tab" aria-hidden="true">
        <span className="book-tab-numeral">{thesis.numeral}</span>
        <span className="book-tab-title">{cover.title}</span>
      </span>
      <span className="book-plaque" aria-hidden="true">
        {deck.status === 'loading' ? (
          <>
            <span className="plaque-seal" data-level="loading" />
            <span className="plaque-text">
              <span className="plaque-shimmer" />
              <span className="plaque-shimmer plaque-shimmer--short" />
            </span>
          </>
        ) : summary && level ? (
          <>
            <span className="plaque-seal" data-level={level}>
              {LEVEL_GLYPH[level]}
            </span>
            <span className="plaque-text">
              <span className="plaque-level">{LEVEL_LABEL[level]}</span>
              <span className="plaque-meta">
                {accumulatingLine(summary.conviction, thesis.tickers.length)}
              </span>
              <span className="plaque-flow">
                {formatMoney(summary.conviction.netFlowUsd, true)}{' '}
                {netLabel(summary, true)}
              </span>
            </span>
          </>
        ) : (
          <>
            <span className="plaque-seal" data-level="offline">
              —
            </span>
            <span className="plaque-text">
              <span className="plaque-level">Offline</span>
              <span className="plaque-meta">No Nansen data</span>
            </span>
          </>
        )}
      </span>
    </button>
  );
}

function LeafIcon() {
  return (
    <svg viewBox="0 0 24 32" aria-hidden="true">
      <path d="M12 1C5 8 2.5 14 2.5 19.5 2.5 25.3 6.8 30 12 30s9.5-4.7 9.5-10.5C21.5 14 19 8 12 1Z" />
      <path className="vein" d="M12 6v24M12 14l-4-3M12 19l5-4M12 24l-5-4" />
    </svg>
  );
}

function Meter({
  thesis,
  summary,
  deck,
}: {
  thesis: Thesis;
  summary: ThesisSummary | null;
  deck: DeckState;
}) {
  if (deck.status === 'loading')
    return (
      <div className="scroll-meter ink" style={{ '--i': 4 } as CSSProperties}>
        <span className="meter-seal" data-level="loading" aria-hidden="true" />
        <div className="meter-copy" role="status">
          <span className="plaque-shimmer" />
          <span className="plaque-shimmer plaque-shimmer--short" />
          <span className="sr-only">Loading saved Nansen readings…</span>
        </div>
      </div>
    );
  if (!summary)
    return (
      <div className="scroll-meter ink" style={{ '--i': 4 } as CSSProperties}>
        <span className="meter-seal" data-level="offline" aria-hidden="true">
          —
        </span>
        <div className="meter-copy">
          <p className="meter-level">Conviction offline</p>
          <p className="meter-line">
            {deck.status === 'offline' ? deck.reason : 'No data yet.'} The
            signal shows again when Nansen responds.
          </p>
        </div>
      </div>
    );
  const { conviction } = summary;
  return (
    <div
      className="scroll-meter ink"
      data-level={conviction.level}
      style={{ '--i': 4 } as CSSProperties}
    >
      <span
        className="meter-seal"
        data-level={conviction.level}
        aria-hidden="true"
      >
        {LEVEL_GLYPH[conviction.level]}
      </span>
      <div className="meter-copy">
        <p className="meter-level">
          {convictionTitle(conviction.level)}
          <span className="meter-flow">
            {formatMoney(conviction.netFlowUsd, true)} {netLabel(summary)}
          </span>
        </p>
        <ol className="meter-leaves" aria-label="Accumulation by asset">
          {thesis.tickers.map((ticker) => {
            const signal = summary.tickers.find(
              (s) => s.symbol === ticker.symbol,
            );
            const flow =
              signal?.status === 'ok' ? signal.smartMoneyNetFlowUsd : null;
            const state = flow === null ? 'none' : flow > 0 ? 'up' : 'down';
            return (
              <li key={ticker.symbol} data-state={state}>
                <LeafIcon />
                <span>
                  {ticker.symbol}
                  <span className="sr-only">
                    {state === 'up'
                      ? ': accumulating'
                      : state === 'down'
                        ? ': distributing'
                        : ': no data'}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="meter-line">
          {convictionSentence(conviction, thesis.tickers.length)}.
        </p>
      </div>
    </div>
  );
}

/** The reading layout's body: one thesis, inked onto the panel paper. */
function ThesisReading({
  thesis,
  summary,
  deck,
  now,
  titleRef,
  onTalkToUncle,
}: {
  thesis: Thesis;
  summary: ThesisSummary | null;
  deck: DeckState;
  now: number;
  titleRef: Ref<HTMLHeadingElement>;
  onTalkToUncle: (draft: string) => void;
}) {
  const titleId = useId();
  const [origin, setOrigin] = useState('');
  const [canShare, setCanShare] = useState(false);
  const [toast, setToast] = useState('');
  const tradeDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const link = origin ? thesisLink(origin, thesis.id) : '';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setToast('Link copied.');
    } catch {
      setToast('Copy failed. The link is in the address bar.');
    }
  };
  const nativeShare = async () => {
    try {
      await navigator.share({
        title: thesis.title,
        text: shareText(thesis, summary),
        url: link,
      });
    } catch {
      /* The person closed the share sheet. */
    }
  };

  const style = {
    '--book': thesis.colors.primary,
    '--book-accent': thesis.colors.accent,
    '--book-ink': thesis.colors.ink,
    '--hue': thesis.hue,
  } as CSSProperties;

  return (
    <section
      className="thesis-reading"
      role="dialog"
      aria-labelledby={titleId}
      style={style}
    >
      <div className="scroll-grid">
        <figure
          className="scroll-art ink"
          style={{ '--i': 0 } as CSSProperties}
        >
          <img
            src={thesis.image}
            srcSet={thesisSrcSet(thesis.image)}
            sizes="(max-width: 760px) 190px, 280px"
            alt={`${thesis.spirit}, the spirit of this thesis`}
            width={900}
            height={1200}
          />
          <figcaption>{thesis.spirit}</figcaption>
        </figure>

        <div className="scroll-text">
          <p
            className="scroll-kicker ink"
            style={{ '--i': 0 } as CSSProperties}
          >
            Scroll · {thesis.numeral} · Thesis
          </p>
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="scroll-title ink"
            style={{ '--i': 1 } as CSSProperties}
          >
            {thesis.title}
          </h2>
          <p className="scroll-sub ink" style={{ '--i': 2 } as CSSProperties}>
            {thesis.subtitle}
          </p>
          <p className="scroll-body ink" style={{ '--i': 3 } as CSSProperties}>
            {thesis.body}
          </p>
          <Meter thesis={thesis} summary={summary} deck={deck} />
          <div
            className="scroll-actions ink"
            role="group"
            aria-label="Thesis actions"
            style={{ '--i': 5 } as CSSProperties}
          >
            <button
              type="button"
              className="scroll-action scroll-action--primary"
              onClick={() => onTalkToUncle(buildUncleDraft(thesis, summary))}
            >
              Ask Uncle about this thesis
            </button>
            <button
              type="button"
              className="scroll-action scroll-action--seal"
              aria-haspopup="dialog"
              onClick={() => tradeDialog.current?.showModal()}
            >
              <span className="scroll-action-seal" aria-hidden="true">
                ↗
              </span>
              Follow this thesis
            </button>
            <div
              className="scroll-share"
              role="group"
              aria-label="Share this thesis"
            >
              <span className="scroll-share-label" aria-hidden="true">
                Share
              </span>
              <a
                className="scroll-action"
                href={origin ? xIntentUrl(thesis, summary, origin) : undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                Post on X<span className="sr-only"> (opens in a new tab)</span>
              </a>
              <button
                type="button"
                className="scroll-action"
                onClick={copyLink}
              >
                Copy link
              </button>
              {canShare && (
                <button
                  type="button"
                  className="scroll-action"
                  onClick={nativeShare}
                >
                  Other apps…
                </button>
              )}
            </div>
          </div>
          <p className="scroll-toast" role="status" aria-live="polite">
            {toast}
          </p>
        </div>

        <dialog
          ref={tradeDialog}
          className="trade-sheet"
          aria-labelledby={`${titleId}-trade-title`}
          onMouseDown={(event) => {
            if (event.currentTarget !== event.target) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              tradeDialog.current?.close();
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="trade-sheet-heading">
            <div>
              <h3 id={`${titleId}-trade-title`}>Follow this thesis</h3>
              <p>Choose where you want to trade the signal.</p>
            </div>
            <button
              type="button"
              className="trade-sheet-close"
              aria-label="Close trading platforms"
              onClick={() => tradeDialog.current?.close()}
            >
              ×
            </button>
          </div>
          <div className="trade-platform-list">
            {TRADING_PLATFORMS.map((platform) => (
              <a
                key={platform.name}
                className="trade-platform"
                aria-label={`Open ${platform.name} in a new tab`}
                href={platform.url}
                target="_blank"
                rel="noopener noreferrer sponsored"
              >
                <span
                  className={`trade-platform-logo${platform.wordmark ? ' trade-platform-logo--wordmark' : ''}${platform.dark ? ' trade-platform-logo--dark' : ''}${platform.large ? ' trade-platform-logo--large' : ''}${platform.ink ? ' trade-platform-logo--ink' : ''}${platform.flush ? ' trade-platform-logo--flush' : ''}`}
                  aria-hidden="true"
                >
                  <img src={platform.logo} alt="" width={48} height={48} />
                </span>
                {platform.wordmarkLogo && (
                  <img
                    className="trade-platform-wordmark trade-platform-wordmark--ink"
                    src={platform.wordmarkLogo}
                    alt=""
                    width={75}
                    height={24}
                  />
                )}
                <span className="trade-platform-arrow" aria-hidden="true">
                  ↗
                </span>
              </a>
            ))}
          </div>
        </dialog>

        <section
          className="scroll-leaves ink"
          aria-labelledby={`${titleId}-leaves`}
          style={{ '--i': 6 } as CSSProperties}
        >
          <h3 id={`${titleId}-leaves`} className="scroll-section-title">
            Four assets behind the signal
          </h3>
          <ul className="leaf-list-root">
            {thesis.tickers.map((ticker) => (
              <ThesisLeaf
                key={ticker.symbol}
                thesisId={thesis.id}
                ticker={ticker}
                signal={summary?.tickers.find(
                  (s) => s.symbol === ticker.symbol,
                )}
                offline={deck.status === 'offline'}
                now={now}
              />
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
