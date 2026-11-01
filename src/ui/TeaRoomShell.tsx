'use client';
import dynamic from 'next/dynamic';
import { flushSync } from 'react-dom';
import {
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Station } from '../shared/contracts';
import type { SceneMood } from '../scene/motion/dynamics';
import type { IrohActivity } from '../scene/TeaHost3D';
import { OBSERVATORIUM_URL, RECENTER_EVENT, STATIONS } from '../scene/stations';
import { AccountMenu } from './AccountMenu';
import type { PublicUser } from '../auth/service';
import {
  isNansenAvailability,
  type NansenAvailability,
} from '../nansen/availability';
import { IrohSession } from '../nansen/session';
import { StationDock } from './StationDock';
import type { ConvictionLevel, ThesisId } from '../thesis/types';
import { convictionToMood } from './convictionMood';
import { InkLine, STATION_TEASERS } from './stationTeasers';
import { WaitingRoom } from './waiting-room/WaitingRoom';
import { whenBookRests } from './waiting-room/bookMotion';
import { WaitingVersions } from './waiting-room/Versions';
import { MusicToggle } from './MusicToggle';
import { roomTextures, SHELF_POSTERS, THESIS_IDS } from './roomTextures';
import { lightExperience } from '../scene/lightExperience';
import { paintSurfaces } from '../scene/paintSurfaces';

// Scene, deck, chat and Shelf stay out of the first paint; idle preloads warm them.
const loadTeaRoom = () => import('../scene/TeaRoom');
const loadThesisDeck = () =>
  import('./ThesisDeck').then((m) => ({ default: m.ThesisDeck }));
const loadIrohChat = () =>
  import('./IrohChat').then((m) => ({ default: m.IrohChat }));
const loadShelf = () =>
  import('./SmartWalletShelf').then((m) => ({ default: m.SmartWalletShelf }));

// Textures download while three.js parses and the room builds, instead of
// after; the scene then reads them from the HTTP cache.
const warmTeaRoom = () => {
  void paintSurfaces();
  return loadTeaRoom().then(() => {
    for (const src of roomTextures(lightExperience())) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.fetchPriority = 'low';
      img.src = src;
    }
  });
};

// The sketchbook plays first. Each heavy step of the room (parsing three.js,
// then mounting and compiling the scene) waits for the book to rest, so no
// step lands in a page turn. The guest is reading; a slow load is fine.
const TeaRoom = dynamic(
  () =>
    whenBookRests()
      .then(loadTeaRoom)
      .then((room) => whenBookRests().then(() => room)),
  {
    ssr: false,
    loading: () => <div className="scene-fallback" />,
  },
);
// No `loading`: the panel's own Suspense waits for them, so the scroll mounts
// once with its content and final size instead of growing mid-unroll.
const ThesisDeck = dynamic(loadThesisDeck);
const IrohChat = dynamic(loadIrohChat);
const SmartWalletShelf = dynamic(loadShelf);

function idlePreload(load: () => Promise<unknown>) {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(() => {
      void load();
    });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(() => {
    void load();
  }, 200);
  return () => window.clearTimeout(timer);
}

export default function TeaRoomShell({
  user,
  nansen: initialNansen,
}: {
  user: PublicUser | null;
  nansen: NansenAvailability;
}) {
  const [irohSession] = useState(() => new IrohSession());
  const [nansen, setNansen] = useState(initialNansen);
  const [irohActivity, setIrohActivity] = useState<IrohActivity>('idle');
  const [station, setStation] = useState<Station>('Entrance');
  const [cameraAt, setCameraAt] = useState<Station | null>(null);
  const [shelfFocused, setShelfFocused] = useState(false);
  const [systemReduced, setSystemReduced] = useState<boolean | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [observatoriumZoomKey, setObservatoriumZoomKey] = useState(0);
  const [openingObservatorium, setOpeningObservatorium] = useState(false);
  const [pour, setPour] = useState<{ key: string | null; mood: SceneMood }>({
    key: null,
    mood: 'waiting',
  });
  const [initialThesis, setInitialThesis] = useState<ThesisId | null>(null);
  const [selectedThesis, setSelectedThesis] = useState<ThesisId | null>(null);
  const [uncleDraft, setUncleDraft] = useState<{
    text: string;
    key: number;
  } | null>(null);
  const [sceneAvailable, setSceneAvailable] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetProgress, setAssetProgress] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const [staged, setStaged] = useState(false);
  const onStaged = useCallback(() => setStaged(true), []);
  // Latches once the guest leaves Entrance by any path (Enter, deep link,
  // dock), so the thesis pictures prefetch only for guests inside.
  const [revealed, setRevealed] = useState(false);
  const [recentered, setRecentered] = useState(false);
  const timerRef = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  useEffect(() => {
    if (station !== 'Entrance') setRevealed(true);
  }, [station]);
  // Warm the 3D room behind the sketchbook once it rests.
  useEffect(() => void whenBookRests().then(warmTeaRoom), []);
  // Warm the shelf posters and the Counter, Host and Shelf panels once the room is ready to enter.
  useEffect(() => {
    if (!sceneReady) return;
    return idlePreload(() => {
      for (const src of SHELF_POSTERS) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = src;
      }
      return Promise.all([loadThesisDeck(), loadIrohChat(), loadShelf()]);
    });
  }, [sceneReady]);
  useEffect(() => {
    if (!revealed) return;
    return idlePreload(async () => {
      for (const id of THESIS_IDS) {
        const img = new Image();
        img.src = `/images/theses/${id}-600w.webp`;
      }
    });
  }, [revealed]);
  const panel = useRef<HTMLElement>(null);
  // Openers commit the panel in a transition, so focus it as it mounts.
  const panelRef = useCallback((node: HTMLElement | null) => {
    panel.current = node;
    node?.focus({ preventScroll: true });
  }, []);
  const openHint = useRef<HTMLButtonElement>(null);
  // Escape stashes a half-typed Uncle question; close applies it once.
  const draftOnClose = useRef<{ text: string; key: number } | null>(null);
  const closeApplied = useRef(false);
  const observatoriumOpening = useRef(false);
  const rollUpTimer = useRef(0);
  // Deep link opens the Counter panel once after the camera arrives.
  const deepLinkOpenOnce = useRef(false);
  const focusHintOnArrive = useRef(false);
  const returnThesis = useRef<ThesisId | null>(null);
  const reduced = systemReduced ?? true;
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setSystemReduced(media.matches);
    const change = () => setSystemReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('thesis');
    if (!raw || !THESIS_IDS.includes(raw as ThesisId)) return;
    setInitialThesis(raw as ThesisId);
    setStation('Counter');
    deepLinkOpenOnce.current = true;
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/nansen-status', {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('nansen' in body)) return;
        if (!isNansenAvailability(body.nansen) || cancelled) return;
        setNansen(body.nansen);
      } catch {
        /* Keep the server-rendered availability. */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => () => irohSession.stop(), [irohSession]);
  useEffect(
    () =>
      irohSession.subscribe(() => {
        const chat = irohSession.getSnapshot();
        const next: IrohActivity = chat.isStreaming
          ? chat.currentTool || !chat.messages.at(-1)?.content
            ? 'researching'
            : 'responding'
          : chat.error
            ? 'error'
            : 'idle';
        setIrohActivity((current) => (current === next ? current : next));
      }),
    [irohSession],
  );
  const navigate = useCallback(
    (next: Station) => {
      if (observatoriumOpening.current) return;
      // Re-clicking Counter closes the desk and returns this camera pose.
      // cameraAt stays set so the open hint does not wait for a new arrival.
      if (next === station) {
        if (next === 'Counter') {
          setPanelOpen(false);
          window.dispatchEvent(new Event(RECENTER_EVENT));
        }
        return;
      }
      // Back from asking Uncle: reopen the thesis the guest was reading.
      // Leave returnThesis set so the open effect can apply it after the
      // desk's unmount cleanup, which clears the selection.
      if (next === 'Counter' && returnThesis.current) {
        deepLinkOpenOnce.current = true;
      } else {
        returnThesis.current = null;
        // An open queued by an earlier trip (a card, a deep link) is stale now.
        deepLinkOpenOnce.current = false;
      }
      setCameraAt(null);
      setShelfFocused(false);
      setStation(next);
      setPanelOpen(false);
      setUncleDraft(null);
    },
    [station],
  );
  const focusShelf = useCallback(() => {
    if (shelfFocused) {
      setPanelOpen(true);
      queueMicrotask(() => panel.current?.focus());
      return;
    }
    const alreadyAtShelf =
      station === 'Shelf' && (cameraAt === 'Shelf' || sceneFailed);
    if (!alreadyAtShelf) setCameraAt(null);
    setShelfFocused(true);
    setStation('Shelf');
    setPanelOpen(true);
  }, [shelfFocused, station, cameraAt, sceneFailed]);
  const openPanel = useCallback(() => {
    // A transition keeps the panel unmounted until its lazy content is ready.
    startTransition(() => {
      if (station === 'Shelf') {
        if (cameraAt !== 'Shelf' && !sceneFailed) setCameraAt(null);
        setShelfFocused(true);
      }
      setPanelOpen(true);
    });
    queueMicrotask(() => panel.current?.focus());
  }, [station, cameraAt, sceneFailed]);
  useEffect(() => {
    if (!deepLinkOpenOnce.current) return;
    if (station !== 'Counter') return;
    if (cameraAt !== 'Counter' && !sceneFailed) return;
    deepLinkOpenOnce.current = false;
    const back = returnThesis.current;
    returnThesis.current = null;
    // After the leaving desk's unmount clear, so the restored thesis sticks.
    startTransition(() => {
      if (back) setSelectedThesis(back);
      setPanelOpen(true);
    });
  }, [station, cameraAt, sceneFailed]);
  const closePanel = useCallback(() => {
    const paper = panel.current;
    const finish = () => {
      // The roll-up timer and a second close must not drop a stashed question.
      if (closeApplied.current) return;
      closeApplied.current = true;
      // Keep focus where the user moved it (e.g. a dock click mid roll-up).
      const active = document.activeElement;
      const refocus =
        !active || active === document.body || Boolean(paper?.contains(active));
      const kept = draftOnClose.current;
      draftOnClose.current = null;
      // × drops the one-shot prefill. Escape leaves a stashed question in `kept`.
      flushSync(() => {
        setPanelOpen(false);
        setUncleDraft(kept);
      });
      if (refocus) openHint.current?.focus();
    };
    if (reduced || !paper || paper.classList.contains('is-rolling-up'))
      return finish();
    // Let the scroll roll up to its top rod before it unmounts. The Shelf has
    // no roll-up, so it closes at once.
    paper.classList.add('is-rolling-up');
    const { animationName, animationDuration } = getComputedStyle(paper);
    if (!animationName.includes('paper-roll-up')) return finish();
    rollUpTimer.current = window.setTimeout(
      finish,
      parseFloat(animationDuration) * 1000,
    );
  }, [reduced]);
  const onCameraArrive = useCallback((at: Station) => {
    setCameraAt(at);
  }, []);
  const openObservatorium = useCallback(() => {
    if (observatoriumOpening.current) return;
    // If WebGL is unavailable, retain the action instead of leaving a blank tab
    // waiting for an animation that cannot run.
    if (!sceneAvailable || sceneFailed) {
      const popup = window.open(OBSERVATORIUM_URL, '_blank');
      if (popup) popup.opener = null;
      return;
    }
    observatoriumOpening.current = true;
    setOpeningObservatorium(true);
    setObservatoriumZoomKey((key) => key + 1);
  }, [sceneAvailable, sceneFailed]);
  const finishObservatoriumOpen = useCallback(() => {
    observatoriumOpening.current = false;
    setOpeningObservatorium(false);
    // Open only after the camera settles, keeping the complete push-in visible.
    // Setting opener manually preserves a usable Window return value so we do
    // not mistake a successful `noopener` tab for a blocked popup.
    const popup = window.open(OBSERVATORIUM_URL, '_blank');
    if (popup) popup.opener = null;
  }, []);
  const onSceneAvailability = useCallback((available: boolean) => {
    setSceneAvailable(available);
    setSceneFailed(!available);
    // A lost context never finishes the push-in; do not lock navigation on it.
    if (!available) {
      observatoriumOpening.current = false;
      setOpeningObservatorium(false);
    }
  }, []);
  const onLoadProgress = useCallback((active: boolean, progress: number) => {
    setAssetsLoading(active);
    // Every loaded texture reports; tenths keep that from re-rendering the
    // shell on each one. The pour eases between steps anyway.
    const step = Math.floor(progress / 10) * 10;
    setAssetProgress((current) => Math.max(current, step));
  }, []);
  const sceneSettled =
    sceneFailed || (sceneAvailable && staged && !assetsLoading);
  useEffect(() => {
    if (sceneReady) return;
    // Wait for loading to stay quiet briefly; never hold the room past 30s.
    const timer = window.setTimeout(
      () => setSceneReady(true),
      sceneSettled ? 450 : 30000,
    );
    return () => window.clearTimeout(timer);
  }, [sceneSettled, sceneReady]);
  const loaderProgress = sceneAvailable ? 15 + assetProgress * 0.85 : 6;
  useEffect(() => {
    if (panelOpen) closeApplied.current = false;
    // Once the panel opens or closes by any path, a pending roll-up is moot,
    // and so is a question Escape stashed for it.
    return () => {
      window.clearTimeout(rollUpTimer.current);
      draftOnClose.current = null;
    };
  }, [panelOpen]);
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const box =
        panel.current?.querySelector<HTMLTextAreaElement>('#iroh-question');
      // Close even when the question field is focused. Keep whatever was typed.
      draftOnClose.current = box?.value
        ? { text: box.value, key: Date.now() }
        : null;
      event.preventDefault();
      closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, closePanel]);
  const onOpenThesis = useCallback(
    (id: ThesisId, conviction: ConvictionLevel | null) => {
      setSelectedThesis(id);
      setPour({
        key: `thesis:${id}:${Date.now()}`,
        mood: convictionToMood(conviction),
      });
    },
    [],
  );
  const onCloseThesis = useCallback(() => {
    setSelectedThesis(null);
    setPour((current) => ({ ...current, mood: 'waiting' }));
  }, []);
  // A counter card opens the desk on all three scrolls, not on its own thesis.
  const openDesk = useCallback(() => {
    // An explicit click wins over the thesis saved before asking Uncle.
    returnThesis.current = null;
    if (station === 'Counter') return openPanel();
    if (observatoriumOpening.current) return;
    navigate('Counter');
    deepLinkOpenOnce.current = true;
  }, [station, navigate, openPanel]);
  const onTalkToUncle = useCallback(
    (text: string) => {
      returnThesis.current = selectedThesis;
      // Urgent, not a transition: a pending one could land after the guest
      // closes the desk. The panel's Suspense still mounts it once, with the chat.
      setUncleDraft({ text, key: Date.now() });
      setCameraAt(null);
      setShelfFocused(false);
      setStation('AvatarSeat');
      setPanelOpen(true);
    },
    [selectedThesis],
  );
  const active = STATIONS.find((s) => s.id === station)!;
  const isEntrance = station === 'Entrance';
  const mood: SceneMood = isEntrance ? 'waiting' : pour.mood;
  const shelfOpen =
    station === 'Shelf' &&
    shelfFocused &&
    (cameraAt === 'Shelf' || sceneFailed);
  const shelfView =
    station === 'Shelf'
      ? shelfOpen
        ? 'open'
        : shelfFocused
          ? 'focusing'
          : 'browse'
      : undefined;
  // After a close the camera keeps its Shelf pose; this button reopens it.
  const canApproachShelf =
    station === 'Shelf' &&
    !(shelfFocused && panelOpen) &&
    (cameraAt === 'Shelf' || sceneFailed);
  const cameraSettled = cameraAt === station || sceneFailed;
  const panelStation =
    station === 'Counter'
      ? 'Counter'
      : station === 'AvatarSeat'
        ? 'Host'
        : null;
  const showOpenHint =
    Boolean(panelStation) && !panelOpen && !isEntrance && cameraSettled;
  // After Enter, focus would drop to <body> as the waiting room unmounts.
  useEffect(() => {
    if (!showOpenHint || !focusHintOnArrive.current) return;
    focusHintOnArrive.current = false;
    const current = document.activeElement;
    if (
      !current ||
      current === document.body ||
      current.closest('.waiting-room')
    )
      openHint.current?.focus({ preventScroll: true });
  }, [showOpenHint]);
  const teaser = STATION_TEASERS[station];
  useEffect(() => {
    if (shelfOpen) panel.current?.focus({ preventScroll: true });
  }, [shelfOpen]);
  const showObservatoriumHint =
    station === 'TeaTable' && !isEntrance && cameraSettled;
  const showPanel =
    !isEntrance &&
    panelOpen &&
    (station === 'Counter' ||
      station === 'AvatarSeat' ||
      (station === 'Shelf' && shelfOpen));
  return (
    <main
      className="app-shell"
      data-station={station}
      data-motion={reduced ? 'reduce' : 'full'}
      data-mood={mood}
      data-nansen={nansen}
      data-iroh-activity={irohActivity}
      data-camera-at={cameraAt ?? undefined}
      data-shelf-view={shelfView}
      aria-busy={!sceneReady}
    >
      <WaitingRoom
        open={isEntrance}
        ready={sceneReady}
        progress={loaderProgress}
        reduced={reduced}
        onEnter={() => {
          focusHintOnArrive.current = true;
          navigate('Counter');
        }}
      >
        <WaitingVersions reduced={reduced} />
      </WaitingRoom>
      <header className="topbar" inert={isEntrance || undefined}>
        <a href="#main-panel" className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◒
          </span>
          <span className="brand-text">
            Iroh&apos;s Tea Shop
            <small>NANSEN-POWERED CRYPTO RESEARCH</small>
          </span>
        </a>

        <div className="topbar-right">
          <MusicToggle floating={isEntrance} />
          <div className="status-indicator">
            <button
              className="status-icon"
              aria-label="Data source status"
              aria-describedby="status-popup"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <circle
                  cx="8"
                  cy="8"
                  r="6.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M8 7.2V11"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
                <circle cx="8" cy="5" r="0.8" fill="currentColor" />
              </svg>
            </button>

            <div className="status-popup" id="status-popup" role="tooltip">
              <div className="status-row">
                <span className="status-label">Thesis</span>
                <span
                  className={
                    nansen === 'configured'
                      ? 'status-value live'
                      : 'status-value'
                  }
                >
                  {nansen === 'configured' ? 'Saved hourly' : 'Offline'}
                </span>
              </div>

              <div className="status-row">
                <span className="status-label">Uncle</span>
                <span
                  className={
                    nansen === 'configured'
                      ? 'status-value live'
                      : 'status-value'
                  }
                >
                  {nansen === 'configured'
                    ? 'Live · Nansen Research'
                    : 'Offline'}
                </span>
              </div>
            </div>
          </div>

          <AccountMenu user={user} />
        </div>
      </header>

      <div className="room-layout" inert={isEntrance || undefined}>
        <section
          className="room-stage"
          aria-label="Guided three-dimensional tea room"
        >
          <TeaRoom
            station={station}
            reduced={reduced}
            mood={mood}
            requestKey={pour.key}
            irohActivity={irohActivity}
            onArrive={onCameraArrive}
            onAvailabilityChange={onSceneAvailability}
            onLoadProgress={onLoadProgress}
            onShelfSelect={focusShelf}
            shelfFocused={shelfFocused}
            shelfRevealed={shelfOpen}
            menuClosed={!isEntrance && !panelOpen}
            onMenuOpen={openPanel}
            onThesisPick={openDesk}
            onNavigate={navigate}
            onObservatoriumOpen={openObservatorium}
            observatoriumZoomKey={observatoriumZoomKey}
            onObservatoriumZoomEnd={finishObservatoriumOpen}
            onStaged={onStaged}
          />

          {!isEntrance && sceneAvailable && (
            <button
              type="button"
              className="recenter-view"
              aria-label="Recenter view"
              title="Recenter view"
              onClick={() => {
                window.dispatchEvent(new Event(RECENTER_EVENT));
                setRecentered(true);
                window.clearTimeout(timerRef.current);
                timerRef.current = window.setTimeout(
                  () => setRecentered(false),
                  2000,
                );
              }}
            >
              <span aria-hidden="true">{recentered ? '✓' : '◎'}</span>
            </button>
          )}

          {canApproachShelf && (
            <button
              ref={openHint}
              type="button"
              className="panel-open-hint shelf-approach"
              aria-label={STATION_TEASERS.Shelf!.cta!.join(' ')}
              onClick={focusShelf}
            >
              <span className="panel-open-hint-seal" aria-hidden="true">
                {STATION_TEASERS.Shelf!.glyph}
              </span>
              <span className="panel-open-hint-body" aria-hidden="true">
                <span className="panel-open-hint-title">
                  {STATION_TEASERS.Shelf!.cta![0]}{' '}
                  <em>{STATION_TEASERS.Shelf!.cta![1]}</em>
                </span>
              </span>
            </button>
          )}

          {showOpenHint && panelStation && teaser?.cta && (
            <button
              ref={openHint}
              key={panelStation}
              type="button"
              className="panel-open-hint"
              aria-label={teaser.cta.join(' ')}
              aria-describedby="panel-open-teaser"
              onClick={openPanel}
            >
              <span className="panel-open-hint-seal" aria-hidden="true">
                {teaser.glyph}
              </span>
              <span className="panel-open-hint-body" aria-hidden="true">
                <span className="panel-open-hint-title">
                  {teaser.cta[0]} <em>{teaser.cta[1]}</em>
                </span>
                <InkLine
                  text={teaser.text}
                  className="panel-open-hint-teaser"
                />
              </span>
              <span id="panel-open-teaser" className="sr-only">
                {teaser.text}
              </span>
            </button>
          )}

          {showObservatoriumHint && teaser?.cta && (
            <button
              key="observatorium-model"
              type="button"
              className="panel-open-hint"
              aria-label={teaser.cta.join(' ')}
              aria-describedby="observatorium-model-teaser"
              aria-busy={openingObservatorium || undefined}
              disabled={openingObservatorium}
              onClick={openObservatorium}
            >
              <span className="panel-open-hint-seal" aria-hidden="true">
                {teaser.glyph}
              </span>
              <span className="panel-open-hint-body" aria-hidden="true">
                <span className="panel-open-hint-title">
                  {teaser.cta[0]} <em>{teaser.cta[1]}</em>
                </span>
                <InkLine
                  text={teaser.text}
                  className="panel-open-hint-teaser"
                />
              </span>
              <span id="observatorium-model-teaser" className="sr-only">
                {teaser.text}
              </span>
            </button>
          )}
        </section>

        <Suspense fallback={null}>
          {showPanel && (
            <section
              key={station}
              className="reading-panel"
              id="main-panel"
              ref={panelRef}
              tabIndex={-1}
              aria-label={active.label}
            >
              <button
                type="button"
                className="panel-close"
                aria-label={`Close ${active.label} menu`}
                onClick={closePanel}
              >
                <span aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </span>
                <span className="sr-only">Close menu</span>
              </button>
              <span
                className="scroll-ornament"
                aria-hidden="true"
                data-seal={teaser?.glyph ?? '茶'}
              />
              {station === 'Counter' && (
                <ThesisDeck
                  reduced={reduced}
                  initialThesis={initialThesis}
                  selectedThesis={selectedThesis}
                  onOpenThesis={onOpenThesis}
                  onCloseThesis={onCloseThesis}
                  onTalkToUncle={onTalkToUncle}
                />
              )}
              {station === 'AvatarSeat' && (
                <IrohChat
                  session={irohSession}
                  user={user}
                  nansen={nansen}
                  draft={uncleDraft}
                />
              )}
              {shelfOpen && <SmartWalletShelf nansen={nansen} />}
            </section>
          )}
        </Suspense>
      </div>

      {!isEntrance && (
        <StationDock
          station={station}
          reduced={reduced}
          onNavigate={navigate}
        />
      )}
    </main>
  );
}
