'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  backgroundMusicSources,
  loopBounds,
  readBackgroundMusic,
  writeBackgroundMusic,
} from './backgroundMusic';
import './MusicToggle.css';

const VOLUME = 0.7;
// Time constant for gain changes; a hard cut clicks.
const FADE = 0.35;

type Player = { context: AudioContext; gain: GainNode };

/**
 * Web Audio, not <audio loop>: a buffer source loops sample-exact, where a
 * media element seeks back and leaves a gap. The file is fetched on the first
 * gesture that can start sound, never before.
 */
export function MusicToggle({ floating = false }: { floating?: boolean }) {
  const player = useRef<Player | null>(null);
  const loading = useRef(false);
  const want = useRef(false);
  const [on, setOn] = useState(false);
  const [playing, setPlaying] = useState(false);

  const fade = useCallback(() => {
    const current = player.current;
    if (!current) return;
    const { context, gain } = current;
    if (want.current && !document.hidden) void context.resume();
    gain.gain.setTargetAtTime(
      want.current ? VOLUME : 0,
      context.currentTime,
      FADE,
    );
    if (want.current) return;
    window.setTimeout(() => {
      if (!want.current) void context.suspend();
    }, FADE * 4000);
  }, []);

  // Must run inside a user gesture: that is what lets the context start.
  const start = useCallback(() => {
    if (!want.current) return;
    if (player.current) return fade();
    if (loading.current) return;
    loading.current = true;
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);
    const probe = document.createElement('audio');
    void (async () => {
      for (const src of backgroundMusicSources((type) =>
        probe.canPlayType(type),
      )) {
        try {
          const response = await fetch(src);
          if (!response.ok) continue;
          const buffer = await context.decodeAudioData(
            await response.arrayBuffer(),
          );
          const source = context.createBufferSource();
          const bounds = loopBounds(
            buffer.getChannelData(0),
            buffer.sampleRate,
          );
          source.buffer = buffer;
          source.loop = true;
          source.loopStart = bounds.start;
          source.loopEnd = bounds.end;
          source.connect(gain);
          source.start(0, bounds.start);
          player.current = { context, gain };
          setPlaying(true);
          loading.current = false;
          return fade();
        } catch {
          /* Try the next format. */
        }
      }
      // Nothing decoded: show the toggle as off rather than silently on.
      loading.current = false;
      want.current = false;
      setOn(false);
      void context.close();
    })();
  }, [fade]);

  const setEnabled = useCallback(
    (next: boolean) => {
      want.current = next;
      setOn(next);
      writeBackgroundMusic(next);
      if (next) start();
      else fade();
    },
    [fade, start],
  );

  useEffect(() => {
    if (!readBackgroundMusic()) return;
    want.current = true;
    setOn(true);
  }, []);

  // Browsers hold sound until a gesture, so "on" starts at the guest's first
  // click, key or page drag anywhere. Once the music plays, stop listening.
  useEffect(() => {
    if (!on || playing) return;
    const onGesture = () => start();
    window.addEventListener('click', onGesture);
    window.addEventListener('pointerup', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('click', onGesture);
      window.removeEventListener('pointerup', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [on, playing, start]);

  useEffect(() => {
    const onVisibility = () => {
      const current = player.current;
      if (!current) return;
      if (document.hidden) void current.context.suspend();
      else fade();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [fade]);

  useEffect(
    () => () => {
      void player.current?.context.close();
    },
    [],
  );

  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => {
    setSlot(floating ? document.querySelector('.waiting-brand') : null);
  }, [floating]);

  const button = (
    <button
      type="button"
      className={floating ? 'music-toggle is-floating' : 'music-toggle'}
      aria-pressed={on}
      aria-label="Background music"
      onClick={() => setEnabled(!on)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
        {!on && <path d="M3 3l18 24" />}
      </svg>
    </button>
  );

  // The waiting room covers the top bar, so the toggle sits in its header row
  // beside the GitHub link. Portal only after mount so the server and first
  // client render match.
  if (floating && slot) return createPortal(button, slot);
  return button;
}
