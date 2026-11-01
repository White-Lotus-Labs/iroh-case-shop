import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LatheGeometry,
  Vector2,
} from 'three';
import type { Point } from '../stations';
import { createRandom } from '../motion/dynamics';
import { canvasTexture, once, useSurfaceMaps } from '../Surfaces';
import { brushText, merge, paper, place, useBuilt } from './craft';

type Profile = [number, number][];
export type JarKind = 'chatsubo' | 'canister' | 'squat' | 'bottle' | 'bowl';
/** Outer lathe profiles, [radius, height] in metres, bottom to top. */
const BODY: Record<JarKind, Profile> = {
  chatsubo: [
    [0, 0],
    [0.046, 0],
    [0.05, 0.007],
    [0.074, 0.04],
    [0.09, 0.09],
    [0.092, 0.115],
    [0.084, 0.145],
    [0.064, 0.172],
    [0.04, 0.186],
    [0.035, 0.194],
    [0.038, 0.204],
    [0.036, 0.21],
  ],
  canister: [
    [0, 0],
    [0.05, 0],
    [0.055, 0.004],
    [0.057, 0.012],
    [0.057, 0.15],
    [0.054, 0.156],
    [0.051, 0.158],
  ],
  squat: [
    [0, 0],
    [0.048, 0],
    [0.053, 0.006],
    [0.075, 0.03],
    [0.083, 0.058],
    [0.076, 0.082],
    [0.058, 0.097],
    [0.046, 0.102],
    [0.047, 0.108],
  ],
  bottle: [
    [0, 0],
    [0.034, 0],
    [0.038, 0.006],
    [0.056, 0.055],
    [0.06, 0.095],
    [0.05, 0.14],
    [0.026, 0.18],
    [0.017, 0.21],
    [0.018, 0.245],
    [0.023, 0.256],
    [0.02, 0.26],
    [0.014, 0.24],
  ],
  bowl: [
    [0, 0],
    [0.03, 0],
    [0.032, 0.008],
    [0.03, 0.012],
    [0.05, 0.022],
    [0.068, 0.045],
    [0.074, 0.058],
    [0.071, 0.06],
    [0.064, 0.047],
    [0.045, 0.025],
    [0, 0.018],
  ],
};
const LID: Partial<Record<JarKind, Profile>> = {
  chatsubo: [
    [0.043, 0.205],
    [0.044, 0.214],
    [0.036, 0.224],
    [0.013, 0.232],
    [0.012, 0.24],
    [0.015, 0.246],
    [0, 0.249],
  ],
  canister: [
    [0.0605, 0.126],
    [0.0615, 0.128],
    [0.0615, 0.161],
    [0.058, 0.166],
    [0.03, 0.169],
    [0, 0.17],
  ],
  squat: [
    [0.05, 0.104],
    [0.05, 0.11],
    [0.042, 0.117],
    [0.014, 0.121],
    [0.011, 0.132],
    [0.016, 0.139],
    [0, 0.142],
  ],
};
/** Label band heights on each body; bodies without one get no label. */
const LABEL: Partial<Record<JarKind, [number, number]>> = {
  chatsubo: [0.07, 0.15],
  canister: [0.03, 0.12],
  squat: [0.035, 0.08],
};
const LABEL_CELLS = 8;

export type JarSpec = {
  kind: JarKind;
  position: Point;
  glaze: string;
  /** Turn about y; labels face +x before turning. */
  turn?: number;
  scale?: number;
  clay?: string;
  lid?: string;
  /** Label atlas cell, 0-7. */
  label?: number;
};

const radiusAt = (profile: Profile, y: number) => {
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1],
      [r1, y1] = profile[i];
    if (y >= y0 && y <= y1 && y1 > y0)
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return profile[profile.length - 1][0];
};

/** Glaze over a wavy unglazed foot, pooling darker at its edge and thinning at rims. */
function glazeColors(
  geometry: BufferGeometry,
  spec: JarSpec,
  seed: number,
  lid: boolean,
) {
  const random = createRandom(seed),
    glaze = new Color(spec.lid && lid ? spec.lid : spec.glaze),
    clay = new Color(spec.clay ?? '#7c5d42'),
    pool = glaze.clone().multiplyScalar(0.55),
    thin = glaze.clone().lerp(new Color('#c8a27a'), 0.35),
    position = geometry.attributes.position,
    height = BODY[spec.kind].at(-1)![1],
    phase = random() * 6.28,
    foot = 0.012 + random() * 0.02,
    data = new Float32Array(position.count * 3),
    c = new Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i),
      angle = Math.atan2(z, x),
      edge =
        foot +
        0.007 * Math.sin(angle * 3 + phase) +
        0.004 * Math.sin(angle * 7 + phase * 2);
    if (!lid && y < edge && Math.hypot(x, z) > 0.001) c.copy(clay);
    else {
      c.copy(glaze);
      if (!lid) c.lerp(pool, Math.max(0, 1 - (y - edge) / 0.018) * 0.7);
      c.lerp(thin, Math.max(0, (y - height * 0.9) / (height * 0.1)) * 0.5);
    }
    c.multiplyScalar(0.94 + random() * 0.1);
    c.toArray(data, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(data, 3));
  return geometry;
}

const lathe = (profile: Profile, segments = 28, phiStart = 0, phi = 6.2832) =>
  new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
    phiStart,
    phi,
  );

function buildJars(jars: JarSpec[]) {
  const bodies: BufferGeometry[] = [],
    labels: BufferGeometry[] = [];
  jars.forEach((spec, index) => {
    const transform = [
      spec.position,
      [0, spec.turn ?? 0, 0] as Point,
      spec.scale ?? 1,
    ] as const;
    bodies.push(
      place(
        glazeColors(lathe(BODY[spec.kind]), spec, index * 31 + 7, false),
        ...transform,
      ),
    );
    const lid = LID[spec.kind];
    if (lid)
      bodies.push(
        place(
          glazeColors(lathe(lid), spec, index * 31 + 11, true),
          ...transform,
        ),
      );
    const band = LABEL[spec.kind];
    if (band && spec.label !== undefined) {
      const [y0, y1] = band,
        profile: Profile = Array.from({ length: 6 }, (_, i) => {
          const y = y0 + ((y1 - y0) * i) / 5;
          return [radiusAt(BODY[spec.kind], y) + 0.0016, y];
        }),
        width = Math.min(1.25, 0.075 / profile[2][0]),
        label = lathe(profile, 10, Math.PI / 2 - width / 2, width),
        uv = label.attributes.uv;
      for (let i = 0; i < uv.count; i++)
        uv.setX(i, (spec.label + uv.getX(i)) / LABEL_CELLS);
      labels.push(place(label, ...transform));
    }
  });
  return {
    bodies: merge(bodies),
    labels: labels.length ? merge(labels) : null,
  };
}

const LABEL_PAPER = [
  '#e9dcc0',
  '#d9c79f',
  '#e3d6c4',
  '#c9b48c',
  '#ddd2b2',
  '#b9523a',
  '#e6dcc4',
  '#3c3a31',
];
const LABEL_TEAS = [
  '煎茶',
  '玉露',
  '抹茶',
  '番茶',
  '焙茶',
  '玄米',
  '白茶',
  '烏龍',
];
/** Eight tall paper labels, each naming a tea in brush script, with a red seal. */
function drawLabels(ctx: CanvasRenderingContext2D) {
  const random = createRandom(2718);
  LABEL_PAPER.forEach((tone, cell) => {
    const x = cell * 128,
      dark = cell === 7,
      red = cell === 5,
      ink = dark ? '226,210,178' : red ? '246,232,206' : undefined;
    paper(ctx, x, 0, 128, 256, tone, random);
    ctx.strokeStyle = dark ? 'rgba(220,200,160,.5)' : 'rgba(60,40,24,.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 10, 12, 108, 232);
    brushText(ctx, LABEL_TEAS[cell], x + 64, 30, 72, ink);
    if (!red) {
      ctx.fillStyle = '#a3321f';
      ctx.fillRect(x + 82, 206, 24, 24);
      brushText(ctx, '閑', x + 94, 208, 20, '240,226,200');
    }
  });
}

const labelAtlas = once(() =>
  canvasTexture(128 * LABEL_CELLS, 256, drawLabels),
);

/** Lathe-turned glazed jars and canisters with lids and paper labels, as two draw calls. */
export function JarSet({ jars }: { jars: JarSpec[] }) {
  const built = useBuilt(() => {
    const geometry = buildJars(jars);
    return {
      ...geometry,
      atlas: labelAtlas(),
      dispose() {
        geometry.bodies.dispose();
        geometry.labels?.dispose();
      },
    };
  });
  const mottle = useSurfaceMaps('paper').color;
  return (
    <group>
      <mesh geometry={built.bodies} castShadow receiveShadow>
        <meshPhysicalMaterial
          vertexColors
          map={mottle}
          roughness={0.34}
          clearcoat={0.7}
          clearcoatRoughness={0.12}
        />
      </mesh>
      {built.labels && (
        <mesh geometry={built.labels}>
          <meshStandardMaterial
            map={built.atlas}
            roughness={0.88}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      )}
    </group>
  );
}
