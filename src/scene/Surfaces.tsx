import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  use,
  type ReactNode,
} from 'react';
import {
  CanvasTexture,
  Color,
  DataTexture,
  Matrix4,
  type InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Vector2,
  type ColorSpace,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Point } from './stations';
import { createRandom } from './motion/dynamics';
import { SURFACES, type Surface, type Texels } from './surfaceTexels';
import { paintSurfaces } from './paintSurfaces';
export type { Surface };

/** Metres covered by one texture tile on a Solid: [along the grain, across it]. */
const TILE: Record<Surface, [number, number]> = {
  wood: [1.6, 0.4],
  floor: [3.2, 0.96],
  plaster: [2, 2],
  paper: [0.7, 0.7],
  shoji: [0.7, 0.7],
  cloth: [0.35, 0.35],
  tatami: [0.45, 0.45],
};

export function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
/**
 * Builds on first call and keeps the result for the page's lifetime, so remounts, Strict
 * Mode and Suspense retries reuse procedural textures instead of repainting them.
 */
export function once<T>(make: () => T) {
  let value: T | undefined;
  return () => (value ??= make());
}

type Draw = (ctx: CanvasRenderingContext2D) => void;
const painted = new Map<Draw, CanvasTexture>();
/** One shared, never-disposed texture per module-level `draw`. */
export function useCanvasTexture(width: number, height: number, draw: Draw) {
  let texture = painted.get(draw);
  if (!texture)
    painted.set(draw, (texture = canvasTexture(width, height, draw)));
  return texture;
}

function dataTexture(
  data: Uint8Array,
  width: number,
  height: number,
  colorSpace: ColorSpace,
) {
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function surfaceMaps({ width, height, color, normal, rough }: Texels) {
  return {
    color: dataTexture(color, width, height, SRGBColorSpace),
    normal: dataTexture(normal, width, height, NoColorSpace),
    rough: dataTexture(rough, width, height, NoColorSpace),
  };
}
type Maps = ReturnType<typeof surfaceMaps>;
const SurfaceContext = createContext<Record<Surface, Maps> | null>(null);
const allSurfaceMaps = once(async () => {
  const texels = await paintSurfaces();
  return Object.fromEntries(
    SURFACES.map((kind, i) => [kind, surfaceMaps(texels[i])]),
  ) as Record<Surface, Maps>;
});
export function Surfaces({ children }: { children: ReactNode }) {
  const textures = use(allSurfaceMaps());
  return (
    <SurfaceContext.Provider value={textures}>
      {children}
    </SurfaceContext.Provider>
  );
}
export function useSurfaceMaps(surface: Surface) {
  return useContext(SurfaceContext)![surface];
}
const NORMAL_SCALE = new Vector2(1, 1);
export function SurfaceMaterial({
  surface = 'wood',
  color,
  clearcoat,
  glow = 0.55,
}: {
  surface?: Surface;
  color: string;
  clearcoat?: number;
  glow?: number;
}) {
  const maps = useSurfaceMaps(surface);
  const props = {
    color,
    map: maps.color,
    normalMap: maps.normal,
    normalScale: NORMAL_SCALE,
    roughnessMap: maps.rough,
    roughness: 1,
    ...(surface === 'shoji' && {
      emissive: '#ffbf78',
      emissiveMap: maps.color,
      emissiveIntensity: glow,
    }),
  };
  return clearcoat ? (
    <meshPhysicalMaterial
      {...props}
      clearcoat={clearcoat}
      clearcoatRoughness={0.24}
    />
  ) : (
    <meshStandardMaterial {...props} />
  );
}

/** Many static boxes in one draw call; `jitter` varies each box's tone. */
export function Boxes({
  items,
  color,
  surface = 'wood',
  jitter = 0,
  cast = true,
  seed = 1,
}: {
  items: [position: Point, size: Point][];
  color: string;
  surface?: Surface;
  jitter?: number;
  cast?: boolean;
  seed?: number;
}) {
  const maps = useSurfaceMaps(surface);
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current!,
      random = createRandom(seed),
      matrix = new Matrix4(),
      tint = new Color();
    items.forEach(([[x, y, z], [sx, sy, sz]], i) => {
      mesh.setMatrixAt(i, matrix.makeScale(sx, sy, sz).setPosition(x, y, z));
      if (jitter)
        mesh.setColorAt(i, tint.setScalar(1 - jitter / 2 + random() * jitter));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, jitter, seed]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, items.length]}
      castShadow={cast}
      receiveShadow
    >
      <boxGeometry />
      <meshStandardMaterial
        color={color}
        map={maps.color}
        normalMap={maps.normal}
        roughnessMap={maps.rough}
        roughness={1}
      />
    </instancedMesh>
  );
}

/** Box-projected UVs in metres, with the grain along `longest` when a face contains it. */
function worldUvs(
  geometry: RoundedBoxGeometry,
  size: Point,
  surface: Surface,
  seed: number,
  longest: number,
) {
  const position = geometry.attributes.position,
    normal = geometry.attributes.normal,
    uv = geometry.attributes.uv,
    [along, across] = TILE[surface],
    offsetU = (seed * 7.31) % 1,
    offsetV = (seed * 3.17) % 1;
  for (let i = 0; i < position.count; i++) {
    const n = [
      Math.abs(normal.getX(i)),
      Math.abs(normal.getY(i)),
      Math.abs(normal.getZ(i)),
    ];
    const face = n[0] > n[1] && n[0] > n[2] ? 0 : n[1] > n[2] ? 1 : 2;
    const [a, b] = face === 0 ? [2, 1] : face === 1 ? [0, 2] : [0, 1];
    const grain =
      a === longest || b === longest ? longest : size[a] >= size[b] ? a : b;
    const cross = grain === a ? b : a;
    uv.setXY(
      i,
      position.getComponent(i, grain) / along + offsetU,
      position.getComponent(i, cross) / across + offsetV,
    );
  }
  uv.needsUpdate = true;
}
export function Solid({
  position,
  size,
  color,
  surface = 'wood',
  clearcoat,
  cast = true,
  grain,
}: {
  position: Point;
  size: Point;
  color: string;
  surface?: Surface;
  clearcoat?: number;
  cast?: boolean;
  /** Axis the grain runs along; defaults to the longest side. */
  grain?: 0 | 1 | 2;
}) {
  const [x, y, z] = size;
  const [px, py, pz] = position;
  const geometry = useMemo(() => {
    const box = new RoundedBoxGeometry(
      x,
      y,
      z,
      2,
      Math.min(0.014, x * 0.12, y * 0.12, z * 0.12),
    );
    const seed = Math.abs(
      Math.sin(px * 12.9898 + py * 78.233 + pz * 37.719) * 43758.5453,
    );
    const longest = grain ?? [x, y, z].indexOf(Math.max(x, y, z));
    worldUvs(box, [x, y, z], surface, seed, longest);
    return box;
  }, [x, y, z, px, py, pz, surface, grain]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      position={position}
      receiveShadow
      castShadow={cast}
    >
      <SurfaceMaterial surface={surface} color={color} clearcoat={clearcoat} />
    </mesh>
  );
}
