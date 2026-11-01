import {
  Component,
  startTransition,
  Suspense,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  advance,
  Canvas,
  useStore,
  type Dpr,
  type Frameloop,
  type RootState,
} from '@react-three/fiber';
import { ContactShadows, useProgress } from '@react-three/drei';
import { WebGLRenderTarget } from 'three';
import { CameraRig } from './CameraRig';
import { StationHalos } from './StationHalos';
import { TeaRitual, LanternLight } from './TeaRitual';
import {
  MechanicalPlanetarySystem,
  OrreryLight,
} from './MechanicalPlanetarySystem';
import { TeaHost3D, type IrohActivity } from './TeaHost3D';
import { ShelfLanternLight, TeaShelf } from './TeaShelf';
import {
  ChamberDetail,
  TeaChamber,
  WaitingDetail,
  WaitingRoom,
} from './TeaArchitecture';
import { STATIONS } from './stations';
import { Surfaces } from './Surfaces';
import { DevShotCamera } from './DevShotCamera';
import { SceneLighting, Staged } from './SceneEffects';
import { ScenePolish } from './ScenePolish';
import { lightExperience } from './lightExperience';
import { ThesisCards } from './props/ThesisCards';
import type { SceneMood } from './motion/dynamics';
import type { Station } from '../shared/contracts';
import type { ThesisId } from '../thesis/types';
import { bookResting } from '../ui/waiting-room/bookMotion';

function RoomGeometry({
  mood,
  reduced,
  requestKey,
  irohActivity,
  onShelfSelect,
  shelfRevealed,
  station,
  menuClosed,
  onMenuOpen,
  onThesisPick,
  onNavigate,
  onObservatoriumOpen,
  onStaged,
  onDpr,
}: {
  mood: SceneMood;
  reduced: boolean;
  requestKey: string | null;
  irohActivity: IrohActivity;
  onShelfSelect: () => void;
  shelfRevealed: boolean;
  station: Station;
  menuClosed: boolean;
  onMenuOpen: () => void;
  onThesisPick?: (id: ThesisId) => void;
  onNavigate: (station: Station) => void;
  onObservatoriumOpen: () => void;
  onStaged?: () => void;
  onDpr: (dpr: number) => void;
}) {
  const [hostHalo, setHostHalo] = useState(false);
  const posters = station !== 'Entrance';
  // The shell's shelf callback changes on every station move. Read it through
  // a ref so the memo below (and its ContactShadows) survives the move.
  const shelfSelect = useRef(onShelfSelect);
  shelfSelect.current = onShelfSelect;
  const selectShelf = useCallback(() => shelfSelect.current(), []);
  // Deck state (mood, menuClosed) re-renders this component on every thesis
  // switch. Each drei ContactShadows then redraws the whole room, so the static
  // detail is memoized away from it.
  const detail = useMemo(
    () => (
      <>
        <WaitingDetail />
        <ChamberDetail reduced={reduced} />
        <ContactShadows
          position={[0, 0.016, -2.55]}
          opacity={0.3}
          scale={5.7}
          blur={2.4}
          far={1.6}
          resolution={256}
          frames={1}
          color="#25180f"
        />
        <MechanicalPlanetarySystem reduced={reduced} />
        <TeaShelf
          onSelect={selectShelf}
          revealed={shelfRevealed}
          reduced={reduced}
          posters={posters}
        />
      </>
    ),
    [reduced, selectShelf, shelfRevealed, posters],
  );
  const covered = station === 'Counter' && !menuClosed;
  const finish = useMemo(
    () => <ScenePolish covered={covered} onDpr={onDpr} />,
    [covered, onDpr],
  );
  return (
    <>
      <color attach="background" args={['#2f2119']} />
      <hemisphereLight args={['#c9c0b6', '#5a3b25', 0.3]} />
      <directionalLight
        position={[-5, 6, -4]}
        color="#ffb877"
        intensity={2.1}
        castShadow
        // About one texel of normal bias: more lifts contact shadows and props look afloat.
        shadow-bias={-0.0003}
        shadow-normalBias={0.011}
        shadow-mapSize={lightExperience() ? [1024, 1024] : [2048, 2048]}
        shadow-radius={3}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
      />
      <directionalLight
        position={[3, 3.8, 2.5]}
        color="#b8c2d6"
        intensity={0.32}
      />
      <pointLight
        position={[1.1, 1.75, -0.7]}
        color="#f5dcc0"
        intensity={1}
        distance={5.3}
      />
      <pointLight
        position={[0.55, 2.3, -4.75]}
        color="#ffc27a"
        intensity={2.4}
        distance={3.2}
      />
      <OrreryLight />
      <ShelfLanternLight />
      <SceneLighting reduced={reduced} />
      <WaitingRoom />
      {/* Later group: no lights, so the shell's programs stay valid when it arrives. */}
      <Staged reduced={reduced} precompile={compileRoom} onReady={onStaged}>
        {detail}
        <ThesisCards reduced={reduced} onPick={onThesisPick} />
        <StationHalos
          station={station}
          menuClosed={menuClosed}
          reduced={reduced}
          onNavigate={onNavigate}
          onMenuOpen={onMenuOpen}
          onShelfSelect={onShelfSelect}
          onHostHover={setHostHalo}
          onObservatoriumOpen={onObservatoriumOpen}
        />
        {finish}
      </Staged>
      <TeaChamber>
        <LanternLight mood={mood} reduced={reduced} />
        <TeaRitual mood={mood} reduced={reduced} requestKey={requestKey} />
        <TeaHost3D
          reduced={reduced}
          activity={irohActivity}
          lit={hostHalo}
          onActivate={() =>
            station === 'AvatarSeat' ? onMenuOpen() : onNavigate('AvatarSeat')
          }
        />
      </TeaChamber>
    </>
  );
}

/**
 * Builds every program in the room while the loader is up, so the first drag never
 * compiles a shader. Any offscreen target selects the variants the composer renders with.
 */
function compileRoom({ gl, scene, camera }: RootState) {
  const target = new WebGLRenderTarget(1, 1),
    previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  const done = gl.compileAsync(scene, camera);
  gl.setRenderTarget(previous);
  return done.finally(() => target.dispose());
}

/**
 * Builds whatever programs the room needs right now (a texture that arrived
 * late is a new variant) and says whether the driver has linked them all. It
 * only asks, never waits, so a frame drawn straight after a `true` cannot
 * block on a link.
 */
function linkedNow({ gl, scene, camera }: RootState) {
  const target = new WebGLRenderTarget(1, 1),
    previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  const materials = gl.compile(scene, camera);
  gl.setRenderTarget(previous);
  target.dispose();
  for (const material of materials) {
    if (!material) continue;
    const props = gl.properties.get(material) as
      | { currentProgram?: { isReady?: () => boolean } }
      | undefined;
    const ready = props?.currentProgram?.isReady;
    if (typeof ready === 'function' && !ready()) return false;
  }
  return true;
}

/**
 * Behind the waiting room nobody sees the room, but the page curl, petals and
 * pour share the page with it. Draw a few frames a second while the book rests
 * (textures upload, shadows settle, staging finishes) and none while a page
 * turns. Each frame waits until its programs are linked, so a late texture
 * never blocks on a shader link. The loop stays 'never' so nothing else (a
 * prop change, a loaded texture) can draw a frame in between.
 */
function HiddenFrames({ hidden }: { hidden: boolean }) {
  const store = useStore();
  useEffect(() => {
    if (!hidden) return;
    const hold = () => {
      const state = store.getState();
      if (state.frameloop === 'never') return;
      state.setFrameloop('never');
      // Switching the loop on (Staged does) already queued a frame; drop it.
      state.internal.frames = 0;
    };
    hold();
    const unsubscribe = store.subscribe(hold);
    // Check and draw in the same task, so nothing can add a variant between.
    const tick = window.setInterval(() => {
      const state = store.getState();
      if (bookResting() && linkedNow(state))
        // advance() takes seconds; r3f derives delta from it.
        advance(performance.now() / 1000, true, state);
    }, 250);
    return () => {
      unsubscribe();
      window.clearInterval(tick);
      // The enter button waits for staging, so no compile is left to protect.
      store.getState().setFrameloop('always');
    };
  }, [hidden, store]);
  return null;
}

/**
 * Staged and HiddenFrames switch the loop on the store, but the Canvas
 * re-applies its `frameloop` prop on every render. Reporting the store's loop
 * back into that prop keeps a re-render from restarting a paused loop.
 */
function FrameloopReport({
  onChange,
}: {
  onChange: (loop: Frameloop) => void;
}) {
  const store = useStore();
  useEffect(() => {
    onChange(store.getState().frameloop);
    return store.subscribe((state) => onChange(state.frameloop));
  }, [store, onChange]);
  return null;
}

/**
 * Mounts the room in a transition, so React slices its first render into
 * short tasks instead of one long one while the sketchbook is on screen.
 */
function InTransition({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => startTransition(() => setShown(true)), []);
  return shown ? children : null;
}

/**
 * Textures load through three's default manager, which useProgress observes.
 * Its own leaf: a store update renders synchronously, and in TeaRoom every
 * loaded texture re-rendered the whole scene.
 */
function LoadProgress({
  onLoadProgress,
}: {
  onLoadProgress?: (active: boolean, progress: number) => void;
}) {
  const { active, progress } = useProgress();
  useEffect(() => {
    onLoadProgress?.(active, progress);
  }, [active, progress, onLoadProgress]);
  return null;
}

class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onUnavailable: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onUnavailable();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function TeaRoom({
  station,
  reduced,
  mood,
  requestKey,
  irohActivity,
  onArrive,
  onAvailabilityChange,
  onLoadProgress,
  onShelfSelect,
  shelfFocused,
  shelfRevealed,
  menuClosed,
  onMenuOpen,
  onThesisPick,
  onNavigate,
  onObservatoriumOpen,
  observatoriumZoomKey,
  onObservatoriumZoomEnd,
  onStaged,
}: {
  station: Station;
  reduced: boolean;
  mood: SceneMood;
  requestKey: string | null;
  irohActivity: IrohActivity;
  onArrive: (station: Station) => void;
  onAvailabilityChange: (available: boolean) => void;
  onLoadProgress?: (active: boolean, progress: number) => void;
  onShelfSelect: () => void;
  shelfFocused: boolean;
  shelfRevealed: boolean;
  menuClosed: boolean;
  onMenuOpen: () => void;
  onThesisPick?: (id: ThesisId) => void;
  onNavigate: (station: Station) => void;
  onObservatoriumOpen: () => void;
  observatoriumZoomKey: number;
  onObservatoriumZoomEnd: () => void;
  onStaged?: () => void;
}) {
  const [lost, setLost] = useState(false);
  const light = lightExperience();
  // The Canvas re-applies its dpr prop on every render, so the quality
  // ladder's choice has to live here rather than in the store.
  const [dpr, setDpr] = useState<Dpr>(light ? [1, 1] : [1, 1.25]);
  const [loop, setLoop] = useState<Frameloop>('always');
  const counterPosition = STATIONS.find(
    (place) => place.id === 'Counter',
  )!.position;
  const fallback = (
    <div className="scene-fallback">
      <span className="fallback-cup">♧</span>
      <p>The room is resting.</p>
      <small>The full ritual is available through the station controls.</small>
    </div>
  );
  if (lost) return fallback;
  return (
    <>
      <LoadProgress onLoadProgress={onLoadProgress} />
      <SceneBoundary
        fallback={fallback}
        onUnavailable={() => onAvailabilityChange(false)}
      >
        <Canvas
          shadows="percentage"
          dpr={dpr}
          frameloop={loop}
          camera={{
            position: light ? [0.05, 1.66, 7.82] : counterPosition,
            fov: 58,
            near: 0.08,
            far: 45,
          }}
          gl={{ antialias: true, toneMappingExposure: 1.0 }}
          fallback={fallback}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener(
              'webglcontextlost',
              (event) => {
                event.preventDefault();
                setLost(true);
                onAvailabilityChange(false);
              },
              { once: true },
            );
            onAvailabilityChange(true);
          }}
        >
          <Suspense fallback={null}>
            <Surfaces>
              <InTransition>
                <RoomGeometry
                  mood={mood}
                  reduced={reduced}
                  requestKey={requestKey}
                  irohActivity={irohActivity}
                  onShelfSelect={onShelfSelect}
                  shelfRevealed={shelfRevealed}
                  station={station}
                  menuClosed={menuClosed}
                  onMenuOpen={onMenuOpen}
                  onThesisPick={onThesisPick}
                  onNavigate={onNavigate}
                  onObservatoriumOpen={onObservatoriumOpen}
                  onStaged={onStaged}
                  onDpr={setDpr}
                />
              </InTransition>
            </Surfaces>
          </Suspense>
          <CameraRig
            station={station}
            shelfFocused={shelfFocused}
            reduced={reduced}
            observatoriumZoomKey={observatoriumZoomKey}
            onArrive={onArrive}
            onObservatoriumZoomEnd={onObservatoriumZoomEnd}
          />
          <DevShotCamera />
          <FrameloopReport onChange={setLoop} />
          <HiddenFrames hidden={station === 'Entrance'} />
        </Canvas>
      </SceneBoundary>
    </>
  );
}
