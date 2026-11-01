import { Component, Suspense, type ReactNode } from 'react';
import { IrohModel } from './IrohModel';
import type { IrohActivity } from './irohMotion';

export type { IrohActivity };

type Point = [number, number, number];

export const IROH_DEFAULT_POSITION: Point = [0, 0, -3.62];
const IROH_DEFAULT_ROTATION: Point = [0, 0, 0];

/** A model that fails to load leaves the cushion empty instead of taking the room down. */
class HostBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Uncle Iroh on his cushion. He loads with the room behind the waiting room
 * and shows once his shaders are compiled; until then the cushion stays empty.
 */
export function TeaHost3D({
  reduced,
  activity = 'idle',
  position = IROH_DEFAULT_POSITION,
  rotation = IROH_DEFAULT_ROTATION,
  lit = false,
  onActivate,
}: {
  reduced: boolean;
  activity?: IrohActivity;
  position?: Point;
  rotation?: Point;
  lit?: boolean;
  onActivate?: () => void;
}) {
  return (
    <group position={position} rotation={rotation} name="tea-host-3d">
      {/* Floor cushion grounding Uncle Iroh to the tatami mat */}
      <mesh
        position={[0, 0.045, 0.02]}
        scale={[0.78, 0.065, 0.52]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[1, 1, 1, 32]} />
        <meshStandardMaterial color="#414a30" roughness={0.94} />
      </mesh>
      <mesh
        position={[0, 0.085, 0.02]}
        scale={[0.72, 0.045, 0.46]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[1, 1, 1, 32]} />
        <meshStandardMaterial color="#555a3c" roughness={0.92} />
      </mesh>
      <HostBoundary>
        <Suspense fallback={null}>
          <IrohModel
            reduced={reduced}
            activity={activity}
            lit={lit}
            onActivate={onActivate}
          />
        </Suspense>
      </HostBoundary>
    </group>
  );
}
