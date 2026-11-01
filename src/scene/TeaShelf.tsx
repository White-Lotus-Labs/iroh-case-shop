import { Suspense } from 'react';
import {
  CatmullRomCurve3,
  CylinderGeometry,
  PlaneGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { HangingPaper } from './HangingPaper';
import { SurfaceMaterial } from './Surfaces';
import type { Point } from './stations';
import {
  block,
  merge,
  paint,
  place,
  Timber,
  type TimberBox,
  useBuilt,
} from './props/craft';

const JARS: [Point, string, string?][] = [
  [[-0.28, 0.55, -1.55], '#6b735a'],
  [[-0.28, 0.55, -1.08], '#8b6c49'],
  [[-0.28, 0.55, 1.08], '#414e42'],
  [[-0.28, 0.55, 1.54], '#9b7656'],
  [[-0.25, 2.08, -1.35], '#465c58', '#b38a55'],
  [[-0.25, 2.08, -1.02], '#b18b62'],
  [[-0.25, 2.87, -0.4], '#6f664d'],
];
const TINS: [Point, string][] = [
  [[-0.28, 1.3, -1.45], '#414f43'],
  [[-0.28, 1.3, -1.12], '#6b553e'],
  [[-0.25, 2.08, 1.04], '#3e4944'],
  [[-0.25, 2.08, 1.38], '#7c5b3a'],
];
const BOXES: [Point, string][] = [
  [[-0.25, 1.3, 1.17], '#786143'],
  [[-0.25, 1.3, 1.49], '#4b4939'],
  [[-0.25, 2.87, 0.5], '#5a4831'],
  [[-0.25, 2.87, 0.86], '#76583a'],
];
const BRANCH: Point = [-0.28, 2.87, -1.24];
const STEMS: Point[][] = [
  [
    [0, 0.23, 0],
    [-0.04, 0.48, 0.06],
    [-0.12, 0.68, 0.1],
  ],
  [
    [0, 0.23, 0],
    [0.02, 0.51, 0.03],
    [0.12, 0.74, -0.05],
  ],
  [
    [0, 0.27, 0],
    [0.07, 0.42, -0.06],
    [0.19, 0.55, -0.1],
  ],
];

const at = ([x, y, z]: Point, dx: number, dy: number, dz = 0): Point => [
  x + dx,
  y + dy,
  z + dz,
];

/** Posts with brass inlay, boards with lips, brackets, kiri boxes and the lantern shelf. */
const TIMBER: TimberBox[] = [
  ...[-1.99, -0.91, 0.91, 1.99].flatMap((z): TimberBox[] => [
    [[-0.05, 1.84, z], [0.57, 3.2, 0.115], '#432b1d'],
    [[-0.35, 1.84, z], [0.018, 2.85, 0.022], '#aa8050'],
  ]),
  ...[0.5, 1.25, 2.03, 2.83].flatMap((y): TimberBox[] => [
    ...(y === 0.5 || y === 2.83 ? [0] : [-1.46, 1.46]).flatMap(
      (z): TimberBox[] => [
        [[-0.17, y, z], [0.88, 0.09, z === 0 ? 4.12 : 1.2], '#835938'],
        [
          [-0.62, y + 0.012, z],
          [0.018, 0.025, z === 0 ? 4.08 : 1.17],
          '#c69a5d',
        ],
      ],
    ),
    ...[-1.55, 1.55].map(
      (z): TimberBox => [[-0.21, y - 0.19, z], [0.09, 0.32, 0.095], '#432b1d'],
    ),
  ]),
  ...BOXES.flatMap(([p, color]): TimberBox[] => [
    [at(p, 0, 0.11), [0.21, 0.22, 0.28], color],
    [at(p, 0, 0.235), [0.225, 0.025, 0.3], '#b48d57'],
  ]),
  [[-0.37, 3.38, 1.53], [0.27, 0.025, 0.27], '#48311f'],
  [[-0.37, 2.96, 1.53], [0.27, 0.025, 0.27], '#48311f'],
];

const FACE_IN: Point = [0, -Math.PI / 2, 0];

/** The shelf's jars, tins, labels and potted branch, merged into one mesh per material. */
function buildGoods() {
  const cylinder = (
    top: number,
    bottom: number,
    height: number,
    segments: number,
    position: Point,
    color: string,
  ) =>
    paint(
      place(new CylinderGeometry(top, bottom, height, segments), position),
      color,
    );
  const label = (w: number, h: number, position: Point, color: string) =>
    paint(place(new PlaneGeometry(w, h), position, FACE_IN), color);
  const parts = {
    glaze: merge(
      JARS.map(([p, c]) => cylinder(0.145, 0.13, 0.28, 20, at(p, 0, 0.15), c)),
    ),
    lids: merge(
      JARS.map(([p, , lid = '#342b21']) =>
        cylinder(0.153, 0.15, 0.045, 20, at(p, 0, 0.306), lid),
      ),
    ),
    tins: merge(
      TINS.map(([p, c]) => cylinder(0.11, 0.11, 0.32, 24, at(p, 0, 0.17), c)),
    ),
    rims: merge(
      TINS.map(([p]) =>
        cylinder(0.116, 0.116, 0.027, 24, at(p, 0, 0.339), '#ac8654'),
      ),
    ),
    labels: merge([
      ...JARS.map(([p]) => label(0.09, 0.12, at(p, -0.145, 0.175), '#d2bb8d')),
      ...TINS.map(([p]) => label(0.105, 0.145, at(p, -0.112, 0.19), '#dfcfaa')),
    ]),
    tags: merge(
      BOXES.map(([p]) =>
        block([0.009, 0.105, 0.13], at(p, -0.111, 0.13), '#d5bd89'),
      ),
    ),
    vase: merge([
      place(new SphereGeometry(0.15, 20, 14), at(BRANCH, 0, 0.12)),
      place(new CylinderGeometry(0.075, 0.09, 0.12, 18), at(BRANCH, 0, 0.23)),
    ]),
    stems: merge(
      STEMS.map((points) =>
        new TubeGeometry(
          new CatmullRomCurve3(points.map((p) => new Vector3(...p))),
          12,
          0.008,
          5,
          false,
        ).translate(...BRANCH),
      ),
    ),
    leaves: merge(
      STEMS.map((points, i) =>
        paint(
          place(new SphereGeometry(0.12, 10, 7), at(BRANCH, ...points[2]), [
            0.3,
            i * 0.75,
            0.45,
          ]),
          i === 1 ? '#758457' : '#566b46',
        ),
      ),
    ),
  };
  return {
    ...parts,
    dispose() {
      Object.values(parts).forEach((geometry) => geometry.dispose());
    },
  };
}

/** The shelf lantern's light, mounted with the room's lights so the light count never changes. */
export function ShelfLanternLight() {
  return (
    <pointLight
      position={[3.82 - 0.4 * 0.82, 3.04 * 0.86, -4.55 + 1.53 * 0.76]}
      color="#ffbe71"
      intensity={4.5}
      distance={3.5}
    />
  );
}

/** Joinery and tea objects mounted to the chamber's actual right wall. */
export function TeaShelf({
  onSelect,
  revealed,
  reduced,
  posters,
}: {
  onSelect: () => void;
  revealed: boolean;
  reduced: boolean;
  posters: boolean;
}) {
  const goods = useBuilt(buildGoods);
  return (
    <group
      position={[3.82, 0, -4.55]}
      name="right-wall-tea-shelf"
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      {/* Own boundary: suspending here must not hide the staged room. */}
      <Suspense fallback={null}>
        {posters && (
          <HangingPaper
            reduced={reduced}
            emphasized={revealed}
            onSelect={onSelect}
          />
        )}
      </Suspense>
      <group scale={[0.82, 0.86, 0.76]}>
        <Timber items={TIMBER} />
        <mesh geometry={goods.glaze} castShadow receiveShadow>
          <meshPhysicalMaterial
            vertexColors
            roughness={0.46}
            clearcoat={0.28}
          />
        </mesh>
        <mesh geometry={goods.lids} castShadow>
          <meshStandardMaterial vertexColors roughness={0.6} metalness={0.15} />
        </mesh>
        <mesh geometry={goods.tins} castShadow>
          <meshStandardMaterial
            vertexColors
            metalness={0.42}
            roughness={0.43}
          />
        </mesh>
        <mesh geometry={goods.rims} castShadow>
          <meshStandardMaterial vertexColors metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh geometry={goods.labels}>
          <meshStandardMaterial vertexColors roughness={0.95} />
        </mesh>
        <mesh geometry={goods.tags} castShadow receiveShadow>
          <SurfaceMaterial surface="paper" color="#d5bd89" />
        </mesh>
        <mesh geometry={goods.vase} castShadow>
          <meshPhysicalMaterial
            color="#2d4841"
            roughness={0.55}
            clearcoat={0.3}
          />
        </mesh>
        <mesh geometry={goods.stems} castShadow>
          <meshStandardMaterial color="#6d6544" roughness={1} />
        </mesh>
        <mesh geometry={goods.leaves} castShadow>
          <meshStandardMaterial vertexColors roughness={0.9} />
        </mesh>
        <mesh position={[-0.27, 3.16, 1.53]} castShadow>
          <cylinderGeometry args={[0.11, 0.11, 0.38, 4]} />
          <SurfaceMaterial surface="paper" color="#f5d7a0" />
        </mesh>
      </group>
    </group>
  );
}
