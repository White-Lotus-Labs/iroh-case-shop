'use client';
import { useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';

// Petals adrift, after ThreeUI "Sakura Branch": a cupped, notched petal strip,
// instanced; each petal falls, sways and tumbles in the vertex shader.

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function petalGeometry(NS = 5, NV = 4) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < NS; i++) {
    const s = i / (NS - 1);
    for (let j = 0; j < NV; j++) {
      const v = (j / (NV - 1)) * 2 - 1;
      const wid =
        Math.pow(Math.sin(Math.PI * 0.5 * Math.min(s / 0.6, 1)), 0.72) *
        (1 - (0.1 * Math.max(s - 0.6, 0)) / 0.4);
      const notch =
        0.19 * Math.exp(-Math.pow(v * 3.1, 2)) * smoothstep(0.7, 1.0, s);
      // Centred on its own middle so it tumbles about its centre.
      pos.push(0.6 * wid * v, s - notch - 0.5, 0.26 * s * s + 0.11 * v * v * s);
      uv.push(s, (v + 1) * 0.5);
    }
  }
  for (let i = 0; i < NS - 1; i++)
    for (let j = 0; j < NV - 1; j++) {
      const a = i * NV + j;
      const b = a + NV;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return { pos, uv, idx };
}

export type PetalArea = {
  /** Half-width of the drift field; x wraps across 2 * x. */
  x: number;
  /** Half-height of the fall; y wraps across 2 * y. */
  y: number;
  near: number;
  far: number;
};

const DEFAULT_AREA: PetalArea = { x: 16, y: 11, near: 6, far: -5 };

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec2 uSpan;
  uniform vec2 uDepth;
  attribute vec3 iOrg;
  attribute vec4 iSeed;
  varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vNear;

  mat3 rotAxis(vec3 a, float ang) {
    float c = cos(ang), s = sin(ang), t = 1.0 - c;
    return mat3(t*a.x*a.x+c, t*a.x*a.y-s*a.z, t*a.x*a.z+s*a.y,
                t*a.x*a.y+s*a.z, t*a.y*a.y+c, t*a.y*a.z-s*a.x,
                t*a.x*a.z-s*a.y, t*a.y*a.z+s*a.x, t*a.z*a.z+c);
  }

  void main() {
    vUv = uv;
    float ph = iSeed.y;
    float fall = uTime * iSeed.x;
    vec3 p = iOrg;
    p.y = mod(iOrg.y - fall + uSpan.y, 2.0 * uSpan.y) - uSpan.y;
    // The source lets x drift without bound; wrap it so a long wait keeps its petals.
    p.x = mod(iOrg.x + fall * 0.34 + uSpan.x, 2.0 * uSpan.x) - uSpan.x
        + sin(uTime * 0.9 + ph) * 0.85;
    p.z = iOrg.z + sin(uTime * 0.6 + ph * 1.7) * 0.5;
    vNear = smoothstep(uDepth.x, uDepth.y, p.z);

    mat3 R = rotAxis(normalize(vec3(sin(ph), 0.7, cos(ph * 1.3))), uTime * iSeed.w + ph);
    vec3 local = R * (position * iSeed.z);
    vN = normalize(R * normal);
    vec4 world = modelMatrix * vec4(p + local, 1.0);
    vW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uSun, uSunCol, uSkyCol;
  varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vNear;

  vec3 petalShade(vec3 N, vec3 V, vec3 L, vec3 base, vec3 warm) {
    float wrap = dot(N, L) * 0.5 + 0.5;
    vec3 col = base * (uSunCol * (0.30 + 0.90 * wrap) + uSkyCol * (0.5 + 0.5 * N.y) * 0.42);
    float back = pow(max(dot(V, -L), 0.0), 2.4);
    col += warm * back * 0.34;
    return col;
  }

  void main() {
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vW);
    // Dusk: a deeper blush than the sunlit source, so petals read pink, not white.
    vec3 base = mix(vec3(0.700, 0.250, 0.400), vec3(0.930, 0.600, 0.700), smoothstep(0.0, 0.8, vUv.x));
    vec3 col = petalShade(N, V, uSun, base, vec3(1.00, 0.56, 0.40));
    // Far petals sink into the dusk; near ones catch the doorway light.
    col *= mix(0.5, 1.0, vNear);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function SakuraPetals({
  count,
  reduced,
  area = DEFAULT_AREA,
  size = 1,
  seed = 0x51a7d3,
}: {
  count: number;
  reduced: boolean;
  area?: PetalArea;
  size?: number;
  seed?: number;
}) {
  const geometry = useMemo(() => {
    const rand = seeded(seed);
    const range = (lo: number, hi: number) => lo + (hi - lo) * rand();
    const P = petalGeometry();
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(P.pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(P.uv, 2));
    g.setIndex(P.idx);
    const tmp = new BufferGeometry();
    tmp.setAttribute('position', g.getAttribute('position'));
    tmp.setIndex(P.idx);
    tmp.computeVertexNormals();
    g.setAttribute('normal', tmp.getAttribute('normal'));
    const org = new Float32Array(count * 3);
    const params = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      org[i * 3] = range(-area.x, area.x);
      org[i * 3 + 1] = range(-area.y, area.y);
      org[i * 3 + 2] = range(area.far, area.near);
      params[i * 4] = range(0.3, 0.72);
      params[i * 4 + 1] = rand() * 6.28;
      params[i * 4 + 2] = range(0.055, 0.115) * size;
      params[i * 4 + 3] = range(0.5, 1.7);
    }
    g.setAttribute('iOrg', new InstancedBufferAttribute(org, 3));
    g.setAttribute('iSeed', new InstancedBufferAttribute(params, 4));
    g.instanceCount = count;
    return g;
  }, [count, area, size, seed]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          // A still frame for reduced motion: petals mid-fall, not stacked at spawn.
          uTime: { value: 18 },
          uSpan: { value: [area.x, area.y] },
          uDepth: { value: [area.far, area.near] },
          // Warm light spilling from the open doors, a little high and to the right.
          uSun: { value: new Vector3(0.45, 0.35, -1).normalize() },
          uSunCol: { value: new Color(0.92, 0.68, 0.52) },
          uSkyCol: { value: new Color(0.55, 0.46, 0.66) },
        },
        vertexShader,
        fragmentShader,
        side: DoubleSide,
      }),
    [area],
  );
  // Apart, so a new count does not dispose (and recompile) a live material.
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, dt) => {
    if (!reduced) material.uniforms.uTime.value += Math.min(dt, 0.05);
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

/** Pause the canvas while the tab is hidden or a sketchbook leaf is riffling. */
function usePetalHold() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const sync = () => {
      const next =
        document.hidden || document.querySelector('.sb[data-riffle]') !== null;
      setHeld((prev) => (prev === next ? prev : next));
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    const root = document.querySelector('.sb');
    const observer = root ? new MutationObserver(sync) : null;
    observer?.observe(root as Element, {
      attributes: true,
      attributeFilter: ['data-riffle'],
    });
    return () => {
      document.removeEventListener('visibilitychange', sync);
      observer?.disconnect();
    };
  }, []);
  return held;
}

function canWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** A full-bleed transparent canvas of drifting petals, framed like the source. */
export function PetalCanvas({
  count,
  reduced,
  className,
  area,
  size,
  seed,
  light = false,
}: {
  count: number;
  reduced: boolean;
  className?: string;
  area?: PetalArea;
  size?: number;
  seed?: number;
  /** Fewer GPU features: no antialias, and a low-power context hint. */
  light?: boolean;
}) {
  // Probe before mounting R3F; a null WebGL context throws outside React boundaries.
  const [ok, setOk] = useState(false);
  const held = usePetalHold();
  useEffect(() => {
    setOk(canWebGL());
  }, []);
  if (!ok) return null;
  return (
    <Canvas
      className={className}
      dpr={[1, 1]}
      frameloop={reduced || held ? 'demand' : 'always'}
      gl={{
        antialias: !light,
        alpha: true,
        powerPreference: light ? 'low-power' : 'default',
      }}
      camera={{ position: [0, 1, 14], fov: 45, near: 0.1, far: 60 }}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      fallback={null}
    >
      <SakuraPetals
        count={count}
        reduced={reduced}
        area={area}
        size={size}
        seed={seed}
      />
    </Canvas>
  );
}
