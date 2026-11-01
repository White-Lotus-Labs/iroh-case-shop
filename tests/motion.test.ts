import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  CameraTravel,
  travelDuration,
  pourPose,
} from '../src/scene/motion/dynamics';
import {
  keepInRoom,
  roomOf,
  SHELF_APPROACH,
  SHELF_FOCUS,
  STATIONS,
  wallBetween,
} from '../src/scene/stations';
import { IROH_DEFAULT_POSITION } from '../src/scene/TeaHost3D';
describe('camera travel', () => {
  it('adapts travel time and settles without a position or velocity discontinuity', () => {
    expect(travelDuration(0.1)).toBeLessThan(travelDuration(5));
    expect(travelDuration(5)).toBeLessThanOrEqual(1.5);
    const move = new CameraTravel(new Vector3(0, 2, 4), new Vector3(0, 1, 0));
    move.retarget(new Vector3(3, 1.8, 0), new Vector3(2, 1, -2));
    move.step(0.24);
    const position = move.position.clone(),
      velocity = move.velocity.clone();
    move.retarget(new Vector3(-0.5, 2, 4), new Vector3(-0.4, 1, -1));
    expect(move.position.distanceTo(position)).toBe(0);
    expect(move.velocity.distanceTo(velocity)).toBe(0);
    move.step(0.00001);
    expect(move.velocity.distanceTo(velocity)).toBeLessThan(0.002);
    for (let i = 0; i < 180; i++) move.step(1 / 60);
    expect(move.position.distanceTo(new Vector3(-0.5, 2, 4))).toBeLessThan(
      1e-8,
    );
    expect(move.velocity.length()).toBe(0);
    expect(move.active).toBe(false);
  });
  it('keeps every station path inside the two rooms and through the doorway', () => {
    for (const a of STATIONS)
      for (const b of STATIONS) {
        const move = new CameraTravel(
          new Vector3(...a.position),
          new Vector3(...a.target),
        );
        move.retarget(new Vector3(...b.position), new Vector3(...b.target));
        for (let i = 0; i < 100; i++) {
          move.step(1 / 60);
          const p = move.position;
          expect(Math.abs(p.x)).toBeLessThan(3.8);
          expect(p.z).toBeGreaterThan(-5.2); // The Shelf station stands near the display but stays clear of the rear wall.
          expect(p.z).toBeLessThan(10.3);
          expect(p.y).toBeGreaterThan(1.4); // Above the counter and tea table.
          if (p.z > 3.28 && p.z < 3.52) {
            expect(Math.abs(p.x)).toBeLessThan(1.12); // Inside the opening.
          }
        }
      }
  });
  it('reduced motion arrives exactly with no remaining motion', () => {
    const move = new CameraTravel(new Vector3(), new Vector3());
    move.retarget(new Vector3(1, 2, 3), new Vector3(0, 1, 0));
    move.finish();
    expect(move.position.toArray()).toEqual([1, 2, 3]);
    expect(move.active).toBe(false);
    expect(move.velocity.length()).toBe(0);
  });
  it('approaches the Shelf without passing through Iroh', () => {
    const shelf = STATIONS.find((station) => station.id === 'Shelf')!;
    const move = new CameraTravel(
      new Vector3(...shelf.position),
      new Vector3(...shelf.target),
    );
    for (const pose of [SHELF_APPROACH, SHELF_FOCUS]) {
      move.retarget(new Vector3(...pose.position), new Vector3(...pose.target));
      for (let i = 0; i < 120; i++) {
        move.step(1 / 60);
        const distanceFromIroh = Math.hypot(
          move.position.x - IROH_DEFAULT_POSITION[0],
          move.position.z - IROH_DEFAULT_POSITION[2],
        );
        expect(distanceFromIroh).toBeGreaterThan(1.15);
      }
    }
  });
  it('frames the focused scroll clear of Iroh', () => {
    const camera = new Vector3(...SHELF_FOCUS.position);
    const toScroll = new Vector3(...SHELF_FOCUS.target).sub(camera);
    const toIroh = new Vector3(...IROH_DEFAULT_POSITION).setY(1.55).sub(camera);
    expect(toScroll.angleTo(toIroh)).toBeGreaterThan(0.55);
  });
  it('fits the full scroll in the Shelf focus with room for viewport controls', () => {
    const distance = new Vector3(...SHELF_FOCUS.position).distanceTo(
      new Vector3(...SHELF_FOCUS.target),
    );
    const visibleHeight = 2 * distance * Math.tan((58 * Math.PI) / 360);
    const scrollHeight = 2.12 * 0.86;
    expect(visibleHeight).toBeGreaterThan(scrollHeight * 1.35);
  });
});
describe('restrained procedural gestures', () => {
  it('stages the pour before the stream and fully returns to rest', () => {
    expect(pourPose(0)).toEqual({ tilt: 0, stream: 0 });
    expect(pourPose(0.08).tilt).toBe(0);
    expect(pourPose(0.5).tilt).toBeGreaterThan(0.2);
    expect(pourPose(0.5).stream).toBeGreaterThan(0);
    expect(pourPose(1.4)).toEqual({ tilt: 0, stream: 0 });
  });
});
it('brakes inherited momentum before an interrupted return overshoots the entrance', () => {
  const shelf = STATIONS.find((s) => s.id === 'Shelf')!,
    entrance = STATIONS[0],
    counter = STATIONS[1];
  const move = new CameraTravel(
    new Vector3(...shelf.position),
    new Vector3(...shelf.target),
  );
  move.retarget(
    new Vector3(...entrance.position),
    new Vector3(...entrance.target),
  );
  move.step(1.05);
  move.retarget(
    new Vector3(...counter.position),
    new Vector3(...counter.target),
  );
  for (let i = 0; i < 120; i++) {
    move.step(1 / 60);
    expect(move.position.z).toBeLessThan(entrance.position[2] + 0.1);
  }
});
describe('free-look bounds', () => {
  it('leaves every station pose where it stands', () => {
    for (const { id, position } of STATIONS) {
      const [x, y, z] = position;
      expect(keepInRoom({ x, y, z }, roomOf(id))).toEqual({ x, y, z });
    }
    for (const {
      position: [x, y, z],
    } of [SHELF_APPROACH, SHELF_FOCUS])
      expect(keepInRoom({ x, y, z }, 'chamber')).toEqual({ x, y, z });
  });
  it('clamps to the walls and leaves props by their nearest open face', () => {
    expect(keepInRoom({ x: 5, y: 1.6, z: 12 }, 'waiting')).toEqual({
      x: 3.7,
      y: 1.6,
      z: 10.9,
    });
    // Off the shelf toward the room, never through the wall behind it.
    expect(keepInRoom({ x: 3.4, y: 1.5, z: -4.5 }, 'chamber').x).toBe(3.05);
    // Just under the counter top: lifted over it.
    expect(keepInRoom({ x: -2, y: 1.4, z: 6 }, 'waiting').y).toBe(1.5);
  });
  it('sees through the doorway but not through the partition', () => {
    expect(wallBetween({ x: 0, y: 1.5, z: 7 }, { x: 0, y: 1.2, z: -2 })).toBe(
      false,
    );
    expect(
      wallBetween({ x: -2.5, y: 1.5, z: 6 }, { x: -2.8, y: 1.3, z: -3 }),
    ).toBe(true);
    expect(wallBetween({ x: 0, y: 1.5, z: -1 }, { x: 2, y: 1.4, z: -4 })).toBe(
      false,
    );
  });
});
