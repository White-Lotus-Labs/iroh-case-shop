import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { temaeLayout } from '../src/scene/props/Temae';

function segmentDistance(point: Vector3, a: Vector3, b: Vector3) {
  const ab = b.clone().sub(a),
    t = Math.min(1, Math.max(0, point.clone().sub(a).dot(ab) / ab.lengthSq()));
  return point.distanceTo(a.clone().addScaledVector(ab, t));
}

describe('temae tools', () => {
  const layout = temaeLayout();

  it('stands the bowl, jar and lid rest on the boards', () => {
    for (const at of [layout.bowlAt, layout.jarAt, layout.restAt])
      expect(at[1]).toBe(0);
  });

  it('lays the ladle handle on the kensui lip', () => {
    const gap = segmentDistance(layout.lip, layout.joint, layout.tip);
    expect(gap).toBeLessThanOrEqual(layout.cordRadius);
    expect(gap).toBeGreaterThan(layout.cordRadius - 0.003);
  });

  it('sinks the fukusa a hair into the tatami', () => {
    const clothBottom = layout.cloth[1] - layout.clothSize[1] / 2,
      clothTop = layout.cloth[1] + layout.clothSize[1] / 2,
      foldBottom = layout.fold[1] - layout.foldSize[1] / 2;
    expect(clothBottom).toBeLessThanOrEqual(layout.tatami);
    expect(clothBottom).toBeGreaterThan(layout.tatami - 0.004);
    expect(foldBottom).toBeLessThanOrEqual(clothTop);
    expect(foldBottom).toBeGreaterThan(clothBottom);
  });

  it('puts a contact shade just above each surface, reaching past the base', () => {
    const [jar, bowl, rest, cloth] = layout.shades;
    // Under the room's ContactShadows planes (boards 0.016, tatami 0.054), so they never occlude them.
    for (const { at } of [jar, bowl, rest]) {
      expect(at[1]).toBeGreaterThan(0);
      expect(at[1]).toBeLessThan(0.016);
    }
    expect(cloth.at[1]).toBeGreaterThan(layout.tatami);
    expect(cloth.at[1]).toBeLessThan(0.054);
    expect(jar.size[0] / 2).toBeGreaterThan(0.086);
    expect(bowl.size[0] / 2).toBeGreaterThan(0.076);
    expect(rest.size[0] / 2).toBeGreaterThan(0.028);
    expect(cloth.size[0]).toBeGreaterThan(layout.clothSize[0]);
    expect(cloth.size[1]).toBeGreaterThan(layout.clothSize[2]);
  });
});
