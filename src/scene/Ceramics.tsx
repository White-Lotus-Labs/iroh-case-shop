import { useMemo, type Ref } from 'react';
import {
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Float32BufferAttribute,
  MathUtils,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Curve,
  type MeshPhysicalMaterial,
} from 'three';
import { createRandom } from './motion/dynamics';
import type { Point } from './stations';

/** [radius, height] control points of a turned cross-section. */
export type Profile = [number, number][];

/** A centripetal spline through `points`, resampled evenly by arc length so a
 * lathe's v coordinate follows the surface. `marks` give each control point's v. */
export function smoothProfile(points: Profile, divisions: number) {
  const curve = new CatmullRomCurve3(
    points.map(([r, y]) => new Vector3(r, y, 0)),
    false,
    'centripetal',
  );
  const spaced = curve
    .getSpacedPoints(divisions)
    .map((p) => new Vector2(Math.max(0, p.x), p.y));
  const marks = points.map(([r, y]) => {
    let best = 0,
      distance = Infinity;
    spaced.forEach((p, i) => {
      const d = Math.hypot(p.x - r, p.y - y);
      if (d < distance) [distance, best] = [d, i];
    });
    return best / divisions;
  });
  return { points: spaced, marks };
}

/** A lathe profile swept along a curve: x is the radius, y the distance along
 * the curve in metres. Winding and UVs match LatheGeometry. */
export function sweepGeometry(
  curve: Curve<Vector3>,
  profile: Vector2[],
  radial = 20,
) {
  const length = curve.getLength(),
    steps = 64,
    frames = curve.computeFrenetFrames(steps, false),
    positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    n = profile.length,
    at = new Vector3(),
    offset = new Vector3();
  for (let i = 0; i <= radial; i++) {
    const phi = (i / radial) * Math.PI * 2,
      sin = Math.sin(phi),
      cos = Math.cos(phi);
    profile.forEach((p, j) => {
      const s = Math.max(0, Math.min(1, p.y / length)),
        k = Math.round(s * steps);
      curve.getPointAt(s, at);
      offset
        .copy(frames.binormals[k])
        .multiplyScalar(sin)
        .addScaledVector(frames.normals[k], cos);
      at.addScaledVector(offset, p.x);
      positions.push(at.x, at.y, at.z);
      uvs.push(i / radial, j / (n - 1));
    });
  }
  for (let i = 0; i < radial; i++)
    for (let j = 0; j < n - 1; j++) {
      const a = j + i * n,
        b = a + n;
      indices.push(a, b, a + 1, b + 1, a + 1, b);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A glaze painted in lathe UV space: u runs around, v along the profile. */
export type Glaze = {
  glaze: string;
  /** Colour where the glaze runs thin over edges. */
  thin: string;
  clay: string;
  /** v below which the clay is bare; drips run below it. Negative: fully glazed. */
  foot: number;
  /** v of edges where the glaze breaks. */
  edges: number[];
  /** v where the glaze collects thick. */
  pools?: number[];
  /** v above which `innerGlaze` applies. */
  inner?: number;
  innerGlaze?: string;
  drips?: number;
  speckle?: number;
  /** Strength of streaks where the glaze ran down while molten. */
  runs?: number;
  seed: number;
  size?: [number, number];
};
type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const tint = (a: string, b: string, t: number) =>
  `#${mix(rgb(a), rgb(b), t)
    .map((c) => Math.round(c).toString(16).padStart(2, '0'))
    .join('')}`;
/** Value noise that tiles with the given periods (in lattice cells). */
export function tiledNoise(seed: number) {
  const random = createRandom(seed),
    size = 64,
    lattice = Float32Array.from({ length: size * size }, () => random());
  return (x: number, y: number, period: number, periodY = size) => {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      fx = x - xi,
      fy = y - yi,
      u = fx * fx * (3 - 2 * fx),
      v = fy * fy * (3 - 2 * fy),
      at = (i: number, j: number) =>
        lattice[
          (((j % periodY) + periodY) % periodY) * size +
            (((i % period) + period) % period)
        ],
      a = at(xi, yi),
      b = at(xi + 1, yi),
      c = at(xi, yi + 1),
      d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
export function fbm(
  noise: ReturnType<typeof tiledNoise>,
  x: number,
  y: number,
  period: number,
  octaves: number,
  periodY = 64,
) {
  let sum = 0,
    amp = 0.5,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, y, period, periodY);
    norm += amp;
    x *= 2;
    y *= 2;
    period *= 2;
    periodY = Math.min(64, periodY * 2);
    amp *= 0.5;
  }
  return sum / norm;
}
/** A U-repeating texture from painted pixels; `color` marks it sRGB. */
export function imageTexture(image: ImageData, color: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.anisotropy = 8;
  if (color) texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Colour, plus a surface map: R glaze thickness (bump and clearcoat), G roughness. */
function paintGlaze(g: Glaze) {
  const [width, height] = g.size ?? [256, 128],
    random = createRandom(g.seed),
    noise = tiledNoise(g.seed + 1),
    glaze = rgb(g.glaze),
    inner = rgb(g.innerGlaze ?? g.glaze),
    thin = rgb(g.thin),
    clay = rgb(g.clay),
    iron: Rgb = [52, 32, 20],
    drips = Array.from({ length: g.drips ?? 6 }, () => ({
      u: random(),
      w: 0.005 + random() * 0.012,
      l: 0.015 + random() * 0.06,
    })),
    color = new ImageData(width, height),
    surface = new ImageData(width, height);
  for (let x = 0; x < width; x++) {
    const u = x / width;
    let drip = 0;
    for (const d of drips) {
      const du = Math.abs(((u - d.u + 1.5) % 1) - 0.5) / d.w;
      if (du < 1) drip = Math.max(drip, d.l * Math.sqrt(1 - du * du));
    }
    const line = g.foot + (fbm(noise, u * 8, 3.5, 8, 3) - 0.5) * 0.03 - drip;
    for (let y = 0; y < height; y++) {
      const v = 1 - (y + 0.5) / height,
        i = (y * width + x) * 4,
        mottle = fbm(noise, u * 16, v * 9, 16, 3),
        grit = random();
      let c: Rgb, rough: number, thick: number;
      if (v < line) {
        const tone = 0.92 + (mottle - 0.5) * 0.3 + (grit - 0.5) * 0.16;
        c = [clay[0] * tone, clay[1] * tone, clay[2] * tone];
        rough = 0.88;
        thick = 0.08 + grit * 0.1;
      } else {
        let t =
          0.62 +
          (mottle - 0.5) * 0.7 +
          (fbm(noise, u * 24, v * 2.5 + 11, 24, 2) - 0.5) * (g.runs ?? 0.4);
        for (const e of g.edges) t -= 0.7 * Math.exp(-(((v - e) / 0.022) ** 2));
        for (const p of g.pools ?? [])
          t += 0.5 * Math.exp(-(((v - p) / 0.07) ** 2));
        if (g.foot > 0)
          t += 0.5 * (1 - MathUtils.smoothstep(v - line, 0, 0.04));
        const base = g.inner !== undefined && v > g.inner ? inner : glaze;
        c = mix(thin, base, MathUtils.smoothstep(t, 0.08, 0.72));
        const deep = 1 - Math.max(0, t - 0.78) * 0.5;
        c = [c[0] * deep, c[1] * deep, c[2] * deep];
        if (grit > 1 - (g.speckle ?? 1) * 0.004) c = mix(c, iron, 0.65);
        t = Math.max(0, Math.min(1, t));
        rough = 0.1 + (1 - t) * 0.22 + (mottle - 0.5) * 0.12;
        thick = 0.5 + t * 0.5;
      }
      color.data[i] = c[0];
      color.data[i + 1] = c[1];
      color.data[i + 2] = c[2];
      color.data[i + 3] = 255;
      surface.data[i] = thick * 255;
      surface.data[i + 1] = Math.max(0, Math.min(1, rough)) * 255;
      surface.data[i + 3] = 255;
    }
  }
  return {
    color: imageTexture(color, true),
    surface: imageTexture(surface, false),
  };
}

const glazes = new Map<string, ReturnType<typeof paintGlaze>>();
/** Glaze maps shared by every mount with the same recipe; painted once, never disposed. */
function useGlaze(glaze: Glaze) {
  const key = JSON.stringify(glaze);
  let maps = glazes.get(key);
  if (!maps) glazes.set(key, (maps = paintGlaze(glaze)));
  return maps;
}

/** Glossy glaze with painted breaks, drips and a bare clay foot. */
export function GlazeMaterial({
  glaze,
  ref,
  emissive,
  emissiveIntensity,
}: {
  glaze: Glaze;
  ref?: Ref<MeshPhysicalMaterial>;
  emissive?: string;
  emissiveIntensity?: number;
}) {
  const maps = useGlaze(glaze);
  return (
    <meshPhysicalMaterial
      ref={ref}
      map={maps.color}
      roughnessMap={maps.surface}
      roughness={1}
      clearcoat={1}
      clearcoatMap={maps.surface}
      clearcoatRoughness={0.07}
      bumpMap={maps.surface}
      bumpScale={0.5}
      {...(emissive && { emissive, emissiveIntensity })}
    />
  );
}

const CUP = smoothProfile(
  [
    [0, -0.058],
    [0.045, -0.058],
    [0.05, -0.063],
    [0.056, -0.066],
    [0.064, -0.066],
    [0.067, -0.061],
    [0.0675, -0.055],
    [0.072, -0.05],
    [0.085, -0.03],
    [0.094, 0],
    [0.1, 0.035],
    [0.1035, 0.062],
    [0.1045, 0.069],
    [0.101, 0.0735],
    [0.097, 0.0705],
    [0.0945, 0.056],
    [0.088, 0.02],
    [0.078, -0.02],
    [0.06, -0.041],
    [0.03, -0.048],
    [0, -0.049],
  ],
  110,
);
const TEA = smoothProfile(
  [
    [0.0911, 0.0432],
    [0.086, 0.0408],
    [0.07, 0.04],
    [0, 0.04],
  ],
  16,
).points;

/** A turned cup: recessed foot ring, glaze break at the rim, and tea with a meniscus. */
export function Cup({
  position,
  color = '#72775d',
}: {
  position: Point;
  color?: string;
}) {
  const glaze = useMemo<Glaze>(
    () => ({
      glaze: color,
      thin: tint(color, '#e0c296', 0.55),
      clay: '#9a5838',
      foot: CUP.marks[6] + 0.035,
      edges: [CUP.marks[13]],
      pools: [1],
      inner: CUP.marks[13],
      innerGlaze: tint(color, '#efe4cc', 0.2),
      drips: 5,
      speckle: 1.6,
      seed: parseInt(color.slice(1), 16) % 997,
      size: [512, 256],
    }),
    [color],
  );
  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <latheGeometry args={[CUP.points, 56]} />
        <GlazeMaterial glaze={glaze} />
      </mesh>
      <mesh>
        <latheGeometry args={[TEA, 56]} />
        <meshPhysicalMaterial
          color="#7e4d17"
          roughness={0.05}
          clearcoat={1}
          clearcoatRoughness={0.02}
        />
      </mesh>
    </group>
  );
}
