import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AddEquation,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  DstColorFactor,
  FogExp2,
  OneFactor,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import type { Point } from '../stations';
import { createRandom } from '../motion/dynamics';

type Shaft = {
  /** Aperture corner, and the two aperture edges from it. */
  origin: Point;
  across: Point;
  up: Point;
  direction: Point;
  length: number;
  gain: number;
  /** Gain weights for the 4 boundary sheets and the 2 diagonals; default [1, 1]. */
  sheetGain?: [number, number];
};

const VERANDA_DIR: Point = [0.45, -0.55, 1];
const SHOJI_DIR: Point = [0.15, -0.42, 1];
const SHAFTS: Shaft[] = [
  {
    origin: [-3.8, 0.35, -6.3],
    across: [1.8, 0, 0],
    up: [0, 2.5, 0],
    direction: VERANDA_DIR,
    length: 5.2,
    gain: 0.7,
    // The boundary sheets face the Host camera beside the jambs; let the diagonals carry the core.
    sheetGain: [0.45, 1.15],
  },
  {
    origin: [-1.55, 1.05, -6.22],
    across: [2.1, 0, 0],
    up: [0, 1.8, 0],
    direction: SHOJI_DIR,
    length: 2.8,
    gain: 0.2,
  },
  {
    origin: [3.93, 1.05, 0.8],
    across: [0, 0, -2],
    up: [0, 1.75, 0],
    direction: [-1, -0.42, -0.12],
    length: 3,
    gain: 0.22,
  },
];

const v = (p: Point) => new Vector3(...p);

/** Side walls plus two diagonal sheets per shaft, merged; aUv = (across, along). */
function shaftGeometry() {
  const positions: number[] = [],
    uvs: number[] = [],
    gains: number[] = [],
    index: number[] = [];
  for (const shaft of SHAFTS) {
    const o = v(shaft.origin),
      a = v(shaft.across),
      u = v(shaft.up),
      d = v(shaft.direction).normalize().multiplyScalar(shaft.length),
      [side, core] = shaft.sheetGain ?? [1, 1];
    const c = [o, o.clone().add(a), o.clone().add(a).add(u), o.clone().add(u)];
    const sheets: [Vector3, Vector3][] = [
      [c[0], c[1]],
      [c[1], c[2]],
      [c[2], c[3]],
      [c[3], c[0]],
      [c[0], c[2]],
      [c[1], c[3]],
    ];
    sheets.forEach(([p, q], k) => {
      const base = positions.length / 3;
      for (const [corner, s, t] of [
        [p, 0, 0],
        [q, 1, 0],
        [q.clone().add(d), 1, 1],
        [p.clone().add(d), 0, 1],
      ] as [Vector3, number, number][]) {
        positions.push(corner.x, corner.y, corner.z);
        uvs.push(s, t);
        gains.push(shaft.gain * (k < 4 ? side : core));
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute('aUv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute(
    'aGain',
    new BufferAttribute(new Float32Array(gains), 1),
  );
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

const noiseGlsl = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }`;

function shaftMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFog: { value: 0 },
      uColor: { value: new Color('#ffb477') },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aUv;
      attribute float aGain;
      varying vec2 vUv;
      varying float vGain;
      varying float vFacing;
      varying float vDepth;
      varying vec3 vWorld;
      void main() {
        vUv = aUv;
        vGain = aGain;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec3 n = normalize(mat3(modelMatrix) * normal);
        vFacing = abs(dot(n, normalize(cameraPosition - world.xyz)));
        vec4 mv = viewMatrix * world;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFog;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vGain;
      varying float vFacing;
      varying float vDepth;
      varying vec3 vWorld;
      ${noiseGlsl}
      void main() {
        vec2 uv = clamp(vUv, 0.0, 1.0);
        float across = pow(max(sin(3.14159 * uv.x), 0.0), 2.0);
        float along = smoothstep(0.0, 0.22, uv.y) * pow(1.0 - uv.y, 2.0);
        float streak = 0.6 + 0.4 * noise(vec2(uv.x * 9.0 + uv.y * 2.0, uTime * 0.06));
        float drift = 0.7 + 0.3 * noise(vWorld.xz * 1.4 + vWorld.y * 0.8 + uTime * 0.07);
        float edge = smoothstep(0.05, 0.55, vFacing);
        // Fade out before the sheets cut into the floor, so no hard line or lit wedge.
        float ground = smoothstep(0.02, 0.6, vWorld.y);
        float fog = exp(-uFog * uFog * vDepth * vDepth);
        float a = across * along * streak * drift * edge * ground * vGain * fog;
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/**
 * Sun pools on the floor and tatami. Each fragment traces back along its shaft to the
 * openings in the back wall, so the pool keeps the eave post, rail and shoji stile
 * shadows, and its edges soften with distance. Numbers mirror BackWall's layout.
 */
function poolMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uFog: { value: 0 },
      uColor: { value: new Color('#ffb477') },
      uVeranda: { value: v(VERANDA_DIR).normalize() },
      uShoji: { value: v(SHOJI_DIR).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mv = viewMatrix * world;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFog;
      uniform vec3 uColor;
      uniform vec3 uVeranda;
      uniform vec3 uShoji;
      varying vec3 vWorld;
      varying float vDepth;
      float band(float x, float a, float b, float soft) {
        return smoothstep(a - soft, a + soft, x) * (1.0 - smoothstep(b - soft, b + soft, x));
      }
      vec3 back(vec3 p, vec3 dir, float plane) {
        return p - dir * ((p.z - plane) / dir.z);
      }
      void main() {
        vec3 p = vWorld;
        vec3 w = back(p, uVeranda, -6.18);
        float reach = length(w - p);
        float soft = 0.03 + reach * 0.05;
        // Opening above the sill; the eave roof cuts the top of the beam.
        float veranda = band(w.x, -3.87, -1.9, soft) * band(w.y, 0.04, 2.45, soft * 2.0);
        vec3 post = back(p, uVeranda, -7.8);
        veranda *= 1.0 - 0.85 * band(post.x, -3.625, -3.475, soft * 1.3);
        vec3 rail = back(p, uVeranda, -7.84);
        float bars = max(max(band(rail.y, 0.112, 0.148, soft),
          band(rail.y, 0.432, 0.468, soft)), band(rail.y, 0.828, 0.872, soft));
        float posts = (band(rail.x, -3.985, -3.915, soft) + band(rail.x, -3.185, -3.115, soft)
          + band(rail.x, -2.385, -2.315, soft)) * step(rail.y, 0.87);
        veranda *= (1.0 - 0.7 * clamp(bars + posts, 0.0, 1.0)) * exp(-reach * 0.12);
        // Shoji paper diffuses: a dim, very soft pool broken by the panel stiles.
        vec3 s = back(p, uShoji, -6.25);
        float sreach = length(s - p);
        float ssoft = 0.1 + sreach * 0.06;
        float shoji = band(s.x, -1.65, 0.66, ssoft) * band(s.y, 0.96, 2.93, ssoft);
        float stiles = band(s.x, -1.65, -1.614, ssoft * 0.4)
          + band(s.x, -0.531, -0.459, ssoft * 0.4) + band(s.x, 0.624, 0.66, ssoft * 0.4);
        shoji *= (1.0 - 0.5 * clamp(stiles, 0.0, 1.0)) * exp(-sreach * 0.2);
        float fog = exp(-uFog * uFog * vDepth * vDepth);
        gl_FragColor = vec4(uColor * (veranda * 0.55 + shoji * 0.16) * fog, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    // Brightens what is under it (dst * (1 + src)), so floor seams stay dark in the light.
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: DstColorFactor,
    blendDst: OneFactor,
  });
}

/** Floor boards (top at 0) in front of the back wall, and the tatami top (0.052). */
const POOLS: { size: [number, number]; at: Point }[] = [
  { size: [5.8, 6.8], at: [-1.1, 0.003, -2.78] },
  { size: [3.59, 4.485], at: [0, 0.0525, -2.05] },
];

const MOTES = 320;

function moteGeometry() {
  const random = createRandom(4242),
    positions = new Float32Array(MOTES * 3),
    seeds = new Float32Array(MOTES),
    weights = SHAFTS.map((shaft) => shaft.gain * shaft.length);
  const total = weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < MOTES; i++) {
    let pick = random() * total,
      s = 0;
    while (pick > weights[s] && s < SHAFTS.length - 1) pick -= weights[s++];
    const shaft = SHAFTS[s];
    const p = v(shaft.origin)
      .addScaledVector(v(shaft.across), 0.15 + random() * 0.7)
      .addScaledVector(v(shaft.up), 0.15 + random() * 0.7)
      .addScaledVector(
        v(shaft.direction).normalize(),
        shaft.length * random() ** 1.4 * 0.8,
      );
    positions.set([p.x, p.y, p.z], i * 3);
    seeds[i] = random();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  return geometry;
}

function moteMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFog: { value: 0 },
      uScale: { value: 500 },
      uColor: { value: new Color('#ffd2a0') },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uScale;
      uniform float uFog;
      varying float vAlpha;
      void main() {
        float t = uTime + aSeed * 100.0;
        float rise = fract(t * 0.004 + aSeed);
        vec3 p = position + vec3(
          sin(t * 0.13 + aSeed * 40.0) * 0.09,
          (rise - 0.5) * 0.35 + sin(t * 0.09 + aSeed * 23.0) * 0.04,
          cos(t * 0.11 + aSeed * 31.0) * 0.09);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float depth = max(-mv.z, 0.05);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.5, (0.006 + aSeed * 0.006) * uScale / depth);
        float twinkle = 0.55 + 0.45 * sin(t * (0.6 + aSeed) + aSeed * 12.0);
        vAlpha = twinkle * max(sin(3.14159 * rise), 0.0) * exp(-uFog * uFog * depth * depth);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d) * vAlpha * 0.8;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** Warm light shafts from the veranda and shoji windows, with drifting dust inside them. */
export function Atmosphere({ reduced }: { reduced: boolean }) {
  const shafts = useMemo(
    () => ({ geometry: shaftGeometry(), material: shaftMaterial() }),
    [],
  );
  const motes = useMemo(
    () => ({ geometry: moteGeometry(), material: moteMaterial() }),
    [],
  );
  const pool = useMemo(poolMaterial, []);
  useEffect(
    () => () => {
      for (const part of [shafts, motes]) {
        part.geometry.dispose();
        part.material.dispose();
      }
      pool.dispose();
    },
    [shafts, motes, pool],
  );
  useFrame(({ scene, camera, size, viewport }, delta) => {
    const fog = scene.fog instanceof FogExp2 ? scene.fog.density : 0;
    const fov = (camera as PerspectiveCamera).fov ?? 50;
    for (const { material } of [shafts, motes]) {
      if (!reduced) material.uniforms.uTime.value += delta;
      material.uniforms.uFog.value = fog;
    }
    pool.uniforms.uFog.value = fog;
    motes.material.uniforms.uScale.value =
      (size.height * viewport.dpr) / (2 * Math.tan((fov * Math.PI) / 360));
  });
  return (
    <group name="atmosphere">
      {POOLS.map(({ size, at }) => (
        <mesh
          key={at[1]}
          position={at}
          rotation={[-Math.PI / 2, 0, 0]}
          material={pool}
          renderOrder={1}
        >
          <planeGeometry args={size} />
        </mesh>
      ))}
      {/* Light, not surfaces: a double-click walk must see the floor through them. */}
      <mesh
        geometry={shafts.geometry}
        material={shafts.material}
        renderOrder={2}
        frustumCulled={false}
        raycast={() => null}
      />
      <points
        geometry={motes.geometry}
        material={motes.material}
        renderOrder={3}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}
