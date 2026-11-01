import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CatmullRomCurve3,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  Vector2,
  Vector3,
} from 'three';
import { createRandom } from '../motion/dynamics';
import { canvasTexture, once, Solid } from '../Surfaces';
import type { Point } from '../stations';

// Rim clears the table's breadboard end (x 1.29) by 6 cm; the box stays on the tatami (x < 1.795).
const AT: Point = [1.575, 0.052, -1.9];
const BOX = { width: 0.4, height: 0.3, wall: 0.03 };
const KETTLE_Y = BOX.height + 0.035;
const SPOUT_TIP: Point = [-0.178, 0.118, 0];

export const KETTLE_SPOUT: Point = [
  AT[0] + SPOUT_TIP[0],
  AT[1] + KETTLE_Y + SPOUT_TIP[1] + 0.01,
  AT[2],
];

const KETTLE_PROFILE: [number, number][] = [
  [0, 0],
  [0.06, 0],
  [0.098, 0.012],
  [0.121, 0.042],
  [0.128, 0.074],
  [0.12, 0.106],
  [0.094, 0.132],
  [0.058, 0.143],
  [0.052, 0.147],
];

function radiusAt(y: number) {
  for (let i = 1; i < KETTLE_PROFILE.length; i++) {
    const [r0, y0] = KETTLE_PROFILE[i - 1],
      [r1, y1] = KETTLE_PROFILE[i];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
  }
  return KETTLE_PROFILE[KETTLE_PROFILE.length - 1][0];
}

/** Arare hobnails in offset rows over the kettle's belly. */
function Hobnails({ material }: { material: MeshStandardMaterial }) {
  const mesh = useRef<InstancedMesh>(null);
  const spots = useMemo(() => {
    const out: Vector3[] = [];
    for (let row = 0; row < 7; row++) {
      const y = 0.026 + row * 0.0145,
        r = radiusAt(y) + 0.0012,
        count = Math.round((Math.PI * 2 * r) / 0.019);
      for (let i = 0; i < count; i++) {
        const a = ((i + (row % 2) * 0.5) / count) * Math.PI * 2;
        if (Math.abs(Math.atan2(Math.sin(a), -Math.cos(a))) < 0.32 && y > 0.05)
          continue;
        out.push(new Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
    }
    return out;
  }, []);
  useLayoutEffect(() => {
    const dummy = new Object3D();
    spots.forEach((spot, i) => {
      dummy.position.copy(spot);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    mesh.current!.instanceMatrix.needsUpdate = true;
  }, [spots]);
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, material, spots.length]}
      castShadow
    >
      <sphereGeometry args={[0.0058, 8, 6]} />
    </instancedMesh>
  );
}

function drawEmbers(ctx: CanvasRenderingContext2D) {
  const random = createRandom(77);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = `rgba(255,${120 + random() * 90},40,${0.35 + random() * 0.6})`;
    ctx.lineWidth = 0.6 + random() * 2.2;
    ctx.beginPath();
    let x = random() * 128,
      y = random() * 128;
    ctx.moveTo(x, y);
    for (let step = 0; step < 4; step++) {
      x += (random() - 0.5) * 22;
      y += (random() - 0.5) * 22;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

const emberMap = once(() => canvasTexture(128, 128, drawEmbers));

/** A wooden hibachi with ash, live charcoal and an iron kettle. */
export function Brazier({ reduced }: { reduced: boolean }) {
  const iron = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#2b2622',
        metalness: 0.55,
        roughness: 0.5,
      }),
    [],
  );
  const embers = emberMap();
  const coal = useRef<MeshStandardMaterial>(null),
    time = useRef(0);
  useEffect(() => () => iron.dispose(), [iron]);
  useFrame((_, delta) => {
    if (reduced || !coal.current) return;
    time.current += Math.min(delta, 0.05);
    const t = time.current;
    coal.current.emissiveIntensity =
      1.5 + Math.sin(t * 1.3) * 0.18 + Math.sin(t * 3.1 + 1) * 0.08;
  });
  const lathe = useMemo(
    () => KETTLE_PROFILE.map(([r, y]) => new Vector2(r, y)),
    [],
  );
  const lid = useMemo(
    () =>
      [
        [0, 0.018],
        [0.02, 0.017],
        [0.05, 0.006],
        [0.056, 0],
      ].map(([r, y]) => new Vector2(r, y)),
    [],
  );
  const spout = useMemo(
    () =>
      new CatmullRomCurve3([
        new Vector3(-0.112, 0.07, 0),
        new Vector3(-0.15, 0.088, 0),
        new Vector3(SPOUT_TIP[0], SPOUT_TIP[1], 0),
      ]),
    [],
  );
  const { width, height, wall } = BOX,
    inner = width - wall * 2;
  const pieces = useMemo(() => {
    const random = createRandom(19);
    return Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2 + random() * 0.4,
        r = i === 0 ? 0 : 0.035 + random() * 0.04;
      return {
        position: [
          Math.cos(a) * r,
          height - 0.06 + random() * 0.012,
          Math.sin(a) * r,
        ] as Point,
        rotation: [random(), random() * 3, random()] as Point,
        size: [
          0.032 + random() * 0.02,
          0.022 + random() * 0.01,
          0.026 + random() * 0.018,
        ] as Point,
      };
    });
  }, [height]);
  return (
    <group position={AT} name="brazier">
      {[-1, 1].map((side) => (
        <group key={side}>
          <Solid
            position={[side * (width / 2 - wall / 2), height / 2, 0]}
            size={[wall, height, width]}
            color="#4e2f1c"
          />
          <Solid
            position={[0, height / 2, side * (width / 2 - wall / 2)]}
            size={[inner, height, wall]}
            color="#4e2f1c"
          />
          <Solid
            position={[side * (width / 2 - 0.004), height + 0.009, 0]}
            size={[0.05, 0.018, width + 0.03]}
            color="#2e1b10"
            clearcoat={0.4}
          />
          <Solid
            position={[0, height + 0.009, side * (width / 2 - 0.004)]}
            size={[width - 0.04, 0.018, 0.05]}
            color="#2e1b10"
            clearcoat={0.4}
          />
          <Solid
            position={[side * (width / 2 - 0.05), 0.012, 0]}
            size={[0.06, 0.024, width - 0.04]}
            color="#24150c"
          />
        </group>
      ))}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[(sx * width) / 2, height - 0.03, (sz * width) / 2]}
          >
            <boxGeometry args={[0.036, 0.05, 0.036]} />
            <meshStandardMaterial
              color="#8a6a3a"
              metalness={1}
              roughness={0.35}
            />
          </mesh>
        )),
      )}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * (width / 2 + 0.004), 0.19, 0]}>
          <mesh rotation={[0, Math.PI / 2, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.008, 12]} />
            <primitive object={iron} attach="material" />
          </mesh>
          <mesh
            position={[side * 0.006, -0.028, 0]}
            rotation={[0, Math.PI / 2, 0]}
          >
            <torusGeometry args={[0.026, 0.0035, 6, 20]} />
            <primitive object={iron} attach="material" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, height - 0.012, 0]}>
        <boxGeometry args={[inner, 0.02, inner]} />
        <meshStandardMaterial
          color="#6e3d22"
          metalness={0.8}
          roughness={0.45}
        />
      </mesh>
      <mesh position={[0, height - 0.066, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[inner - 0.01, inner - 0.01, 12, 12]} />
        <meshStandardMaterial color="#8d8479" roughness={1} />
      </mesh>
      {pieces.map((piece, i) => (
        <mesh
          key={i}
          position={piece.position}
          rotation={piece.rotation}
          scale={piece.size}
        >
          <dodecahedronGeometry args={[0.5, 0]} />
          <meshStandardMaterial
            ref={i === 0 ? coal : undefined}
            color="#171211"
            roughness={0.95}
            emissive="#ff5a1c"
            emissiveMap={embers}
            emissiveIntensity={1.5}
          />
        </mesh>
      ))}
      <pointLight
        position={[0, height + 0.02, 0]}
        color="#ff8a44"
        intensity={0.7}
        distance={1.6}
      />
      <mesh position={[0, height - 0.035, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.105, 0.005, 6, 32]} />
        <primitive object={iron} attach="material" />
      </mesh>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * 0.1, height, Math.sin(a) * 0.1]}
            rotation={[0, -a, 0.35]}
          >
            <boxGeometry args={[0.008, 0.075, 0.012]} />
            <primitive object={iron} attach="material" />
          </mesh>
        );
      })}
      <group position={[0, KETTLE_Y, 0]} rotation={[0, 0, 0]}>
        <mesh castShadow receiveShadow>
          <latheGeometry args={[lathe, 40]} />
          <primitive object={iron} attach="material" />
        </mesh>
        <Hobnails material={iron} />
        <mesh position={[0, 0.144, 0]} castShadow>
          <latheGeometry args={[lid, 28]} />
          <meshStandardMaterial
            color="#5c4a33"
            metalness={0.8}
            roughness={0.38}
          />
        </mesh>
        <mesh position={[0, 0.168, 0]} castShadow>
          <sphereGeometry args={[0.011, 12, 8]} />
          <primitive object={iron} attach="material" />
        </mesh>
        <mesh castShadow>
          <tubeGeometry args={[spout, 12, 0.013, 10, false]} />
          <primitive object={iron} attach="material" />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[0, 0.13, side * 0.094]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.009, 0.011, 0.02, 10]} />
            <primitive object={iron} attach="material" />
          </mesh>
        ))}
        <mesh
          position={[0, 0.13, 0]}
          rotation={[0.18, Math.PI / 2, 0]}
          castShadow
        >
          <torusGeometry args={[0.098, 0.0065, 8, 40, Math.PI]} />
          <primitive object={iron} attach="material" />
        </mesh>
      </group>
    </group>
  );
}
