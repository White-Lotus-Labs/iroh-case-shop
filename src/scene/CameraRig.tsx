import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import {
  MathUtils,
  Raycaster,
  Vector2,
  Vector3,
  type Intersection,
  type Mesh,
  type Object3D,
} from 'three';
import type { Station } from '../shared/contracts';
import {
  keepInRoom,
  LOOK,
  OBSERVATORIUM_FOCUS,
  RECENTER_EVENT,
  roomOf,
  SHELF_APPROACH,
  SHELF_FOCUS,
  STATIONS,
} from './stations';
import { CameraTravel, damp } from './motion/dynamics';

type Orbit = { azimuth: number; polar: number; distance: number };
const orbitOf = (offset: Vector3): Orbit => ({
  azimuth: Math.atan2(offset.x, offset.z),
  polar: Math.acos(offset.y / offset.length()),
  distance: offset.length(),
});
/** Open free look around a pose, and clear residual damping so a drag cannot kick the new frame. */
function lookAround(c: OrbitImpl, a: Orbit, reduced: boolean) {
  c.minAzimuthAngle = a.azimuth - LOOK.azimuth;
  c.maxAzimuthAngle = a.azimuth + LOOK.azimuth;
  c.minPolarAngle = Math.max(0.05, a.polar - LOOK.polar);
  c.maxPolarAngle = Math.min(Math.PI - 0.05, a.polar + LOOK.polar);
  c.minDistance = a.distance * LOOK.zoomIn;
  c.maxDistance = a.distance * LOOK.zoomOut;
  c.enableDamping = false;
  c.update();
  c.enableDamping = !reduced;
}
function isSolid(object: Object3D) {
  if (!(object as Mesh).isMesh) return false;
  for (let o: Object3D | null = object; o; o = o.parent)
    if (!o.visible) return false;
  const m = (object as Mesh).material,
    material = Array.isArray(m) ? m[0] : m;
  return material.visible && !(material.transparent && material.opacity < 0.05);
}
/** The walkable point under a double-click: the first solid surface, facing up, at floor level. */
function floorPoint(hits: Intersection[]) {
  const hit = hits.find(
    ({ object }) => object.userData.halo || isSolid(object),
  );
  if (!hit?.face || hit.object.userData.halo || hit.point.y > 0.2) return null;
  const up = hit.face.normal
    .clone()
    .transformDirection(hit.object.matrixWorld).y;
  return up > 0.7 ? hit.point : null;
}

export function CameraRig({
  station,
  reduced,
  shelfFocused = false,
  observatoriumZoomKey = 0,
  onArrive,
  onObservatoriumZoomEnd,
}: {
  station: Station;
  reduced: boolean;
  shelfFocused?: boolean;
  /** Changes when the live planetary model should open after a close camera push-in. */
  observatoriumZoomKey?: number;
  onArrive?: (station: Station) => void;
  onObservatoriumZoomEnd?: () => void;
}) {
  const { camera, size, gl, scene, events } = useThree();
  const controls = useRef<OrbitImpl>(null);
  const travel = useRef<CameraTravel | null>(null);
  const idle = useRef({
    time: 0,
    gain: 0,
    dragging: false,
    position: new Vector3(),
    target: new Vector3(),
  });
  const angles = useRef<Orbit>({ azimuth: 0, polar: Math.PI / 2, distance: 3 });
  // OrbitControls zooms in undamped steps; the rig eases the radius toward their running goal.
  const zoom = useRef({ goal: 3, last: 3 });
  const [recenter, setRecenter] = useState(0);
  const priorStation = useRef<Station | null>(null);
  const priorShelfFocused = useRef(false);
  const shelfApproachLeg = useRef(false);
  const latestObservatoriumZoomKey = useRef(observatoriumZoomKey);
  const zoomingObservatorium = useRef(false);
  useEffect(() => {
    const again = () => setRecenter((n) => n + 1);
    window.addEventListener(RECENTER_EVENT, again);
    return () => window.removeEventListener(RECENTER_EVENT, again);
  }, []);
  // Dev-only probe for browser specs: the live pose, and a world point in page pixels.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const probe = window as { __teaCamera?: unknown };
    probe.__teaCamera = {
      pose: () => ({
        position: camera.position.toArray(),
        target: controls.current?.target.toArray(),
        moving: travel.current?.active ?? false,
      }),
      project: (point: [number, number, number]) => {
        const rect = gl.domElement.getBoundingClientRect(),
          v = new Vector3(...point).project(camera);
        return [
          rect.left + ((v.x + 1) / 2) * rect.width,
          rect.top + ((1 - v.y) / 2) * rect.height,
          v.z,
        ];
      },
    };
    return () => {
      delete probe.__teaCamera;
    };
  }, [camera, gl]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    // Opening a portrait from the settled Shelf view should reveal its panel
    // in place, without replacing the view the guest just chose.
    const openingAtShelf =
      station === 'Shelf' &&
      shelfFocused &&
      !priorShelfFocused.current &&
      priorStation.current === 'Shelf' &&
      !travel.current?.active;
    if (openingAtShelf) {
      priorShelfFocused.current = true;
      return;
    }
    const anchor = STATIONS.find((s) => s.id === station)!;
    const pose = station === 'Shelf' && shelfFocused ? SHELF_FOCUS : anchor;
    const approachingShelf =
      station === 'Shelf' && shelfFocused && !priorShelfFocused.current;
    const travelPose = approachingShelf ? SHELF_APPROACH : pose;
    const mobile = size.width < 760;
    const position =
      mobile && station === 'Counter'
        ? ([-1.4, 1.6, 7.4] as const)
        : mobile && station === 'Entrance'
          ? ([0.55, 1.67, 9.38] as const)
          : mobile && station === 'TeaTable'
            ? ([-0.9, 1.48, -0.9] as const)
            : travelPose.position;
    const look =
      mobile && station === 'Counter'
        ? ([-1.11, 1.17, 2.43] as const)
        : mobile && station === 'Entrance'
          ? ([-3.14, 1.44, 6.4] as const)
          : mobile && station === 'AvatarSeat'
            ? ([0.0, 0.72, -3.55] as const)
            : mobile && station === 'TeaTable'
              ? ([-3.28, 0.85, -3.15] as const)
              : travelPose.target;
    const to = new Vector3(...position),
      target = new Vector3(...look),
      offset = approachingShelf
        ? new Vector3(...pose.position).sub(new Vector3(...pose.target))
        : to.clone().sub(target);
    angles.current = orbitOf(offset);
    if (!travel.current)
      travel.current = new CameraTravel(camera.position, c.target);
    const previous = priorStation.current;
    const firstFrame = previous === null;
    // Capture the actual visible frame, including any local orbit, before retargeting.
    travel.current.position.copy(camera.position);
    travel.current.target.copy(c.target);
    const crossingRooms =
      previous !== null &&
      (previous === 'Entrance' || previous === 'Counter') !==
        (station === 'Entrance' || station === 'Counter');
    travel.current.retarget(to, target, crossingRooms ? 3.1 : undefined);
    // The first look after the waiting room is the Counter pose, with no fly-in.
    const snap =
      firstFrame || (previous === 'Entrance' && station === 'Counter');
    if (snap) travel.current.finish();
    priorStation.current = station;
    priorShelfFocused.current = station === 'Shelf' && shelfFocused;
    shelfApproachLeg.current = approachingShelf;
    c.enabled = false;
    idle.current.gain = 0;
    c.enableDamping = false;
    c.update();
    camera.position.copy(travel.current.position);
    c.target.copy(travel.current.target);
    if (snap) {
      lookAround(c, angles.current, reduced);
      zoom.current = {
        goal: angles.current.distance,
        last: angles.current.distance,
      };
      c.enabled = true;
      camera.lookAt(c.target);
      onArrive?.(station);
    }
  }, [station, shelfFocused, recenter, camera, size.width, onArrive]);
  useEffect(() => {
    if (observatoriumZoomKey === latestObservatoriumZoomKey.current) return;
    latestObservatoriumZoomKey.current = observatoriumZoomKey;
    if (station !== 'TeaTable') return;
    const c = controls.current;
    if (!c) return;
    if (!travel.current)
      travel.current = new CameraTravel(camera.position, c.target);
    const position = new Vector3(...OBSERVATORIUM_FOCUS.position);
    const target = new Vector3(...OBSERVATORIUM_FOCUS.target);
    angles.current = orbitOf(position.clone().sub(target));
    travel.current.position.copy(camera.position);
    travel.current.target.copy(c.target);
    travel.current.retarget(position, target, 2.2);
    zoomingObservatorium.current = true;
    c.enabled = false;
    c.enableDamping = false;
  }, [observatoriumZoomKey, station, camera, onObservatoriumZoomEnd]);
  useEffect(() => {
    const canvas = gl.domElement,
      stage: HTMLElement = events.connected ?? canvas,
      down = new Vector2(),
      ndc = new Vector2(),
      ray = new Raycaster();
    // Capture listeners on the stage run before OrbitControls and R3F, which listen there too.
    const onDown = (event: PointerEvent) => {
      down.set(event.clientX, event.clientY);
      if (controls.current)
        controls.current.enableZoom = event.target === canvas;
    };
    // A drag is not a click, for any prop in the room.
    const onClick = (event: MouseEvent) => {
      if (
        event.target === canvas &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > LOOK.dragPx
      )
        event.stopPropagation();
    };
    // An HTML panel over the canvas keeps its wheel: OrbitControls then skips preventDefault.
    const onWheel = (event: WheelEvent) => {
      if (controls.current)
        controls.current.enableZoom = event.target === canvas;
    };
    const onDoubleClick = (event: MouseEvent) => {
      const c = controls.current,
        t = travel.current;
      if (!c?.enabled || !t) return;
      const rect = canvas.getBoundingClientRect();
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        ((rect.top - event.clientY) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      const floor = floorPoint(ray.intersectObject(scene, true));
      if (!floor) return;
      event.preventDefault();
      // Walk: keep the heading, eye height and pose distance; stand on the chosen boards.
      const to = keepInRoom(
        new Vector3(
          floor.x,
          MathUtils.clamp(camera.position.y, 1.3, 1.75),
          floor.z,
        ),
        roomOf(station),
      );
      const target = c.target
        .clone()
        .sub(camera.position)
        .setLength(angles.current.distance)
        .add(to);
      angles.current = orbitOf(to.clone().sub(target));
      t.position.copy(camera.position);
      t.target.copy(c.target);
      t.retarget(to, target);
      c.enabled = false;
    };
    stage.addEventListener('pointerdown', onDown, true);
    stage.addEventListener('click', onClick, true);
    stage.addEventListener('wheel', onWheel, { capture: true, passive: true });
    canvas.addEventListener('dblclick', onDoubleClick);
    return () => {
      stage.removeEventListener('pointerdown', onDown, true);
      stage.removeEventListener('click', onClick, true);
      stage.removeEventListener('wheel', onWheel, { capture: true });
      canvas.removeEventListener('dblclick', onDoubleClick);
    };
  }, [gl, events.connected, scene, camera, station]);
  // drei updates orbit at priority -1. Remove last frame's decorative offsets first,
  // then apply this frame's offsets after orbit, so drift never accumulates.
  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    camera.position.sub(idle.current.position);
    c.target.sub(idle.current.target);
    idle.current.position.set(0, 0, 0);
    idle.current.target.set(0, 0, 0);
  }, -2);
  useFrame((_, delta) => {
    const c = controls.current,
      t = travel.current;
    if (!c || !t) return;
    const dt = Math.min(delta, 0.2),
      a = angles.current,
      i = idle.current,
      z = zoom.current;
    if (t.active) {
      // An explicit Observatorium action is intentional motion, so it still
      // shows its short push-in even when the rest of the room is reduced.
      if (reduced && !zoomingObservatorium.current) t.finish();
      else t.step(delta);
      camera.position.copy(t.position);
      c.target.copy(t.target);
      if (!t.active) {
        if (zoomingObservatorium.current) {
          zoomingObservatorium.current = false;
          lookAround(c, a, reduced);
          z.goal = z.last = a.distance;
          c.enabled = true;
          onObservatoriumZoomEnd?.();
          camera.lookAt(c.target);
          return;
        }
        if (shelfApproachLeg.current) {
          shelfApproachLeg.current = false;
          t.retarget(
            new Vector3(...SHELF_FOCUS.position),
            new Vector3(...SHELF_FOCUS.target),
            0.82,
          );
          camera.lookAt(c.target);
          return;
        }
        lookAround(c, a, reduced);
        z.goal = z.last = a.distance;
        onArrive?.(station);
      }
    } else {
      // Ease each wheel or pinch step, then keep the lens out of walls and large props.
      const r = camera.position.distanceTo(c.target);
      if (Math.abs(r - z.last) > 1e-4 && z.last >= c.minDistance - 1e-4)
        z.goal = MathUtils.clamp(
          (z.goal * r) / z.last,
          c.minDistance,
          c.maxDistance,
        );
      const next = reduced ? z.goal : damp(z.last, z.goal, 9, dt);
      camera.position.sub(c.target).setLength(next).add(c.target);
      keepInRoom(camera.position, roomOf(station));
      z.last = camera.position.distanceTo(c.target);
      if (!reduced) {
        i.time += dt;
        i.gain = damp(i.gain, i.dragging ? 0 : 1, 3, dt);
        const g = i.gain;
        // Kept under a pixel on the near counter edge. A larger sway
        // slides the table edges and the shadow lines.
        i.position.set(
          Math.sin(i.time * 0.43) * 0.00015 * g,
          Math.sin(i.time * 0.91) * 0.00022 * g,
          0,
        );
        i.target.set(
          Math.sin(i.time * 0.37 + 1) * 0.0001 * g,
          Math.sin(i.time * 0.67) * 0.0001 * g,
          0,
        );
        camera.position.add(i.position);
        c.target.add(i.target);
      }
    }
    c.enabled = !t.active;
    camera.lookAt(c.target);
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping={!reduced}
      dampingFactor={0.14}
      rotateSpeed={0.3}
      onStart={() => {
        idle.current.dragging = true;
      }}
      onEnd={() => {
        idle.current.dragging = false;
      }}
    />
  );
}
