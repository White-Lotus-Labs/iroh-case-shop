import {
  startTransition,
  Suspense,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import {
  Color,
  CubeCamera,
  DoubleSide,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Scene,
  WebGLCubeRenderTarget,
  type Group,
  type Material,
  type Object3D,
  type ShaderMaterial,
} from 'three';
import { Atmosphere } from './props/Atmosphere';

type Former = [
  form: 'rect' | 'circle',
  color: string,
  intensity: number,
  position: [number, number, number],
  scale: number | [number, number],
  rotation?: [number, number, number],
];

// Warm window and doorway panels, two lanterns, dim timber above and below.
const FORMERS: Former[] = [
  ['rect', '#ff9a5c', 3.2, [-3.1, 1.2, -6], [1.8, 2.6]],
  ['rect', '#ffd9a3', 2.4, [-0.4, 1.9, -6], [2.2, 2.8]],
  ['rect', '#ffd7a0', 2, [4, 2.1, -0.3], [2, 2.4]],
  ['circle', '#ffc070', 9, [2.3, 2.72, -3.1], 0.5],
  ['circle', '#ffc070', 9, [-1.05, 2.45, -2.6], 0.55],
  ['rect', '#ffcf96', 0.7, [0, 1.6, 8], [3.5, 3]],
  ['rect', '#5a3b25', 0.35, [0, 4, -1.5], [8, 10], [Math.PI / 2, 0, 0]],
  ['rect', '#7a4c2c', 0.4, [0, -1.2, -1.5], [8, 10], [-Math.PI / 2, 0, 0]],
  ['rect', '#4a3222', 0.3, [-4.5, 1.8, -1.5], [10, 3.7]],
];

/** Procedural room reflections, rendered once into a cube map. */
function RoomEnvironment() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  useLayoutEffect(() => {
    const room = new Scene();
    room.background = new Color('#140d09');
    const rect = new PlaneGeometry(1, 1);
    const circle = new RingGeometry(0, 0.5, 64);
    const materials = FORMERS.map(
      ([form, color, intensity, position, scale, rotation]) => {
        const material = new MeshBasicMaterial({
          color: new Color(color).multiplyScalar(intensity),
          side: DoubleSide,
          toneMapped: false,
        });
        const mesh = new Mesh(form === 'circle' ? circle : rect, material);
        mesh.position.set(...position);
        if (Array.isArray(scale)) mesh.scale.set(scale[0], scale[1], 1);
        else mesh.scale.setScalar(scale);
        if (rotation) mesh.rotation.set(...rotation);
        else mesh.lookAt(0, 0, 0);
        room.add(mesh);
        return material;
      },
    );
    const target = new WebGLCubeRenderTarget(256);
    target.texture.type = HalfFloatType;
    const autoClear = gl.autoClear;
    gl.autoClear = true;
    new CubeCamera(0.1, 1000, target).update(gl, room);
    gl.autoClear = autoClear;
    scene.environment = target.texture;
    scene.environmentIntensity = 0.55;
    return () => {
      scene.environment = null;
      scene.environmentIntensity = 1;
      target.dispose();
      rect.dispose();
      circle.dispose();
      materials.forEach((material) => material.dispose());
    };
  }, [gl, scene]);
  return null;
}

/** Fog, reflections and light shafts belong to the lit shell: adding them later recompiles every program. */
export function SceneLighting({ reduced }: { reduced: boolean }) {
  return (
    <>
      <fogExp2 attach="fog" args={['#5c3c26', 0.045]} />
      <RoomEnvironment />
      <Atmosphere reduced={reduced} />
    </>
  );
}

type Fade = {
  material: Material;
  opacity: number;
  transparent: boolean;
  forceSinglePass: boolean;
};
const FADE_SECONDS = 0.6;

function collectFades(root: Object3D) {
  const fades = new Map<Material, Fade>();
  root.traverse((object) => {
    const material = (object as Mesh).material;
    for (const m of Array.isArray(material) ? material : [material]) {
      if (!m || (m as ShaderMaterial).isShaderMaterial) continue;
      fades.set(m, {
        material: m,
        opacity: m.opacity,
        transparent: m.transparent,
        forceSinglePass: m.forceSinglePass,
      });
    }
  });
  return [...fades.values()];
}

// `transparent` is part of three's program key, and a transparent double-sided
// material draws in two passes with `side` swapped, so fading needs its own
// variants. Single-pass keeps that to one extra program per opaque recipe.
function hide(fade: Fade) {
  const m = fade.material;
  if (!fade.transparent) m.transparent = m.forceSinglePass = true;
  m.opacity = 0;
}

function show(fade: Fade) {
  const m = fade.material;
  m.opacity = fade.opacity;
  m.transparent = fade.transparent;
  m.forceSinglePass = fade.forceSinglePass;
  if (!fade.transparent) m.needsUpdate = true;
}

// A driver that never reports ready must not leave the room frozen.
const settle = (work: Promise<unknown>) =>
  Promise.race([
    work,
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]).catch(() => undefined);

/**
 * Mounts `children` one frame after the shell, in a transition so React can slice the
 * work. Its priority-1 frame slot keeps R3F from rendering until the composer (inside
 * `children`) takes over, so no program is ever built for the unused on-screen variant.
 * Once every child has resolved, with the frame loop paused, it runs `precompile` for
 * the final look and again for the fade, then fades the new detail in and calls `onReady`.
 */
export function Staged({
  children,
  reduced,
  precompile,
  onReady,
}: {
  children: ReactNode;
  reduced: boolean;
  precompile: (state: RootState) => Promise<unknown>;
  onReady?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const group = useRef<Group>(null);
  const requested = useRef(false);
  const fades = useRef<Fade[] | null>(null);
  const progress = useRef(-1);
  const get = useThree((state) => state.get);
  const compile = useRef(precompile);
  compile.current = precompile;
  const ready = useRef(onReady);
  ready.current = onReady;
  const reveal = useCallback(() => {
    const list = (fades.current ??= collectFades(group.current!));
    const { setFrameloop } = get();
    setFrameloop('never');
    let live = true;
    // Deferred: Strict Mode's rehearsal unmount disposes materials, and a compile already
    // polling them would throw. The cleanup cancels the start instead.
    const start = setTimeout(async () => {
      list.forEach(show);
      await settle(compile.current(get()));
      if (!live) return;
      list.forEach(hide);
      await settle(compile.current(get()));
      if (!live) return;
      setFrameloop('always');
      progress.current = 0;
      ready.current?.();
    });
    return () => {
      live = false;
      clearTimeout(start);
      setFrameloop('always');
    };
  }, [get]);
  useFrame((_, delta) => {
    if (!mounted) {
      if (!requested.current) startTransition(() => setMounted(true));
      requested.current = true;
      return;
    }
    if (progress.current < 0) return;
    const t = (progress.current = reduced
      ? 1
      : Math.min(1, progress.current + delta / FADE_SECONDS));
    const eased = t * t * (3 - 2 * t);
    for (const fade of fades.current!)
      fade.material.opacity = fade.opacity * eased;
    if (t === 1) {
      fades.current!.forEach(show);
      progress.current = -1;
    }
  }, 1);
  return (
    <Suspense fallback={null}>
      <group ref={group}>{mounted && children}</group>
      {mounted && <OnCommit run={reveal} />}
    </Suspense>
  );
}

/** Runs after its Suspense siblings commit, i.e. once every lazy child has resolved. */
function OnCommit({ run }: { run: () => () => void }) {
  useLayoutEffect(run, [run]);
  return null;
}
