import { BufferGeometry, PlaneGeometry, TorusGeometry } from 'three';
import type { Point } from '../stations';
import { createRandom } from '../motion/dynamics';
import { canvasTexture, once, Solid } from '../Surfaces';
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
import { JarSet, type JarKind, type JarSpec } from './Jars';

const BACK = -3.995,
  FRONT = -3.63,
  FROM = 3.47,
  TO = 5.43,
  MID = (FROM + TO) / 2,
  WIDTH = TO - FROM,
  BOARDS = [1.33, 1.77, 2.21, 2.65];

/** A paulownia storage box with an overhanging lid and a cord tied over it. */
function kiriBox(
  [x, y, z]: Point,
  [w, h, d]: Point,
  tone = '#b8916a',
): BufferGeometry[] {
  return [
    block([w, h * 0.78, d], [x, y + h * 0.39, z], tone),
    block([w + 0.008, h * 0.26, d + 0.008], [x, y + h * 0.87, z], tone, {
      grain: 2,
    }),
    block([w + 0.012, 0.007, 0.012], [x, y + h + 0.002, z], '#5a2419'),
    block(
      [0.007, h * 0.9, 0.012],
      [x + w / 2 + 0.005, y + h * 0.55, z],
      '#5a2419',
    ),
  ];
}

const KIRI: [Point, Point, string?][] = [
  [
    [-3.83, 0.896, 5.1],
    [0.24, 0.13, 0.3],
  ],
  [[-3.83, 1.026, 5.08], [0.22, 0.11, 0.26], '#c4a078'],
  [[-3.83, 0.896, 4.72], [0.26, 0.16, 0.2], '#a98460'],
  [
    [-3.83, 2.226, 3.72],
    [0.22, 0.12, 0.28],
  ],
  [[-3.83, 2.346, 3.74], [0.2, 0.1, 0.22], '#c4a078'],
  [[-3.83, 2.715, 5.1], [0.26, 0.14, 0.34], '#a98460'],
];
const KIRI_TEAS = ['玉露', '抹茶', '煎茶', '番茶', '白茶', '銘茶'];

/** Paper box labels: a tea name in ink on each cell of a six-cell atlas. */
function drawBoxLabels(ctx: CanvasRenderingContext2D) {
  const random = createRandom(909);
  KIRI_TEAS.forEach((name, i) => {
    paper(ctx, i * 64, 0, 64, 160, i % 2 ? '#efe6d0' : '#e6dbc2', random);
    brushText(ctx, name, i * 64 + 32, 14, 56);
  });
}

/** One merged mesh of labels on the front face of each kiri box, beside its cord. */
function buildLabels() {
  const faces = KIRI.map(([[x, y, z], [w, h, d]], i) => {
    const face = new PlaneGeometry(Math.min(d * 0.3, 0.07), h * 0.66);
    const uv = face.attributes.uv;
    for (let k = 0; k < uv.count; k++)
      uv.setX(k, (i + uv.getX(k)) / KIRI.length);
    return place(
      face,
      [x + w / 2 + 0.0015, y + h * 0.42, z - d * 0.26],
      [0, Math.PI / 2, 0],
    );
  });
  const geometry = merge(faces);
  return {
    geometry,
    map: boxLabels(),
    dispose() {
      geometry.dispose();
    },
  };
}
const boxLabels = once(() =>
  canvasTexture(64 * KIRI.length, 160, drawBoxLabels),
);

function buildCase() {
  const random = createRandom(512),
    wood: BufferGeometry[] = [],
    iron: BufferGeometry[] = [];
  const tone = (base: number) =>
    `hsl(24, ${38 + random() * 10}%, ${base + random() * 4}%)`;
  wood.push(
    block([0.33, 0.08, WIDTH - 0.04], [BACK + 0.17, 0.04, MID], '#1b110b'),
    block([0.35, 0.78, WIDTH], [BACK + 0.18, 0.47, MID], '#3a2416'),
    block([0.4, 0.036, WIDTH + 0.04], [BACK + 0.2, 0.878, MID], '#5b3620'),
  );
  [0.215, 0.465, 0.715].forEach((y) =>
    [FROM + 0.33, MID, TO - 0.33].forEach((z) => {
      wood.push(
        block([0.022, 0.228, 0.6], [FRONT + 0.006, y, z], tone(20), {
          grain: 2,
        }),
      );
      iron.push(
        place(
          new TorusGeometry(0.02, 0.0028, 6, 14, Math.PI),
          [FRONT + 0.024, y - 0.004, z],
          [0, Math.PI / 2, Math.PI],
        ),
        place(
          new TorusGeometry(0.009, 0.004, 5, 12),
          [FRONT + 0.018, y + 0.012, z],
          [0, Math.PI / 2, 0],
        ),
      );
    }),
  );
  [FROM + 0.025, TO - 0.025].forEach((z) =>
    wood.push(block([0.045, 1.82, 0.045], [FRONT - 0.02, 1.79, z], '#3a2416')),
  );
  BOARDS.forEach((y) =>
    wood.push(
      block([0.35, 0.032, WIDTH + 0.02], [BACK + 0.175, y, MID], tone(30)),
      block(
        [0.014, 0.05, WIDTH + 0.02],
        [FRONT + 0.005, y - 0.008, MID],
        tone(22),
      ),
    ),
  );
  wood.push(
    block([0.41, 0.05, WIDTH + 0.08], [BACK + 0.2, 2.7, MID], '#2e1c12'),
    ...KIRI.flatMap(([at, size, tone]) => kiriBox(at, size, tone)),
  );
  return {
    wood: merge(wood),
    iron: merge(iron.map((part) => paint(part, '#2b2520'))),
    dispose() {
      this.wood.dispose();
      this.iron.dispose();
    },
  };
}

type Item = [JarKind, string, number?, number?];
/** Spreads jars along one shelf, turning their labels toward the room's entrance side. */
function row(y: number, items: Item[], seed: number, from = 3.62, to = 5.28) {
  const random = createRandom(seed);
  return items.map(
    ([kind, glaze, label, scale], i): JarSpec => ({
      kind,
      glaze,
      label,
      scale: scale ?? 1,
      position: [
        -3.82 + (random() - 0.5) * 0.03,
        y,
        from + ((to - from) * i) / Math.max(1, items.length - 1),
      ],
      turn: -0.55 + (random() - 0.5) * 0.4,
      lid: kind === 'canister' && random() > 0.5 ? '#2a1c14' : undefined,
    }),
  );
}

const CELADON = '#8b9f86',
  TENMOKU = '#2c1e17',
  ASH = '#d6ccb6',
  IRON = '#8a3d24',
  INDIGO = '#34435a',
  AMBER = '#a56f30',
  ORIBE = '#4f6b3c',
  RUST = '#6a4632';
const JARS: JarSpec[] = [
  ...row(
    0.896,
    [
      ['chatsubo', TENMOKU, 2, 1.45],
      ['chatsubo', CELADON, 0, 1.3],
      ['bowl', ASH, undefined, 1.1],
    ],
    1,
    3.62,
    4.4,
  ),
  {
    kind: 'bowl',
    glaze: ASH,
    position: [-3.82, 0.918, 4.4],
    scale: 1.06,
  },
  {
    kind: 'bowl',
    glaze: INDIGO,
    position: [-3.82, 0.94, 4.4],
    scale: 1.02,
  },
  ...row(
    1.346,
    [
      ['chatsubo', CELADON, 0],
      ['squat', IRON, 1],
      ['chatsubo', ASH, 3],
      ['canister', ORIBE, 4],
      ['chatsubo', TENMOKU, 6],
      ['squat', AMBER, 2],
      ['chatsubo', INDIGO, 7],
    ],
    2,
  ),
  ...row(
    1.786,
    [
      ['canister', ASH, 5],
      ['canister', RUST, 0],
      ['bottle', CELADON],
      ['canister', INDIGO, 3],
      ['canister', AMBER, 6],
      ['bottle', TENMOKU],
      ['canister', ASH, 1],
      ['canister', ORIBE, 7],
    ],
    3,
  ),
  ...row(
    2.226,
    [
      ['squat', ASH, 4],
      ['bottle', IRON],
      ['squat', ORIBE, 5],
      ['bottle', ASH],
    ],
    4,
    4.12,
    5.28,
  ),
  ...row(
    2.715,
    [
      ['chatsubo', IRON, undefined, 1.25],
      ['chatsubo', ASH, 2, 1.1],
    ],
    5,
    3.7,
    4.45,
  ),
];

/** Tea-merchant shelving on the waiting room's left wall, behind the counter. */
export function CounterShelves() {
  const built = useBuilt(buildCase),
    labels = useBuilt(buildLabels);
  return (
    <group>
      <Solid
        position={[BACK + 0.006, 1.79, MID]}
        size={[0.012, 1.8, WIDTH - 0.04]}
        color="#a8845a"
        surface="plaster"
        cast={false}
      />
      <mesh geometry={built.wood} castShadow receiveShadow>
        <WoodMaterial clearcoat={0.2} />
      </mesh>
      <mesh geometry={built.iron}>
        <meshStandardMaterial vertexColors metalness={0.7} roughness={0.45} />
      </mesh>
      <mesh geometry={labels.geometry}>
        <meshStandardMaterial map={labels.map} roughness={0.85} />
      </mesh>
      <JarSet jars={JARS} />
    </group>
  );
}
