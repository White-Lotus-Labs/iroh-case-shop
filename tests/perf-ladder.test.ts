import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

let frame: () => void = () => {};
vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: () => void) => {
    frame = cb;
  },
}));

const { PerformanceMonitor } = await import(
  '@react-three/drei/core/PerformanceMonitor.js'
);

function run(hz: number, seconds: number, props: object) {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (now += 1000 / hz));
  const calls = { incline: 0, decline: 0, fallback: 0 };
  renderToString(
    createElement(PerformanceMonitor, {
      ...props,
      onIncline: () => calls.incline++,
      onDecline: () => calls.decline++,
      onFallback: () => calls.fallback++,
    }),
  );
  for (let i = 0; i < hz * seconds; i++) frame();
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('scene quality ladder', () => {
  it.each([60, 120])(
    'drei counts every smooth incline as a flip at %i Hz',
    (hz) => {
      expect(run(hz, 20, { flipflops: 3 }).fallback).toBe(1);
    },
  );

  it.each([60, 120])('never falls back without flipflops at %i Hz', (hz) => {
    const calls = run(hz, 20, {});
    expect(calls.fallback).toBe(0);
    expect(calls.decline).toBe(0);
    expect(calls.incline).toBeGreaterThan(3);
  });

  it('ScenePolish does not use the flip-flop fallback', () => {
    const source = readFileSync('src/scene/ScenePolish.tsx', 'utf8');
    expect(source).not.toMatch(/flipflops=|onFallback=/);
  });

  // The Canvas re-applies its dpr prop on every render, undoing a store setDpr.
  it('keeps the rung DPR in the Canvas prop', () => {
    const polish = readFileSync('src/scene/ScenePolish.tsx', 'utf8');
    const room = readFileSync('src/scene/TeaRoom.tsx', 'utf8');
    expect(polish).not.toMatch(/setDpr/);
    expect(room).toMatch(/dpr=\{dpr\}/);
    expect(room).toMatch(/onDpr=\{setDpr\}/);
  });
});
