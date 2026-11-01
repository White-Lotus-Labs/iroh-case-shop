import {
  BoxGeometry,
  BufferAttribute,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  MathUtils,
  PlaneGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { useCanvasTexture } from '../Surfaces';
import type { Point } from '../stations';
import { createRandom } from '../motion/dynamics';
import { merge, paint, place, useBuilt } from './craft';

/** Metres: half the hung width, the drop below the loops, the slit and its spread at the hem. */
const CLOTH = { half: 1.2, drop: 0.44, slit: 0.008, splay: 0.04 };
/** Andrii's Jasmine Dragon crest, centred on the slit; `depth` is below the cloth top. */
const CREST = { radius: 0.095, depth: 0.19 };
const ROD = 0.013,
  LOOP = ROD + 0.006,
  /** Cloth top, below the rod centre, where the loop tabs are sewn on. */
  TOP = -(LOOP + 0.012),
  LOOPS = [0.05, 0.35, 0.65, 0.95],
  DYE = '#3b4d34',
  TEX = [2048, 384] as const;

function drawNoren(ctx: CanvasRenderingContext2D) {
  const [w, h] = TEX,
    random = createRandom(733),
    sx = w / (2 * CLOTH.half),
    sy = h / CLOTH.drop;
  ctx.fillStyle = DYE;
  ctx.fillRect(0, 0, w, h);
  // Uneven dye: broad soft clouds, then faint streaks where it ran down the warp.
  for (let i = 0; i < 70; i++) {
    const x = random() * w,
      y = random() * h,
      r = 40 + random() * 160,
      tone = random() > 0.5 ? '16,28,12' : '120,140,100',
      glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, `rgba(${tone},${0.06 + random() * 0.07})`);
    glow.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(${random() > 0.5 ? '14,24,12' : '110,130,92'},${0.02 + random() * 0.03})`;
    ctx.fillRect(random() * w, 0, 1 + random() * 3, h);
  }
  // Resist-dyed crest: an undyed disc holding a dyed ring (0.2 R to 0.6 R), edges bled.
  const cx = w / 2,
    cy = CREST.depth * sy,
    rx = CREST.radius * sx,
    ry = CREST.radius * sy;
  ctx.filter = 'blur(0.8px)';
  ctx.fillStyle = '#cdc3a6';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = DYE;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.6, ry * 0.6, 0, 0, Math.PI * 2);
  ctx.ellipse(cx, cy, rx * 0.2, ry * 0.2, 0, 0, Math.PI * 2);
  ctx.fill('evenodd');
  ctx.filter = 'none';
  // Weft slubs over everything, so the crest is in the weave and not on top of it.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle =
      random() > 0.5
        ? `rgba(205,212,182,${random() * 0.07})`
        : `rgba(10,16,8,${random() * 0.09})`;
    ctx.fillRect(random() * w, random() * h, 2 + random() * 10, 1);
  }
  // Folded hems read as a double layer, with a running stitch just inside each edge.
  const hem = 0.012,
    stitch = 0.008;
  ctx.fillStyle = 'rgba(8,14,6,0.22)';
  ctx.fillRect(0, h - hem * sy, w, hem * sy);
  ctx.fillRect(0, 0, w, 0.014 * sy);
  for (const x of [0, w / 2 - hem * sx, w / 2, w - hem * sx])
    ctx.fillRect(x, 0, hem * sx, h);
  ctx.strokeStyle = 'rgba(214,204,170,0.3)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(0, h - stitch * sy);
  ctx.lineTo(w, h - stitch * sy);
  for (const x of [
    stitch * sx,
    w / 2 - stitch * sx,
    w / 2 + stitch * sx,
    w - stitch * sx,
  ]) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.stroke();
}

/**
 * Soft folds that deepen toward the hem, at x with the slit closed (`side * u * half`),
 * so the two halves of the crest meet across the slit.
 */
const fold = (side: -1 | 1, u: number, v: number) => {
  const closed = side * u * CLOTH.half;
  return (
    (0.008 + 0.03 * v) *
    MathUtils.smoothstep(v, 0, 0.25) *
    (0.55 * Math.sin(closed * 7.9 + 0.4) +
      0.3 * Math.sin(closed * 15.3 + 1.7) +
      0.18 * Math.sin(closed * 29 + 0.9))
  );
};

/**
 * Where the cloth of panel `side` hangs, relative to the rod centre; `u` runs from the
 * slit (0) to the outer edge (1) and `v` from the top (0) to the hem (1). The panels
 * part only below the crest (v 0.65).
 */
export function drape(side: -1 | 1, u: number, v: number): Point {
  const { half, drop, slit, splay } = CLOTH,
    belly = 0.012 * v ** 1.5 * Math.sin(Math.PI * u),
    nearest = Math.min(...LOOPS.map((at) => Math.abs(u - at))),
    // Between loops the top edge dips; each panel's hem sags a little mid-width.
    scallop = 0.0035 * (1 - Math.cos(Math.PI * Math.min(1, nearest / 0.15))),
    sag = 0.022 * v * v * Math.sin(Math.PI * u);
  return [
    side *
      (slit / 2 +
        u * (half - slit / 2) +
        splay * MathUtils.smoothstep(v, 0.6, 1) * (1 - u) ** 2),
    TOP - v * drop - scallop * (1 - MathUtils.smoothstep(v, 0, 0.18)) - sag,
    fold(side, u, v) + belly,
  ];
}

/** Every vertex samples the texel at `[u, v]`, so small parts take one dye tone. */
function flatUv(geometry: BufferGeometry, [u, v]: [number, number]) {
  const count = geometry.attributes.position.count;
  geometry.setAttribute(
    'uv',
    new BufferAttribute(
      Float32Array.from({ length: count * 2 }, (_, i) => (i % 2 ? v : u)),
      2,
    ),
  );
  return geometry;
}

function panel(side: -1 | 1) {
  const geometry = new PlaneGeometry(1, 1, 64, 20),
    position = geometry.attributes.position,
    uv = geometry.attributes.uv,
    tint = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const across = position.getX(i) + 0.5,
      v = 0.5 - position.getY(i),
      u = side < 0 ? 1 - across : across;
    position.setXYZ(i, ...drape(side, u, v));
    uv.setXY(i, 0.5 + (side * u) / 2, 1 - v);
    // Baked occlusion: fold valleys darken, so the folds read from across the room.
    tint.fill(
      Math.min(1.08, Math.max(0.72, 0.94 + 6 * fold(side, u, v))),
      i * 3,
      i * 3 + 3,
    );
  }
  geometry.setAttribute('color', new BufferAttribute(tint, 3));
  geometry.computeVertexNormals();
  // A rolled hem down both sides and along the bottom gives the edge real thickness.
  const outline = [
    ...Array.from({ length: 13 }, (_, i) => drape(side, 0, i / 12)),
    ...Array.from({ length: 47 }, (_, i) => drape(side, (i + 1) / 48, 1)),
    ...Array.from({ length: 13 }, (_, i) => drape(side, 1, 1 - i / 12)),
  ].map((p) => new Vector3(...p));
  const hem = new TubeGeometry(
    new CatmullRomCurve3(outline, false, 'centripetal'),
    220,
    0.0035,
    5,
  );
  const loops = LOOPS.flatMap((at) => {
    const [x] = drape(side, at, 0);
    return [
      place(
        new CylinderGeometry(LOOP, LOOP, 0.035, 12, 1, true),
        [x, 0, 0],
        [0, 0, Math.PI / 2],
      ),
      place(new BoxGeometry(0.035, -TOP - LOOP + 0.004, 0.004), [
        x,
        (TOP - LOOP) / 2,
        0,
      ]),
    ];
  });
  return [
    geometry,
    paint(flatUv(hem, [0.25, 0.01]), '#fff'),
    ...loops.map((part) => paint(flatUv(part, [0.25, 0.99]), '#fff')),
  ];
}

const buildNoren = () => merge([...panel(-1), ...panel(1)]);

/**
 * A split noren in dyed cloth on a rod at `position`; `span` is the rod length,
 * post to post. The two panels meet at the crest and part a little toward the hem.
 */
export function Noren({ position, span }: { position: Point; span: number }) {
  const cloth = useCanvasTexture(...TEX, drawNoren);
  const geometry = useBuilt(buildNoren);
  return (
    <group name="noren" position={position}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[ROD, ROD, span, 16]} />
        <meshStandardMaterial color="#2d1c12" roughness={0.6} />
      </mesh>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          vertexColors
          map={cloth}
          roughness={0.92}
          sheen={0.35}
          sheenRoughness={0.75}
          sheenColor="#56654b"
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}
