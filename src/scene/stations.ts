import type { Station } from '../shared/contracts';
export const OBSERVATORIUM_URL =
  'https://chains-planetary-system.up.railway.app';

export type Point = [number, number, number];
/** Close camera pose for the planetary model before handing visitors to its live view. */
export const OBSERVATORIUM_FOCUS = {
  position: [-2.33, 1.23, -2.2] as Point,
  target: [-3.28, 0.8, -3.15] as Point,
};

export const STATIONS: {
  id: Station;
  label: string;
  purpose: string;
  position: Point;
  target: Point;
  hotspot: Point;
}[] = [
  {
    id: 'Entrance',
    label: 'Waiting room',
    purpose: 'About the shop',
    position: [0.7, 1.7, 10.15],
    target: [-2.8, 1.25, 6.7],
    hotspot: [0, 0.2, 10.1],
  },
  {
    id: 'Counter',
    label: 'Counter',
    purpose: 'Thesis Desk',
    position: [-1, 1.8, 7.8],
    target: [-1.32, 1.38, 2.82],
    hotspot: [-1.36, 1.5, 6.4],
  },
  {
    id: 'TeaTable',
    label: 'Observatorium',
    purpose: 'Wind the orrery',
    // x stays at -1.2 when the orrery moves: the straight Counter trip must clear the doorway jamb (x ±1.3).
    position: [-1.2, 1.45, -1.4],
    target: [-3.28, 0.8, -3.15],
    hotspot: [-3.28, 1.3, -3.15],
  },
  {
    id: 'AvatarSeat',
    label: 'Host',
    purpose: 'Ask Uncle',
    position: [0.35, 1.48, 0.45],
    target: [1.25, 1.05, -3.55],
    hotspot: [0.74, 0.84, -2.86],
  },
  {
    id: 'Shelf',
    label: 'Shelf',
    purpose: 'Top traders',
    position: [0.4, 1.55, -4.8],
    target: [3.1, 1.45, -4.55],
    hotspot: [3.25, 1.43, -4.55],
  },
];

export const SHELF_APPROACH = {
  position: [1.55, 1.58, -5.1] as Point,
  target: [2.7, 1.43, -4.55] as Point,
};

export const SHELF_FOCUS = {
  position: [0.95, 1.55, -5.1] as Point,
  target: [3.25, 1.43, -4.55] as Point,
};

/** Free look around each station pose: radians of orbit and multiples of the pose distance. */
export const LOOK = {
  azimuth: 0.7,
  polar: 0.35,
  zoomIn: 0.55,
  zoomOut: 1.35,
  /** Pointer travel, in CSS px, after which a press is a drag and not a click. */
  dragPx: 6,
};

/** Window event that flies the camera back to the current station pose. */
export const RECENTER_EVENT = 'tea:recenter';

type Box = { min: Point; max: Point };
/** Where the camera may stand: wall faces less a 0.3 m margin, floor to ceiling. */
const ROOMS = {
  waiting: { min: [-3.7, 0.3, 3.71], max: [3.7, 3.35, 10.9] },
  chamber: { min: [-3.7, 0.3, -5.88], max: [3.7, 3.35, 2.93] },
} satisfies Record<string, Box>;
export type Room = keyof typeof ROOMS;
/** Large props the camera must stay out of, margin included. */
const PROPS: Record<Room, Box[]> = {
  waiting: [
    { min: [-3.95, 0, 5.45], max: [-0.4, 1.5, 6.75] }, // counter
    { min: [-4.1, 0, 3.3], max: [-3.35, 3.0, 5.6] }, // counter shelves
    { min: [-4.0, 0, 8.0], max: [-3.2, 0.75, 10.1] }, // bench
  ],
  chamber: [
    { min: [-1.3, 0, -3.1], max: [1.3, 0.85, -1.65] }, // tea table
    { min: [-0.9, 0, -4.2], max: [0.9, 2.15, -3.1] }, // host
    { min: [-3.45, 0, -3.75], max: [-2.25, 1.6, -2.55] }, // orrery
    { min: [3.05, 0, -6.3], max: [4.1, 3.5, -2.8] }, // shelf
  ],
};
export const roomOf = (station: Station): Room =>
  station === 'Entrance' || station === 'Counter' ? 'waiting' : 'chamber';

type Vec = { x: number; y: number; z: number };
const AXES = ['x', 'y', 'z'] as const;
/** Clamp a camera point into its room, then lift or slide it out of any large prop. Mutates `p`. */
export function keepInRoom<T extends Vec>(point: T, room: Room): T {
  const p: Vec = point,
    r = ROOMS[room];
  AXES.forEach((axis, i) => {
    p[axis] = Math.min(r.max[i], Math.max(r.min[i], p[axis]));
  });
  for (const b of PROPS[room]) {
    if (AXES.some((axis, i) => p[axis] <= b.min[i] || p[axis] >= b.max[i]))
      continue;
    // Leave by the nearest face that is still inside the room; never downward.
    let exit: { axis: (typeof AXES)[number]; value: number } | null = null;
    for (const [i, value] of [
      [0, b.min[0]],
      [0, b.max[0]],
      [2, b.min[2]],
      [2, b.max[2]],
      [1, b.max[1]],
    ] as const) {
      const axis = AXES[i];
      if (value < r.min[i] || value > r.max[i]) continue;
      if (
        !exit ||
        Math.abs(p[axis] - value) < Math.abs(p[exit.axis] - exit.value)
      )
        exit = { axis, value };
    }
    if (exit) p[exit.axis] = exit.value;
  }
  return point;
}

/** The partition doorway: its plane, clear width, and how high a sightline may pass. */
export const DOORWAY = { z: 3.32, width: 2.6, height: 2.38 };
/** True when the partition wall, not its doorway, blocks the segment from `a` to `b`. */
export function wallBetween(a: Vec, b: Vec) {
  if (a.z > DOORWAY.z === b.z > DOORWAY.z) return false;
  const t = (DOORWAY.z - a.z) / (b.z - a.z),
    x = a.x + (b.x - a.x) * t,
    y = a.y + (b.y - a.y) * t;
  return Math.abs(x) > DOORWAY.width / 2 || y < 0 || y > DOORWAY.height;
}
