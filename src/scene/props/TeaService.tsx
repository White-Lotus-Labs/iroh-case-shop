import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  ExtrudeGeometry,
  Shape,
  type BufferGeometry,
  type Material,
} from 'three';
import { GlazeMaterial, smoothProfile, type Glaze } from '../Ceramics';

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
function roundedRect(width: number, depth: number, radius: number) {
  const shape = new Shape(),
    w = width / 2,
    d = depth / 2;
  shape.moveTo(-w + radius, -d);
  shape.lineTo(w - radius, -d);
  shape.quadraticCurveTo(w, -d, w, -d + radius);
  shape.lineTo(w, d - radius);
  shape.quadraticCurveTo(w, d, w - radius, d);
  shape.lineTo(-w + radius, d);
  shape.quadraticCurveTo(-w, d, -w, d - radius);
  shape.lineTo(-w, -d + radius);
  shape.quadraticCurveTo(-w, -d, -w + radius, -d);
  return shape;
}
/** Extrudes upward from y 0; UVs scaled to the table's wood tile. */
function lift(shape: Shape, height: number, bevel: number) {
  const geometry = new ExtrudeGeometry(shape, {
    depth: height - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  })
    .rotateX(-Math.PI / 2)
    .translate(0, bevel, 0);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, uv.getX(i) / 1.2, uv.getY(i) / 0.3);
  return geometry;
}
function trayGeometry() {
  const width = 0.34,
    depth = 0.24,
    rim = roundedRect(width, depth, 0.03);
  rim.holes.push(roundedRect(width - 0.024, depth - 0.024, 0.02));
  return {
    rim: lift(rim, 0.026, 0.0025),
    base: lift(roundedRect(width, depth, 0.03), 0.009, 0.0015),
  };
}
/** A split-bamboo scoop: concave blade, a node, and a steamed, curled tip. */
function scoopGeometry() {
  const scoop = new BoxGeometry(0.19, 0.0022, 0.0095, 48, 1, 4),
    position = scoop.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i) * (1 - 0.35 * smooth(-0.02, -0.095, x));
    position.setZ(i, z);
    position.setY(
      i,
      position.getY(i) +
        0.009 * smooth(0.07, 0.095, x) ** 2 +
        (z / 0.00475) ** 2 * 0.0008 +
        0.0007 * Math.exp(-(((x + 0.01) / 0.004) ** 2)),
    );
  }
  scoop.computeVertexNormals();
  return scoop;
}

const NATSUME_BODY = smoothProfile(
  [
    [0, 0.002],
    [0.03, 0.002],
    [0.035, 0],
    [0.04, 0.004],
    [0.0445, 0.015],
    [0.046, 0.03],
    [0.0456, 0.042],
    [0.043, 0.0425],
    [0, 0.0425],
  ],
  40,
).points;
const NATSUME_LID = smoothProfile(
  [
    [0.0452, 0.0428],
    [0.0462, 0.047],
    [0.0455, 0.058],
    [0.042, 0.068],
    [0.034, 0.075],
    [0.02, 0.0785],
    [0, 0.079],
  ],
  40,
).points;
const KENSUI = smoothProfile(
  [
    [0, 0.004],
    [0.04, 0.004],
    [0.045, 0],
    [0.053, 0],
    [0.056, 0.006],
    [0.06, 0.01],
    [0.074, 0.03],
    [0.082, 0.052],
    [0.083, 0.06],
    [0.0805, 0.0625],
    [0.0775, 0.058],
    [0.072, 0.035],
    [0.058, 0.016],
    [0.03, 0.011],
    [0, 0.01],
  ],
  90,
);
const KENSUI_GLAZE: Glaze = {
  glaze: '#3d2618',
  thin: '#a86a3c',
  clay: '#8a5a3c',
  foot: KENSUI.marks[5] + 0.03,
  edges: [KENSUI.marks[9]],
  pools: [1],
  drips: 7,
  speckle: 0.6,
  runs: 0.7,
  seed: 211,
};
const FUTAOKI = smoothProfile(
  [
    [0.019, 0],
    [0.021, 0.001],
    [0.0213, 0.02],
    [0.0226, 0.0225],
    [0.0213, 0.025],
    [0.021, 0.046],
    [0.0195, 0.048],
    [0.0175, 0.047],
    [0.0172, 0.027],
    [0, 0.026],
  ],
  40,
).points;

/** The tea tools laid out around the pot: tray, caddy, scoop, waste bowl, lid rest. */
export function TeaService({ lacquer }: { lacquer: Material }) {
  const tray = useMemo(trayGeometry, []),
    scoop = useMemo(scoopGeometry, []);
  useEffect(
    () => () => {
      [tray.rim, tray.base, scoop].forEach((g: BufferGeometry) => g.dispose());
    },
    [tray, scoop],
  );
  return (
    <group>
      <group position={[-0.92, 0.61, -2.02]} rotation={[0, 0.1, 0]}>
        <mesh
          geometry={tray.base}
          material={lacquer}
          castShadow
          receiveShadow
        />
        <mesh geometry={tray.rim} material={lacquer} castShadow receiveShadow />
        <group position={[-0.075, 0.009, 0.005]}>
          <mesh castShadow receiveShadow>
            <latheGeometry args={[NATSUME_BODY, 48]} />
            <meshPhysicalMaterial
              color="#150d09"
              roughness={0.2}
              clearcoat={1}
              clearcoatRoughness={0.04}
            />
          </mesh>
          <mesh castShadow>
            <latheGeometry args={[NATSUME_LID, 48]} />
            <meshPhysicalMaterial
              color="#150d09"
              roughness={0.2}
              clearcoat={1}
              clearcoatRoughness={0.04}
            />
          </mesh>
          <mesh position={[0, 0.0502, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.0461, 0.0006, 6, 64]} />
            <meshStandardMaterial
              color="#d9a64e"
              metalness={1}
              roughness={0.28}
            />
          </mesh>
        </group>
        <mesh
          geometry={scoop}
          position={[0.055, 0.0105, 0.01]}
          rotation={[0, 0.55, 0]}
          castShadow
          receiveShadow
        >
          <meshPhysicalMaterial
            color="#c9a66a"
            roughness={0.5}
            clearcoat={0.3}
            clearcoatRoughness={0.3}
          />
        </mesh>
      </group>
      <mesh position={[0.98, 0.61, -2.06]} castShadow receiveShadow>
        <latheGeometry args={[KENSUI.points, 56]} />
        <GlazeMaterial glaze={KENSUI_GLAZE} />
      </mesh>
      <mesh position={[0.4, 0.61, -2.66]} castShadow receiveShadow>
        <latheGeometry args={[FUTAOKI, 32]} />
        <meshStandardMaterial color="#b3955a" roughness={0.55} />
      </mesh>
    </group>
  );
}
