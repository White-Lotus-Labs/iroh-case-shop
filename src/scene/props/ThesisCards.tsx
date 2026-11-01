import { useEffect, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  ExtrudeGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Shape,
  TextureLoader,
  type Group,
  type Texture,
} from 'three';
import { THESES } from '../../thesis/deck';
import type { Thesis, ThesisId } from '../../thesis/types';
import { canvasTexture } from '../Surfaces';
import { LOOK } from '../stations';
import { useBuilt } from './craft';
import { lightExperience } from '../lightExperience';

// Must match TOP_Y in Counter.tsx: the cards rest on that slab.
const TOP_Y = 1.33;
const W = 0.105,
  L = 0.14,
  T = 0.0012;
// Each card's far edge rests on the tray's front rim (Counter.tsx trayAt).
const RIM = { z: 6.346, y: 0.03 };
const LEAN = Math.asin(RIM.y / L);
const REST_Z = RIM.z + (L / 2) * Math.cos(LEAN);
const REST_Y = TOP_Y + RIM.y / 2;
// [x, yaw] beside the cups; the tops splay like a loose hand.
const FAN: [number, number][] = [
  [-1.478, 0.14],
  [-1.36, 0],
  [-1.242, -0.14],
];
const LIFT = 0.05,
  TILT = 0.5,
  STIFFNESS = 210,
  DAMPING = 17;

function cardGeometry() {
  const w = W / 2,
    l = L / 2,
    r = 0.008,
    shape = new Shape();
  shape.moveTo(-w + r, -l);
  shape.lineTo(w - r, -l);
  shape.quadraticCurveTo(w, -l, w, -l + r);
  shape.lineTo(w, l - r);
  shape.quadraticCurveTo(w, l, w - r, l);
  shape.lineTo(-w + r, l);
  shape.quadraticCurveTo(-w, l, -w, l - r);
  shape.lineTo(-w, -l + r);
  shape.quadraticCurveTo(-w, -l, -w + r, -l);
  const geometry = new ExtrudeGeometry(shape, {
    depth: T,
    bevelEnabled: false,
    curveSegments: 4,
  });
  const uv = geometry.attributes.uv,
    position = geometry.attributes.position;
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, (position.getX(i) + w) / W, (position.getY(i) + l) / L);
  // Lie flat, face up, with the top of the cover away from the room.
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function drawBlob(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(20,10,4,0.8)');
  gradient.addColorStop(0.55, 'rgba(20,10,4,0.35)');
  gradient.addColorStop(1, 'rgba(20,10,4,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
}

/** The 600w cover when it exists, otherwise the full thesis image. */
function useCover(image: string) {
  const [cover, setCover] = useState<Texture | null>(null);
  useEffect(() => {
    let live = true,
      loaded: Texture | null = null;
    const loader = new TextureLoader();
    const done = (texture: Texture) => {
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 8;
      if (!live) return texture.dispose();
      loaded = texture;
      setCover(texture);
    };
    const width = lightExperience() ? '-360w.webp' : '-600w.webp';
    loader.load(image.replace(/\.webp$/, width), done, undefined, () =>
      loader.load(image, done),
    );
    return () => {
      live = false;
      loaded?.dispose();
    };
  }, [image]);
  return cover;
}

function ThesisCard({
  thesis,
  index,
  shared,
  reduced,
  onPick,
}: {
  thesis: Thesis;
  index: number;
  shared: ReturnType<typeof buildShared>;
  reduced: boolean;
  onPick?: (id: ThesisId) => void;
}) {
  const cover = useCover(thesis.image);
  const card = useRef<Group>(null);
  const hovered = useRef(false);
  const posed = useRef(false);
  const spring = useRef({ at: 0, velocity: 0 });
  const [face] = useState(
    () => new MeshStandardMaterial({ color: '#e6d8bb', roughness: 0.78 }),
  );
  const [rim] = useState(
    () =>
      new MeshBasicMaterial({
        color: '#e9c983',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
  );
  const [blob] = useState(
    () =>
      new MeshBasicMaterial({
        map: shared.blobMap,
        transparent: true,
        // The rest value: Staged snapshots it before the first frame and restores it.
        opacity: 0.55,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
  );
  useEffect(() => {
    face.map = cover;
    // The lantern hangs right above the tray; a warm tint keeps the paper from blowing out.
    face.color.set(cover ? '#cfc2a8' : '#e6d8bb');
    face.needsUpdate = true;
  }, [face, cover]);
  useEffect(
    () => () => {
      face.dispose();
      blob.dispose();
      rim.dispose();
    },
    [face, blob, rim],
  );
  useFrame((_, delta) => {
    const s = spring.current;
    const target = hovered.current ? 1 : 0;
    const idle = Math.abs(target - s.at) < 0.001 && Math.abs(s.velocity) < 0.02;
    // A resting card is already where the JSX posed it. Don't write every frame.
    if (idle && posed.current) return;
    if (reduced || idle) {
      s.at = target;
      s.velocity = 0;
    } else {
      const dt = Math.min(delta, 1 / 30);
      s.velocity += (STIFFNESS * (target - s.at) - DAMPING * s.velocity) * dt;
      s.at += s.velocity * dt;
      if (Math.abs(target - s.at) < 0.001 && Math.abs(s.velocity) < 0.02) {
        s.at = target;
        s.velocity = 0;
      }
    }
    const group = card.current;
    if (!group) return;
    group.position.y = REST_Y + index * 0.0015 + s.at * LIFT;
    group.rotation.x = LEAN + s.at * TILT;
    blob.opacity = 0.55 - Math.min(1, Math.max(0, s.at)) * 0.3;
    rim.opacity = onPick ? s.at : 0;
    posed.current = s.velocity === 0 && s.at === target;
  });
  const [x, yaw] = FAN[index];
  const handlers = onPick
    ? {
        onPointerOver: (event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          hovered.current = true;
          document.body.style.cursor = 'pointer';
        },
        onPointerOut: () => {
          hovered.current = false;
          document.body.style.cursor = '';
        },
        onClick: (event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          // A camera orbit that ends on a card is not a pick.
          if (event.delta > LOOK.dragPx) return;
          onPick(thesis.id);
        },
      }
    : {};
  return (
    <group name={`thesis-card-${thesis.id}`}>
      <mesh
        geometry={shared.blob}
        material={blob}
        position={[x, TOP_Y + 0.0008, REST_Z]}
        rotation={[0, yaw, 0]}
        renderOrder={1}
      />
      <group
        ref={card}
        position={[x, REST_Y, REST_Z]}
        rotation={[LEAN, yaw, 0, 'YXZ']}
      >
        <mesh
          geometry={shared.rim}
          material={rim}
          position={[0, -0.0016, 0]}
          renderOrder={0}
        />
        <mesh
          geometry={shared.card}
          material={[face, shared.edge]}
          castShadow
          renderOrder={1}
          {...handlers}
        />
      </group>
    </group>
  );
}

function buildShared() {
  const card = cardGeometry(),
    rim = card.clone().scale(1.08, 1, 1.08),
    blob = new PlaneGeometry(W * 1.4, L * 1.3).rotateX(-Math.PI / 2),
    blobMap = canvasTexture(64, 64, drawBlob),
    edge = new MeshStandardMaterial({ color: '#e6d8bb', roughness: 0.8 });
  return {
    card,
    rim,
    blob,
    blobMap,
    edge,
    dispose() {
      [card, rim, blob, blobMap, edge].forEach((item) => item.dispose());
    },
  };
}

/** Three thesis cards fanned on the counter beside the teacups. */
export function ThesisCards({
  reduced,
  onPick,
}: {
  reduced: boolean;
  onPick?: (id: ThesisId) => void;
}) {
  const shared = useBuilt(buildShared);
  return (
    <group name="thesis-cards">
      {THESES.map((thesis, index) => (
        <ThesisCard
          key={thesis.id}
          thesis={thesis}
          index={index}
          shared={shared}
          reduced={reduced}
          onPick={onPick}
        />
      ))}
    </group>
  );
}
