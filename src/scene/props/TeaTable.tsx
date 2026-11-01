import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  BufferGeometry,
  ExtrudeGeometry,
  InstancedMesh,
  MathUtils,
  MeshPhysicalMaterial,
  Object3D,
  RepeatWrapping,
  Shape,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Cup, fbm, imageTexture, tiledNoise } from '../Ceramics';
import { createRandom } from '../motion/dynamics';
import { once, Solid } from '../Surfaces';
import type { Point } from '../stations';
import { TeaService } from './TeaService';

/** Metres covered by one wood tile: [along the grain, across it]. */
const WOOD_TILE = [1.2, 0.3];
/** Soft growth rings and long streaks; R holds relief, G roughness. */
function woodMaps(
  early: [number, number, number],
  late: [number, number, number],
  seed: number,
  [width, height] = [1024, 256],
) {
  const noise = tiledNoise(seed),
    fine = tiledNoise(seed + 1),
    random = createRandom(seed + 2),
    color = new ImageData(width, height),
    surface = new ImageData(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = x / width,
        t = y / height,
        warp = fbm(noise, s * 4, t * 4, 4, 3, 4),
        phase = (((t * 10 + warp * 1.5) % 1) + 1) % 1,
        band =
          MathUtils.smoothstep(phase, 0.5, 0.82) *
          (1 - MathUtils.smoothstep(phase, 0.9, 1)),
        streak = fbm(fine, s * 6, t * 48, 6, 2, 64),
        pore = random() < 0.012 * (1 - band) ? 1 : 0,
        tone = 0.92 + (streak - 0.5) * 0.42 - pore * 0.25,
        i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++)
        color.data[i + c] = (early[c] + (late[c] - early[c]) * band) * tone;
      color.data[i + 3] = 255;
      surface.data[i] = (0.62 - band * 0.2 + (streak - 0.5) * 0.25) * 255;
      surface.data[i + 1] = (0.58 - band * 0.12 + pore * 0.2) * 255;
      surface.data[i + 3] = 255;
    }
  const maps = {
    color: imageTexture(color, true),
    surface: imageTexture(surface, false),
  };
  maps.color.wrapT = maps.surface.wrapT = RepeatWrapping;
  return maps;
}

/** Box-projected UVs in metres; the grain runs along `grain` wherever a face contains it. */
function woodUvs(geometry: BufferGeometry, grain: 0 | 1 | 2, seed: number) {
  const position = geometry.attributes.position,
    normal = geometry.attributes.normal,
    uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    const n = [
      Math.abs(normal.getX(i)),
      Math.abs(normal.getY(i)),
      Math.abs(normal.getZ(i)),
    ];
    const face = n[0] > n[1] && n[0] > n[2] ? 0 : n[1] > n[2] ? 1 : 2;
    const [a, b] = face === 0 ? [2, 1] : face === 1 ? [0, 2] : [0, 1];
    const along = a === grain || b === grain ? grain : a,
      across = along === a ? b : a;
    uv.setXY(
      i,
      position.getComponent(i, along) / WOOD_TILE[0] + seed * 0.37,
      position.getComponent(i, across) / WOOD_TILE[1] + seed * 0.61,
    );
  }
  return geometry;
}

type Part = [BufferGeometry, Point, 0 | 1 | 2];
function merge(parts: Part[]) {
  return mergeGeometries(
    parts.map(([geometry, [x, y, z], grain], seed) => {
      const flat = geometry.index ? geometry.toNonIndexed() : geometry;
      if (flat !== geometry) geometry.dispose();
      return woodUvs(flat.translate(x, y, z), grain, seed);
    }),
  );
}

const Z = -2.41,
  LEG_X = 1.04,
  LEG_Z = 0.51,
  LEG_TOP = 0.12,
  LEG_FOOT = 0.085,
  FLOOR = 0.035,
  UNDER = 0.54;
/** Half-width of a tapered leg at height y. */
const legHalf = (y: number) =>
  (LEG_FOOT + (LEG_TOP - LEG_FOOT) * ((y - FLOOR) / (UNDER - FLOOR))) / 2;

/** The top's long edges: an eased arris over a steep under-chamfer. */
function topSlab(length: number, depth: number, thickness: number) {
  const d = depth / 2,
    h = thickness / 2,
    shape = new Shape();
  shape.moveTo(-d + 0.012, h);
  shape.lineTo(d - 0.012, h);
  shape.quadraticCurveTo(d, h, d, h - 0.012);
  shape.lineTo(d, -0.004);
  shape.lineTo(d - 0.04, -h);
  shape.lineTo(-d + 0.04, -h);
  shape.lineTo(-d, -0.004);
  shape.lineTo(-d, h - 0.012);
  shape.quadraticCurveTo(-d, h, -d + 0.012, h);
  return new ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: false,
    curveSegments: 5,
  })
    .rotateY(Math.PI / 2)
    .translate(-length / 2, 0, 0);
}
function taperedLeg() {
  const height = UNDER - FLOOR,
    leg = new RoundedBoxGeometry(LEG_TOP, height, LEG_TOP, 2, 0.008),
    position = leg.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const t = (position.getY(i) + height / 2) / height,
      scale = LEG_FOOT / LEG_TOP + (1 - LEG_FOOT / LEG_TOP) * t;
    position.setX(i, position.getX(i) * scale);
    position.setZ(i, position.getZ(i) * scale);
  }
  leg.computeVertexNormals();
  return leg;
}

function tableGeometry() {
  const legs: Part[] = [],
    ends: Part[] = [];
  const apronY = UNDER - 0.0425,
    stretcherY = 0.15;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      legs.push([
        taperedLeg(),
        [sx * LEG_X, (FLOOR + UNDER) / 2, Z + sz * LEG_Z],
        1,
      ]);
      // Through-tenons of the long aprons, on the legs' end faces.
      ends.push([
        new RoundedBoxGeometry(0.008, 0.058, 0.02, 1, 0.002),
        [sx * (LEG_X + legHalf(apronY)), apronY, Z + sz * (LEG_Z + 0.005)],
        0,
      ]);
      // Through-tenons of the short aprons and stretchers, on the side faces.
      for (const [y, h] of [
        [apronY, 0.058],
        [stretcherY, 0.03],
      ])
        ends.push([
          new RoundedBoxGeometry(0.02, h, 0.008, 1, 0.002),
          [sx * LEG_X, y, Z + sz * (LEG_Z + legHalf(y))],
          2,
        ]);
    }
    const inner = LEG_X - legHalf(apronY);
    legs.push(
      [
        new BoxGeometry(0.026, 0.085, 2 * (LEG_Z - legHalf(apronY)) + 0.02),
        [sx * LEG_X, apronY, Z],
        2,
      ],
      [
        new BoxGeometry(0.036, 0.045, 2 * (LEG_Z - legHalf(stretcherY)) + 0.02),
        [sx * LEG_X, stretcherY, Z],
        2,
      ],
      [
        new BoxGeometry(2 * inner + 0.02, 0.085, 0.026),
        [0, apronY, Z + sx * (LEG_Z + 0.005)],
        0,
      ],
    );
    // Breadboard ends stand 3 mm proud; three pegs pin each tongue.
    for (const dz of [-0.45, 0, 0.45])
      ends.push([
        new RoundedBoxGeometry(0.017, 0.004, 0.017, 1, 0.003),
        [sx * 1.185, 0.6115, Z + dz],
        1,
      ]);
  }
  const top = merge([
    [topSlab(2.28, 1.37, 0.07), [0, 0.575, Z], 0],
    [
      new RoundedBoxGeometry(0.15, 0.076, 1.37, 2, 0.008),
      [-1.2165, 0.575, Z],
      2,
    ],
    [
      new RoundedBoxGeometry(0.15, 0.076, 1.37, 2, 0.008),
      [1.2165, 0.575, Z],
      2,
    ],
  ]);
  return { top, base: merge(legs), ends: merge(ends) };
}

/** Plain linen weave with indigo kasuri bands along both long edges. */
function runnerMaps() {
  const width = 256,
    height = 768,
    along = 0.12,
    across = 0.36,
    noise = tiledNoise(611),
    color = new ImageData(width, height),
    surface = new ImageData(width, height),
    linen = [190, 172, 138],
    indigo = [44, 56, 80];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = x / width,
        t = y / height,
        over = (x + y) % 2,
        slub = fbm(noise, s * 8, t * 64, 8, 2, 64),
        edge = Math.min(t, 1 - t) * across,
        motif =
          Math.abs((((s * along) / 0.02) % 1) - 0.5) +
            Math.abs((edge - 0.03) / 0.012) <
          0.36,
        dyed =
          (edge > 0.012 && edge < 0.0155) ||
          (edge > 0.02 && edge < 0.04 && !motif) ||
          (edge > 0.044 && edge < 0.0465),
        base = dyed ? indigo : linen,
        tone =
          (0.86 + over * 0.1 + (slub - 0.5) * 0.22) * (edge < 0.004 ? 0.8 : 1),
        i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) color.data[i + c] = base[c] * tone;
      color.data[i + 3] = 255;
      surface.data[i] = (0.35 + over * 0.35 + slub * 0.3) * 255;
      surface.data[i + 1] = 0.9 * 255;
      surface.data[i + 3] = 255;
    }
  const maps = {
    color: imageTexture(color, true),
    surface: imageTexture(surface, false),
  };
  maps.color.repeat.set(2.05 / along, 1);
  maps.surface.repeat.set(2.05 / along, 1);
  return maps;
}

const FRINGE = 88;
function Fringe() {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const random = createRandom(733),
      dummy = new Object3D();
    for (let i = 0; i < FRINGE * 2; i++) {
      const side = i < FRINGE ? -1 : 1,
        k = i % FRINGE,
        length = 0.034 + random() * 0.014;
      dummy.position.set(
        side * (1.025 + length / 2 - 0.004),
        0.6118,
        -2.36 - 0.176 + ((k + 0.5) / FRINGE) * 0.352 + (random() - 0.5) * 0.002,
      );
      dummy.rotation.set(0, (random() - 0.5) * 0.22, (random() - 0.5) * 0.04);
      dummy.scale.set(length, 1, 1);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    }
    mesh.current!.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, FRINGE * 2]}>
      <boxGeometry args={[1, 0.0012, 0.0017]} />
      <meshStandardMaterial color="#b3a282" roughness={0.95} />
    </instancedMesh>
  );
}

const tableMaps = once(() => ({
  wood: woodMaps([102, 67, 46], [76, 48, 32], 301),
  runner: runnerMaps(),
}));

/** The host's low tea table, its runner, the guest cups and the tea tools. */
export function TeaTable() {
  const geometry = useMemo(tableGeometry, []);
  const { wood, runner } = tableMaps();
  const materials = useMemo(() => {
    const make = (color: string, clearcoat: number, clearcoatRoughness = 0.3) =>
      new MeshPhysicalMaterial({
        color,
        map: wood.color,
        roughnessMap: wood.surface,
        bumpMap: wood.surface,
        bumpScale: 0.6,
        roughness: 1,
        clearcoat,
        clearcoatRoughness,
      });
    return {
      top: make('#ffffff', 0.45),
      base: make('#a28b7c', 0.2),
      ends: make('#7a6252', 0.1),
      tray: make('#d09060', 1, 0.08),
    };
  }, [wood]);
  useEffect(
    () => () => {
      [geometry, materials].forEach((set) =>
        Object.values(set).forEach((item) => item.dispose()),
      );
    },
    [geometry, materials],
  );
  return (
    <group>
      <mesh
        geometry={geometry.top}
        material={materials.top}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geometry.base}
        material={materials.base}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geometry.ends}
        material={materials.ends}
        castShadow
        receiveShadow
      />
      <mesh position={[0, 0.6115, -2.36]} receiveShadow>
        <boxGeometry args={[2.05, 0.003, 0.36]} />
        <meshStandardMaterial
          map={runner.color}
          roughnessMap={runner.surface}
          bumpMap={runner.surface}
          bumpScale={0.8}
          roughness={1}
        />
      </mesh>
      {[-1, 1].map((side) => (
        <Solid
          key={side}
          position={[side * 1.01, 0.6118, -2.36]}
          size={[0.03, 0.0036, 0.36]}
          color="#8d8068"
          surface="cloth"
          cast={false}
        />
      ))}
      <Fringe />
      <Cup position={[-0.58, 0.68, -2.18]} color="#6e7d6c" />
      <Cup position={[0.58, 0.68, -2.34]} color="#b7a88c" />
      <TeaService lacquer={materials.tray} />
    </group>
  );
}
