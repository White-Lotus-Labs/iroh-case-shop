import { CatmullRomCurve3, DoubleSide, Vector2, Vector3 } from 'three';
import { Solid } from '../Surfaces';
import type { Point } from '../stations';
import { Timber, type TimberBox, useBuilt } from './craft';
import { NAGESHI, WAINSCOT_TOP } from './hanging';
import { stemLeaves } from './Plants';
import { ShojiWindow } from './Shoji';
import { WallTrim } from './WallDetail';

const timber = '#3a2419';
const face = 4.005;
const from = -6.18;
const to = 3.23;
const length = to - from;
const center = (from + to) / 2;
const at = (depth: number) => face - depth;
const win = { z0: -1.3, z1: 0.9, y0: 0.99, y1: 2.86 };
const jamb = -1.445;
const post = 0.985;

const TUBE = [
  [0, 0],
  [0.033, 0],
  [0.034, 0.26],
  [0.03, 0.26],
  [0.029, 0.02],
  [0, 0.02],
].map(([r, y]) => new Vector2(r, y));

const STEM = new CatmullRomCurve3([
  new Vector3(0, 0.15, 0),
  new Vector3(-0.03, 0.3, 0.01),
  new Vector3(-0.1, 0.4, 0.02),
  new Vector3(-0.14, 0.43, 0.03),
]);

/** A hanging bamboo vase (kakehanaire) with a single camellia, hung on the window jamb. */
function Kakehanaire({ position }: { position: Point }) {
  const leaves = useBuilt(() =>
    stemLeaves(
      STEM,
      [
        { t: 0.42, turn: 1.2, rise: 0.1 },
        { t: 0.56, turn: -1.1 },
        { t: 0.7, turn: 1.3, rise: 0.4 },
        { t: 0.84, turn: -1.2, rise: 0.2 },
      ],
      { length: 0.08, width: 0.036, color: '#1f3a1c', face: [-1, 0, 0] },
    ),
  );
  const bloom: Point = [-0.145, 0.435, 0.03];
  return (
    <group position={position}>
      <mesh castShadow>
        <latheGeometry args={[TUBE, 20]} />
        <meshPhysicalMaterial
          color="#8c7a48"
          roughness={0.45}
          clearcoat={0.4}
        />
      </mesh>
      {[0.075, 0.215].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.0345, 0.0032, 6, 20]} />
          <meshStandardMaterial color="#6e5e36" roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0.02, 0.33, 0]} rotation={[0, 0, -0.35]}>
        <cylinderGeometry args={[0.0015, 0.0015, 0.16, 4]} />
        <meshStandardMaterial color="#4a3b26" roughness={0.9} />
      </mesh>
      <mesh position={[0.045, 0.405, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.004, 0.004, 0.03, 6]} />
        <meshStandardMaterial color="#2a2622" metalness={0.7} roughness={0.5} />
      </mesh>
      <mesh castShadow>
        <tubeGeometry args={[STEM, 16, 0.0035, 5, false]} />
        <meshStandardMaterial color="#3a2e1c" roughness={0.8} />
      </mesh>
      <mesh geometry={leaves} castShadow>
        <meshPhysicalMaterial
          vertexColors
          roughness={0.35}
          clearcoat={0.6}
          side={DoubleSide}
        />
      </mesh>
      <group position={bloom} rotation={[0.3, 0, 0.9]}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 0.016, 0, Math.sin(a) * 0.016]}
              rotation={[0.35 * Math.sin(a), -a, 0.35 * Math.cos(a)]}
              scale={[0.022, 0.006, 0.017]}
            >
              <sphereGeometry args={[1, 10, 6]} />
              <meshStandardMaterial color="#a3182a" roughness={0.55} />
            </mesh>
          );
        })}
        <mesh position={[0, 0.006, 0]}>
          <cylinderGeometry args={[0.008, 0.006, 0.012, 10]} />
          <meshStandardMaterial color="#e0b23a" roughness={0.7} />
        </mesh>
      </group>
    </group>
  );
}

/** The right chamber wall: rails and wainscot framing a lit two-panel shoji window. */
export function RightWall() {
  const winZ = (win.z0 + win.z1) / 2;
  const casing = post - 0.085 - jamb;
  const casingZ = (jamb + post - 0.085) / 2;
  return (
    <group name="right-wall">
      <Timber
        cast={false}
        items={[
          [[3.91, 1.85, post], [0.17, 3.7, 0.17], timber],
          [
            [at(0.07), (win.y0 + win.y1) / 2, (jamb + win.z0) / 2],
            [0.14, win.y1 - win.y0 + 0.1, win.z0 - jamb],
            timber,
          ],
          ...[0.03, 0.06].map(
            (depth): TimberBox => [
              [at(depth), win.y0 + 0.001, casingZ],
              [0.012, 0.004, casing - 0.02],
              '#1a100a',
            ],
          ),
          [[at(0.07), win.y1 + 0.045, casingZ], [0.14, 0.09, casing], timber],
          ...[
            [from, jamb],
            [post + 0.085, to],
          ].map(
            ([a, b]): TimberBox => [
              [at(0.045), (NAGESHI.bottom + NAGESHI.top) / 2, (a + b) / 2],
              [0.09, NAGESHI.top - NAGESHI.bottom, b - a],
              timber,
            ],
          ),
          [[at(0.035), 3.3, center], [0.07, 0.07, length], timber],
          [[at(0.02), 0.47, center], [0.04, 0.94, length], '#4a2e1d'],
          [
            [at(0.04), WAINSCOT_TOP - 0.025, center],
            [0.07, 0.05, length],
            timber,
          ],
          [[at(0.04), 0.035, center], [0.07, 0.07, length], timber],
          ...[0.33, 0.64].map(
            (y): TimberBox => [
              [at(0.041), y, center],
              [0.004, 0.006, length],
              '#1f140d',
            ],
          ),
        ]}
      />
      <Solid
        position={[at(0.1), win.y0 - 0.02, casingZ]}
        size={[0.2, 0.04, casing]}
        color="#4a2e1d"
        clearcoat={0.25}
        cast={false}
      />
      <ShojiWindow
        position={[at(0.075), (win.y0 + win.y1) / 2, winZ]}
        rotation={-Math.PI / 2}
        width={win.z1 - win.z0}
        height={win.y1 - win.y0}
        cols={3}
        rows={6}
        glow={0.8}
        seed={17}
      />
      <Kakehanaire position={[3.83, 1.36, -1.372]} />
      <WallTrim
        face={face}
        from={from}
        to={to}
        posts={[-5.94, -1.53, post, 3.17]}
        window={[jamb, post]}
      />
    </group>
  );
}
