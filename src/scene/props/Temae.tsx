import {
  CylinderGeometry,
  LatheGeometry,
  PlaneGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { Steam } from '../Steam';
import { canvasTexture, once, Solid } from '../Surfaces';
import type { Point } from '../stations';
import { createRandom } from '../motion/dynamics';
import { Chabana } from './BackWall';
import {
  block,
  cord,
  inkStroke,
  merge,
  paint,
  place,
  useBuilt,
  WoodMaterial,
} from './craft';

const lathe = (profile: number[][], segments = 28) =>
  new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  );

const JAR = [
  [0, 0],
  [0.066, 0],
  [0.074, 0.008],
  [0.084, 0.05],
  [0.086, 0.11],
  [0.08, 0.16],
  [0.077, 0.172],
  [0.08, 0.178],
  [0.072, 0.18],
  [0.068, 0.172],
  [0, 0.172],
];
const BOWL_RIM = 0.084;
const BOWL = [
  [0, 0],
  [0.05, 0],
  [0.058, 0.006],
  [0.07, 0.05],
  [0.076, 0.082],
  [0.071, BOWL_RIM],
  [0.064, 0.052],
  [0.05, 0.014],
  [0, 0.014],
];

/** Shino glaze: cream with an orange blush, pinholes and iron-brushed grasses; top of canvas is the rim. */
function drawShino(ctx: CanvasRenderingContext2D) {
  const random = createRandom(733);
  const base = ctx.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0, '#c98a58');
  base.addColorStop(0.18, '#e2d2b6');
  base.addColorStop(0.8, '#e6d8be');
  base.addColorStop(1, '#b8764a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = `rgba(${random() > 0.5 ? '190,120,70' : '120,90,60'},${random() * 0.35})`;
    ctx.beginPath();
    ctx.arc(
      random() * 512,
      random() * 256,
      0.6 + random() * 1.4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  for (let g = 0; g < 3; g++) {
    const x = 60 + g * 170 + random() * 30;
    for (let blade = 0; blade < 3; blade++)
      inkStroke(
        ctx,
        [
          [x + blade * 5, 196],
          [x + blade * 8 + 6, 160],
          [x + blade * 16 + (random() - 0.5) * 24, 128 + random() * 14],
        ],
        2.2,
        random,
        '128,72,40',
      );
  }
}
const shinoMap = once(() => canvasTexture(512, 256, drawShino));

const JAR_AT: Point = [2.12, 0, -1.8];
const KENSUI: Point = [2.02, 0, -1.3];
const LID_REST: Point = [2.34, 0, -1.03];
const LID_REST_H = 0.055;
/** Tatami top, from the mat boxes in TeaArchitecture. */
const TATAMI_TOP = 0.052;
const HISHAKU_R = 0.0055;
/** Contact shades lie this far above their surface, below the room's ContactShadows planes. */
const SHADE_LIFT = 0.001;

function drawShade(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(20,10,4,0.85)');
  gradient.addColorStop(0.5, 'rgba(20,10,4,0.45)');
  gradient.addColorStop(1, 'rgba(20,10,4,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
}
const shadeMap = once(() => canvasTexture(64, 64, drawShade));

/**
 * Where the temae sits: jar, kensui and lid rest on the boards, the hishaku handle
 * biting the kensui lip, the fukusa sunk a hair into the tatami, and a soft contact
 * shade under each. The room's ContactShadows are too blurred for pieces this small.
 */
export function temaeLayout() {
  const [kx, , kz] = KENSUI,
    [fx, , fz] = LID_REST,
    toward = new Vector3(kx - fx, 0, kz - fz).normalize(),
    cupY = LID_REST_H + 0.0225,
    joint = new Vector3(fx, cupY, fz).addScaledVector(toward, 0.028),
    // Widest point of the bronze lip. The cord centreline sits just inside its radius.
    lip = new Vector3(kx, 0.082, kz).addScaledVector(toward, -0.076),
    rest = lip.clone();
  rest.y += HISHAKU_R - 0.0015;
  const tip = rest
    .clone()
    .addScaledVector(rest.clone().sub(joint).normalize(), 0.014);
  const clothH = 0.009,
    sink = 0.002,
    clothBottom = TATAMI_TOP - sink,
    foldH = 0.004,
    clothSize: Point = [0.13, clothH, 0.09];
  const shade = ([x, y, z]: Point, width: number, depth = width) => ({
    at: [x, y + SHADE_LIFT, z] as Point,
    size: [width, depth] as [number, number],
  });
  return {
    tatami: TATAMI_TOP,
    cordRadius: HISHAKU_R,
    jarAt: JAR_AT,
    bowlAt: KENSUI,
    restAt: LID_REST,
    cupY,
    joint,
    lip,
    tip,
    cloth: [1.24, clothBottom + clothH / 2, -1.42] as Point,
    clothSize,
    clothBottom,
    fold: [1.238, clothBottom + clothH - 0.001 + foldH / 2, -1.44] as Point,
    foldSize: [0.124, foldH, 0.046] as Point,
    // Each shade reaches a few cm past the base it grounds.
    shades: [
      shade(JAR_AT, 0.26),
      shade(KENSUI, 0.2),
      shade(LID_REST, 0.1),
      shade([1.24, TATAMI_TOP, -1.42], 0.2, 0.15),
    ],
  };
}

/**
 * Temae utensils beside the brazier: a lidded water jar (mizusashi), a bronze waste
 * bowl (kensui), a bamboo lid rest holding the ladle's upturned cup with the handle
 * laid on the kensui rim, and a folded fukusa.
 */
export function TemaeSet() {
  const layout = temaeLayout();
  const built = useBuilt(() => {
    const { jarAt, bowlAt, restAt, cupY, joint, tip } = layout,
      jar = place(lathe(JAR), jarAt),
      lacquer = merge([
        paint(
          place(new CylinderGeometry(0.075, 0.075, 0.012, 28), [
            jarAt[0],
            0.186,
            jarAt[2],
          ]),
          '#120a06',
        ),
        paint(
          place(new SphereGeometry(0.012, 12, 8), [jarAt[0], 0.196, jarAt[2]]),
          '#120a06',
        ),
      ]),
      bronze = place(lathe(BOWL), bowlAt);
    const bamboo = merge([
      paint(
        place(new CylinderGeometry(0.026, 0.028, 0.045, 18), [
          restAt[0],
          cupY,
          restAt[2],
        ]),
        '#c9a860',
      ),
      paint(cord(joint.toArray(), tip.toArray(), HISHAKU_R), '#c9a860'),
      paint(
        place(new CylinderGeometry(0.024, 0.024, LID_REST_H, 14), [
          restAt[0],
          LID_REST_H / 2,
          restAt[2],
        ]),
        '#a88a48',
      ),
    ]);
    return {
      jar,
      shino: shinoMap(),
      shade: shadeMap(),
      lacquer,
      bronze,
      bamboo,
      dispose() {
        [jar, lacquer, bronze, bamboo].forEach((g) => g.dispose());
      },
    };
  });
  return (
    <group name="temae-set">
      <mesh geometry={built.jar} castShadow receiveShadow>
        <meshPhysicalMaterial
          map={built.shino}
          roughness={0.42}
          clearcoat={0.6}
          clearcoatRoughness={0.25}
        />
      </mesh>
      <mesh geometry={built.lacquer} castShadow>
        <meshPhysicalMaterial
          vertexColors
          roughness={0.2}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
      </mesh>
      <mesh geometry={built.bronze} castShadow receiveShadow>
        <meshStandardMaterial
          color="#6b4b28"
          metalness={0.8}
          roughness={0.42}
        />
      </mesh>
      <mesh geometry={built.bamboo} castShadow>
        <meshStandardMaterial vertexColors roughness={0.55} />
      </mesh>
      {layout.shades.map(({ at, size }) => (
        <mesh key={at.join()} position={at} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={size} />
          <meshBasicMaterial
            map={built.shade}
            transparent
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
          />
        </mesh>
      ))}
      <Solid
        position={layout.cloth}
        size={layout.clothSize}
        color="#6e2433"
        surface="cloth"
      />
      <Solid
        position={layout.fold}
        size={layout.foldSize}
        color="#7a2a3a"
        surface="cloth"
      />
    </group>
  );
}

const LEG = 0.17;
/** A low lacquer flower stand (hanadai) with a chabana and a burning incense stick. */
export function FlowerStand({
  position,
  reduced,
}: {
  position: Point;
  reduced: boolean;
}) {
  const built = useBuilt(() => {
    const wood = merge([
      block([0.56, 0.026, 0.36], [0, LEG + 0.013, 0], '#1c100a'),
      block([0.5, 0.04, 0.012], [0, LEG - 0.02, 0.165], '#24150c'),
      block([0.5, 0.04, 0.012], [0, LEG - 0.02, -0.165], '#24150c'),
      ...[-1, 1].flatMap((x) =>
        [-1, 1].map((z) =>
          block([0.03, LEG, 0.03], [x * 0.25, LEG / 2, z * 0.15], '#1c100a', {
            rotation: [z * 0.08, 0, -x * 0.08],
          }),
        ),
      ),
    ]);
    const cup = lathe([
      [0, 0],
      [0.028, 0],
      [0.03, 0.03],
      [0.027, 0.032],
      [0, 0.03],
    ]);
    return {
      wood,
      cup,
      dispose() {
        wood.dispose();
        cup.dispose();
      },
    };
  });
  const top = LEG + 0.026;
  return (
    <group position={position} rotation={[0, -0.5, 0]}>
      <mesh geometry={built.wood} castShadow receiveShadow>
        <WoodMaterial clearcoat={0.8} />
      </mesh>
      <Chabana position={[0.08, top, 0]} />
      <mesh geometry={built.cup} position={[-0.19, top, 0.06]} castShadow>
        <meshPhysicalMaterial color="#2c3a3a" roughness={0.3} clearcoat={0.8} />
      </mesh>
      <mesh position={[-0.19, top + 0.1, 0.06]} rotation={[0, 0, 0.06]}>
        <cylinderGeometry args={[0.0018, 0.0018, 0.15, 5]} />
        <meshStandardMaterial color="#4a2e1a" roughness={0.9} />
      </mesh>
      <mesh position={[-0.1945, top + 0.176, 0.06]}>
        <sphereGeometry args={[0.0025, 6, 4]} />
        <meshStandardMaterial
          color="#ff7a2a"
          emissive="#ff5a10"
          emissiveIntensity={4}
        />
      </mesh>
      <Steam
        origin={[-0.195, top + 0.18, 0.06]}
        active
        reduced={reduced}
        count={7}
        strength={0.7}
        rise={0.55}
      />
    </group>
  );
}

const FOLD = 0.42;

/** Gold leaf squares under an ink landscape: far ridges, gold cloud bands and a leaning pine. */
function drawScreen(ctx: CanvasRenderingContext2D) {
  const w = 1024,
    h = 720,
    random = createRandom(1597);
  for (let y = 0; y < h; y += 48)
    for (let x = 0; x < w; x += 48) {
      const tone = 150 + random() * 30;
      ctx.fillStyle = `rgb(${tone + 40},${tone + 8},${tone * 0.45})`;
      ctx.fillRect(x, y, 48, 48);
      ctx.fillStyle = 'rgba(90,60,20,.18)';
      ctx.fillRect(x, y, 48, 1);
      ctx.fillRect(x, y, 1, 48);
    }
  for (const [base, alpha] of [
    [430, 0.22],
    [500, 0.35],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 16)
      ctx.lineTo(
        x,
        base -
          Math.abs(Math.sin(x * 0.006 + base)) * 120 -
          Math.sin(x * 0.021) * 18,
      );
    ctx.lineTo(w, h);
    ctx.fillStyle = `rgba(40,34,26,${alpha})`;
    ctx.fill();
  }
  for (const y of [180, 560]) {
    const band = ctx.createLinearGradient(0, y - 40, 0, y + 40);
    band.addColorStop(0, 'rgba(236,196,110,0)');
    band.addColorStop(0.5, 'rgba(240,204,120,.75)');
    band.addColorStop(1, 'rgba(236,196,110,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, y - 40, w, 80);
  }
  // Dilute ink on gold leaf: a wide pale bleed and a thin warm stroke, never a black mass.
  const wash = (path: [number, number][], width: number) => {
    ctx.save();
    ctx.filter = 'blur(8px)';
    ctx.globalAlpha = 0.18;
    inkStroke(ctx, path, width * 2.4, random, '150,118,82');
    ctx.filter = 'none';
    ctx.globalAlpha = 0.5;
    inkStroke(ctx, path, width * 0.8, random, '92,70,48');
    ctx.restore();
  };
  const trunk: [number, number][] = [
    [690, 720],
    [676, 600],
    [640, 480],
    [560, 380],
    [470, 330],
  ];
  wash(trunk, 22);
  const branches: [number, number][][] = [
    [
      [640, 480],
      [740, 430],
      [840, 420],
    ],
    [
      [560, 380],
      [520, 300],
      [560, 230],
    ],
    [
      [470, 330],
      [380, 320],
      [300, 350],
    ],
  ];
  branches.forEach((path) => wash(path, 9));
  ctx.globalAlpha = 0.45;
  for (const [cx, cy] of [
    [840, 410],
    [560, 225],
    [300, 340],
    [460, 320],
    [740, 425],
  ])
    for (let i = 0; i < 70; i++) {
      const a = random() * Math.PI * 2,
        r = 20 + random() * 50,
        x = cx + Math.cos(a) * r * 1.4,
        y = cy + Math.sin(a) * r * 0.5;
      inkStroke(
        ctx,
        [
          [x, y],
          [x + 10 + random() * 12, y - 4 + random() * 8],
        ],
        2.2,
        random,
        '72,92,68',
      );
    }
  ctx.globalAlpha = 1;
}
const screenArt = once(() => canvasTexture(1024, 720, drawScreen));

/** Lacquer frame section: face width and depth. The painting sits inside the depth. */
const FRAME = { face: 0.026, depth: 0.03 };
/**
 * A folding screen (byobu): each panel is a lacquer frame that wraps its gold painting
 * and paper back, and brass hinges join the stiles at every fold.
 */
export function Byobu({
  position,
  turn = 0,
  panels: PANELS = 2,
  width: PANEL_W = 0.62,
  height: PANEL_H = 0.68,
}: {
  position: Point;
  turn?: number;
  panels?: number;
  width?: number;
  height?: number;
}) {
  const built = useBuilt(() => {
    const { face: F, depth: D } = FRAME,
      innerW = PANEL_W - 2 * F + 0.008,
      innerH = PANEL_H - 2 * F + 0.008;
    let x = 0,
      z = 0;
    const faces = [],
      frames = [],
      hinges = [];
    for (let i = 0; i < PANELS; i++) {
      const angle = i % 2 ? FOLD : -FOLD,
        cx = x + (Math.cos(angle) * PANEL_W) / 2,
        cz = z - (Math.sin(angle) * PANEL_W) / 2,
        r: Point = [0, angle, 0],
        // Panel-local (along, up, out of the painted face) to screen space.
        at = (dx: number, y: number, dn = 0): Point => [
          cx + Math.cos(angle) * dx + Math.sin(angle) * dn,
          y,
          cz - Math.sin(angle) * dx + Math.cos(angle) * dn,
        ];
      const face = new PlaneGeometry(innerW, innerH);
      const uv = face.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / PANELS);
      faces.push(place(face, at(0, PANEL_H / 2, 0.004), r));
      const lacquer = '#140b07';
      frames.push(
        block([PANEL_W, F, D], at(0, F / 2), lacquer, { rotation: r }),
        block([PANEL_W, F, D], at(0, PANEL_H - F / 2), lacquer, {
          rotation: r,
        }),
        ...[-1, 1].map((side) =>
          block(
            [F, PANEL_H - 2 * F + 0.002, D],
            at(side * (PANEL_W / 2 - F / 2), PANEL_H / 2),
            lacquer,
            { rotation: r },
          ),
        ),
        block([innerW, innerH, 0.004], at(0, PANEL_H / 2, -0.004), '#b9a27a', {
          rotation: r,
        }),
      );
      x += Math.cos(angle) * PANEL_W;
      z -= Math.sin(angle) * PANEL_W;
      if (i === PANELS - 1) continue;
      // The knuckle fills the V on the fold's convex side; a leaf sits on each stile there.
      const next = i % 2 ? -FOLD : FOLD,
        s = i % 2 ? -1 : 1,
        nx = x + Math.cos(next) * 0.013 + Math.sin(next) * s * (D / 2),
        nz = z - Math.sin(next) * 0.013 + Math.cos(next) * s * (D / 2);
      for (const y of [0.1, PANEL_H / 2, PANEL_H - 0.1])
        hinges.push(
          paint(
            place(new CylinderGeometry(0.0055, 0.0055, 0.05, 12), [
              x,
              y,
              z + s * (D / 2 - 0.001),
            ]),
            '#fff',
          ),
          block(
            [0.024, 0.044, 0.002],
            at(PANEL_W / 2 - 0.013, y, s * (D / 2)),
            '#fff',
            { rotation: r },
          ),
          block([0.024, 0.044, 0.002], [nx, y, nz], '#fff', {
            rotation: [0, next, 0],
          }),
        );
    }
    const face = merge(faces),
      frame = merge(frames),
      hinge = merge(hinges);
    return {
      art: screenArt(),
      face,
      frame,
      hinge,
      dispose() {
        [face, frame, hinge].forEach((item) => item.dispose());
      },
    };
  });
  return (
    <group position={position} rotation={[0, turn, 0]}>
      <mesh geometry={built.frame} castShadow receiveShadow>
        <WoodMaterial clearcoat={0.9} />
      </mesh>
      <mesh geometry={built.face} receiveShadow>
        <meshStandardMaterial
          map={built.art}
          metalness={0.35}
          roughness={0.5}
        />
      </mesh>
      <mesh geometry={built.hinge} castShadow>
        <meshStandardMaterial
          vertexColors
          color="#9a7a3e"
          metalness={0.9}
          roughness={0.35}
        />
      </mesh>
    </group>
  );
}
