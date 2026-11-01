'use client';
import dynamic from 'next/dynamic';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { petalCountFor, useMotionBudget } from '../motionBudget';
import { PROJECT, REPO_URL } from './content';
import { TeaPourButton } from './TeaPourButton';
import { usePetalCanvas } from './usePetalCanvas';
import './WaitingRoom.css';

const PetalCanvas = dynamic(
  () => import('./SakuraPetals').then((m) => m.PetalCanvas),
  { ssr: false },
);

// Long enough for the push through the doorway to read before the room shows.
// Matches the 1.1s push and 0.2s reduced fade on .is-leaving in WaitingRoom.css.
const LEAVE_MS = 1100;

export function WaitingRoom({
  open,
  ready,
  progress,
  reduced,
  onEnter,
  children,
}: {
  open: boolean;
  ready: boolean;
  progress: number;
  reduced: boolean;
  onEnter: () => void;
  children?: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const budget = useMotionBudget();
  const petals = usePetalCanvas();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(
      () => setMounted(false),
      reduced ? 200 : LEAVE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open, reduced]);
  useEffect(() => {
    if (reduced || !open) return;
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const style = root.current?.style;
      style?.setProperty('--px', (event.clientX / innerWidth - 0.5).toFixed(3));
      style?.setProperty(
        '--py',
        (event.clientY / innerHeight - 0.5).toFixed(3),
      );
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, [reduced, open]);
  // Render in the same commit that `open` turns true, so MusicToggle finds
  // the header when it looks for its slot.
  if (!mounted && !open) return null;
  const percent = Math.round(ready ? 100 : Math.min(progress, 99));
  return (
    <div
      ref={root}
      className={`waiting-room${open ? '' : ' is-leaving'}`}
      data-ready={ready || undefined}
      aria-hidden={!open || undefined}
    >
      <div className="waiting-backdrop" aria-hidden="true">
        <img
          src="/images/waiting-room/exterior.webp"
          srcSet="/images/waiting-room/exterior-780w.webp 780w, /images/waiting-room/exterior.webp 1280w"
          sizes="100vw"
          alt=""
          fetchPriority="high"
          decoding="async"
        />
      </div>
      {petals && (
        <PetalCanvas
          className="waiting-petals"
          count={petalCountFor(48, budget)}
          size={2.1}
          reduced={reduced}
          light={budget === 'light'}
        />
      )}
      <header className="waiting-brand">
        <span className="waiting-brand-mark" aria-hidden="true">
          ◒
        </span>
        <span className="waiting-brand-text">
          {PROJECT.name}
          <small>{PROJECT.studio}</small>
        </span>
        <a
          className="waiting-repo"
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Source on GitHub"
        >
          <span className="waiting-repo-lead">Source on </span>GitHub
        </a>
      </header>
      <div className="waiting-stage">{children}</div>
      <footer className="waiting-entry">
        <div className="waiting-status">
          <p role="status" aria-live="polite">
            {ready ? 'The tea is ready.' : 'Preparing the tea room…'}
          </p>
          <div
            className="waiting-progress"
            role="progressbar"
            aria-label="Preparing the tea room"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ transform: `scaleX(${percent / 100})` }} />
          </div>
        </div>
        <TeaPourButton
          fill={percent / 100}
          ready={ready}
          disabled={!ready || !open}
          reduced={reduced}
          onClick={onEnter}
        />
      </footer>
    </div>
  );
}
