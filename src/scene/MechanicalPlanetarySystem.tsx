import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  Texture,
  TorusGeometry,
  Vector2,
} from 'three';
import { ContactShadows, useTexture } from '@react-three/drei';
import { damp } from './motion/dynamics';
import type { Point } from './stations';
import { useCanvasTexture, useSurfaceMaps } from './Surfaces';
import { merge, paint, place, useBuilt } from './props/craft';

const WOOD_NORMAL_SCALE = new Vector2(0.45, 0.45);
const PLANET_NORMAL_SCALE = new Vector2(0.22, 0.22);

export const POSITION: Point = [-3.28, 0, -3.15];
export const SCALE = 1.55;
/** Height of the wooden display table. */
export const STAND_Y = 0.38;
/** Additional elevation of the orrery base above the table to clear rotating crank handle. */
const BASE_Y = 0.036;
/** Crank drive axle height in the pedestal frame. */
export const CRANK_AXLE_Y = 0.032 + BASE_Y;
/** Keep the winding handle visibly clear of the plinth and its trim rings. */
export const CRANK_HANDLE_X = 0.212;
const CRANK_ARBOR_INNER_X = 0.022;
const CRANK_ARBOR_LENGTH = CRANK_HANDLE_X - CRANK_ARBOR_INNER_X;
const CRANK_ARBOR_CENTER_X = CRANK_ARBOR_INNER_X + CRANK_ARBOR_LENGTH / 2;
/** The plinth has a deliberately restrained trim: one ring at each outer edge. */
export const BASE_TRIM_RINGS = [
  { radius: 0.175, tube: 0.003, y: 0.022 },
  { radius: 0.136, tube: 0.0028, y: 0.053 + BASE_Y },
] as const;
/** The sun sits at this height in the pedestal frame, defining the common ecliptic plane. */
export const SUN_Y = 0.329 + BASE_Y;
export const SUN_RADIUS = 0.035;
/** Inner and outer radius of Saturn's rings. */
export const SATURN_RINGS = [0.024, 0.048] as const;

/** Spindle collar mounting heights along the central column. */
export const ARM_HEIGHTS = {
  mercury: 0.138 + BASE_Y,
  venus: 0.16 + BASE_Y,
  earth: 0.184 + BASE_Y,
  mars: 0.208 + BASE_Y,
  jupiter: 0.232 + BASE_Y,
  saturn: 0.256 + BASE_Y,
} as const;

const BRASS = '#ffffff';
const BRONZE = '#b08b52';
const BRASS_METALNESS = 0.64;
const BRASS_ROUGHNESS = 0.42;
const BRASS_ENV_INTENSITY = 1.2;
/** Quarter turn about x: lays a torus or ring flat around the vertical axis. */
const FLAT: Point = [Math.PI / 2, 0, 0];
const ACROSS: Point = [0, 0, Math.PI / 2];

/** Base orbital angular velocities (rad/s scaled). Maintains astronomical hierarchy. */
export const ORBITAL_SPEEDS = {
  mercury: 1.95,
  venus: 0.98,
  earth: 0.62,
  mars: 0.38,
  jupiter: 0.18,
  saturn: 0.09,
};

/** Orbital eccentricities (e) for Keplerian velocity modulation. */
export const ECCENTRICITIES = {
  mercury: 0.2056,
  venus: 0.0068,
  earth: 0.0167,
  mars: 0.0934,
  jupiter: 0.0484,
  saturn: 0.0542,
};

/** Tooth counts of the clockwork train. */
export const TEETH = {
  drive: 28,
  pinion1: 14,
  pinion1Upper: 12,
  pinion2: 11,
  intermediate: 35,
} as const;

/** Clockwork angular speeds at nominal wind; the pinions counter-rotate. */
export const TRAIN_SPEEDS = {
  drive: 0.62,
  pinion1: 1.24,
  pinion2: 1.58,
  intermediate: 1.24 * (12 / 35),
};

/** A click winds the spring to `burst` times nominal speed; it damps back at `rate`. */
export const WIND_UP = { burst: 4.8, rate: 1.35 };

/** Galilean moon speeds around Jupiter exhibiting Laplace resonance (4:2:1). */
export const LAPLACE_RESONANCE = {
  io: 4.8,
  europa: 2.4,
  ganymede: 1.2,
};

/**
 * Calculates instantaneous angular velocity for an eccentric Keplerian orbit.
 * By conservation of angular momentum: dθ/dt ≈ ω0 * (1 + 2e * cos(θ)), accelerating at
 * perihelion (θ=0) and lingering at aphelion (θ=π). Averaged over angle it is ω0, but the
 * period stretches by 1/√(1 − 4e²): about 10% for Mercury, under 2% for the others.
 */
export function keplerianVelocity(
  nominalSpeed: number,
  eccentricity: number,
  theta: number,
): number {
  return nominalSpeed * (1 + 2 * eccentricity * Math.cos(theta));
}

// One context for every click: browsers cap how many a page may hold open.
let windAudio: AudioContext | null = null;

/** WebAudio ratchet click synthesis for tactile wind-up feedback. */
function playOrreryWindSound() {
  if (typeof window === 'undefined') return;
  try {
    if (!windAudio) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      windAudio = new AudioCtx();
    }
    const ctx = windAudio;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const t = now + i * 0.045;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1750 - i * 110, t);
      osc.frequency.exponentialRampToValueAtTime(380, t + 0.022);
      gain.gain.setValueAtTime(0.045, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.024);
    }
  } catch {
    // Gracefully ignore when browser policy blocks audio before user interaction
  }
}

/** A gear: a solid disc with its perimeter teeth, as one geometry. */
function cogGeometry(radius: number, teeth: number, thickness: number) {
  const toothDepth = 0.007,
    toothWidth = 0.005;
  return merge([
    new CylinderGeometry(radius, radius, thickness, Math.max(24, teeth)),
    ...Array.from({ length: teeth }, (_, i) => {
      const angle = (i / teeth) * Math.PI * 2,
        r = radius + toothDepth * 0.25;
      return place(
        new BoxGeometry(toothWidth, thickness, toothDepth),
        [Math.cos(angle) * r, 0, Math.sin(angle) * r],
        [0, -angle, 0],
      );
    }),
  ]);
}

/** A 45° bevel miter gear for translating crank horizontal rotation to vertical spindle. */
function bevelGearGeometry(radius: number, teeth: number, height: number) {
  const toothDepth = 0.005,
    toothWidth = 0.0035;
  return merge([
    new CylinderGeometry(radius * 0.75, radius, height, Math.max(16, teeth)),
    ...Array.from({ length: teeth }, (_, i) => {
      const angle = (i / teeth) * Math.PI * 2,
        r = radius + toothDepth * 0.2;
      return place(
        new BoxGeometry(toothWidth, height, toothDepth),
        [Math.cos(angle) * r, 0, Math.sin(angle) * r],
        [0.4, -angle, 0],
      );
    }),
  ]);
}

/** Tellurion dual-hemisphere Moon sphere: half illuminated pearl, half blackened bronze. */
function moonGlobeGeometry(radius: number) {
  const geom = new SphereGeometry(radius, 16, 12);
  const count = geom.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const pos = geom.attributes.position;
  const bright = new Color('#f4f2ea');
  const dark = new Color('#26201a');
  for (let i = 0; i < count; i++) {
    const c = pos.getX(i) >= 0 ? bright : dark;
    c.toArray(colors, i * 3);
  }
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  return geom;
}

function Cog({
  radius,
  teeth,
  thickness,
  color = '#ffffff',
  map,
}: {
  radius: number;
  teeth: number;
  thickness: number;
  color?: string;
  map?: Texture;
}) {
  const geometry = useBuilt(() => cogGeometry(radius, teeth, thickness));
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        map={map}
        metalness={BRASS_METALNESS}
        roughness={BRASS_ROUGHNESS}
        envMapIntensity={BRASS_ENV_INTENSITY}
      />
    </mesh>
  );
}

type Arm = {
  collar: number;
  sleeve: [radius: number, length: number];
  rod: [radius: number, length: number];
  weight: [x: number, radius: number];
  riser: [radius: number, length: number];
};

/** Collar, coaxial sleeve, cranked rod, counterweight and riser of one planet arm. */
function armParts({ collar, sleeve, rod, weight, riser }: Arm) {
  return [
    paint(new CylinderGeometry(collar, collar, 0.012, 20), BRASS),
    // Concentric telescoping sleeve extending downward from the collar
    paint(
      place(new CylinderGeometry(sleeve[0], sleeve[0], sleeve[1], 20), [
        0,
        -sleeve[1] / 2 - 0.006,
        0,
      ]),
      BRASS,
    ),
    paint(
      place(
        new CylinderGeometry(rod[0], rod[0], rod[1], 8),
        [rod[1] / 2, 0, 0],
        ACROSS,
      ),
      BRASS,
    ),
    paint(
      place(new SphereGeometry(weight[1], 12, 10), [weight[0], 0, 0]),
      BRONZE,
    ),
    paint(
      place(new CylinderGeometry(riser[0], riser[0], riser[1], 8), [
        rod[1],
        riser[1] / 2,
        0,
      ]),
      BRASS,
    ),
  ];
}

export const ARMS = {
  mercury: {
    collar: 0.021,
    sleeve: [0.0185, 0.022],
    rod: [0.0018, 0.068],
    weight: [-0.022, 0.0055],
    riser: [0.0016, 0.191], // 0.138 + 0.191 = 0.329 (SUN_Y)
  },
  venus: {
    collar: 0.0205,
    sleeve: [0.0175, 0.022],
    rod: [0.002, 0.104],
    weight: [-0.026, 0.0065],
    riser: [0.0018, 0.169], // 0.160 + 0.169 = 0.329 (SUN_Y)
  },
  earth: {
    collar: 0.02,
    sleeve: [0.0165, 0.024],
    rod: [0.0022, 0.148],
    weight: [-0.032, 0.0075],
    riser: [0.002, 0.145], // 0.184 + 0.145 = 0.329 (SUN_Y)
  },
  mars: {
    collar: 0.0195,
    sleeve: [0.0155, 0.024],
    rod: [0.0022, 0.194],
    weight: [-0.038, 0.008],
    riser: [0.0018, 0.121], // 0.208 + 0.121 = 0.329 (SUN_Y)
  },
  jupiter: {
    collar: 0.019,
    sleeve: [0.0145, 0.024],
    rod: [0.0025, 0.244],
    weight: [-0.046, 0.0095],
    riser: [0.0022, 0.097], // 0.232 + 0.097 = 0.329 (SUN_Y)
  },
  saturn: {
    collar: 0.0185,
    sleeve: [0.0135, 0.024],
    rod: [0.0026, 0.298],
    weight: [-0.052, 0.0105],
    riser: [0.0024, 0.073], // 0.256 + 0.073 = 0.329 (SUN_Y)
  },
} satisfies Record<string, Arm>;

/**
 * Every static part in the pedestal frame, merged by material: brass and bronze share one
 * vertex-coloured metal mesh. Moving parts get one metal mesh per rotating group.
 */
function buildOrrery() {
  const metal: BufferGeometry[] = [],
    gold: BufferGeometry[] = [],
    wood: BufferGeometry[] = [];
  const brass = (g: BufferGeometry, p: Point, r?: Point) =>
    metal.push(paint(place(g, p, r), BRASS));
  const bronze = (g: BufferGeometry, p: Point, r?: Point) =>
    metal.push(paint(place(g, p, r), BRONZE));
  const shine = (g: BufferGeometry, p: Point, r?: Point) =>
    gold.push(place(g, p, r));
  const timber = (g: BufferGeometry, p: Point) => wood.push(place(g, p));

  // Small simple wooden display table (daiza), supporting the orrery on its tabletop
  // Tabletop slab and beveled sub-rim
  timber(new BoxGeometry(0.39, 0.018, 0.39), [0, -0.009, 0]);
  timber(new BoxGeometry(0.375, 0.008, 0.375), [0, -0.022, 0]);

  // Apron rails (maku-ita)
  timber(new BoxGeometry(0.3, 0.028, 0.014), [0, -0.04, 0.15]);
  timber(new BoxGeometry(0.3, 0.028, 0.014), [0, -0.04, -0.15]);
  timber(new BoxGeometry(0.014, 0.028, 0.272), [0.15, -0.04, 0]);
  timber(new BoxGeometry(0.014, 0.028, 0.272), [-0.15, -0.04, 0]);

  // 4 square wooden legs with brass ferrule feet at the tatami floor
  for (const lx of [-0.15, 0.15]) {
    for (const lz of [-0.15, 0.15]) {
      timber(new BoxGeometry(0.022, 0.34, 0.022), [lx, -0.196, lz]);
      brass(new BoxGeometry(0.024, 0.014, 0.024), [lx, -0.373, lz]);
    }
  }

  // Lower stretchers (nuki)
  timber(new BoxGeometry(0.28, 0.012, 0.012), [0, -0.32, 0.15]);
  timber(new BoxGeometry(0.28, 0.012, 0.012), [0, -0.32, -0.15]);
  timber(new BoxGeometry(0.012, 0.012, 0.276), [0.15, -0.32, 0]);
  timber(new BoxGeometry(0.012, 0.012, 0.276), [-0.15, -0.32, 0]);

  // One uninterrupted taper makes the plinth read as a single turned wooden base.
  // The only breaks in its silhouette are the deliberate bottom and top trim rings.
  timber(new CylinderGeometry(0.138, 0.182, 0.089, 36), [0, 0.0445, 0]);
  brass(
    new TorusGeometry(
      BASE_TRIM_RINGS[0].radius,
      BASE_TRIM_RINGS[0].tube,
      12,
      36,
    ),
    [0, BASE_TRIM_RINGS[0].y, 0],
    FLAT,
  );

  brass(
    new TorusGeometry(
      BASE_TRIM_RINGS[1].radius,
      BASE_TRIM_RINGS[1].tube,
      12,
      36,
    ),
    [0, BASE_TRIM_RINGS[1].y, 0],
    FLAT,
  );
  brass(new CylinderGeometry(0.132, 0.132, 0.003, 44), [0, 0.0545 + BASE_Y, 0]);

  // 4 Cardinal Solstice & Equinox diamond indicators at the dial plate rim
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    shine(
      new ConeGeometry(0.0028, 0.0055, 4),
      [Math.cos(angle) * 0.088, 0.0568 + BASE_Y, Math.sin(angle) * 0.088],
      FLAT,
    );
  }

  // Spindle column and stationary inner axle (which concentric sleeves wrap around)
  brass(new CylinderGeometry(0.028, 0.042, 0.028, 20), [0, 0.07 + BASE_Y, 0]);
  shine(new TorusGeometry(0.026, 0.0035, 12, 20), [0, 0.086 + BASE_Y, 0], FLAT);
  brass(new CylinderGeometry(0.011, 0.012, 0.22, 20), [0, 0.196 + BASE_Y, 0]);
  shine(new CylinderGeometry(0.025, 0.018, 0.018, 20), [0, 0.271 + BASE_Y, 0]);

  // Pinion axles aligned with exact gear pitch circle centers
  brass(new CylinderGeometry(0.004, 0.004, 0.076, 12), [
    -0.0861,
    0.096 + BASE_Y,
    0.0351,
  ]);
  brass(new SphereGeometry(0.0055, 12, 10), [-0.0861, 0.134 + BASE_Y, 0.0351]);
  brass(new CylinderGeometry(0.004, 0.004, 0.076, 12), [
    0.0735,
    0.096 + BASE_Y,
    -0.0454,
  ]);
  brass(new SphereGeometry(0.0055, 12, 10), [0.0735, 0.134 + BASE_Y, -0.0454]);

  // Horizontal drive arbor extending from crank through the bearing boss into the central bevel gear
  brass(
    new CylinderGeometry(0.012, 0.015, 0.014, 16),
    [0.144, CRANK_AXLE_Y, 0],
    ACROSS,
  );
  brass(
    new CylinderGeometry(0.0035, 0.0035, CRANK_ARBOR_LENGTH, 14),
    [CRANK_ARBOR_CENTER_X, CRANK_AXLE_Y, 0],
    ACROSS,
  );
  // Vertical drive arbor translating bevel rotation upward to the main gear
  brass(new CylinderGeometry(0.0042, 0.0042, 0.052, 12), [
    0,
    0.062 + BASE_Y,
    0,
  ]);

  // Sun collar pedestal seat
  shine(new CylinderGeometry(0.016, 0.022, 0.024, 20), [0, 0.29 + BASE_Y, 0]);

  // Plaque backing on the plinth front with bronze corner rivets
  brass(
    new BoxGeometry(0.072, 0.018, 0.003),
    [0, 0.022 + BASE_Y, 0.166],
    [0.32, 0, 0],
  );
  for (const [rx, ry] of [
    [-0.031, -0.0055],
    [0.031, -0.0055],
    [-0.031, 0.0055],
    [0.031, 0.0055],
  ]) {
    bronze(new SphereGeometry(0.0018, 10, 8), [
      rx,
      0.022 + BASE_Y + ry * 0.95,
      0.166 - ry * 0.31,
    ]);
  }

  // Rotating parts, each in its own group's frame
  const gimbal: Point = [0.41, 0, 0];
  const earthAt: Point = [0.148, 0.145, 0];
  const parts = {
    metal: merge(metal),
    gold: merge(gold),
    wood: merge(wood),
    crank: merge([
      // Hub collar fitting onto the axle
      paint(
        place(
          new CylinderGeometry(0.0075, 0.0075, 0.006, 16),
          [0.003, 0, 0],
          ACROSS,
        ),
        BRASS,
      ),
      // Central brass hub dome screw
      paint(place(new SphereGeometry(0.005, 12, 10), [0.006, 0, 0]), BRASS),
      // Crank lever arm in Y-Z plane
      paint(
        place(new BoxGeometry(0.0045, 0.042, 0.0075), [0.003, 0.019, 0]),
        BRASS,
      ),
      // Boss / eyelet at the handle mount
      paint(
        place(
          new CylinderGeometry(0.0065, 0.0065, 0.005, 14),
          [0.003, 0.038, 0],
          ACROSS,
        ),
        BRASS,
      ),
      // Inner brass collar/washer for handle pin
      paint(
        place(
          new CylinderGeometry(0.0055, 0.0055, 0.0025, 14),
          [0.0065, 0.038, 0],
          ACROSS,
        ),
        BRASS,
      ),
      // Brass handle center pin
      paint(
        place(
          new CylinderGeometry(0.0022, 0.0022, 0.028, 12),
          [0.019, 0.038, 0],
          ACROSS,
        ),
        BRASS,
      ),
      // Brass end cap / retention nut at tip of handle
      paint(
        place(new SphereGeometry(0.0042, 12, 10), [0.033, 0.038, 0]),
        BRASS,
      ),
    ]),
    mercury: merge(armParts(ARMS.mercury)),
    venus: merge(armParts(ARMS.venus)),
    earth: merge([
      ...armParts(ARMS.earth),
      paint(
        place(new TorusGeometry(0.021, 0.0018, 10, 28), earthAt, gimbal),
        BRASS,
      ),
      paint(
        place(new CylinderGeometry(0.0012, 0.0012, 0.046, 8), earthAt, gimbal),
        BRASS,
      ),
    ]),
    moon: merge([
      paint(new CylinderGeometry(0.006, 0.006, 0.003, 12), BRASS),
      paint(
        place(
          new CylinderGeometry(0.001, 0.001, 0.032, 6),
          [0.016, 0, 0],
          ACROSS,
        ),
        BRASS,
      ),
    ]),
    moonGlobe: moonGlobeGeometry(0.0048),
    mars: merge(armParts(ARMS.mars)),
    jupiter: merge(armParts(ARMS.jupiter)),
    saturn: merge(armParts(ARMS.saturn)),
    saturnRings: place(
      new RingGeometry(SATURN_RINGS[0], SATURN_RINGS[1], 48),
      [0, 0, 0],
      [-Math.PI / 2, 0, 0],
    ),
    bevelGear: bevelGearGeometry(0.012, 12, 0.007),
    matingBevelGear: bevelGearGeometry(0.012, 12, 0.007),
  };
  return {
    ...parts,
    dispose() {
      Object.values(parts).forEach((geometry) => geometry.dispose());
    },
  };
}

/** 1. Astrological & Calendar Dial Plate: 360° graduations, 12 Zodiac signs, 12 months, and cardinals. */
function drawDialPlate(ctx: CanvasRenderingContext2D) {
  const cx = 256,
    cy = 256;
  const bg = ctx.createRadialGradient(cx, cy, 170, cx, cy, 256);
  bg.addColorStop(0, '#caa758');
  bg.addColorStop(0.5, '#ba9548');
  bg.addColorStop(1, '#a68037');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, 256, 0, Math.PI * 2);
  ctx.fill();

  // Subtle circular lathe machining marks
  ctx.strokeStyle = 'rgba(70, 48, 20, 0.12)';
  ctx.lineWidth = 1;
  for (let r = 182; r < 254; r += 3) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Major concentric track division rings
  const rings = [180, 202, 226, 244, 254];
  ctx.strokeStyle = '#321f0c';
  ctx.lineWidth = 1.6;
  for (const r of rings) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Track 1: Outer Ecliptic 360° degree graduations (r: 244 -> 254)
  ctx.strokeStyle = '#2b190a';
  for (let deg = 0; deg < 360; deg++) {
    const rad = (deg * Math.PI) / 180;
    const is30 = deg % 30 === 0;
    const is10 = deg % 10 === 0;
    const is5 = deg % 5 === 0;
    const len = is30 ? 10 : is10 ? 8 : is5 ? 6 : 4;
    ctx.lineWidth = is30 ? 1.4 : is10 ? 1.0 : 0.6;
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(rad) * (254 - len),
      cy + Math.sin(rad) * (254 - len),
    );
    ctx.lineTo(cx + Math.cos(rad) * 254, cy + Math.sin(rad) * 254);
    ctx.stroke();
  }

  // Track 2: 12 Calendar Months (r: 226 -> 244)
  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  ctx.font = 'bold 9px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#241407';

  for (let m = 0; m < 12; m++) {
    const angleStart = (m * Math.PI) / 6;
    const angleMid = angleStart + Math.PI / 12;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#321f0c';
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(angleStart) * 226,
      cy + Math.sin(angleStart) * 226,
    );
    ctx.lineTo(
      cx + Math.cos(angleStart) * 244,
      cy + Math.sin(angleStart) * 244,
    );
    ctx.stroke();

    ctx.save();
    ctx.translate(cx + Math.cos(angleMid) * 235, cy + Math.sin(angleMid) * 235);
    ctx.rotate(angleMid + Math.PI / 2);
    ctx.fillText(months[m], 0, 0);
    ctx.restore();

    for (let d = 1; d < 3; d++) {
      const a = angleStart + (d * Math.PI) / 18;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 238, cy + Math.sin(a) * 238);
      ctx.lineTo(cx + Math.cos(a) * 244, cy + Math.sin(a) * 244);
      ctx.stroke();
    }
  }

  // Track 3: 12 Zodiac Constellations (r: 202 -> 226)
  const zodiac = [
    'ARIES',
    'TAURUS',
    'GEMINI',
    'CANCER',
    'LEO',
    'VIRGO',
    'LIBRA',
    'SCORPIO',
    'SAGITT',
    'CAPRIC',
    'AQUAR',
    'PISCES',
  ];
  ctx.font = '8px serif';
  for (let z = 0; z < 12; z++) {
    const angleStart = (z * Math.PI) / 6;
    const angleMid = angleStart + Math.PI / 12;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#321f0c';
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(angleStart) * 202,
      cy + Math.sin(angleStart) * 202,
    );
    ctx.lineTo(
      cx + Math.cos(angleStart) * 226,
      cy + Math.sin(angleStart) * 226,
    );
    ctx.stroke();

    ctx.save();
    ctx.translate(cx + Math.cos(angleMid) * 214, cy + Math.sin(angleMid) * 214);
    ctx.rotate(angleMid + Math.PI / 2);
    ctx.fillText(zodiac[z], 0, 0);
    ctx.restore();
  }

  // Track 4: Cardinal Equinoxes and Solstices (r: 180 -> 202)
  const cardinals = ['VERNAL EQ', 'SUMMER SOLST', 'AUTUMN EQ', 'WINTER SOLST'];
  ctx.font = 'italic bold 7.5px serif';
  for (let q = 0; q < 4; q++) {
    const angleMid = (q * Math.PI) / 2 + Math.PI / 4;
    ctx.save();
    ctx.translate(cx + Math.cos(angleMid) * 191, cy + Math.sin(angleMid) * 191);
    ctx.rotate(angleMid + Math.PI / 2);
    ctx.fillText(cardinals[q], 0, 0);
    ctx.restore();
  }
}

/** 2. Celestial Brass Sun Globe: burnished brass, celestial meridians, tropics and active sunspots. */
function drawSun(ctx: CanvasRenderingContext2D) {
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#cca552');
  grad.addColorStop(0.5, '#dab562');
  grad.addColorStop(1, '#cca552');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = 'rgba(85, 60, 20, 0.35)';
  ctx.lineWidth = 1;
  [64, 128, 192].forEach((y) => {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  });
  for (let x = 0; x < 512; x += 42.66) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }

  ctx.fillStyle = '#3a250a';
  for (const [sx, sy] of [
    [180, 105],
    [192, 108],
    [340, 145],
    [352, 142],
  ]) {
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 3. Tellurion Earth Globe: lapis oceans, hand-painted continents with coastlines, and polar ice. */
function drawEarth(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#1e4868';
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = 'rgba(80, 130, 175, 0.22)';
  ctx.lineWidth = 0.8;
  for (let y = 32; y < 256; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  for (let x = 0; x < 512; x += 42.66) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(220, 185, 115, 0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(512, 128);
  ctx.stroke();

  ctx.fillStyle = '#5c7855';
  ctx.strokeStyle = '#324630';
  ctx.lineWidth = 1.4;

  // North America
  ctx.beginPath();
  ctx.moveTo(60, 48);
  ctx.lineTo(135, 45);
  ctx.lineTo(150, 75);
  ctx.lineTo(135, 110);
  ctx.lineTo(105, 125);
  ctx.lineTo(95, 142);
  ctx.lineTo(82, 125);
  ctx.lineTo(55, 95);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // South America
  ctx.beginPath();
  ctx.moveTo(105, 145);
  ctx.lineTo(142, 160);
  ctx.lineTo(152, 185);
  ctx.lineTo(125, 222);
  ctx.lineTo(112, 225);
  ctx.lineTo(100, 180);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Eurasia
  ctx.beginPath();
  ctx.moveTo(235, 52);
  ctx.lineTo(320, 42);
  ctx.lineTo(415, 55);
  ctx.lineTo(440, 90);
  ctx.lineTo(395, 118);
  ctx.lineTo(355, 130);
  ctx.lineTo(335, 110);
  ctx.lineTo(290, 105);
  ctx.lineTo(260, 95);
  ctx.lineTo(235, 75);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Africa
  ctx.beginPath();
  ctx.moveTo(255, 105);
  ctx.lineTo(295, 110);
  ctx.lineTo(315, 140);
  ctx.lineTo(290, 195);
  ctx.lineTo(270, 190);
  ctx.lineTo(245, 145);
  ctx.lineTo(245, 115);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Australia
  ctx.beginPath();
  ctx.ellipse(392, 185, 32, 22, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Polar ice caps
  ctx.fillStyle = '#dbe1e8';
  ctx.fillRect(0, 0, 512, 16);
  ctx.fillRect(0, 240, 512, 16);
}

/** 4. Jovian Atmosphere: equatorial zones, turbulent cloud belts, and Great Red Spot. */
function drawJupiter(ctx: CanvasRenderingContext2D) {
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#8c7653');
  grad.addColorStop(0.2, '#cba972');
  grad.addColorStop(0.5, '#e5cca0');
  grad.addColorStop(0.8, '#cba972');
  grad.addColorStop(1, '#8c7653');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  const drawBand = (
    y0: number,
    h: number,
    col: string,
    amp: number,
    freq: number,
  ) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    for (let x = 0; x <= 512; x += 8) {
      const y = y0 + Math.sin((x * freq * Math.PI) / 180) * amp;
      ctx.lineTo(x, y);
    }
    for (let x = 512; x >= 0; x -= 8) {
      const y = y0 + h + Math.sin(((x + 40) * freq * Math.PI) / 180) * amp;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };

  drawBand(58, 18, '#935832', 2.5, 4);
  drawBand(90, 26, '#9c4322', 3.2, 5);
  drawBand(138, 28, '#a44220', 3.5, 5);
  drawBand(180, 16, '#8a5530', 2.0, 3);

  // Great Red Spot
  const spotX = 350,
    spotY = 152;
  ctx.fillStyle = '#b03c1c';
  ctx.beginPath();
  ctx.ellipse(spotX, spotY, 26, 14, -0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ca522c';
  ctx.beginPath();
  ctx.ellipse(spotX, spotY, 16, 8, -0.05, 0, Math.PI * 2);
  ctx.fill();
}

/** 5. Saturn Atmosphere: warm amber-ochre latitudinal banding. */
function drawSaturn(ctx: CanvasRenderingContext2D) {
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#887a5c');
  grad.addColorStop(0.3, '#c9ad6f');
  grad.addColorStop(0.5, '#e4caa0');
  grad.addColorStop(0.7, '#caa96a');
  grad.addColorStop(1, '#85785a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);

  ctx.fillStyle = 'rgba(130, 95, 45, 0.28)';
  ctx.fillRect(0, 38, 256, 12);
  ctx.fillRect(0, 78, 256, 10);
}

/** 6. Saturn Rings: bright B-ring, transparent Cassini Division gap, outer A-ring, and inner crepe C-ring. */
function drawSaturnRings(ctx: CanvasRenderingContext2D) {
  const cx = 128,
    cy = 128;
  ctx.clearRect(0, 0, 256, 256);

  // Inner Crepe Ring C: r: 66 -> 76
  for (let r = 66; r <= 76; r++) {
    ctx.strokeStyle = 'rgba(110, 92, 68, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Dense Golden B Ring: r: 77 -> 102
  for (let r = 77; r <= 102; r++) {
    const tone = r % 4 === 0 ? '#caa665' : '#e0c382';
    ctx.strokeStyle = tone;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Cassini Division gap: r: 103 -> 108 (transparent gap)

  // Outer A Ring: r: 109 -> 126
  for (let r = 109; r <= 126; r++) {
    if (r === 120) continue;
    const tone = r % 3 === 0 ? '#bda062' : '#d2b678';
    ctx.strokeStyle = tone;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 7. Martian Regolith: terracotta base with Syrtis Major albedo markings and polar ice. */
function drawMars(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#b74b28';
  ctx.fillRect(0, 0, 256, 128);

  ctx.fillStyle = '#5c2a1a';
  ctx.beginPath();
  ctx.moveTo(85, 45);
  ctx.lineTo(122, 35);
  ctx.lineTo(135, 68);
  ctx.lineTo(102, 75);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(140, 85, 75, 18, 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#dbe1ec';
  ctx.beginPath();
  ctx.ellipse(128, 6, 45, 12, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 8. Venusian Enamel: soft creamy ochre with atmospheric cloud chevron wisps. */
function drawVenus(ctx: CanvasRenderingContext2D) {
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#ebd4a4');
  grad.addColorStop(0.5, '#f5e3ba');
  grad.addColorStop(1, '#ebd4a4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);

  ctx.strokeStyle = 'rgba(255, 248, 235, 0.45)';
  ctx.lineWidth = 6;
  for (let x = -60; x < 320; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 20);
    ctx.lineTo(x + 30, 64);
    ctx.lineTo(x, 108);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(180, 145, 95, 0.18)';
  ctx.lineWidth = 4;
  for (let x = -40; x < 320; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 25);
    ctx.lineTo(x + 25, 64);
    ctx.lineTo(x, 103);
    ctx.stroke();
  }
}

/** 9. Mercurian Basalt: dark cratered terrain with impact ray stippling. */
function drawMercury(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#6c6760';
  ctx.fillRect(0, 0, 256, 128);

  ctx.fillStyle = '#4c4740';
  ctx.beginPath();
  ctx.ellipse(80, 60, 45, 25, 0.2, 0, Math.PI * 2);
  ctx.ellipse(190, 75, 40, 20, -0.3, 0, Math.PI * 2);
  ctx.fill();

  for (const [cx, cy, r] of [
    [65, 45, 12],
    [115, 80, 8],
    [160, 40, 14],
    [210, 85, 10],
    [130, 30, 6],
    [180, 95, 7],
  ]) {
    ctx.strokeStyle = '#8e8880';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#58524b';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 10. Front Nameplate Plaque: brushed brass with engraved borders and serif typography. */
function drawPlaque(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#d1af5e';
  ctx.fillRect(0, 0, 256, 64);

  ctx.strokeStyle = 'rgba(75, 52, 20, 0.12)';
  for (let y = 3; y < 61; y += 2) {
    ctx.beginPath();
    ctx.moveTo(4, y);
    ctx.lineTo(252, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#2e1c0a';
  ctx.lineWidth = 1.8;
  ctx.strokeRect(5, 5, 246, 54);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(8, 8, 240, 48);

  ctx.fillStyle = '#2e1c0a';
  for (const [cx, cy] of [
    [8, 8],
    [248, 8],
    [8, 56],
    [248, 56],
  ]) {
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#261608';
  ctx.font = 'bold 15px serif';
  ctx.fillText('WHITE  LOTUS', 128, 24);
  ctx.font = '10px serif';
  ctx.fillText('ORRERY  ·  1888', 128, 44);
}

/** The sun's light stub, mounted with the room's lights so the light count never changes. */
export function OrreryLight() {
  return (
    <pointLight
      position={[POSITION[0], (STAND_Y + SUN_Y) * SCALE, POSITION[2]]}
      intensity={0}
      distance={0}
    />
  );
}

/**
 * A museum-grade mechanical planetary system (orrery) on a tripod floor stand, for Uncle
 * Iroh's tea room. Clicking winds it up; the arms, gears, crank and globes keep turning.
 */
export function MechanicalPlanetarySystem({
  reduced = false,
}: {
  reduced?: boolean;
}) {
  const speedRef = useRef(1);
  const [hovered, setHovered] = useState(false);

  const crankRef = useRef<Group>(null);
  const crankBevelRef = useRef<Group>(null);
  const verticalBevelRef = useRef<Group>(null);
  const driveGearRef = useRef<Group>(null);
  const pinion1Ref = useRef<Group>(null);
  const pinion2Ref = useRef<Group>(null);
  const intermediateGearRef = useRef<Group>(null);

  const mercuryArmRef = useRef<Group>(null);
  const venusArmRef = useRef<Group>(null);
  const venusGlobeRef = useRef<Group>(null);
  const earthArmRef = useRef<Group>(null);
  const earthGlobeRef = useRef<Mesh>(null);
  const moonSubArmRef = useRef<Group>(null);
  const moonGlobeRef = useRef<Mesh>(null);
  const marsArmRef = useRef<Group>(null);
  const marsGlobeRef = useRef<Mesh>(null);
  const jupiterArmRef = useRef<Group>(null);
  const jupiterGlobeRef = useRef<Group>(null);
  const ioMoonRef = useRef<Group>(null);
  const europaMoonRef = useRef<Group>(null);
  const ganymedeMoonRef = useRef<Group>(null);
  const callistoMoonRef = useRef<Group>(null);
  const saturnArmRef = useRef<Group>(null);
  const saturnGlobeRef = useRef<Mesh>(null);
  const sunGlobeRef = useRef<Mesh>(null);

  const angles = useRef({
    mercury: 0.8,
    venus: 2.1,
    earth: 3.5,
    moon: 0.2,
    mars: 1.2,
    jupiter: 4.8,
    saturn: 0.4,
    sun: 0,
    crank: 0,
    driveGear: 0,
    pinion1: 0,
    pinion2: 0,
    intermediateGear: 0,
    earthSpin: 0,
    marsSpin: 0,
    jupiterSpin: 0,
    saturnSpin: 0,
    venusSpin: 0,
    ioMoon: 0,
    europaMoon: 1.5,
    ganymedeMoon: 3.0,
    callistoMoon: 4.2,
  });

  const onWindUp = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (reduced) return;
    playOrreryWindSound();
    // Spring tension release: a burst that damps back to the nominal speed.
    speedRef.current = WIND_UP.burst;
  };

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const targetSpeed = reduced ? 0.06 : 1.0;
    speedRef.current = damp(speedRef.current, targetSpeed, WIND_UP.rate, dt);
    const s = speedRef.current;
    const a = angles.current;

    // Keplerian orbital dynamics: instantaneous speed modulates with eccentricity
    a.mercury +=
      dt *
      keplerianVelocity(
        ORBITAL_SPEEDS.mercury,
        ECCENTRICITIES.mercury,
        a.mercury,
      ) *
      s;
    a.venus +=
      dt *
      keplerianVelocity(ORBITAL_SPEEDS.venus, ECCENTRICITIES.venus, a.venus) *
      s;
    a.earth +=
      dt *
      keplerianVelocity(ORBITAL_SPEEDS.earth, ECCENTRICITIES.earth, a.earth) *
      s;
    a.moon += dt * 6.8 * s;
    a.mars +=
      dt *
      keplerianVelocity(ORBITAL_SPEEDS.mars, ECCENTRICITIES.mars, a.mars) *
      s;
    a.jupiter +=
      dt *
      keplerianVelocity(
        ORBITAL_SPEEDS.jupiter,
        ECCENTRICITIES.jupiter,
        a.jupiter,
      ) *
      s;
    a.saturn +=
      dt *
      keplerianVelocity(
        ORBITAL_SPEEDS.saturn,
        ECCENTRICITIES.saturn,
        a.saturn,
      ) *
      s;

    // Clockwork drive train with exact meshing ratios
    a.driveGear += dt * TRAIN_SPEEDS.drive * s;
    a.pinion1 -= dt * TRAIN_SPEEDS.pinion1 * s; // 2:1 counter-rotation
    a.pinion2 -= dt * TRAIN_SPEEDS.pinion2 * s; // 2.545:1 counter-rotation
    a.intermediateGear += dt * TRAIN_SPEEDS.intermediate * s; // Step-up counter-rotation from Pinion 1 upper
    a.crank += dt * 2.1 * s;

    // Diurnal planet rotations & solar rotation
    a.earthSpin += dt * 2.5 * s;
    a.marsSpin += dt * 2.4 * s;
    a.jupiterSpin += dt * 5.2 * s;
    a.saturnSpin += dt * 4.2 * s;
    a.venusSpin -= dt * 0.15 * s; // Slow retrograde spin
    a.sun += dt * 0.15 * s;

    // Galilean moons Laplace resonance (4:2:1)
    a.ioMoon += dt * LAPLACE_RESONANCE.io * s;
    a.europaMoon += dt * LAPLACE_RESONANCE.europa * s;
    a.ganymedeMoon += dt * LAPLACE_RESONANCE.ganymede * s;
    a.callistoMoon += dt * 0.5 * s;

    if (mercuryArmRef.current) mercuryArmRef.current.rotation.y = a.mercury;
    if (venusArmRef.current) venusArmRef.current.rotation.y = a.venus;
    if (venusGlobeRef.current) venusGlobeRef.current.rotation.y = a.venusSpin;
    if (earthArmRef.current) earthArmRef.current.rotation.y = a.earth;
    if (earthGlobeRef.current) earthGlobeRef.current.rotation.y = a.earthSpin;
    if (moonSubArmRef.current) moonSubArmRef.current.rotation.y = a.moon;
    // Tellurion moon orientation: bright face constantly tracks central sun
    if (moonGlobeRef.current)
      moonGlobeRef.current.rotation.y = -(a.earth + a.moon);
    if (marsArmRef.current) marsArmRef.current.rotation.y = a.mars;
    if (marsGlobeRef.current) marsGlobeRef.current.rotation.y = a.marsSpin;
    if (jupiterArmRef.current) jupiterArmRef.current.rotation.y = a.jupiter;
    if (jupiterGlobeRef.current)
      jupiterGlobeRef.current.rotation.y = a.jupiterSpin;
    if (ioMoonRef.current) ioMoonRef.current.rotation.y = a.ioMoon;
    if (europaMoonRef.current) europaMoonRef.current.rotation.y = a.europaMoon;
    if (ganymedeMoonRef.current)
      ganymedeMoonRef.current.rotation.y = a.ganymedeMoon;
    if (callistoMoonRef.current)
      callistoMoonRef.current.rotation.y = a.callistoMoon;
    if (saturnArmRef.current) saturnArmRef.current.rotation.y = a.saturn;
    if (saturnGlobeRef.current)
      saturnGlobeRef.current.rotation.y = a.saturnSpin;
    if (sunGlobeRef.current) sunGlobeRef.current.rotation.y = a.sun;

    if (driveGearRef.current) driveGearRef.current.rotation.y = a.driveGear;
    if (pinion1Ref.current) pinion1Ref.current.rotation.y = a.pinion1;
    if (pinion2Ref.current) pinion2Ref.current.rotation.y = a.pinion2;
    if (intermediateGearRef.current)
      intermediateGearRef.current.rotation.y = a.intermediateGear;
    if (crankRef.current) crankRef.current.rotation.x = -a.crank;
    if (crankBevelRef.current) crankBevelRef.current.rotation.x = -a.crank;
    if (verticalBevelRef.current)
      verticalBevelRef.current.rotation.y = a.driveGear;
  });

  const built = useBuilt(buildOrrery);
  const plaster = useSurfaceMaps('plaster');
  const wood = useSurfaceMaps('wood');

  const dialMap = useCanvasTexture(512, 512, drawDialPlate);
  const sunMap = useCanvasTexture(512, 256, drawSun);
  const mercuryMap = useCanvasTexture(256, 128, drawMercury);
  const venusMap = useCanvasTexture(256, 128, drawVenus);
  const earthMap = useCanvasTexture(512, 256, drawEarth);
  const marsMap = useCanvasTexture(256, 128, drawMars);
  const jupiterMap = useCanvasTexture(512, 256, drawJupiter);
  const saturnMap = useCanvasTexture(256, 128, drawSaturn);
  const saturnRingMap = useCanvasTexture(256, 256, drawSaturnRings);
  const plaqueMap = useCanvasTexture(256, 64, drawPlaque);
  const brassTexture = useTexture('/images/orrery/brushed-brass.jpg');
  useMemo(() => {
    brassTexture.wrapS = RepeatWrapping;
    brassTexture.wrapT = RepeatWrapping;
    brassTexture.repeat.set(1.5, 1.5);
  }, [brassTexture]);

  const metalMat = useMemo(
    () =>
      new MeshStandardMaterial({
        vertexColors: true,
        map: brassTexture,
        metalness: BRASS_METALNESS,
        roughness: BRASS_ROUGHNESS,
        envMapIntensity: BRASS_ENV_INTENSITY,
      }),
    [brassTexture],
  );
  const warmGoldMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#ffffff',
        map: brassTexture,
        metalness: 0.68,
        roughness: 0.4,
        envMapIntensity: BRASS_ENV_INTENSITY,
      }),
    [brassTexture],
  );
  const sunGlobeMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#ffffff',
        map: sunMap,
        metalness: 0.7,
        roughness: 0.38,
        envMapIntensity: BRASS_ENV_INTENSITY,
      }),
    [sunMap],
  );
  const woodBaseMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#2e190e',
        roughness: 0.72,
        metalness: 0.04,
        map: wood.color,
        roughnessMap: wood.rough,
        normalMap: wood.normal,
        normalScale: WOOD_NORMAL_SCALE,
      }),
    [wood],
  );
  useEffect(
    () => () =>
      [metalMat, warmGoldMat, sunGlobeMat, woodBaseMat].forEach((m) =>
        m.dispose(),
      ),
    [metalMat, warmGoldMat, sunGlobeMat, woodBaseMat],
  );
  const metal = (geometry: BufferGeometry) => (
    <mesh geometry={geometry} material={metalMat} castShadow receiveShadow />
  );

  return (
    <group
      position={POSITION}
      scale={SCALE}
      name="mechanical-planetary-system"
      onClick={onWindUp}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = '';
      }}
    >
      <ContactShadows
        position={[0, 0.004, 0]}
        scale={1}
        far={0.9}
        blur={2.2}
        opacity={0.7}
        resolution={256}
        frames={1}
        color="#140b06"
      />
      <group position={[0, STAND_Y, 0]}>
        {metal(built.metal)}
        <mesh
          geometry={built.gold}
          material={warmGoldMat}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={built.wood}
          material={woodBaseMat}
          castShadow
          receiveShadow
        />
        <mesh
          position={[0, 0.0561 + BASE_Y, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.088, 0.126, 64]} />
          <meshStandardMaterial
            color={hovered ? '#fff8e6' : '#ffffff'}
            map={dialMap}
            roughness={0.78}
            metalness={0.12}
            side={DoubleSide}
          />
        </mesh>
        <group position={[0, 0.022 + BASE_Y, 0.166]} rotation={[0.32, 0, 0]}>
          <mesh position={[0, 0, 0.002]}>
            <boxGeometry args={[0.066, 0.013, 0.001]} />
            <meshStandardMaterial
              color={hovered ? '#fff8e6' : '#ffffff'}
              map={plaqueMap}
              roughness={0.72}
              metalness={0.15}
            />
          </mesh>
        </group>

        {/* Clockwork train with bevel miter gear transmission */}
        <group ref={driveGearRef} position={[0, 0.088 + BASE_Y, 0]}>
          <Cog
            radius={0.062}
            teeth={TEETH.drive}
            thickness={0.0055}
            color="#ffffff"
            map={brassTexture}
          />
        </group>
        <group ref={pinion1Ref} position={[-0.0861, BASE_Y, 0.0351]}>
          {/* Lower 14-tooth pinion meshing with Drive Gear */}
          <group position={[0, 0.088, 0]}>
            <Cog
              radius={0.031}
              teeth={TEETH.pinion1}
              thickness={0.005}
              color="#fff4d4"
              map={brassTexture}
            />
          </group>
          {/* Upper 12-tooth pinion driving Intermediate Gear */}
          <group position={[0, 0.104, 0]}>
            <Cog
              radius={0.024}
              teeth={TEETH.pinion1Upper}
              thickness={0.0045}
              color="#ffeec4"
              map={brassTexture}
            />
          </group>
        </group>
        <group ref={pinion2Ref} position={[0.0735, 0.088 + BASE_Y, -0.0454]}>
          <Cog
            radius={0.0244}
            teeth={TEETH.pinion2}
            thickness={0.0048}
            color="#fff0cc"
            map={brassTexture}
          />
        </group>
        <group ref={intermediateGearRef} position={[0, 0.104 + BASE_Y, 0]}>
          <Cog
            radius={0.069}
            teeth={TEETH.intermediate}
            thickness={0.0045}
            color="#fff8dc"
            map={brassTexture}
          />
        </group>
        {/* Winding transmission: 90° bevel miter gear pair */}
        <group ref={crankBevelRef} position={[0.022, CRANK_AXLE_Y, 0]}>
          <mesh
            geometry={built.bevelGear}
            material={warmGoldMat}
            rotation={ACROSS}
            castShadow
          />
        </group>
        <group ref={verticalBevelRef} position={[0, 0.044 + BASE_Y, 0]}>
          <mesh
            geometry={built.matingBevelGear}
            material={warmGoldMat}
            rotation={[Math.PI, 0, 0]}
            castShadow
          />
        </group>
        <group ref={crankRef} position={[CRANK_HANDLE_X, CRANK_AXLE_Y, 0]}>
          {metal(built.crank)}
          {/* Turned wooden grip revolving sleeve aligned along the X-axis pin */}
          <mesh
            position={[0.019, 0.038, 0]}
            rotation={ACROSS}
            castShadow
            material={woodBaseMat}
          >
            <cylinderGeometry args={[0.005, 0.0068, 0.022, 16]} />
          </mesh>
        </group>

        <mesh
          ref={sunGlobeRef}
          position={[0, SUN_Y, 0]}
          castShadow
          receiveShadow
          material={sunGlobeMat}
        >
          <sphereGeometry args={[SUN_RADIUS, 32, 24]} />
        </mesh>

        {/* Planet arms with concentric telescoping sleeves */}
        <group ref={mercuryArmRef} position={[0, ARM_HEIGHTS.mercury, 0]}>
          {metal(built.mercury)}
          <mesh position={[0.068, 0.191, 0]} castShadow receiveShadow>
            <sphereGeometry args={[0.0075, 16, 12]} />
            <meshStandardMaterial
              color="#ffffff"
              map={mercuryMap}
              roughness={0.65}
              metalness={0.22}
              roughnessMap={plaster.rough}
              normalMap={plaster.normal}
              normalScale={PLANET_NORMAL_SCALE}
            />
          </mesh>
        </group>
        <group ref={venusArmRef} position={[0, ARM_HEIGHTS.venus, 0]}>
          {metal(built.venus)}
          <group ref={venusGlobeRef} position={[0.104, 0.169, 0]}>
            <mesh castShadow receiveShadow>
              <sphereGeometry args={[0.012, 20, 16]} />
              <meshStandardMaterial
                color="#ffffff"
                map={venusMap}
                roughness={0.62}
                metalness={0.06}
                roughnessMap={plaster.rough}
                normalMap={plaster.normal}
                normalScale={PLANET_NORMAL_SCALE}
              />
            </mesh>
          </group>
        </group>
        <group ref={earthArmRef} position={[0, ARM_HEIGHTS.earth, 0]}>
          {metal(built.earth)}
          <group position={[0.148, 0.145, 0]}>
            <group rotation={[0.41, 0, 0]}>
              <mesh ref={earthGlobeRef} castShadow receiveShadow>
                <sphereGeometry args={[0.0145, 24, 18]} />
                <meshStandardMaterial
                  color="#ffffff"
                  map={earthMap}
                  roughness={0.56}
                  metalness={0.08}
                />
              </mesh>
            </group>
            <group ref={moonSubArmRef} position={[0, -0.006, 0]}>
              {metal(built.moon)}
              <mesh
                ref={moonGlobeRef}
                position={[0.032, 0.006, 0]}
                geometry={built.moonGlobe}
                castShadow
                receiveShadow
              >
                <meshStandardMaterial
                  vertexColors
                  roughness={0.62}
                  metalness={0.1}
                />
              </mesh>
            </group>
          </group>
        </group>
        <group ref={marsArmRef} position={[0, ARM_HEIGHTS.mars, 0]}>
          {metal(built.mars)}
          <group position={[0.194, 0.121, 0]}>
            <group rotation={[0.44, 0, 0]}>
              <mesh ref={marsGlobeRef} castShadow receiveShadow>
                <sphereGeometry args={[0.0105, 18, 14]} />
                <meshStandardMaterial
                  color="#ffffff"
                  map={marsMap}
                  roughness={0.62}
                  metalness={0.1}
                />
              </mesh>
            </group>
          </group>
        </group>
        <group ref={jupiterArmRef} position={[0, ARM_HEIGHTS.jupiter, 0]}>
          {metal(built.jupiter)}
          <group position={[0.244, 0.097, 0]}>
            <group ref={jupiterGlobeRef} rotation={[0.054, 0, 0]}>
              <mesh castShadow receiveShadow>
                <sphereGeometry args={[0.022, 28, 20]} />
                <meshStandardMaterial
                  color="#ffffff"
                  map={jupiterMap}
                  roughness={0.56}
                  metalness={0.08}
                />
              </mesh>
            </group>
            {/* Galilean Moons (Io, Europa, Ganymede, Callisto) */}
            <group ref={ioMoonRef}>
              <mesh
                position={[0.028, 0.002, 0]}
                castShadow
                material={warmGoldMat}
              >
                <sphereGeometry args={[0.0018, 10, 8]} />
              </mesh>
            </group>
            <group ref={europaMoonRef}>
              <mesh position={[0.034, -0.002, 0]} castShadow>
                <sphereGeometry args={[0.0016, 10, 8]} />
                <meshStandardMaterial
                  color="#dce0e8"
                  roughness={0.62}
                  metalness={0.06}
                />
              </mesh>
            </group>
            <group ref={ganymedeMoonRef}>
              <mesh
                position={[0.041, 0.003, 0]}
                castShadow
                material={warmGoldMat}
              >
                <sphereGeometry args={[0.0024, 10, 8]} />
              </mesh>
            </group>
            <group ref={callistoMoonRef}>
              <mesh position={[0.048, -0.003, 0]} castShadow>
                <sphereGeometry args={[0.0021, 10, 8]} />
                <meshStandardMaterial
                  color="#8a7e75"
                  roughness={0.65}
                  metalness={0.14}
                />
              </mesh>
            </group>
          </group>
        </group>
        <group ref={saturnArmRef} position={[0, ARM_HEIGHTS.saturn, 0]}>
          {metal(built.saturn)}
          <group position={[0.298, 0.073, 0]} rotation={[0.47, 0, 0.2]}>
            <mesh ref={saturnGlobeRef} castShadow receiveShadow>
              <sphereGeometry args={[0.018, 24, 18]} />
              <meshStandardMaterial
                color="#ffffff"
                map={saturnMap}
                roughness={0.54}
                metalness={0.1}
              />
            </mesh>
            <mesh geometry={built.saturnRings} castShadow receiveShadow>
              <meshStandardMaterial
                map={saturnRingMap}
                transparent
                metalness={0.42}
                roughness={0.62}
                side={DoubleSide}
              />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}
