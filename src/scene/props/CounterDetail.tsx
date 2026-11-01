import {
  CylinderGeometry,
  LatheGeometry,
  LineCurve3,
  PlaneGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { Point } from '../stations';
import { createRandom } from '../motion/dynamics';
import { canvasTexture, once } from '../Surfaces';
import {
  block,
  brushText,
  merge,
  paint,
  paper,
  place,
  useBuilt,
  WoodMaterial,
} from './craft';

const brass = '#b08a4a';
const lathe = (profile: number[][], at: Point, segments = 24) =>
  place(
    new LatheGeometry(
      profile.map(([r, y]) => new Vector2(r, y)),
      segments,
    ),
    at,
  );
const thread = (a: Point, b: Point) =>
  new TubeGeometry(
    new LineCurve3(new Vector3(...a), new Vector3(...b)),
    1,
    0.0009,
    4,
  );

/** A merchant's balance (tenbin): wooden base, brass post and beam, two pans on threads. */
function buildScale([x, y, z]: Point) {
  const beamY = y + 0.27,
    arm = 0.13,
    pan = y + 0.09;
  const metal: BufferGeometry[] = [
    place(new CylinderGeometry(0.006, 0.008, 0.25, 10), [x, y + 0.145, z]),
    place(
      new CylinderGeometry(0.004, 0.004, arm * 2, 8),
      [x, beamY, z],
      [Math.PI / 2, 0, 0],
    ),
    place(new SphereGeometry(0.011, 12, 8), [x, beamY + 0.004, z]),
    place(new CylinderGeometry(0.002, 0.004, 0.05, 6), [x, beamY + 0.03, z]),
  ];
  for (const side of [-1, 1]) {
    const pz = z + side * arm;
    metal.push(
      lathe(
        [
          [0, 0],
          [0.05, 0.004],
          [0.056, 0.014],
          [0.052, 0.015],
          [0, 0.006],
        ],
        [x, pan, pz],
      ),
    );
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      metal.push(
        thread(
          [x, beamY - 0.003, pz],
          [x + Math.cos(a) * 0.048, pan + 0.013, pz + Math.sin(a) * 0.048],
        ),
      );
    }
  }
  return {
    metal: merge(metal.map((part) => paint(part, brass))),
    wood: merge([
      block([0.12, 0.022, 0.34], [x, y + 0.011, z], '#2a180e'),
      block([0.05, 0.02, 0.05], [x, y + 0.03, z], '#1c100a'),
    ]),
  };
}

/** Round tea cakes pressed from leaf, wrapped in printed paper; the print is 普洱 (pu-erh). */
function drawWrapper(ctx: CanvasRenderingContext2D) {
  const random = createRandom(88);
  paper(ctx, 0, 0, 256, 256, '#ece2cc', random);
  ctx.strokeStyle = 'rgba(160,40,30,.8)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(128, 128, 104, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(128, 128, 94, 0, Math.PI * 2);
  ctx.stroke();
  brushText(ctx, '普洱', 128, 52, 72, '150,34,24');
  for (let i = 0; i < 40; i++) {
    const a = random() * Math.PI * 2;
    ctx.fillStyle = 'rgba(110,70,30,.12)';
    ctx.fillRect(128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118, 8, 2);
  }
}

const CAKES: [Point, number][] = [
  [[-3.8, 0.896, 5.35], 3],
  [[-2.2, 1.33, 5.65], 2],
];

/** Counter-top life: a balance scale and stacks of wrapped tea cakes. */
export function CounterDetail({ top }: { top: number }) {
  const built = useBuilt(() => {
    const scale = buildScale([-0.64, top, 5.78]),
      cakes = merge(
        CAKES.flatMap(([[x, y, z], count]) =>
          Array.from({ length: count }, (_, i) =>
            place(
              new CylinderGeometry(0.1, 0.1, 0.028, 32),
              [x, y + 0.015 + i * 0.03, z],
              [0, i * 0.7, 0],
            ),
          ),
        ),
      ),
      metal = scale.metal,
      wood = scale.wood,
      wrapper = canvasTexture(256, 256, drawWrapper);
    return {
      metal,
      wood,
      cakes,
      wrapper,
      dispose() {
        [metal, wood, cakes, wrapper].forEach((item) => item.dispose());
      },
    };
  });
  return (
    <group name="counter-detail">
      <mesh geometry={built.metal} castShadow>
        <meshStandardMaterial vertexColors metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh geometry={built.wood} castShadow receiveShadow>
        <WoodMaterial clearcoat={0.4} />
      </mesh>
      <mesh geometry={built.cakes} castShadow receiveShadow>
        <meshStandardMaterial map={built.wrapper} roughness={0.85} />
      </mesh>
    </group>
  );
}

const PLAQUES: [string, string][] = [
  ['煎茶', '五百'],
  ['玉露', '八百'],
  ['抹茶', '七百'],
  ['番茶', '四百'],
  ['焙茶', '四百'],
  ['玄米茶', '四百'],
  ['白茶', '九百'],
];

/** Wooden menu plaques (fuda): one tea name per plaque, price in red below. */
function drawPlaques(ctx: CanvasRenderingContext2D) {
  const random = createRandom(77);
  PLAQUES.forEach(([name, price], i) => {
    const x = i * 128;
    ctx.fillStyle = i % 2 ? '#c7a878' : '#d2b486';
    ctx.fillRect(x, 0, 128, 512);
    for (let k = 0; k < 90; k++) {
      ctx.fillStyle = `rgba(110,70,36,${0.05 + random() * 0.12})`;
      ctx.fillRect(x + random() * 128, 0, 0.8 + random() * 1.6, 512);
    }
    brushText(ctx, name, x + 64, 40, name.length > 2 ? 72 : 84);
    brushText(ctx, price, x + 64, 330, 52, '150,34,24');
  });
}
const plaqueArt = once(() =>
  canvasTexture(128 * PLAQUES.length, 512, drawPlaques),
);

/** A row of menu plaques hung from the nageshi on the waiting room's left wall. */
export function MenuPlaques() {
  const built = useBuilt(() => {
    const faces = PLAQUES.map((_, i) => {
      const face = new PlaneGeometry(0.12, 0.48);
      const uv = face.attributes.uv;
      for (let k = 0; k < uv.count; k++)
        uv.setX(k, (i + uv.getX(k)) / PLAQUES.length);
      return place(face, [-3.972, 1.98, 5.62 + i * 0.24], [0, Math.PI / 2, 0]);
    });
    const face = merge(faces),
      wood = merge(
        PLAQUES.flatMap((_, i) => [
          block([0.012, 0.5, 0.135], [-3.98, 1.98, 5.62 + i * 0.24], '#3a2215'),
          block(
            [0.004, 0.1, 0.004],
            [-3.975, 2.27, 5.62 + i * 0.24],
            '#1c100a',
          ),
        ]),
      );
    return {
      art: plaqueArt(),
      face,
      wood,
      dispose() {
        [face, wood].forEach((item) => item.dispose());
      },
    };
  });
  return (
    <group name="menu-plaques">
      <mesh geometry={built.wood} castShadow>
        <WoodMaterial />
      </mesh>
      <mesh geometry={built.face}>
        <meshStandardMaterial map={built.art} roughness={0.8} />
      </mesh>
    </group>
  );
}
