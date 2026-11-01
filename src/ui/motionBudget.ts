'use client';

import { useEffect, useState } from 'react';

/** Nested page-curl strips on a machine that can spend them. */
export const FULL_STRIPS = 18;
/** Still a paper bend. Faces are page snapshots, so 16 strips stay cheap. */
export const LIGHT_STRIPS = 16;
export const LOW_CORE_COUNT = 4;
/** `navigator.deviceMemory` is capped and coarse; 4 GB is the low bucket. */
export const LOW_DEVICE_MEMORY_GB = 4;
/** A median frame slower than this (~45 fps) is a poor probe. */
export const LOW_FPS = 45;

export type MotionBudget = 'full' | 'light';

export type MotionSignals = {
  hardwareConcurrency?: number;
  /** GB, as reported by Chromium. Absent on Safari. */
  deviceMemory?: number;
  /** Median frames per second from a short rAF sample. */
  fps?: number;
};

const listeners = new Set<(budget: MotionBudget) => void>();
let settled: MotionBudget | null = null;
let inflight: Promise<MotionBudget> | null = null;

export function motionBudgetFromSignals(signals: MotionSignals): MotionBudget {
  const cores = signals.hardwareConcurrency;
  if (typeof cores === 'number' && cores >= 1 && cores <= LOW_CORE_COUNT)
    return 'light';
  const memory = signals.deviceMemory;
  if (
    typeof memory === 'number' &&
    memory > 0 &&
    memory <= LOW_DEVICE_MEMORY_GB
  )
    return 'light';
  const fps = signals.fps;
  if (
    typeof fps === 'number' &&
    Number.isFinite(fps) &&
    fps > 0 &&
    fps < LOW_FPS
  )
    return 'light';
  return 'full';
}

export function stripsFor(budget: MotionBudget): number {
  switch (budget) {
    case 'full':
      return FULL_STRIPS;
    case 'light':
      return LIGHT_STRIPS;
    default: {
      const neverBudget: never = budget;
      return neverBudget;
    }
  }
}

/** Wall-clock seconds for one riffle leaf. `bell` is 0 at the ends and 1 mid-run. */
export function riffleDuration(bell: number, budget: MotionBudget): number {
  const clamped = Math.min(1, Math.max(0, bell));
  switch (budget) {
    case 'light':
      return 0.18 - 0.1 * clamped;
    case 'full':
      return 0.32 - 0.21 * clamped;
    default: {
      const neverBudget: never = budget;
      return neverBudget;
    }
  }
}

export function petalCountFor(full: number, budget: MotionBudget): number {
  switch (budget) {
    case 'full':
      return full;
    case 'light':
      return Math.max(3, Math.round(full / 4));
    default: {
      const neverBudget: never = budget;
      return neverBudget;
    }
  }
}

export function readStaticMotionSignals(): MotionSignals {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
  };
}

export function currentMotionBudget(): MotionBudget {
  return settled ?? 'full';
}

/**
 * Latch the light path for the rest of the visit. A slow curl can call this
 * after the static probe already returned full.
 */
export function noteMotionBudget(next: MotionBudget) {
  if (next !== 'light' || settled === 'light') return;
  publish('light');
}

function publish(next: MotionBudget): MotionBudget {
  if (settled === 'light') return 'light';
  settled = next;
  for (const listener of listeners) listener(settled);
  return settled;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForIdle(timeout: number) {
  return new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout });
      return;
    }
    window.setTimeout(resolve, 32);
  });
}

/**
 * Median frame rate over a short sample. Single long stalls (decode, GC)
 * are dropped so one hiccup does not condemn a fast machine.
 */
export function probeFramesPerSecond(
  requestFrame: (
    callback: FrameRequestCallback,
  ) => number = requestAnimationFrame,
  sampleCount = 10,
  stallMs = 80,
  maxFrames = 24,
): Promise<number> {
  return new Promise((resolve) => {
    const samples: number[] = [];
    let previous = 0;
    let seen = 0;
    const finish = () => {
      if (samples.length === 0) {
        resolve(30);
        return;
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor((sorted.length - 1) / 2)];
      resolve(median > 0 ? 1000 / median : 60);
    };
    const step: FrameRequestCallback = (now) => {
      seen += 1;
      if (previous > 0) {
        const dt = now - previous;
        if (dt > 0 && dt < stallMs) samples.push(dt);
      }
      previous = now;
      if (samples.length >= sampleCount || seen >= maxFrames) {
        finish();
        return;
      }
      requestFrame(step);
    };
    requestFrame(step);
  });
}

/** One shared decision per visit, so the sketchbook and the deck agree. */
export function resolveMotionBudget(): Promise<MotionBudget> {
  if (typeof window === 'undefined') return Promise.resolve('full');
  if (settled) return Promise.resolve(settled);
  if (!inflight) {
    inflight = (async () => {
      const early = motionBudgetFromSignals(readStaticMotionSignals());
      if (early === 'light') return publish('light');
      await waitForIdle(500);
      if (settled === 'light') return 'light' as const;
      const fps = await Promise.race([
        probeFramesPerSecond(),
        wait(700).then(() => 60),
      ]);
      return publish(
        motionBudgetFromSignals({ ...readStaticMotionSignals(), fps }),
      );
    })();
  }
  return inflight;
}

export function useMotionBudget(): MotionBudget {
  const [budget, setBudget] = useState<MotionBudget>('full');
  useEffect(() => {
    let cancel = false;
    const onBudget = (next: MotionBudget) => {
      if (!cancel) setBudget(next);
    };
    listeners.add(onBudget);
    if (settled) onBudget(settled);
    void resolveMotionBudget().then(onBudget);
    return () => {
      cancel = true;
      listeners.delete(onBudget);
    };
  }, []);
  return budget;
}
