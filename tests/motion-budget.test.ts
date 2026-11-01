import { describe, expect, it } from 'vitest';
import {
  FULL_STRIPS,
  LIGHT_STRIPS,
  motionBudgetFromSignals,
  petalCountFor,
  probeFramesPerSecond,
  riffleDuration,
  stripsFor,
} from '../src/ui/motionBudget';

describe('motion budget', () => {
  it('uses the light path at four cores or fewer', () => {
    expect(motionBudgetFromSignals({ hardwareConcurrency: 4 })).toBe('light');
    expect(motionBudgetFromSignals({ hardwareConcurrency: 2 })).toBe('light');
    expect(motionBudgetFromSignals({ hardwareConcurrency: 8 })).toBe('full');
    expect(motionBudgetFromSignals({})).toBe('full');
  });

  it('uses the light path when device memory is in the low bucket', () => {
    expect(
      motionBudgetFromSignals({ hardwareConcurrency: 8, deviceMemory: 4 }),
    ).toBe('light');
    expect(
      motionBudgetFromSignals({ hardwareConcurrency: 8, deviceMemory: 0.5 }),
    ).toBe('light');
    expect(
      motionBudgetFromSignals({ hardwareConcurrency: 8, deviceMemory: 8 }),
    ).toBe('full');
  });

  it('uses the light path when the frame probe is poor', () => {
    expect(motionBudgetFromSignals({ hardwareConcurrency: 8, fps: 30 })).toBe(
      'light',
    );
    expect(motionBudgetFromSignals({ hardwareConcurrency: 8, fps: 44 })).toBe(
      'light',
    );
    expect(motionBudgetFromSignals({ hardwareConcurrency: 8, fps: 59 })).toBe(
      'full',
    );
  });

  it('keeps a full curl on a capable machine and a shorter one on the light path', () => {
    expect(stripsFor('full')).toBe(FULL_STRIPS);
    expect(stripsFor('light')).toBe(LIGHT_STRIPS);
    expect(LIGHT_STRIPS).toBeLessThan(FULL_STRIPS);
    expect(riffleDuration(0, 'light')).toBeLessThan(riffleDuration(0, 'full'));
    expect(riffleDuration(1, 'light')).toBeLessThan(riffleDuration(1, 'full'));
    expect(petalCountFor(48, 'full')).toBe(48);
    expect(petalCountFor(48, 'light')).toBe(12);
    expect(petalCountFor(9, 'light')).toBe(3);
  });

  it('measures median frame time and ignores a single stall', async () => {
    const queue: FrameRequestCallback[] = [];
    const request = (callback: FrameRequestCallback) => {
      queue.push(callback);
      return 1;
    };
    const pending = probeFramesPerSecond(request, 4, 80, 12);
    let now = 1000;
    const deltas = [16, 16, 200, 16, 16, 16];
    while (queue.length) {
      const callback = queue.shift();
      if (!callback) break;
      now += deltas.shift() ?? 16;
      callback(now);
    }
    await expect(pending).resolves.toBeCloseTo(1000 / 16, 5);
  });
});
