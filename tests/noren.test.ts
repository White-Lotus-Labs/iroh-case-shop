import { describe, expect, it } from 'vitest';
import { drape } from '../src/scene/props/Noren';
import { NOREN_ROD_Y as ROD_Y } from '../src/scene/TeaArchitecture';

// The lintel soffit is at 2.41 m and the opening between the jamb posts is ±1.3 m.

describe('doorway noren', () => {
  it('hangs inside the opening, under the lintel, and above the camera', () => {
    for (const side of [-1, 1] as const)
      for (let i = 0; i <= 24; i++)
        for (let j = 0; j <= 24; j++) {
          const [x, y] = drape(side, i / 24, j / 24);
          expect(Math.abs(x)).toBeLessThan(1.26);
          expect(ROD_Y + y).toBeLessThan(2.41);
          // Station cameras cross the doorway at 1.7 m or lower; the near plane is 0.08 m.
          expect(ROD_Y + y).toBeGreaterThan(1.85);
        }
  });
  it('closes the slit through the crest so it reads as one mark', () => {
    for (let j = 0; j <= 13; j++) {
      const v = j * 0.05,
        left = drape(-1, 0, v),
        right = drape(1, 0, v);
      expect(right[1]).toBeCloseTo(left[1], 6);
      expect(right[2]).toBeCloseTo(left[2], 6);
      expect(right[0] - left[0]).toBeLessThan(0.015);
    }
  });
});
