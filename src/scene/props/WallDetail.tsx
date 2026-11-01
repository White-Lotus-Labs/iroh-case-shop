import {
  CylinderGeometry,
  LatheGeometry,
  PlaneGeometry,
  SphereGeometry,
  Vector2,
} from 'three';
import type { CanvasTexture } from 'three';
import type { Point } from '../stations';
import { createRandom } from '../motion/dynamics';
import { canvasTexture, once } from '../Surfaces';
import {
  block,
  brushText,
  cord,
  Hanger,
  merge,
  paint,
  place,
  useBuilt,
  WoodMaterial,
} from './craft';
import { NAGESHI, WAINSCOT_TOP } from './hanging';

const timber = '#3a2419';
const BANDS: [number, number][] = [
  [WAINSCOT_TOP, NAGESHI.bottom],
  [NAGESHI.top, 3.265],
];

let wear: CanvasTexture | undefined;
// ponytail: one shared, never-disposed 256² texture for every bay; stains repeat per bay.
function wearTexture() {
  wear ??= canvasTexture(256, 256, (ctx) => {
    const random = createRandom(404);
    const edge = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      alpha: number,
    ) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(20,12,6,${alpha})`);
      g.addColorStop(1, 'rgba(20,12,6,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    };
    edge(0, 0, 0, 56, 0.5);
    edge(0, 256, 0, 190, 0.42);
    edge(0, 0, 34, 0, 0.36);
    edge(256, 0, 222, 0, 0.36);
    for (let i = 0; i < 5; i++) {
      const x = 30 + random() * 196,
        y = 60 + random() * 150,
        r = 20 + random() * 50,
        g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(60,38,18,${0.06 + random() * 0.08})`);
      g.addColorStop(1, 'rgba(60,38,18,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
  });
  return wear;
}

/**
 * Trim for a plaster wall whose inner face sits at x = `face`: wainscot stiles, bronze
 * nail covers on the nageshi at each post, and soft grime in every plaster bay.
 */
export function WallTrim({
  face,
  from,
  to,
  posts,
  window,
}: {
  face: number;
  from: number;
  to: number;
  posts: number[];
  /** z range of an opening in the lower plaster band, left bare. */
  window?: [number, number];
}) {
  const side = Math.sign(face),
    at = (depth: number) => face - side * depth;
  const built = useBuilt(() => {
    const stiles = [];
    for (let z = from + 0.22; z < to - 0.1; z += 0.45)
      if (posts.every((p) => Math.abs(p - z) > 0.12))
        stiles.push(block([0.014, 0.84, 0.034], [at(0.046), 0.51, z], timber));
    const covers = posts.flatMap((z) => [
      paint(
        place(
          new CylinderGeometry(0.034, 0.038, 0.01, 18),
          [at(0.093), (NAGESHI.bottom + NAGESHI.top) / 2, z],
          [0, 0, Math.PI / 2],
        ),
        '#8a6a34',
      ),
      paint(
        place(new SphereGeometry(0.013, 12, 8), [
          at(0.098),
          (NAGESHI.bottom + NAGESHI.top) / 2,
          z,
        ]),
        '#b08a48',
      ),
    ]);
    const edges = [...new Set([from, ...posts, to])].sort((a, b) => a - b);
    const bays = edges.slice(1).flatMap((z1, i) => {
      const z0 = edges[i] + 0.07,
        width = z1 - 0.07 - z0,
        mid = (z0 + z1) / 2;
      if (width < 0.1) return [];
      return BANDS.filter(
        (_, band) => band > 0 || !window || mid < window[0] || mid > window[1],
      ).map(([y0, y1]) =>
        place(
          new PlaneGeometry(width, y1 - y0),
          [at(0.004), (y0 + y1) / 2, (z0 + z1 - 0.07) / 2],
          [0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0],
        ),
      );
    });
    const wood = merge(stiles),
      bronze = merge(covers),
      grime = merge(bays);
    return {
      wood,
      bronze,
      grime,
      dispose() {
        [wood, bronze, grime].forEach((g) => g.dispose());
      },
    };
  });
  return (
    <group>
      <mesh geometry={built.wood} receiveShadow>
        <WoodMaterial />
      </mesh>
      <mesh geometry={built.bronze}>
        <meshStandardMaterial vertexColors metalness={0.85} roughness={0.38} />
      </mesh>
      <mesh geometry={built.grime}>
        <meshBasicMaterial
          color="#000"
          map={wearTexture()}
          transparent
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

const VASE = [
  [0, 0],
  [0.022, 0],
  [0.03, 0.03],
  [0.026, 0.07],
  [0.011, 0.1],
  [0.009, 0.125],
  [0.013, 0.135],
  [0.011, 0.137],
].map(([r, y]) => new Vector2(r, y));

/** A staggered display shelf (chigaidana) hung on the left wall, with a bud vase and an incense box. */
export function WallShelf({ position }: { position: Point }) {
  const built = useBuilt(() => {
    const wood = merge([
      block([0.22, 0.026, 0.72], [0, 0, 0.14], '#7a5236'),
      block([0.22, 0.026, 0.6], [0, 0.3, -0.2], '#7a5236'),
      block([0.22, 0.326, 0.024], [0, 0.15, -0.02], '#5e3d26'),
      block([0.014, 0.034, 0.72], [0.104, -0.004, 0.14], '#2a180e'),
      block([0.014, 0.034, 0.6], [0.104, 0.296, -0.2], '#2a180e'),
      block([0.03, 0.05, 0.72], [-0.095, -0.036, 0.14], '#3a2215'),
      block([0.03, 0.05, 0.6], [-0.095, 0.264, -0.2], '#3a2215'),
    ]);
    const ceramic = merge([
      paint(place(new LatheGeometry(VASE, 20), [0.02, 0.012, 0.37]), '#2f3a34'),
      paint(
        place(
          new CylinderGeometry(0.035, 0.035, 0.03, 20),
          [0.02, 0.287, -0.2],
        ),
        '#8e2a22',
      ),
      paint(
        place(
          new CylinderGeometry(0.036, 0.036, 0.012, 20),
          [0.02, 0.308, -0.2],
        ),
        '#1c120c',
      ),
    ]);
    const stem = cord([0.02, 0.125, 0.37], [0.035, 0.288, 0.389], 0.0018);
    return {
      wood,
      ceramic,
      stem,
      dispose() {
        wood.dispose();
        ceramic.dispose();
        stem.dispose();
      },
    };
  });
  return (
    <group position={position}>
      <mesh geometry={built.wood} castShadow receiveShadow>
        <WoodMaterial clearcoat={0.3} />
      </mesh>
      <mesh geometry={built.ceramic} castShadow>
        <meshPhysicalMaterial
          vertexColors
          roughness={0.3}
          clearcoat={0.8}
          clearcoatRoughness={0.15}
        />
      </mesh>
      {/* Stem from inside the vase mouth (0.149 m) to the bud it carries. */}
      <mesh geometry={built.stem}>
        <meshStandardMaterial color="#3a4a26" roughness={0.8} />
      </mesh>
      <mesh position={[0.037, 0.302, 0.391]} scale={[0.018, 0.022, 0.018]}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#f2ece0" roughness={0.6} />
      </mesh>
    </group>
  );
}

/** 茶禅一味 ("tea and Zen are one taste"), right to left in pale gold on a dark board. */
function drawHengaku(ctx: CanvasRenderingContext2D) {
  const random = createRandom(2024);
  ctx.fillStyle = '#2a1a10';
  ctx.fillRect(0, 0, 1024, 320);
  for (let i = 0; i < 320; i++) {
    ctx.fillStyle = `rgba(${random() > 0.5 ? '80,52,32' : '14,8,4'},${0.1 + random() * 0.2})`;
    ctx.fillRect(0, random() * 320, 1024, 0.8 + random() * 2.4);
  }
  [...'茶禅一味'].forEach((char, i) => {
    const x = 896 - i * 256;
    brushText(ctx, char, x + 4, 58, 200, '8,4,2');
    brushText(ctx, char, x, 54, 200, '214,190,132');
  });
  ctx.fillStyle = '#9e2f1c';
  ctx.fillRect(40, 236, 40, 40);
  brushText(ctx, '閑', 60, 239, 34, '236,214,180');
}
const hengakuArt = once(() => canvasTexture(1024, 320, drawHengaku));

/** A framed calligraphy board (hengaku) hung above the nageshi, its top tilted into the room. */
export function Hengaku({ position }: { position: Point }) {
  const built = useBuilt(() => {
    const w = 1.12,
      h = 0.36;
    const frame = merge([
      block([w + 0.08, 0.05, 0.05], [0, h / 2 + 0.015, 0], '#1c100a'),
      block([w + 0.08, 0.05, 0.05], [0, -h / 2 - 0.015, 0], '#1c100a'),
      block([0.05, h + 0.08, 0.05], [w / 2 + 0.015, 0, 0], '#1c100a'),
      block([0.05, h + 0.08, 0.05], [-w / 2 - 0.015, 0, 0], '#1c100a'),
      block([w, h, 0.02], [0, 0, -0.012], '#24150c'),
    ]);
    return {
      frame,
      art: hengakuArt(),
      w,
      h,
      dispose() {
        frame.dispose();
      },
    };
  });
  // Cords from the frame's top back edge (after the tilt) to eyes under the 3.3 m rail.
  const rail = 3.265 - position[1];
  return (
    <group position={position} rotation={[0, Math.PI / 2, 0]}>
      {[-1, 1].map((side) => (
        <Hanger
          key={side}
          hook={[side * 0.5, rail - 0.002, 0.02]}
          ends={[[side * 0.5, 0.211, 0.05]]}
        />
      ))}
      <group rotation={[0.14, 0, 0]} position={[0, 0, 0.04]}>
        <mesh geometry={built.frame} castShadow>
          <WoodMaterial clearcoat={0.6} />
        </mesh>
        <mesh position={[0, 0, 0.0005]}>
          <planeGeometry args={[built.w, built.h]} />
          <meshPhysicalMaterial
            map={built.art}
            roughness={0.45}
            clearcoat={0.5}
            clearcoatRoughness={0.3}
          />
        </mesh>
      </group>
    </group>
  );
}
