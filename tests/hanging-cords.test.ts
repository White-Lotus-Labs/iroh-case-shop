import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import { cord, screwEye } from '../src/scene/props/craft';
import {
  HANG_RING,
  KAKEJIKU_HANGER,
  KAKEJIKU_ORIGIN_Y,
  KAKEJIKU_ROD,
  NAGESHI,
  SCROLL,
  SCROLL_HANGER,
  SCROLL_HOOK_Y,
  SCROLL_ROD,
  SCROLL_WEIGHT,
  TOKO_LINTEL_BOTTOM,
  WAINSCOT_TOP,
} from '../src/scene/props/hanging';
import type { Point } from '../src/scene/stations';

function onSegment(from: Point, to: Point, radius: number) {
  const geometry = cord(from, to, radius),
    position = geometry.attributes.position,
    a = new Vector3(...from),
    d = new Vector3(...to).sub(a),
    len = d.length(),
    dir = d.clone().normalize();
  let maxRadial = 0,
    minT = Infinity,
    maxT = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const p = new Vector3(position.getX(i), position.getY(i), position.getZ(i)),
      t = p.clone().sub(a).dot(dir),
      radial = p.sub(a).sub(dir.clone().multiplyScalar(t)).length();
    maxRadial = Math.max(maxRadial, radial);
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
  }
  geometry.dispose();
  return { maxRadial, minT, maxT, len };
}

function worldY(local: Point, hook: Point, turn: number) {
  const q = new Quaternion().setFromEuler(new Euler(0, turn, 0));
  return new Vector3(...local).applyQuaternion(q).add(new Vector3(...hook)).y;
}

describe('scroll and kakejiku cords', () => {
  it('keeps a cord on the segment between its ends', () => {
    const { maxRadial, minT, maxT, len } = onSegment(
      SCROLL_HANGER.end,
      SCROLL_HANGER.hook,
      0.0018,
    );
    expect(maxRadial).toBeLessThanOrEqual(0.0018 + 1e-4);
    expect(minT).toBeGreaterThanOrEqual(-1e-4);
    expect(maxT).toBeLessThanOrEqual(len + 1e-4);
  });

  it('hangs each wall scroll on one vertical cord under the nageshi', () => {
    const { hook, end, into, ring } = SCROLL_HANGER;
    expect(end[0]).toBe(hook[0]);
    expect(end[2]).toBe(hook[2]);
    expect(end[1]).toBeLessThan(hook[1]);
    const rod = new Vector3(0, -SCROLL.drop, SCROLL_ROD.z);
    expect(new Vector3(...end).distanceTo(rod)).toBeLessThanOrEqual(
      SCROLL_ROD.radius,
    );
    const eye = screwEye(hook, into, ring);
    for (const turn of [Math.PI / 2, -Math.PI / 2]) {
      const placed: Point = [-3.99, SCROLL_HOOK_Y, -4.62];
      const geometry = cord(end, hook);
      const position = geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const y = worldY(
          [position.getX(i), position.getY(i), position.getZ(i)],
          placed,
          turn,
        );
        expect(y).toBeLessThan(NAGESHI.bottom);
      }
      geometry.dispose();
      expect(worldY(eye.shank, placed, turn)).toBeGreaterThan(NAGESHI.bottom);
      expect(worldY(eye.shank, placed, turn)).toBeLessThan(NAGESHI.top);
      expect(worldY(eye.top, placed, turn)).toBeLessThan(NAGESHI.top);
    }
    const rollerBottom =
      SCROLL_HOOK_Y -
      SCROLL.drop -
      SCROLL.height -
      SCROLL_WEIGHT.gap -
      SCROLL_WEIGHT.radius;
    expect(rollerBottom).toBeGreaterThan(WAINSCOT_TOP + 0.01);
  });

  it('hangs the kakejiku on one vertical cord under the lintel', () => {
    const { hook, end, into, ring } = KAKEJIKU_HANGER;
    expect(end[0]).toBe(hook[0]);
    expect(end[2]).toBe(hook[2]);
    expect(end[1]).toBeLessThan(hook[1]);
    const axis = new Vector3(end[0], KAKEJIKU_ROD.y, KAKEJIKU_ROD.z);
    expect(new Vector3(...end).distanceTo(axis)).toBeLessThanOrEqual(
      KAKEJIKU_ROD.radius + 1e-6,
    );
    const eye = screwEye(hook, into, ring);
    expect(KAKEJIKU_ORIGIN_Y + eye.top[1]).toBeLessThan(TOKO_LINTEL_BOTTOM);
    expect(KAKEJIKU_ORIGIN_Y + end[1]).toBeLessThan(TOKO_LINTEL_BOTTOM);
    expect(eye.shank[2]).toBeLessThan(0);
  });

  it('keeps the default screw eye sized like the 茶 sign', () => {
    const eye = screwEye([0, 1, 0]);
    expect(HANG_RING).toBe(0.005);
    expect(eye.top[1]).toBeCloseTo(1.01);
    expect(eye.shank[1]).toBeCloseTo(1.03);
    expect(eye.tube).toBeCloseTo(0.0013);
  });
});
