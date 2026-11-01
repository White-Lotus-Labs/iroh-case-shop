import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import {
  AdditiveBlending,
  BackSide,
  Box3,
  Color,
  MathUtils,
  Mesh,
  Quaternion,
  SkinnedMesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Group,
  type InstancedMesh,
  type MeshStandardMaterial,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import type { Station } from '../shared/contracts';
import { InkLine, STATION_TEASERS } from '../ui/stationTeasers';
import { LOOK, STATIONS, wallBetween, type Point } from './stations';

/** The ember quad and its hit disc, in CSS pixels; the lit core itself reads about 20 px. */
const QUAD_PX = 56,
  HIT_PX = 34;
/** Same gold as the thesis-card rim. */
const WARM = new Color('#e9c983');
const RIM_PX = 6;

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// A quiet ring around the seal. No sparks and no expanding pulse.
const EMBER_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uHover;
uniform float uActive;
uniform float uOpacity;
uniform float uMotion;
varying vec2 vUv;
float band(float d, float radius, float width) {
  return 1.0 - smoothstep(width * 0.5 - 0.5, width * 0.5 + 0.5, abs(d - radius));
}
void main() {
  vec2 p = (vUv - 0.5) * ${QUAD_PX.toFixed(1)};
  float r = length(p);
  float breath = 0.5 + 0.5 * sin(uTime * 1.3) * uMotion;
  float ring = band(r, 16.5, 1.45);
  float halo = exp(-pow(r - 16.5, 2.0) / 22.0);
  float lit = ring * (0.8 + 0.4 * uHover + 0.15 * uActive) + halo * (0.22 + 0.1 * breath);
  vec3 ember = vec3(1.0, 0.58, 0.22);
  vec3 hot = vec3(1.0, 0.94, 0.8);
  gl_FragColor = vec4(mix(ember, hot, ring) * lit, uOpacity);
}`;
// Inverted hull pushed out a fixed number of pixels, so the warm line is crisp at any distance.
const HULL_VERTEX = /* glsl */ `
uniform vec2 uSize;
uniform float uThickness;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec2 dir = (projectionMatrix * vec4(normalMatrix * normal, 0.0)).xy;
  clip.xy += normalize(dir + vec2(1e-5)) * uThickness / uSize * clip.w * 2.0;
  gl_Position = clip;
}`;
const FLAT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor, uOpacity); }`;
// Cut-out art (the host diorama) has no closed hull: dilate its alpha instead.
const CUTOUT_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float a = 0.0;
  for (int i = 0; i < 12; i++) {
    float angle = float(i) * 0.5236;
    a = max(a, texture2D(uMap, vUv + vec2(cos(angle), sin(angle)) * 0.005).a);
  }
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;

const world = new Vector3(),
  lifted = new Vector3(),
  view = new Vector3(),
  worldScale = new Vector3(),
  facing = new Quaternion();

/** A small ember that marks something to open or inspect. Keep these props stable for other lanes. */
function HaloMarker({
  position,
  active,
  reduced,
  onClick,
  detail,
  onHover,
  stay = false,
  stayNear = 0,
  openDelay = 700,
}: {
  position: Point;
  active: boolean;
  reduced: boolean;
  onClick?: () => void;
  /** Longer line. The seal is always in the ring. The line opens beside it. */
  detail?: { glyph: string; text: string };
  onHover?: (hovered: boolean) => void;
  /** Keep the line open. Used when this place is the current station. */
  stay?: boolean;
  /** Also keep the line open while the camera is within this many metres. */
  stayNear?: number;
  /** Wait before the line opens, so the seal is seen first. */
  openDelay?: number;
}) {
  const root = useRef<Group>(null),
    face = useRef<Group>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader: EMBER_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uHover: { value: 0 },
          uActive: { value: 0 },
          uOpacity: { value: 0 },
          uMotion: { value: 1 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [near, setNear] = useState(false);
  const [held, setHeld] = useState(false);
  const live = useRef({ hidden: false, opacity: 0, hover: 0, near: false });
  const hoverRef = useRef({ on: false, notify: onHover });
  useEffect(() => {
    hoverRef.current.notify = onHover;
  });
  const hover = (on: boolean) => {
    if (hoverRef.current.on === on) return;
    hoverRef.current.on = on;
    setHovered(on);
    hoverRef.current.notify?.(on);
    if (onClick || !on) document.body.style.cursor = on ? 'pointer' : '';
  };
  useEffect(
    () => () => {
      if (!hoverRef.current.on) return;
      hoverRef.current.notify?.(false);
      document.body.style.cursor = '';
    },
    [],
  );
  const pinned = stay || near;
  useEffect(() => {
    if (!pinned) {
      setHeld(false);
      return;
    }
    if (reduced || openDelay <= 0) {
      setHeld(true);
      return;
    }
    const id = window.setTimeout(() => setHeld(true), openDelay);
    return () => window.clearTimeout(id);
  }, [pinned, reduced, openDelay]);
  useFrame(({ camera, size, clock }, delta) => {
    const g = root.current,
      f = face.current,
      s = live.current;
    if (!g || !f) return;
    g.getWorldPosition(world);
    const distance = world.distanceTo(camera.position);
    // Hide inside the marker, and behind the partition wall (a segment test against the room box).
    const blocked = distance < 0.35 || wallBetween(world, camera.position);
    if (blocked !== s.hidden) {
      s.hidden = blocked;
      setHidden(blocked);
      if (blocked) hover(false);
    }
    if (stayNear > 0) {
      const limit = s.near ? stayNear + 0.7 : stayNear;
      const next = distance < limit;
      if (next !== s.near) {
        s.near = next;
        setNear(next);
      }
    }
    // Slide the ember toward the camera on its own sight line: same pixel, but it now wins
    // R3F's nearest-first raycast over the prop it marks.
    lifted
      .copy(camera.position)
      .sub(world)
      .setLength(Math.min(0.35, distance * 0.3))
      .add(world);
    // Constant screen size: world units per CSS pixel at this depth.
    const depth = Math.max(
      0.05,
      -view.copy(lifted).applyMatrix4(camera.matrixWorldInverse).z,
    );
    f.position.copy(g.worldToLocal(lifted));
    const fov = MathUtils.degToRad((camera as PerspectiveCamera).fov ?? 50);
    g.getWorldScale(worldScale);
    f.scale.setScalar(
      (2 * depth * Math.tan(fov / 2)) / size.height / worldScale.x,
    );
    f.quaternion.copy(
      g.getWorldQuaternion(facing).invert().multiply(camera.quaternion),
    );
    const fade = blocked ? 0 : 1 - MathUtils.smoothstep(distance, 4, 12) * 0.65;
    s.opacity += (fade - s.opacity) * (reduced ? 1 : Math.min(1, delta * 6));
    s.hover +=
      ((hovered ? 1 : 0) - s.hover) * (reduced ? 1 : Math.min(1, delta * 10));
    f.visible = s.opacity > 0.01;
    const u = material.uniforms;
    u.uOpacity.value = s.opacity;
    u.uHover.value = s.hover;
    u.uActive.value = active ? 1 : 0;
    u.uMotion.value = reduced ? 0 : 1;
    if (!reduced) u.uTime.value = clock.elapsedTime;
  });
  return (
    <group ref={root} position={position}>
      <group ref={face}>
        <mesh material={material} renderOrder={20} raycast={() => null}>
          <planeGeometry args={[QUAD_PX, QUAD_PX]} />
        </mesh>
        <mesh
          userData={{ halo: true }}
          onPointerOver={(event) => {
            if (live.current.hidden) return;
            event.stopPropagation();
            hover(true);
          }}
          onPointerOut={() => hover(false)}
          onClick={(event) => {
            if (live.current.hidden || !onClick || event.delta > LOOK.dragPx)
              return;
            event.stopPropagation();
            hover(false);
            onClick();
          }}
        >
          <circleGeometry args={[HIT_PX / 2, 24]} />
          <meshBasicMaterial
            transparent
            opacity={0}
            depthTest={false}
            depthWrite={false}
            colorWrite={false}
          />
        </mesh>
        {!hidden && detail && (
          <Html
            center
            zIndexRange={[5, 0]}
            wrapperClass="halo-core-wrap"
            pointerEvents="none"
          >
            <span className="halo-label-seal" aria-hidden="true">
              {detail.glyph}
            </span>
          </Html>
        )}
      </group>
      {!hidden && (held || hovered) && detail && (
        <Html
          zIndexRange={[6, 0]}
          wrapperClass="halo-label-wrap"
          pointerEvents="none"
        >
          <div className="halo-label is-note" aria-hidden="true">
            <InkLine text={detail.text} className="halo-label-text" />
          </div>
        </Html>
      )}
    </group>
  );
}

type OutlineTarget = { name: string; within?: [Point, Point] };

/** Warm line around a prop while its marker is hovered. Attaches shells to the prop's largest meshes. */
function WarmOutline({
  name,
  within,
  reduced,
}: OutlineTarget & { reduced: boolean }) {
  const scene = useThree((state) => state.scene),
    gl = useThree((state) => state.gl);
  const shells = useRef<ShaderMaterial[]>([]);
  useEffect(() => {
    const root = scene.getObjectByName(name);
    if (!root) return;
    root.updateWorldMatrix(true, true);
    const box =
      within && new Box3(new Vector3(...within[0]), new Vector3(...within[1]));
    const bounds = new Box3(),
      extent = new Vector3();
    const picked: { mesh: Mesh; size: number; cutout: Texture | null }[] = [];
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (
        !mesh.isMesh ||
        !mesh.visible ||
        (mesh as InstancedMesh).isInstancedMesh ||
        // A plain hull is not skinned, so it draws the bind pose through Uncle.
        (mesh as SkinnedMesh).isSkinnedMesh
      )
        return;
      const material = (
        Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      ) as MeshStandardMaterial;
      const cutout =
        material.map && material.alphaTest > 0 ? material.map : null;
      if (material.transparent && !cutout) return;
      bounds.setFromObject(mesh);
      if (box && !box.containsBox(bounds)) return;
      bounds.getSize(extent);
      if (!cutout && Math.min(extent.x, extent.y, extent.z) < 0.004) return;
      picked.push({ mesh, size: extent.length(), cutout });
    });
    // The largest parts carry the silhouette. Every gear would draw lines through the machine.
    picked.sort((a, b) => b.size - a.size);
    const hull = new ShaderMaterial({
      vertexShader: HULL_VERTEX,
      fragmentShader: FLAT_FRAGMENT,
      uniforms: {
        uColor: { value: WARM },
        uOpacity: { value: 0 },
        uSize: { value: new Vector2(1, 1) },
        uThickness: { value: RIM_PX },
      },
      side: BackSide,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const materials = [hull];
    const added = picked.slice(0, 12).map(({ mesh, cutout }) => {
      let shell: Mesh;
      if (cutout) {
        const glow = new ShaderMaterial({
          vertexShader: QUAD_VERTEX,
          fragmentShader: CUTOUT_FRAGMENT,
          uniforms: {
            uMap: { value: cutout },
            uColor: { value: WARM },
            uOpacity: { value: 0 },
          },
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        });
        materials.push(glow);
        shell = new Mesh(mesh.geometry, glow);
        shell.position.z = -0.012;
        shell.scale.setScalar(1.025);
      } else shell = new Mesh(mesh.geometry, hull);
      shell.raycast = () => null;
      mesh.add(shell);
      return shell;
    });
    shells.current = materials;
    return () => {
      added.forEach((shell) => shell.removeFromParent());
      materials.forEach((material) => material.dispose());
      shells.current = [];
    };
  }, [scene, name, within]);
  const drawing = useMemo(() => new Vector2(), []);
  useFrame((_, delta) => {
    gl.getDrawingBufferSize(drawing);
    for (const material of shells.current) {
      const u = material.uniforms;
      u.uOpacity.value +=
        (0.85 - u.uOpacity.value) * (reduced ? 1 : Math.min(1, delta * 8));
      u.uSize?.value.copy(drawing);
      if (u.uThickness) u.uThickness.value = RIM_PX * gl.getPixelRatio();
    }
  });
  return null;
}

const HALO_STATIONS = ['Counter', 'AvatarSeat', 'TeaTable', 'Shelf'] as const;
type HaloStation = (typeof HALO_STATIONS)[number];
/** Props outlined while their seal is hovered. The host lights itself; the shelf stays plain. */
const OUTLINES: Partial<Record<HaloStation, OutlineTarget>> = {
  Counter: {
    name: 'waiting-counter-room',
    within: [
      [-4.0, 0, 5.4],
      [-0.4, 1.95, 6.8],
    ],
  },
};

/** One ember per place worth opening. Another station's ember flies there; the current one opens it. */
export function StationHalos({
  station,
  menuClosed,
  reduced,
  onNavigate,
  onMenuOpen,
  onShelfSelect,
  onHostHover,
  onObservatoriumOpen,
}: {
  station: Station;
  menuClosed: boolean;
  reduced: boolean;
  onNavigate: (station: Station) => void;
  onMenuOpen: () => void;
  onShelfSelect: () => void;
  onHostHover?: (on: boolean) => void;
  onObservatoriumOpen: () => void;
}) {
  const [hovered, setHovered] = useState<HaloStation | null>(null);
  if (station === 'Entrance') return null;
  const rim = hovered && OUTLINES[hovered];
  return (
    <>
      {HALO_STATIONS.map((id) => {
        const current = id === station;
        // The open panel covers the room. Hide this place's seal until it closes.
        if (current && !menuClosed) return null;
        const stays =
          current && (id === 'Counter' || id === 'Shelf' || id === 'TeaTable');
        const anchor = STATIONS.find((place) => place.id === id)!;
        // The Observatorium halo opens the external planetary model once the camera arrives.
        const open = !current
          ? () => onNavigate(id)
          : id === 'Shelf'
            ? onShelfSelect
            : id === 'TeaTable'
              ? onObservatoriumOpen
              : onMenuOpen;
        return (
          <HaloMarker
            key={id}
            position={anchor.hotspot}
            active={current}
            reduced={reduced}
            onClick={open}
            detail={STATION_TEASERS[id]}
            stay={stays}
            stayNear={id === 'Shelf' || id === 'TeaTable' ? 4.2 : 0}
            openDelay={id === 'Counter' ? 1200 : 650}
            onHover={(on) => {
              setHovered((was) => (on ? id : was === id ? null : was));
              if (id === 'AvatarSeat') onHostHover?.(on);
            }}
          />
        );
      })}
      {rim && (
        <WarmOutline
          key={rim.name}
          name={rim.name}
          within={rim.within}
          reduced={reduced}
        />
      )}
    </>
  );
}
