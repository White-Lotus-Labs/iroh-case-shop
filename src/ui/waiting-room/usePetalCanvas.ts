'use client';
import { useEffect, useState } from 'react';
import { lightExperience } from '../../scene/lightExperience';

/** Skip the petal WebGL layer on phones, save-data, and reduced motion. */
export function usePetalCanvas() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (lightExperience()) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = () => setOn(true);
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(start, { timeout: 1800 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(start, 700);
    return () => window.clearTimeout(timer);
  }, []);
  return on;
}
