import { useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Object3D,
  Path,
  Quaternion,
  Shape,
  TorusGeometry,
  Vector2,
  Vector3,
  type Curve,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Point } from '../stations';
import { createRandom } from '../motion/dynamics';
import { canvasTexture, once, useSurfaceMaps } from '../Surfaces';
import {
  block,
  cord,
  merge,
  paint,
  taperedTube,
  useBuilt,
  WoodMaterial,
} from './craft';

type Instance = { matrix: Matrix4; color: Color };
const dummy = new Object3D();
function instance(
  position: Vector3 | Point,
  rotation: Point,
  scale: Point,
  color: Color,
): Instance {
  if (Array.isArray(position)) dummy.position.set(...position);
  else dummy.position.copy(position);
  dummy.rotation.set(...rotation);
  dummy.scale.set(...scale);
  dummy.updateMatrix();
  return { matrix: dummy.matrix.clone(), color };
}

/** An instanced mesh whose matrices and colours are written once. */
function Instances({
  geometry,
  items,
  children,
  cast = true,
}: {
  geometry: BufferGeometry;
  items: Instance[];
  children: ReactNode;
  cast?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current!;
    items.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      mesh.setColorAt(i, item.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, undefined, items.length]}
      castShadow={cast}
      receiveShadow
    >
      {children}
    </instancedMesh>
  );
}

/** A lumpy unit blob; displacement is position-hashed so shared vertices stay welded. */
function blobGeometry() {
  const geometry = mergeVertices(new IcosahedronGeometry(1, 2)),
    p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i),
      d =
        1 +
        0.16 * Math.sin(x * 6.1 + y * 2.3) * Math.sin(z * 5.2 + x * 1.7) +
        0.08 * Math.sin(y * 11 + z * 7);
    p.setXYZ(i, x * d, y * d, z * d);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function drawNeedles(ctx: CanvasRenderingContext2D, alpha: boolean) {
  const random = createRandom(alpha ? 61 : 62),
    size = alpha ? 128 : 256;
  if (!alpha) {
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect(0, 0, size, size);
  }
  const tufts = alpha ? 5 : 90;
  for (let t = 0; t < tufts; t++) {
    const cx = alpha ? 64 + (random() - 0.5) * 50 : random() * size,
      cy = alpha ? 64 + (random() - 0.5) * 50 : random() * size;
    for (let n = 0; n < 14; n++) {
      const angle = random() * Math.PI * 2,
        length = size * (alpha ? 0.18 : 0.05) * (0.6 + random() * 0.6),
        light = 90 + random() * 150;
      ctx.strokeStyle = `rgb(${light},${light},${light * 0.95})`;
      ctx.lineWidth = alpha ? 2.2 : 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
      ctx.stroke();
    }
  }
}
const needleMaps = once(() => ({
  needles: canvasTexture(256, 256, (ctx) => drawNeedles(ctx, false)),
  tuft: canvasTexture(128, 128, (ctx) => drawNeedles(ctx, true)),
}));

const trunkTile: [number, number] = [0.3, 0.07];
const GREENS = ['#2c4420', '#3a5526', '#4b652c', '#5d7532'];

/** Trunk, branches, surface roots, foliage pads and moss for one tree; origin at soil level. */
function growBonsai(seed: number) {
  const random = createRandom(seed),
    jitter = (amount: number) => (random() - 0.5) * amount,
    lean = random() > 0.5 ? 1 : -1;
  const trunk = new CatmullRomCurve3(
    [
      [0, 0, 0],
      [0.045 * lean, 0.1, 0.02],
      [-0.035 * lean, 0.2, jitter(0.04)],
      [0.05 * lean, 0.3, jitter(0.04)],
      [0.005, 0.4, jitter(0.03)],
      [0.035 * lean, 0.48, 0],
    ].map(([x, y, z]) => new Vector3(x, y, z)),
  );
  const trunkRadius = (t: number) =>
    0.036 * (1 - t) ** 0.9 + 0.007 + 0.03 * Math.exp(-t * 16);
  const bark: BufferGeometry[] = [
      paint(taperedTube(trunk, trunkRadius, 44, 10, trunkTile), '#5b4a3b'),
    ],
    blobs: Instance[] = [],
    cards: Instance[] = [];
  const pad = (centre: Vector3, rx: number, ry: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2,
        r = Math.sqrt(random()),
        height = (1 - r * r) ** 0.5 * (0.35 + random() * 0.65),
        size = rx * (0.24 + random() * 0.14),
        tone = new Color(
          GREENS[Math.min(3, Math.floor(height * 3 + random()))],
        );
      blobs.push(
        instance(
          new Vector3(
            centre.x + Math.cos(angle) * r * rx,
            centre.y + (height - 0.3) * ry,
            centre.z + Math.sin(angle) * r * rx * 0.85,
          ),
          [random() * 3, random() * 3, random() * 3],
          [size, size * 0.62, size],
          tone,
        ),
      );
    }
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2,
        r = 0.7 + random() * 0.4,
        size = rx * (0.5 + random() * 0.3);
      cards.push(
        instance(
          new Vector3(
            centre.x + Math.cos(angle) * r * rx,
            centre.y + (random() - 0.2) * ry * 0.8,
            centre.z + Math.sin(angle) * r * rx * 0.85,
          ),
          [-Math.PI / 2 + jitter(1.4), jitter(1), angle],
          [size, size, size],
          new Color(GREENS[1 + Math.floor(random() * 3)]),
        ),
      );
    }
  };
  const branches = 6;
  for (let k = 0; k < branches; k++) {
    const t = 0.3 + k * 0.105,
      angle = k * 2.4 + seed + jitter(0.5),
      start = trunk.getPointAt(t),
      length = 0.21 - k * 0.022,
      dir = new Vector3(Math.cos(angle), 0, Math.sin(angle)),
      side = new Vector3(-dir.z, 0, dir.x).multiplyScalar(jitter(0.05)),
      curve = new CatmullRomCurve3([
        start,
        start
          .clone()
          .addScaledVector(dir, length * 0.3)
          .add(new Vector3(0, -0.012, 0)),
        start
          .clone()
          .addScaledVector(dir, length * 0.65)
          .add(side)
          .add(new Vector3(0, -0.006, 0)),
        start
          .clone()
          .addScaledVector(dir, length)
          .add(new Vector3(0, 0.02, 0)),
      ]),
      r0 = trunkRadius(t) * 0.55;
    bark.push(
      paint(
        taperedTube(curve, (s) => r0 * (1 - s * 0.7), 14, 6, trunkTile),
        '#5b4a3b',
      ),
    );
    pad(
      curve.getPointAt(1).add(new Vector3(0, 0.022, 0)),
      0.065 + length * 0.28,
      0.045,
      20,
    );
    pad(curve.getPointAt(0.55).add(new Vector3(0, 0.03, 0)), 0.045, 0.03, 8);
  }
  pad(trunk.getPointAt(1).add(new Vector3(0, 0.035, 0)), 0.1, 0.07, 30);
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + jitter(0.6),
      length = 0.06 + random() * 0.05,
      root = new CatmullRomCurve3([
        new Vector3(0, 0.012, 0),
        new Vector3(
          Math.cos(angle) * length * 0.5,
          0.006,
          Math.sin(angle) * length * 0.5,
        ),
        new Vector3(Math.cos(angle) * length, -0.006, Math.sin(angle) * length),
      ]);
    bark.push(
      paint(
        taperedTube(root, (s) => 0.02 * (1 - s * 0.85), 8, 6, trunkTile),
        '#4f4032',
      ),
    );
  }
  for (let i = 0; i < 34; i++) {
    const angle = random() * Math.PI * 2,
      r = 0.05 + random() * 0.14,
      size = 0.012 + random() * 0.018,
      stone = random() > 0.8;
    blobs.push(
      instance(
        [Math.cos(angle) * r, 0, Math.sin(angle) * r * 0.55],
        [random() * 3, random() * 3, random() * 3],
        stone
          ? [size * 0.7, size * 0.5, size * 0.6]
          : [size * 1.6, size * 0.4, size * 1.4],
        new Color(stone ? '#6d675c' : random() > 0.5 ? '#3d4a22' : '#56602c'),
      ),
    );
  }
  return { bark: merge(bark), blobs, cards };
}

function roundedRect(path: Path, w: number, d: number, r: number) {
  path.moveTo(-w / 2 + r, -d / 2);
  path.lineTo(w / 2 - r, -d / 2);
  path.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  path.lineTo(w / 2, d / 2 - r);
  path.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  path.lineTo(-w / 2 + r, d / 2);
  path.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  path.lineTo(-w / 2, -d / 2 + r);
  path.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  return path;
}

const POT = { w: 0.46, d: 0.3, h: 0.07, foot: 0.014, wall: 0.014 };
/** A shallow glazed rectangular pot with an eased rim, floor and four cloud feet. */
function potGeometry() {
  const { w, d, h, foot, wall } = POT,
    shape = roundedRect(new Shape(), w, d, 0.03) as Shape;
  shape.holes.push(roundedRect(new Path(), w - wall * 2, d - wall * 2, 0.02));
  const walls = new ExtrudeGeometry(shape, {
    depth: h - 0.008,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 3,
    curveSegments: 6,
  });
  walls.rotateX(-Math.PI / 2);
  walls.translate(0, foot + 0.004, 0);
  return merge(
    [
      walls,
      block([w - 0.01, 0.012, d - 0.01], [0, foot + 0.006, 0], '#ffffff'),
      ...[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) =>
          block(
            [0.05, foot, 0.035],
            [sx * (w / 2 - 0.05), foot / 2, sz * (d / 2 - 0.04)],
            '#ffffff',
            {
              radius: 0.005,
            },
          ),
        ),
      ),
    ].map((part) => paint(part, '#ffffff')),
  );
}

function standGeometry() {
  const tone = '#3d2517';
  return merge([
    block([0.64, 0.036, 0.42], [0, 0.302, 0], '#4a2c1a'),
    block([0.6, 0.05, 0.38], [0, 0.26, 0], tone),
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) =>
        block([0.045, 0.28, 0.045], [sx * 0.27, 0.14, sz * 0.165], tone),
      ),
    ),
    ...[-1, 1].map((sz) =>
      block([0.56, 0.03, 0.03], [0, 0.04, sz * 0.165], tone),
    ),
    ...[-1, 1].map((sx) =>
      block([0.03, 0.03, 0.34], [sx * 0.27, 0.04, 0], tone),
    ),
  ]);
}
const STAND_H = 0.32;

/** A pruned tree in a shallow glazed pot; `stand` lifts it on a low wooden table. */
export function Bonsai({
  position,
  scale = 1,
  seed = 1,
  stand = false,
  glaze = '#34414f',
  turn = 0,
}: {
  position: Point;
  scale?: number;
  seed?: number;
  stand?: boolean;
  glaze?: string;
  turn?: number;
}) {
  const built = useBuilt(() => {
    const tree = growBonsai(seed),
      pot = potGeometry(),
      table = stand ? standGeometry() : null,
      blob = blobGeometry(),
      card = new CircleGeometry(0.5, 6);
    return {
      ...tree,
      ...needleMaps(),
      pot,
      table,
      blob,
      card,
      dispose() {
        [tree.bark, pot, table, blob, card].forEach((item) => item?.dispose());
      },
    };
  });
  const soil = useSurfaceMaps('cloth').color;
  const lift = stand ? STAND_H : 0,
    soilY = POT.foot + POT.h - 0.006;
  return (
    <group position={position} rotation={[0, turn, 0]} scale={scale}>
      {built.table && (
        <mesh geometry={built.table} castShadow receiveShadow>
          <WoodMaterial clearcoat={0.3} />
        </mesh>
      )}
      <group position={[0, lift, 0]}>
        <mesh geometry={built.pot} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={glaze}
            roughness={0.38}
            clearcoat={0.6}
            clearcoatRoughness={0.15}
          />
        </mesh>
        <mesh position={[0, soilY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[POT.w - 0.03, POT.d - 0.03]} />
          <meshStandardMaterial color="#3b3122" map={soil} roughness={1} />
        </mesh>
        <group position={[0.04, soilY, 0]}>
          <mesh geometry={built.bark} castShadow receiveShadow>
            <WoodMaterial />
          </mesh>
          <Instances geometry={built.blob} items={built.blobs}>
            <meshStandardMaterial map={built.needles} roughness={0.85} />
          </Instances>
          <Instances geometry={built.card} items={built.cards} cast={false}>
            <meshStandardMaterial
              map={built.tuft}
              alphaTest={0.4}
              side={DoubleSide}
              roughness={0.85}
            />
          </Instances>
        </group>
      </group>
    </group>
  );
}

/** One lanceolate leaf along +x with a raised midrib and a drooping tip. */
function leafGeometry() {
  const steps = 10,
    length = 0.14,
    positions: number[] = [],
    uvs: number[] = [],
    index: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps,
      width = 0.011 * Math.sin(Math.PI * Math.min(1, s ** 0.6)) * (1 - s * 0.3),
      x = s * length,
      droop = -0.035 * s * s;
    positions.push(
      x,
      droop - 0.0025,
      -width,
      x,
      droop,
      0,
      x,
      droop - 0.0025,
      width,
    );
    uvs.push(s, 0, s, 0.5, s, 1);
    if (i < steps) {
      const a = i * 3;
      index.push(
        a,
        a + 3,
        a + 1,
        a + 1,
        a + 3,
        a + 4,
        a + 1,
        a + 4,
        a + 2,
        a + 2,
        a + 4,
        a + 5,
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

const UP = new Vector3(0, 1, 0);
/**
 * Leaves on stalks along `stem`, as one vertex-coloured geometry: each stalk starts on
 * the stem and each blade's base overlaps its stalk, so no leaf floats beside the branch.
 * `face` points at the room. `turn` swings a leaf off the stem's heading as seen from the
 * room, `rise` tips it toward the room, and each blade turns its face,
 * not its edge, to the room and the light above.
 */
export function stemLeaves(
  stem: Curve<Vector3>,
  leaves: { t: number; turn: number; rise?: number }[],
  {
    length = 0.085,
    width = 0.04,
    stalk = 0.012,
    color = '#1f3322',
    face = [0, 0, 1] as Point,
  } = {},
) {
  const blade = leafGeometry()
    .scale(length / 0.14, 0.35, width / 0.019)
    .rotateY(-Math.PI / 2)
    .translate(0, 0, stalk - 0.002);
  const room = new Vector3(...face).normalize();
  const lit = room.clone().addScaledVector(UP, 0.5);
  const basis = new Matrix4(),
    rotation = new Quaternion();
  const parts = leaves.flatMap(({ t, turn, rise = 0.25 }) => {
    const at = stem.getPointAt(t);
    const heading = stem
      .getTangentAt(t)
      .projectOnPlane(room)
      .normalize()
      .applyAxisAngle(room, turn)
      .addScaledVector(room, Math.sin(rise))
      .normalize();
    const normal = lit
      .clone()
      .addScaledVector(heading, -lit.dot(heading))
      .normalize()
      .applyAxisAngle(heading, 0.3 * Math.sign(turn));
    basis.makeBasis(normal.clone().cross(heading), normal, heading);
    rotation.setFromRotationMatrix(basis);
    const tip = at.clone().addScaledVector(heading, stalk);
    return [
      paint(cord(at.toArray(), tip.toArray(), 0.0016), '#3b3a1e'),
      paint(
        blade.clone().applyQuaternion(rotation).translate(at.x, at.y, at.z),
        color,
      ),
    ];
  });
  blade.dispose();
  return merge(parts);
}

function drawLeaf(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 32);
  gradient.addColorStop(0, '#b8b8a8');
  gradient.addColorStop(0.5, '#e8e8d6');
  gradient.addColorStop(1, '#b8b8a8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = 'rgba(255,255,235,.7)';
  ctx.fillRect(0, 15, 256, 2);
  ctx.fillStyle = 'rgba(80,90,60,.18)';
  for (const y of [5, 9, 23, 27]) ctx.fillRect(0, y, 256, 1);
}
const bambooLeafMap = once(() => canvasTexture(256, 32, drawLeaf));

/** Culms with node rings and bloom bands, twigs, and instanced leaves in a tall planter. */
function growBamboo(seed: number) {
  const random = createRandom(seed),
    jitter = (amount: number) => (random() - 0.5) * amount,
    culms: BufferGeometry[] = [],
    leaves: Instance[] = [],
    soil = 0.4,
    up = new Vector3(0, 1, 0);
  const leafFan = (at: Vector3, heading: number, count: number) => {
    for (let i = 0; i < count; i++)
      leaves.push(
        instance(
          at,
          [jitter(0.8), heading + jitter(1.6), -0.25 - random() * 0.7],
          [0.8 + random() * 0.5, 1, 0.9 + random() * 0.4],
          new Color(
            random() > 0.9 ? '#9c9747' : GREENS[1 + Math.floor(random() * 3)],
          ).multiplyScalar(1.15),
        ),
      );
  };
  for (let c = 0; c < 7; c++) {
    const height = 1.5 + random() * 1.0,
      angle = random() * Math.PI * 2,
      r = random() * 0.12,
      base = new Vector3(Math.cos(angle) * r, soil, Math.sin(angle) * r),
      leanAngle = 2.36 + jitter(2.2),
      lean = new Vector3(
        Math.cos(leanAngle),
        0,
        Math.sin(leanAngle),
      ).multiplyScalar(0.12 + random() * 0.2),
      curve = new CatmullRomCurve3([
        base,
        base
          .clone()
          .addScaledVector(lean, 0.08)
          .add(new Vector3(0, height * 0.33, 0)),
        base
          .clone()
          .addScaledVector(lean, 0.4)
          .add(new Vector3(0, height * 0.66, 0)),
        base
          .clone()
          .add(lean)
          .add(new Vector3(0, height, 0)),
      ]),
      r0 = 0.016 + random() * 0.01,
      radius = (t: number) => r0 * (1 - t * 0.55),
      nodes = Math.round(height / 0.27),
      tone = new Color(['#6a7a34', '#7b8a3a', '#a39552', '#5f6f30'][c % 4]),
      bloom = new Color('#b9b89c'),
      tube = taperedTube(curve, radius, 60, 10, [0.6, 0.2]),
      p = tube.attributes.position,
      colors = new Float32Array(p.count * 3),
      col = new Color();
    for (let i = 0; i < p.count; i++) {
      const t = Math.floor(i / 11) / 60,
        below = (Math.ceil(t * nodes - 1e-6) - t * nodes) / nodes;
      col
        .copy(tone)
        .lerp(bloom, Math.max(0, 1 - below / 0.02) * 0.45)
        .multiplyScalar(0.92 + random() * 0.08);
      col.toArray(colors, i * 3);
    }
    tube.setAttribute('color', new BufferAttribute(colors, 3));
    culms.push(tube);
    for (let k = 1; k <= nodes; k++) {
      const t = k / nodes,
        at = curve.getPointAt(Math.min(t, 0.999)),
        tangent = curve.getTangentAt(Math.min(t, 0.999)),
        ring = new TorusGeometry(radius(t) * 1.04, 0.0028, 4, 18);
      ring.rotateX(Math.PI / 2);
      ring.applyQuaternion(new Quaternion().setFromUnitVectors(up, tangent));
      ring.translate(at.x, at.y, at.z);
      culms.push(paint(ring, tone.clone().multiplyScalar(0.7)));
      if (t < 0.5) continue;
      for (const side of [0, Math.PI]) {
        const heading = leanAngle + side + k * 1.3 + jitter(0.8),
          dir = new Vector3(
            Math.cos(heading),
            0.8,
            Math.sin(heading),
          ).normalize(),
          length = 0.14 + random() * 0.2,
          tip = at
            .clone()
            .addScaledVector(dir, length)
            .add(new Vector3(0, -0.03, 0)),
          twig = new CatmullRomCurve3([
            at,
            at.clone().addScaledVector(dir, length * 0.5),
            tip,
          ]);
        culms.push(
          paint(
            taperedTube(twig, (s) => 0.0028 * (1 - s * 0.6), 6, 4, [0.6, 0.2]),
            tone,
          ),
        );
        leafFan(tip, -heading, 3 + Math.floor(random() * 3));
        leafFan(twig.getPointAt(0.55), -heading, 2);
      }
    }
    leafFan(curve.getPointAt(1), -leanAngle, 7);
  }
  return { culms: merge(culms), leaves };
}

/** A clump of bamboo in a tall dark planter with a gravel top. */
export function BambooPot({ position }: { position: Point }) {
  const built = useBuilt(() => {
    const plant = growBamboo(33),
      leaf = leafGeometry(),
      leafMap = bambooLeafMap(),
      pot = new LatheGeometry(
        [
          [0, 0],
          [0.15, 0],
          [0.16, 0.012],
          [0.2, 0.12],
          [0.214, 0.3],
          [0.21, 0.39],
          [0.222, 0.405],
          [0.226, 0.425],
          [0.212, 0.432],
          [0.2, 0.41],
          [0.19, 0.39],
        ].map(([r, y]) => new Vector2(r, y)),
        40,
      );
    return {
      ...plant,
      leaf,
      leafMap,
      pot,
      dispose() {
        [plant.culms, leaf, pot].forEach((item) => item.dispose());
      },
    };
  });
  const mottle = useSurfaceMaps('paper').color;
  const gravel = useSurfaceMaps('tatami').color;
  return (
    <group position={position}>
      <mesh geometry={built.pot} castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#2f2a25"
          map={mottle}
          roughness={0.4}
          clearcoat={0.5}
          clearcoatRoughness={0.2}
        />
      </mesh>
      <mesh position={[0, 0.395, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.195, 32]} />
        <meshStandardMaterial color="#8c8676" map={gravel} roughness={1} />
      </mesh>
      <mesh geometry={built.culms} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.45} />
      </mesh>
      <Instances geometry={built.leaf} items={built.leaves}>
        <meshStandardMaterial
          map={built.leafMap}
          side={DoubleSide}
          roughness={0.6}
        />
      </Instances>
    </group>
  );
}
