import {
  BufferGeometry,
  CatmullRomCurve3,
  PlaneGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { Solid, SurfaceMaterial } from '../Surfaces';
import type { Point } from '../stations';
import { Cup } from '../Ceramics';
import { block, merge, place, useBuilt, WoodMaterial } from './craft';
import { MenuPlaques } from './CounterDetail';
import { BambooPot, Bonsai } from './Plants';
import { Byobu, FlowerStand, TemaeSet } from './Temae';

const CUSHION = { w: 0.74, d: 0.8, seam: 0.036, top: 0.052, bottom: 0.032 };

/** Pinched outline: sides bow out a little, corners draw in. */
const outline = (u: number, v: number): [number, number] => [
  (u * CUSHION.w * (1 + 0.03 * (1 - v * v))) / 2,
  (v * CUSHION.d * (1 + 0.03 * (1 - u * u))) / 2,
];
const puff = (s: number) => (1 - Math.min(1, Math.abs(s)) ** 4) ** 0.32;

/** One stuffed face; `up` picks the top (tufted, fuller) or the floor side. */
function panel(up: boolean) {
  const geometry = new PlaneGeometry(2, 2, 48, 48);
  geometry.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  const p = geometry.attributes.position,
    uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i),
      v = p.getZ(i),
      [x, z] = outline(u, v),
      r2 = u * u + v * v,
      body = puff(u) * puff(v),
      y = up
        ? CUSHION.seam +
          CUSHION.top * body -
          0.024 * Math.exp(-r2 / 0.014) +
          0.0025 *
            Math.sin(8 * Math.atan2(v, u)) *
            Math.sqrt(r2) *
            Math.exp(-r2 / 0.09)
        : CUSHION.seam - CUSHION.bottom * body;
    p.setXYZ(i, x, Math.max(0.002, y), z);
    uv.setXY(i, x / 0.35, z / 0.35);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function buildCushion() {
  const ring = Array.from({ length: 96 }, (_, i) => {
    const a = (i / 96) * Math.PI * 2,
      c = Math.cos(a),
      s = Math.sin(a),
      k = Math.max(Math.abs(c), Math.abs(s)),
      [x, z] = outline(c / k, s / k);
    return new Vector3(x, CUSHION.seam, z);
  });
  const tuftY = CUSHION.seam + CUSHION.top - 0.022;
  const strands: BufferGeometry[] = [0.5, 2.07, 3.64, 5.21].map((a) =>
    place(
      new TubeGeometry(
        new CatmullRomCurve3([
          new Vector3(0, 0.004, 0),
          new Vector3(Math.cos(a) * 0.018, 0.002, Math.sin(a) * 0.018),
          new Vector3(Math.cos(a) * 0.034, -0.001, Math.sin(a) * 0.034),
        ]),
        6,
        0.0032,
        5,
      ),
      [0, tuftY, 0],
    ),
  );
  return {
    body: merge([panel(true), panel(false)]),
    piping: new TubeGeometry(
      new CatmullRomCurve3(ring, true),
      192,
      0.0075,
      6,
      true,
    ),
    tuft: merge([
      ...strands,
      place(new SphereGeometry(0.009, 10, 8), [0, tuftY + 0.004, 0]),
    ]),
    dispose() {
      this.body.dispose();
      this.piping.dispose();
      this.tuft.dispose();
    },
  };
}

/** A zabuton: stuffed top and floor panels, piped seam and a centre tuft tie. */
function Cushion({
  position,
  turn = 0.18,
  color = '#3f4a37',
}: {
  position: Point;
  turn?: number;
  color?: string;
}) {
  const built = useBuilt(buildCushion);
  return (
    <group position={position} rotation={[0, turn, 0]}>
      <mesh geometry={built.body} castShadow receiveShadow>
        <SurfaceMaterial surface="cloth" color={color} />
      </mesh>
      <mesh geometry={built.piping} castShadow>
        <SurfaceMaterial surface="cloth" color="#28301f" />
      </mesh>
      <mesh geometry={built.tuft} castShadow>
        <SurfaceMaterial surface="cloth" color="#cbb98e" />
      </mesh>
    </group>
  );
}

/** Loose props in the tea chamber: cushions, plants and small objects. */
export function ChamberDressing({ reduced }: { reduced: boolean }) {
  return (
    <group>
      <Cushion position={[-0.76, 0.053, -0.93]} />
      <Cushion position={[0.76, 0.053, -0.93]} turn={-0.12} />
      {['#3f4a37', '#6a2f2a', '#3f4a37'].map((color, i) => (
        <Cushion
          key={i}
          position={[-2.75, i * 0.086, 0.35]}
          turn={0.5 + i * 0.13}
          color={color}
        />
      ))}
      <Bonsai position={[-1.3, 0, -5.75]} seed={3} stand turn={0.1} />
      <TemaeSet />
      <FlowerStand position={[2.85, 0, -0.05]} reduced={reduced} />
      <Byobu position={[2.4, 0, -2.62]} turn={-Math.PI / 2} />
    </group>
  );
}

const SEAT = 0.44;
/** A waiting bench (koshikake) with a red felt mōsen and a cup of tea set down on it. */
function Bench({ position }: { position: Point }) {
  const wood = useBuilt(() =>
    merge([
      block([0.46, 0.05, 1.8], [0, SEAT - 0.025, 0], '#5b3a24'),
      ...[-1, 1].flatMap((x) =>
        [-0.8, 0.8].map((z) =>
          block(
            [0.05, SEAT - 0.05, 0.05],
            [x * 0.18, (SEAT - 0.05) / 2, z],
            '#3a2416',
          ),
        ),
      ),
      ...[-1, 1].map((x) =>
        block([0.03, 0.05, 1.6], [x * 0.18, 0.1, 0], '#3a2416'),
      ),
      ...[-0.8, 0.8].map((z) =>
        block([0.36, 0.05, 0.03], [0, SEAT - 0.08, z], '#3a2416'),
      ),
    ]),
  );
  return (
    <group position={position}>
      <mesh geometry={wood} castShadow receiveShadow>
        <WoodMaterial clearcoat={0.3} />
      </mesh>
      <Solid
        position={[0, SEAT + 0.004, 0.1]}
        size={[0.5, 0.008, 1.2]}
        color="#8e1f1c"
        surface="cloth"
      />
      <group position={[0.05, SEAT + 0.008, -0.35]} scale={0.62}>
        <Cup position={[0, 0, 0]} color="#6f7a68" />
      </group>
    </group>
  );
}

/** Loose props in the waiting room. */
export function WaitingDressing() {
  return (
    <group>
      <BambooPot position={[3.35, 0, 4.0]} />
      <MenuPlaques />
      <Bench position={[-3.62, 0, 9.05]} />
    </group>
  );
}
