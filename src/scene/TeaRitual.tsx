import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Group,
  Mesh,
  MeshPhysicalMaterial,
  PointLight,
  Quaternion,
  Vector3,
  CatmullRomCurve3,
} from 'three';
import { ContactShadows } from '@react-three/drei';
import { damp, pourPose, type SceneMood } from './motion/dynamics';
import { Steam } from './Steam';
import { PaperLantern } from './TeaArchitecture';
import {
  GlazeMaterial,
  smoothProfile,
  sweepGeometry,
  type Glaze,
} from './Ceramics';
import { Brazier, KETTLE_SPOUT } from './props/Brazier';
import type { Point } from './stations';

const STEAM: {
  origin: Point;
  count: number;
  strength: number;
  rise: number;
}[] = [
  { origin: [0, 0.92, -2.48], count: 10, strength: 0.85, rise: 0.56 },
  { origin: [0.3, 0.905, -2.345], count: 6, strength: 0.55, rise: 0.4 },
  { origin: [-0.58, 0.72, -2.18], count: 8, strength: 0.7, rise: 0.46 },
  { origin: [0.58, 0.72, -2.34], count: 8, strength: 0.7, rise: 0.46 },
  { origin: KETTLE_SPOUT, count: 8, strength: 0.6, rise: 0.5 },
];

/** Foot-rim radius: the pot tips about this edge. */
const FOOT = 0.106;
const BODY = smoothProfile(
  [
    [0, 0.007],
    [0.075, 0.007],
    [0.084, 0.004],
    [0.09, 0],
    [0.103, 0],
    [0.108, 0.004],
    [0.109, 0.014],
    [0.106, 0.02],
    [0.12, 0.028],
    [0.155, 0.045],
    [0.185, 0.075],
    [0.2, 0.11],
    [0.203, 0.135],
    [0.197, 0.165],
    [0.18, 0.198],
    [0.152, 0.225],
    [0.122, 0.24],
    [0.106, 0.247],
    [0.1, 0.2515],
    [0.0965, 0.2515],
    [0.0945, 0.246],
    [0.0935, 0.238],
    [0.086, 0.236],
    [0.078, 0.235],
    [0.075, 0.228],
    [0.07, 0.215],
    [0.03, 0.205],
    [0, 0.205],
  ],
  180,
);
const LID = smoothProfile(
  [
    [0, 0.214],
    [0.066, 0.214],
    [0.07, 0.218],
    [0.072, 0.234],
    [0.078, 0.2365],
    [0.0875, 0.2365],
    [0.09, 0.2385],
    [0.0905, 0.249],
    [0.088, 0.2535],
    [0.08, 0.258],
    [0.06, 0.2645],
    [0.03, 0.2705],
    [0, 0.272],
  ],
  70,
);
const KNOB = smoothProfile(
  [
    [0.021, 0.266],
    [0.022, 0.2695],
    [0.018, 0.2725],
    [0.012, 0.277],
    [0.0125, 0.282],
    [0.019, 0.286],
    [0.0215, 0.292],
    [0.019, 0.298],
    [0.012, 0.3015],
    [0, 0.302],
  ],
  40,
);
const SPOUT_PATH = new CatmullRomCurve3(
  [
    new Vector3(0.135, 0.1, 0),
    new Vector3(0.21, 0.16, 0),
    new Vector3(0.275, 0.225, 0),
    new Vector3(0.33, 0.29, 0),
  ],
  false,
  'centripetal',
);
const SPOUT_LENGTH = SPOUT_PATH.getLength();
const SPOUT = smoothProfile(
  [
    [0.05, 0],
    [0.05, 0.06],
    [0.053, 0.082],
    [0.04, 0.115],
    [0.031, 0.16],
    [0.024, 0.21],
    [0.0205, SPOUT_LENGTH - 0.01],
    [0.0215, SPOUT_LENGTH - 0.003],
    [0.0195, SPOUT_LENGTH],
    [0.0145, SPOUT_LENGTH - 0.0015],
    [0.0128, SPOUT_LENGTH - 0.012],
    [0.016, SPOUT_LENGTH - 0.07],
  ],
  70,
);
const HANDLE_PATH = new CatmullRomCurve3(
  [
    new Vector3(0, 0.125, -0.13),
    new Vector3(0, 0.14, -0.23),
    new Vector3(0, 0.162, -0.315),
  ],
  false,
  'centripetal',
);
const HANDLE_LENGTH = HANDLE_PATH.getLength();
const HANDLE = smoothProfile(
  [
    [0.032, 0],
    [0.033, 0.06],
    [0.037, 0.076],
    [0.029, 0.096],
    [0.025, 0.13],
    [0.0265, HANDLE_LENGTH - 0.025],
    [0.029, HANDLE_LENGTH - 0.008],
    [0.027, HANDLE_LENGTH - 0.002],
    [0.018, HANDLE_LENGTH],
    [0, HANDLE_LENGTH],
  ],
  50,
);
const ASH = {
  glaze: '#4a5536',
  thin: '#b58a4c',
  clay: '#8c4c30',
  speckle: 1.4,
};
const POT_GLAZE: Record<'body' | 'lid' | 'knob' | 'spout' | 'handle', Glaze> = {
  body: {
    ...ASH,
    foot: BODY.marks[7] + 0.04,
    edges: [BODY.marks[18], BODY.marks[22]],
    inner: BODY.marks[21],
    innerGlaze: '#2c3322',
    drips: 11,
    seed: 31,
    size: [512, 256],
  },
  lid: {
    ...ASH,
    foot: LID.marks[5] + 0.02,
    edges: [LID.marks[8]],
    pools: [1],
    seed: 57,
  },
  knob: { ...ASH, foot: -1, edges: [KNOB.marks[6]], seed: 83 },
  spout: { ...ASH, foot: -1, edges: [SPOUT.marks[8]], seed: 97 },
  handle: { ...ASH, foot: -1, edges: [HANDLE.marks[7]], seed: 113 },
};
/** A short ceremonial tip rotates about the teapot's foot rim, keeping its
 * support point on the table. Completion/cancellation never delays the result. */
export function TeaRitual({
  mood,
  reduced,
  requestKey,
}: {
  mood: SceneMood;
  reduced: boolean;
  requestKey: string | null;
}) {
  const pot = useRef<Group>(null),
    stream = useRef<Mesh>(null),
    ceramic = useRef<MeshPhysicalMaterial>(null);
  const spout = useMemo(() => sweepGeometry(SPOUT_PATH, SPOUT.points), []),
    handle = useMemo(() => sweepGeometry(HANDLE_PATH, HANDLE.points), []);
  useEffect(
    () => () => {
      spout.dispose();
      handle.dispose();
    },
    [spout, handle],
  );
  const motion = useRef({ age: 2, tilt: 0, stream: 0, active: false });
  const [still, setStill] = useState(true);
  const points = useRef({
    spout: new Vector3(),
    unit: new Vector3(),
    cup: new Vector3(0.58, 0.75, -2.34),
    direction: new Vector3(),
    up: new Vector3(0, 1, 0),
    rotation: new Quaternion(),
  });
  useEffect(() => {
    if (mood === 'pouring') {
      motion.current.age = 0;
      motion.current.active = true;
    } else motion.current.active = false;
  }, [mood, requestKey]);
  useFrame((_, delta) => {
    const m = motion.current,
      dt = Math.min(delta, 0.05);
    m.age += dt;
    const pose =
      m.active && !reduced ? pourPose(m.age) : { tilt: 0, stream: 0 };
    // A faster critically damped recovery handles early result/error/cancellation.
    m.tilt = damp(m.tilt, pose.tilt, 18, dt);
    m.stream = damp(m.stream, pose.stream, 22, dt);
    if (reduced) {
      m.tilt = 0;
      m.stream = 0;
    }
    if (pot.current) pot.current.rotation.z = -m.tilt;
    const resting = !m.active && m.tilt < 1e-4;
    if (resting !== still) setStill(resting);
    if (ceramic.current)
      ceramic.current.emissiveIntensity = damp(
        ceramic.current.emissiveIntensity,
        mood === 'pouring' ? 0.13 : 0.025,
        4,
        dt,
      );
    if (stream.current && pot.current) {
      const p = points.current;
      p.spout.set(0.33 - FOOT, 0.29, 0);
      pot.current.localToWorld(p.spout);
      p.direction.copy(p.cup).sub(p.spout);
      stream.current.position.copy(p.spout).addScaledVector(p.direction, 0.5);
      stream.current.quaternion.copy(
        p.rotation.setFromUnitVectors(
          p.up,
          p.unit.copy(p.direction).normalize(),
        ),
      );
      stream.current.scale.set(m.stream, p.direction.length(), m.stream);
      stream.current.visible = m.stream > 0.03 && !reduced;
    }
  });
  // drei's ContactShadows restarts its frame count on every render and then
  // redraws the whole scene, so it is memoized and live only while the pot moves.
  const shadow = useMemo(
    () => (
      <ContactShadows
        position={[0, 0.6135, -2.41]}
        scale={[2.5, 1.3]}
        far={0.32}
        blur={1.4}
        opacity={0.75}
        resolution={512}
        frames={reduced || still ? 1 : Infinity}
        color="#140b06"
      />
    ),
    [reduced, still],
  );
  return (
    <>
      <group position={[0, 0.6, -2.48]} rotation={[0, -0.423, 0]}>
        <group ref={pot} position={[FOOT, 0.0125, 0]} name="pouring-teapot">
          <group position={[-FOOT, 0, 0]}>
            <mesh castShadow receiveShadow>
              <latheGeometry args={[BODY.points, 72]} />
              <GlazeMaterial
                ref={ceramic}
                glaze={POT_GLAZE.body}
                emissive="#b07839"
                emissiveIntensity={0.025}
              />
            </mesh>
            <mesh castShadow receiveShadow>
              <latheGeometry args={[LID.points, 64]} />
              <GlazeMaterial glaze={POT_GLAZE.lid} />
            </mesh>
            <mesh castShadow>
              <latheGeometry args={[KNOB.points, 32]} />
              <GlazeMaterial glaze={POT_GLAZE.knob} />
            </mesh>
            <mesh
              position={[0, 0.2672, 0.05]}
              rotation={[-Math.PI / 2 + 0.2, 0, 0]}
            >
              <circleGeometry args={[0.0042, 12]} />
              <meshBasicMaterial color="#0b0906" />
            </mesh>
            <mesh geometry={spout} castShadow receiveShadow>
              <GlazeMaterial glaze={POT_GLAZE.spout} />
            </mesh>
            <mesh geometry={handle} castShadow receiveShadow>
              <GlazeMaterial glaze={POT_GLAZE.handle} />
            </mesh>
          </group>
        </group>
      </group>
      <Brazier reduced={reduced} />
      <mesh ref={stream} visible={false}>
        <cylinderGeometry args={[0.008, 0.006, 1, 8]} />
        <meshBasicMaterial
          color="#c49a51"
          transparent
          opacity={0.65}
          depthWrite={false}
        />
      </mesh>
      {STEAM.map((source) => (
        <Steam
          key={source.origin.join()}
          {...source}
          active={mood === 'pouring'}
          reduced={reduced}
        />
      ))}
      {shadow}
    </>
  );
}
export function LanternLight({
  mood,
  reduced,
}: {
  mood: SceneMood;
  reduced: boolean;
}) {
  const light = useRef<PointLight>(null),
    motion = useRef({ time: 0, warmth: 0 });
  useFrame((_, delta) => {
    const m = motion.current,
      dt = Math.min(delta, 0.05);
    m.time += reduced ? 0 : dt;
    m.warmth = damp(
      m.warmth,
      mood === 'pouring' ? 1 : mood === 'card' ? 0.3 : 0,
      2,
      dt,
    );
    if (light.current)
      light.current.intensity =
        6.5 +
        m.warmth * 0.65 +
        (reduced
          ? 0
          : Math.sin(m.time * 0.73) * 0.07 +
            Math.sin(m.time * 0.29 + 2) * 0.035);
  });
  return (
    <>
      <PaperLantern position={[2.3, 2.72, -3.1]} radius={0.15} />
      <pointLight
        ref={light}
        position={[2.3, 2.72, -3.1]}
        intensity={6.5}
        distance={7}
        color="#ffc36d"
      />
    </>
  );
}
