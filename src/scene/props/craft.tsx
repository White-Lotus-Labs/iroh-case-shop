import { useEffect, useState } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Matrix4,
  Quaternion,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Curve,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Point } from '../stations';
import { useSurfaceMaps } from '../Surfaces';

/** Builds a GPU resource once and disposes it on unmount. */
export function useBuilt<T extends { dispose(): void }>(make: () => T) {
  const [value] = useState(make);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

/** Metres per wood texture tile: [along the grain, across it]; matches Surfaces. */
const WOOD_TILE: [number, number] = [1.6, 0.4];

/** Box-projected UVs in texture tiles, with the grain along `grain` when a face contains it. */
export function boxUv(
  geometry: BufferGeometry,
  grain: number,
  seed = 0,
  [along, across] = WOOD_TILE,
) {
  const position = geometry.attributes.position,
    normal = geometry.attributes.normal,
    uv = new Float32Array(position.count * 2),
    offsetU = (seed * 7.31) % 1,
    offsetV = (seed * 3.17) % 1;
  for (let i = 0; i < position.count; i++) {
    const n = [
      Math.abs(normal.getX(i)),
      Math.abs(normal.getY(i)),
      Math.abs(normal.getZ(i)),
    ];
    const face = n[0] > n[1] && n[0] > n[2] ? 0 : n[1] > n[2] ? 1 : 2;
    const [a, b] = face === 0 ? [2, 1] : face === 1 ? [0, 2] : [0, 1];
    const g = a === grain || b === grain ? grain : a,
      c = g === a ? b : a;
    uv[i * 2] = position.getComponent(i, g) / along + offsetU;
    uv[i * 2 + 1] = position.getComponent(i, c) / across + offsetV;
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  return geometry;
}

/** Fills a linear-space vertex colour attribute. */
export function paint(geometry: BufferGeometry, color: string | Color) {
  const c = typeof color === 'string' ? new Color(color) : color,
    count = geometry.attributes.position.count,
    data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) c.toArray(data, i * 3);
  geometry.setAttribute('color', new BufferAttribute(data, 3));
  return geometry;
}

const matrix = new Matrix4(),
  quaternion = new Quaternion(),
  euler = new Euler(),
  vPosition = new Vector3(),
  vScale = new Vector3();
export function place(
  geometry: BufferGeometry,
  position: Point,
  rotation: Point = [0, 0, 0],
  scale: number | Point = 1,
) {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  matrix.compose(
    vPosition.set(...position),
    quaternion.setFromEuler(euler.set(...rotation)),
    vScale.set(s[0], s[1], s[2]),
  );
  return geometry.applyMatrix4(matrix);
}

/** A rounded wood block with grain-aligned UVs and a vertex colour, placed in world space. */
export function block(
  size: Point,
  position: Point,
  color: string,
  {
    rotation,
    radius,
    grain,
  }: { rotation?: Point; radius?: number; grain?: number } = {},
) {
  const geometry = new RoundedBoxGeometry(
    ...size,
    2,
    radius ?? Math.min(0.006, Math.min(...size) * 0.4),
  );
  const seed = Math.abs(
    Math.sin(position[0] * 12.99 + position[1] * 78.23 + position[2] * 37.72) *
      437.58,
  );
  boxUv(geometry, grain ?? size.indexOf(Math.max(...size)), seed);
  return place(paint(geometry, color), position, rotation);
}

/** Merges parts into one static geometry; keeps only position, normal, uv and color. */
export function merge(parts: BufferGeometry[]) {
  const indexed = parts.every((part) => part.index);
  const ready = parts.map((part) => {
    const geometry = indexed || !part.index ? part : part.toNonIndexed();
    for (const name of Object.keys(geometry.attributes))
      if (!['position', 'normal', 'uv', 'color'].includes(name))
        geometry.deleteAttribute(name);
    geometry.clearGroups();
    return geometry;
  });
  const merged = mergeGeometries(ready)!;
  ready.forEach((geometry) => geometry.dispose());
  merged.computeBoundingSphere();
  return merged;
}

/** A tube whose radius follows `radius(t)`; UVs run in texture tiles along and around it. */
export function taperedTube(
  curve: Curve<Vector3>,
  radius: (t: number) => number,
  tubular = 24,
  radial = 7,
  [along, around] = WOOD_TILE,
) {
  const geometry = new TubeGeometry(curve, tubular, 1, radial, false);
  const position = geometry.attributes.position,
    uv = geometry.attributes.uv,
    length = curve.getLength(),
    p = new Vector3(),
    v = new Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular,
      r = radius(t);
    curve.getPointAt(t, p);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(position, k).sub(p).multiplyScalar(r).add(p);
      position.setXYZ(k, v.x, v.y, v.z);
      uv.setXY(k, (t * length) / along, ((j / radial) * r * 6.3) / around);
    }
  }
  return geometry;
}

/** Oiled-wood material for merged parts; tone comes from vertex colours. */
export function WoodMaterial({ clearcoat }: { clearcoat?: number }) {
  const maps = useSurfaceMaps('wood');
  const props = {
    vertexColors: true,
    map: maps.color,
    normalMap: maps.normal,
    roughnessMap: maps.rough,
    roughness: 1,
  };
  return clearcoat ? (
    <meshPhysicalMaterial
      {...props}
      clearcoat={clearcoat}
      clearcoatRoughness={0.3}
    />
  ) : (
    <meshStandardMaterial {...props} />
  );
}

/** A dry-brush ink stroke: bristle lines along a path, thinning and fading toward the end. */
export function inkStroke(
  ctx: CanvasRenderingContext2D,
  path: [number, number][],
  width: number,
  random: () => number,
  ink = '24,17,12',
) {
  const bristles = Math.max(5, Math.round(width * 1.4));
  for (let b = 0; b < bristles; b++) {
    const offset = (b / (bristles - 1) - 0.5) * width,
      dry = 0.55 + random() * 0.45;
    ctx.beginPath();
    path.forEach(([x, y], i) => {
      const t = i / (path.length - 1),
        [nx, ny] = path[Math.min(i + 1, path.length - 1)],
        [px, py] = path[Math.max(i - 1, 0)],
        dx = nx - px,
        dy = ny - py,
        length = Math.hypot(dx, dy) || 1,
        o = offset * (1.1 - t * 0.7);
      const X = x - (dy / length) * o,
        Y = y + (dx / length) * o;
      if (i === 0) ctx.moveTo(X, Y);
      else if (t < dry || Math.abs(offset) < width * 0.25) ctx.lineTo(X, Y);
    });
    ctx.strokeStyle = `rgba(${ink},${0.45 + random() * 0.5})`;
    ctx.lineWidth = Math.max(0.8, (width / bristles) * (1.4 + random()));
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

const BRUSH_FONT =
  '"Hiragino Mincho ProN","Yu Mincho","YuMincho","Noto Serif JP","Noto Serif CJK JP","MS Mincho",serif';

/** Real Japanese text written top to bottom, centred on x, in a heavy mincho face. */
export function brushText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  ink = '24,17,12',
) {
  ctx.save();
  ctx.font = `600 ${size}px ${BRUSH_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = `rgba(${ink},.9)`;
  [...text].forEach((char, i) => ctx.fillText(char, x, y + i * size * 1.04));
  ctx.restore();
}

/** Speckled handmade-paper fill. */
export function paper(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tone: string,
  random: () => number,
) {
  ctx.fillStyle = tone;
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < (w * h) / 40; i++) {
    ctx.fillStyle = `rgba(110,80,45,${random() * 0.07})`;
    ctx.fillRect(
      x + random() * w,
      y + random() * h,
      1 + random() * 5,
      0.6 + random(),
    );
  }
}

const Y = new Vector3(0, 1, 0);
/** A straight cord between two points, so it always meets what it hangs from. */
export function cord(from: Point, to: Point, radius = 0.0018) {
  const a = new Vector3(...from),
    d = new Vector3(...to).sub(a),
    geometry = new CylinderGeometry(radius, radius, d.length(), 5);
  geometry.applyQuaternion(
    quaternion.setFromUnitVectors(Y, d.clone().normalize()),
  );
  return geometry.translate(a.x + d.x / 2, a.y + d.y / 2, a.z + d.z / 2);
}

/**
 * Screw eye above `hook` (the bottom of the ring). The shank runs `into` the
 * timber. Default `ring` keeps the 茶-sign hanger: top at +0.01 m, tube 0.0013 m.
 */
export function screwEye(hook: Point, into: Point = [0, 1, 0], ring = 0.005) {
  const [x, y, z] = hook,
    top: Point = [x, y + ring * 2, z],
    shank: Point = [
      x + into[0] * 0.02,
      top[1] + into[1] * 0.02,
      z + into[2] * 0.02,
    ];
  return { top, shank, tube: ring * 0.26, centre: [x, y + ring, z] as Point };
}

/**
 * Cords from each of `ends` up to one brass screw eye; `hook` is the bottom of its ring
 * and `into` points from the ring into the timber or wall that holds it.
 */
export function Hanger({
  hook,
  ends,
  into = [0, 1, 0],
  color = '#6b5a3a',
  ring = 0.005,
}: {
  hook: Point;
  ends: Point[];
  into?: Point;
  /** Screw-eye radius. The hook point is the bottom of the ring. */
  ring?: number;
  color?: string;
}) {
  const built = useBuilt(() => {
    const eyeShape = screwEye(hook, into, ring),
      cords = merge(ends.map((end) => cord(end, hook))),
      eye = merge([
        place(new TorusGeometry(ring, eyeShape.tube, 6, 16), eyeShape.centre),
        cord(eyeShape.top, eyeShape.shank, 0.0015),
      ]);
    return {
      cords,
      eye,
      dispose() {
        cords.dispose();
        eye.dispose();
      },
    };
  });
  return (
    <group>
      <mesh geometry={built.cords}>
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      <mesh geometry={built.eye}>
        <meshStandardMaterial
          color="#8a6a34"
          metalness={0.85}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}

export type TimberBox = [position: Point, size: Point, color?: string];
/** Static timber boxes merged into one wood mesh; `offset` shifts a group of boxes. */
export function Timber({
  items,
  cast = true,
}: {
  items: TimberBox[];
  cast?: boolean;
}) {
  const geometry = useBuilt(() =>
    merge(items.map(([p, s, c]) => block(s, p, c ?? '#3a2419'))),
  );
  return (
    <mesh geometry={geometry} castShadow={cast} receiveShadow>
      <WoodMaterial />
    </mesh>
  );
}

export const offset = (items: TimberBox[], [dx, dy, dz]: Point): TimberBox[] =>
  items.map(([[x, y, z], s, c]) => [[x + dx, y + dy, z + dz], s, c]);
