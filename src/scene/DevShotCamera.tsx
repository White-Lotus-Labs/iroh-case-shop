import { useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import type { Station } from '../shared/contracts';
import { STATIONS, type Point } from './stations';

type Shot = { position: Point; target: Point; fov?: number };

function stationShot(id: Station): Shot {
  const { position, target } = STATIONS.find((place) => place.id === id)!;
  return { position, target };
}

/** Fixed art-review poses, keyed by `?shot=<name>`. Station shots match the product frame. */
const SHOTS: Record<string, Shot> = {
  'room-wide': {
    position: [-0.35, 2.05, 2.95],
    target: [0.25, 1.0, -3.4],
    fov: 64,
  },
  entrance: stationShot('Entrance'),
  counter: stationShot('Counter'),
  'tea-table': stationShot('TeaTable'),
  'host-full': stationShot('AvatarSeat'),
  'host-face': {
    position: [0.08, 1.63, -2.45],
    target: [0, 1.6, -3.5],
    fov: 30,
  },
  'host-hands': {
    position: [0.1, 1.25, -2.05],
    target: [-0.15, 0.68, -3.2],
    fov: 42,
  },
  'tea-set': { position: [0.85, 1.2, -1.2], target: [0, 0.78, -2.4], fov: 40 },
  observatorium: {
    position: [-1.98, 1.42, -1.55],
    target: [-3.28, 0.92, -3.15],
    fov: 46,
  },
  shelf: stationShot('Shelf'),
  'counter-shelves': {
    position: [-2.55, 1.65, 4.45],
    target: [-3.85, 1.55, 4.45],
    fov: 60,
  },
  brazier: {
    position: [0.55, 1.15, -0.35],
    target: [2.0, 0.25, -2.0],
    fov: 50,
  },
};

function ShotPose({ shot }: { shot: Shot }) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const controls = useThree((state) => state.controls) as {
    enabled: boolean;
  } | null;
  useEffect(() => {
    const fov = camera.fov;
    camera.fov = shot.fov ?? 58;
    camera.updateProjectionMatrix();
    return () => {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    };
  }, [camera, shot]);
  // Mounted after CameraRig, so this runs after its priority-0 frame and wins.
  useFrame(() => {
    if (controls) controls.enabled = false;
    camera.position.set(...shot.position);
    camera.lookAt(...shot.target);
  });
  return null;
}

export function DevShotCamera() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production')
      setName(new URLSearchParams(window.location.search).get('shot'));
  }, []);
  const shot = name ? SHOTS[name] : undefined;
  return shot ? <ShotPose key={name} shot={shot} /> : null;
}
