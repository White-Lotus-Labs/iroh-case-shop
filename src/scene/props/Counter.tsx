import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Shape,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { Cup } from '../Ceramics';
import type { Point } from '../stations';
import { createRandom } from '../motion/dynamics';
import { canvasTexture, once, Solid } from '../Surfaces';
import {
  block,
  boxUv,
  brushText,
  Hanger,
  merge,
  paint,
  paper,
  place,
  useBuilt,
  WoodMaterial,
} from './craft';
import { CounterDetail } from './CounterDetail';
import { CounterShelves } from './CounterShelves';
import { JarSet, type JarSpec } from './Jars';
import { Bonsai } from './Plants';

const TOP_Y = 1.33,
  LEFT = -3.975,
  RIGHT = -0.425,
  BACK = 5.515,
  FRONT = 6.625;
const liveEdge = (x: number) =>
  0.007 * Math.sin(x * 2.1 + 1) +
  0.005 * Math.sin(x * 5.3 + 0.4) +
  0.0025 * Math.sin(x * 13.1);

/** The slab: an extruded outline with eased edges, a wavering front and a darker live edge. */
function buildTop() {
  const bevel = 0.016,
    lift = 0.018,
    thickness = 0.1,
    shape = new Shape(),
    steps = 80;
  shape.moveTo(LEFT + bevel, -(BACK + bevel));
  shape.lineTo(RIGHT - bevel, -(BACK + bevel));
  for (let i = 0; i <= steps; i++) {
    const x = RIGHT - bevel - ((RIGHT - LEFT - 2 * bevel) * i) / steps,
      corner = Math.max(
        0,
        1 - Math.min(x - LEFT - bevel, RIGHT - bevel - x) / 0.05,
      );
    shape.lineTo(x, -(FRONT - bevel + liveEdge(x) - corner ** 2 * 0.02));
  }
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness - 2 * lift,
    bevelEnabled: true,
    bevelThickness: lift,
    bevelSize: bevel,
    bevelSegments: 5,
    curveSegments: 4,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, TOP_Y - thickness + lift, 0);
  geometry.computeVertexNormals();
  boxUv(geometry, 0, 0.37);
  const position = geometry.attributes.position,
    base = new Color('#7d4a28'),
    edge = new Color('#4a2814'),
    end = new Color('#5c3319'),
    data = new Float32Array(position.count * 3),
    c = new Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i),
      toFront = FRONT + liveEdge(x) - z,
      toEnd = Math.min(x - LEFT, RIGHT - x);
    c.copy(base)
      .lerp(edge, Math.max(0, 1 - toFront / 0.035) * 0.75)
      .lerp(end, Math.max(0, 1 - toEnd / 0.02) * 0.6);
    c.toArray(data, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(data, 3));
  return geometry;
}

/** Plinth, carcass, framed front and end with tategoshi slats, and small wooden fittings. */
function buildBody() {
  const random = createRandom(77),
    parts: BufferGeometry[] = [],
    frame = '#5a3520',
    slat = () => `hsl(22, ${40 + random() * 8}%, ${15 + random() * 4}%)`;
  parts.push(
    block([3.26, 0.1, 0.8], [-2.2, 0.05, 6.04], '#140c07'),
    block([3.3, 1.13, 0.9], [-2.2, 0.665, 6.05], '#20130b'),
    block([3.3, 0.1, 0.05], [-2.2, 0.15, 6.525], frame),
    block([3.3, 0.13, 0.05], [-2.2, 1.165, 6.525], frame),
    block([3.4, 0.022, 0.07], [-2.2, 1.222, 6.56], '#2c190e'),
  );
  const stiles = [-3.805, -2.72, -1.66, -0.595];
  stiles.forEach((x) =>
    parts.push(block([0.09, 1.13, 0.056], [x, 0.665, 6.53], frame)),
  );
  for (let bay = 0; bay < 3; bay++) {
    const from = stiles[bay] + 0.045,
      to = stiles[bay + 1] - 0.045,
      count = Math.round((to - from) / 0.062),
      pitch = (to - from) / count;
    for (let i = 0; i < count; i++)
      parts.push(
        block(
          [0.024, 0.9, 0.028],
          [from + pitch * (i + 0.5), 0.65, 6.512],
          slat(),
        ),
      );
    parts.push(
      block([to - from, 0.032, 0.036], [(from + to) / 2, 0.9, 6.528], frame),
    );
  }
  [5.645, 6.455].forEach((z) =>
    parts.push(block([0.056, 1.13, 0.09], [-0.525, 0.665, z], frame)),
  );
  parts.push(
    block([0.05, 0.1, 0.9], [-0.525, 0.15, 6.05], frame),
    block([0.05, 0.13, 0.9], [-0.525, 1.165, 6.05], frame),
    block([0.036, 0.032, 0.72], [-0.522, 0.9, 6.05], frame),
  );
  for (let i = 0; i < 11; i++)
    parts.push(
      block([0.028, 0.9, 0.024], [-0.538, 0.65, 5.72 + i * 0.066], slat()),
    );
  return parts;
}

/** Tray, menu stand and the whisk's bamboo parts share the counter's wood material. */
function buildFittings() {
  const parts: BufferGeometry[] = [],
    tray = '#3b1a12';
  const trayAt = (x: number, z: number, w: number, d: number) => [
    block([w, 0.012, d], [x, TOP_Y + 0.006, z], tray, { grain: 0 }),
    ...[-1, 1].flatMap((side) => [
      block(
        [w, 0.024, 0.012],
        [x, TOP_Y + 0.018, z + (side * (d - 0.012)) / 2],
        tray,
      ),
      block(
        [0.012, 0.024, d],
        [x + (side * (w - 0.012)) / 2, TOP_Y + 0.018, z],
        tray,
      ),
    ]),
  ];
  parts.push(...trayAt(-1.36, 6.24, 0.56, 0.2));
  const menu = (geometry: BufferGeometry) =>
    place(geometry, MENU_AT, [0, MENU_TURN, 0]);
  parts.push(
    menu(block([0.28, 0.03, 0.085], [0, 0.015, 0], '#2a180e')),
    menu(block([0.018, 0.34, 0.02], [-0.121, 0.2, 0], '#3a2215')),
    menu(block([0.018, 0.34, 0.02], [0.121, 0.2, 0], '#3a2215')),
    menu(block([0.26, 0.022, 0.022], [0, 0.382, 0], '#3a2215')),
    menu(block([0.26, 0.02, 0.02], [0, 0.04, 0], '#3a2215')),
    menu(block([0.226, 0.32, 0.006], [0, 0.21, -0.006], '#4a2c1a')),
  );
  return parts;
}

/** A tea whisk resting tines-down on its ceramic former, plus its bamboo scoop. */
function buildWhisk() {
  const parts: BufferGeometry[] = [],
    random = createRandom(9),
    bamboo = new Color('#d8c592'),
    tine = (points: [number, number][], angle: number, radius: number) => {
      const curve = new CatmullRomCurve3(
        points.map(
          ([r, y]) => new Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r),
        ),
      );
      return paint(
        new TubeGeometry(curve, 6, radius, 3),
        bamboo.clone().multiplyScalar(0.85 + random() * 0.2),
      );
    };
  for (let i = 0; i < 56; i++)
    parts.push(
      tine(
        [
          [0.011, 0.098],
          [0.021, 0.085],
          [0.03, 0.062],
          [0.031, 0.045],
          [0.026, 0.036],
        ],
        (i / 56) * Math.PI * 2,
        0.0007,
      ),
    );
  for (let i = 0; i < 18; i++)
    parts.push(
      tine(
        [
          [0.007, 0.098],
          [0.012, 0.08],
          [0.013, 0.062],
          [0.011, 0.056],
        ],
        (i / 18) * Math.PI * 2 + 0.1,
        0.0008,
      ),
    );
  parts.push(
    paint(
      new CylinderGeometry(0.0105, 0.0112, 0.07, 18).translate(0, 0.132, 0),
      bamboo,
    ),
    paint(
      new TorusGeometry(0.0118, 0.0014, 5, 20)
        .rotateX(Math.PI / 2)
        .translate(0, 0.097, 0),
      '#2b1a12',
    ),
    paint(
      new TorusGeometry(0.018, 0.001, 4, 24)
        .rotateX(Math.PI / 2)
        .translate(0, 0.088, 0),
      '#2b1a12',
    ),
  );
  const scoop = new BoxGeometry(0.18, 0.0022, 0.0095, 36, 1, 2),
    p = scoop.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i),
      tip = Math.max(0, (x - 0.05) / 0.04);
    p.setXYZ(
      i,
      x,
      p.getY(i) +
        tip * tip * 0.011 +
        z * z * 4 * (tip > 0 ? 1 : 0.3) +
        0.0012 * Math.exp(-(((x + 0.01) / 0.004) ** 2)),
      z * (0.8 + 0.2 * Math.min(1, (x + 0.09) / 0.12)),
    );
  }
  scoop.computeVertexNormals();
  parts.push(
    place(paint(scoop, '#b8945e'), [0.12, 0.0095, 0.13], [0, -0.7, 0]),
  );
  return parts;
}

const lathe = (points: [number, number][], color: string) =>
  paint(
    new LatheGeometry(
      points.map(([r, y]) => new Vector2(r, y)),
      32,
    ),
    color,
  );

/** Former, lidded bowl with saucer, and a copper caddy: turned parts in one glaze mesh. */
function buildCeramics() {
  const whisk = (g: BufferGeometry) => place(g, [-1.95, TOP_Y, 5.92]);
  const bowl = (g: BufferGeometry) => place(g, [-2.36, TOP_Y, 6.12]);
  return [
    whisk(
      lathe(
        [
          [0, 0],
          [0.03, 0],
          [0.032, 0.004],
          [0.026, 0.012],
          [0.02, 0.03],
          [0.019, 0.05],
          [0.021, 0.065],
          [0.018, 0.075],
          [0.008, 0.08],
          [0, 0.081],
        ],
        '#e6e0d2',
      ),
    ),
    bowl(
      lathe(
        [
          [0, 0],
          [0.035, 0],
          [0.037, 0.004],
          [0.07, 0.01],
          [0.077, 0.016],
          [0.072, 0.018],
          [0.036, 0.01],
          [0, 0.01],
        ],
        '#8fa28c',
      ),
    ),
    bowl(
      lathe(
        [
          [0, 0.01],
          [0.025, 0.01],
          [0.026, 0.017],
          [0.045, 0.031],
          [0.058, 0.061],
          [0.062, 0.076],
          [0.058, 0.077],
          [0.054, 0.063],
          [0.04, 0.031],
          [0, 0.025],
        ],
        '#9fb29b',
      ),
    ),
    bowl(
      lathe(
        [
          [0.054, 0.066],
          [0.057, 0.073],
          [0.05, 0.087],
          [0.03, 0.097],
          [0.012, 0.101],
          [0.011, 0.109],
          [0.016, 0.115],
          [0, 0.116],
        ],
        '#9fb29b',
      ),
    ),
  ];
}

function buildCaddy() {
  const at = (g: BufferGeometry) => place(g, [-3.02, TOP_Y, 5.74]);
  return merge([
    at(
      lathe(
        [
          [0, 0],
          [0.044, 0],
          [0.046, 0.003],
          [0.046, 0.13],
          [0.043, 0.132],
        ],
        '#b56a3b',
      ),
    ),
    at(
      lathe(
        [
          [0.0475, 0.104],
          [0.0478, 0.106],
          [0.0478, 0.138],
          [0.045, 0.142],
          [0.02, 0.144],
          [0, 0.145],
        ],
        '#c07a48',
      ),
    ),
  ]);
}

const TEAS: [string, string][] = [
  ['煎茶', '五百'],
  ['玉露', '八百'],
  ['抹茶', '七百'],
  ['番茶', '四百'],
];

function drawSign(ctx: CanvasRenderingContext2D) {
  const random = createRandom(733);
  ctx.fillStyle = '#3a2416';
  ctx.fillRect(0, 0, 1024, 320);
  for (let i = 0; i < 420; i++) {
    const y = random() * 320;
    ctx.fillStyle = `rgba(${random() > 0.5 ? '90,60,38' : '24,14,8'},${0.12 + random() * 0.2})`;
    ctx.fillRect(0, y, 1024, 0.8 + random() * 3);
  }
  ctx.strokeStyle = 'rgba(14,8,4,.8)';
  ctx.lineWidth = 8;
  ctx.strokeRect(26, 26, 972, 268);
  ctx.strokeStyle = 'rgba(214,176,112,.6)';
  ctx.lineWidth = 4;
  ctx.strokeRect(22, 22, 972, 268);
  for (const side of [-1, 1])
    for (let line = 0; line < 3; line++) {
      const x = 512 + side * (190 + line * 26);
      ctx.fillStyle = 'rgba(214,176,112,.45)';
      ctx.fillRect(x - 2, 110 + line * 14, 4, 100 - line * 28);
    }
  brushText(ctx, '茶', 518, 50, 236, '10,6,3');
  brushText(ctx, '茶', 512, 44, 236, '228,190,118');
  ctx.fillStyle = '#9e2f1e';
  ctx.fillRect(900, 216, 44, 44);
  brushText(ctx, '閑', 922, 219, 38, '236,214,180');
}

function drawMenu(ctx: CanvasRenderingContext2D) {
  const random = createRandom(4242);
  paper(ctx, 0, 0, 512, 704, '#e8dbbb', random);
  ctx.strokeStyle = 'rgba(60,38,20,.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, 472, 664);
  brushText(ctx, '御品書', 424, 50, 80);
  ctx.fillStyle = '#a3321f';
  ctx.fillRect(398, 330, 52, 52);
  brushText(ctx, '茶', 424, 334, 44, '232,219,187');
  TEAS.forEach(([name, price], column) => {
    const x = 316 - column * 80;
    ctx.fillStyle = 'rgba(60,38,20,.25)';
    ctx.fillRect(x + 40, 52, 2, 600);
    brushText(ctx, name, x, 60, 56);
    for (let dot = 0; dot < 6; dot++) {
      ctx.fillStyle = 'rgba(24,17,12,.55)';
      ctx.fillRect(x - 2.5, 200 + dot * 34, 5, 5);
    }
    brushText(ctx, price, x, 420, 48, '120,34,22');
  });
}

// Faces both the counter camera and the lantern, so the paper is lit from the front.
const MENU_AT: Point = [-3.02, TOP_Y, 6.32];
const MENU_TURN = 1.05;

const CANISTERS: JarSpec[] = [
  {
    kind: 'canister',
    glaze: '#1d1612',
    lid: '#1d1612',
    position: [-2.72, TOP_Y, 5.76],
    turn: -0.6,
    label: 7,
  },
  {
    kind: 'chatsubo',
    glaze: '#8b9f86',
    position: [-3.28, TOP_Y, 5.78],
    turn: -0.7,
    scale: 0.85,
    label: 0,
  },
  {
    kind: 'canister',
    glaze: '#d6ccb6',
    position: [-2.52, TOP_Y, 5.7],
    turn: -0.5,
    scale: 0.8,
    label: 3,
  },
];
const counterArt = once(() => ({
  menu: canvasTexture(512, 704, drawMenu),
  sign: canvasTexture(1024, 320, drawSign),
}));

/** The waiting-room serving counter, its back-wall shelving and what sits on it. */
export function Counter() {
  const built = useBuilt(() => {
    const top = buildTop(),
      wood = merge([...buildBody(), ...buildFittings()]),
      bamboo = merge(buildWhisk().map((g) => place(g, [-1.95, TOP_Y, 5.92]))),
      ceramics = merge(buildCeramics()),
      caddy = buildCaddy();
    return {
      top,
      wood,
      bamboo,
      ceramics,
      caddy,
      ...counterArt(),
      dispose() {
        [top, wood, bamboo, ceramics, caddy].forEach((item) => item.dispose());
      },
    };
  });
  return (
    <group>
      <CounterShelves />
      <CounterDetail top={TOP_Y} />
      <group position={[-2.2, 1.92, 3.445]} rotation={[0.04, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[1.02, 0.34, 0.03]} />
          <meshStandardMaterial color="#24150c" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0, 0.0155]}>
          <planeGeometry args={[0.98, 0.306]} />
          <meshPhysicalMaterial
            map={built.sign}
            roughness={0.45}
            clearcoat={0.5}
            clearcoatRoughness={0.3}
          />
        </mesh>
      </group>
      {/* Screw eyes under the doorway beam (bottom at 2.42 m). */}
      {[-1, 1].map((side) => (
        <Hanger
          key={side}
          hook={[-2.2 + side * 0.3, 2.414, 3.415]}
          ends={[[-2.2 + side * 0.36, 2.09, 3.452]]}
        />
      ))}
      <mesh geometry={built.top} castShadow receiveShadow>
        <WoodMaterial clearcoat={0.55} />
      </mesh>
      <mesh geometry={built.wood} castShadow receiveShadow>
        <WoodMaterial clearcoat={0.25} />
      </mesh>
      <group position={MENU_AT} rotation={[0, MENU_TURN, 0]}>
        <mesh position={[0, 0.21, -0.002]}>
          <planeGeometry args={[0.222, 0.305]} />
          <meshStandardMaterial map={built.menu} roughness={0.9} />
        </mesh>
      </group>
      <mesh geometry={built.bamboo} castShadow>
        <meshStandardMaterial vertexColors roughness={0.62} />
      </mesh>
      <mesh geometry={built.ceramics} castShadow receiveShadow>
        <meshPhysicalMaterial
          vertexColors
          roughness={0.3}
          clearcoat={0.8}
          clearcoatRoughness={0.1}
        />
      </mesh>
      <mesh geometry={built.caddy} castShadow>
        <meshStandardMaterial vertexColors metalness={1} roughness={0.32} />
      </mesh>
      <Solid
        position={[-1.83, TOP_Y + 0.004, 6.05]}
        size={[0.15, 0.008, 0.11]}
        color="#7b2d33"
        surface="cloth"
      />
      <JarSet jars={CANISTERS} />
      {[-1.54, -1.36, -1.18].map((x, i) => (
        <group key={x} position={[x, TOP_Y + 0.052, 6.24]} scale={0.58}>
          <Cup
            position={[0, 0, 0]}
            color={['#a5a077', '#b98755', '#6f7a68'][i]}
          />
        </group>
      ))}
      <Bonsai position={[-3.62, TOP_Y, 6.05]} scale={0.36} seed={5} />
    </group>
  );
}
