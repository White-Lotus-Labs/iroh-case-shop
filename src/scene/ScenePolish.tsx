import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  ColorManagement,
  CustomToneMapping,
  HalfFloatType,
  LinearToneMapping,
  Material,
  Mesh,
  OrthographicCamera,
  NeutralToneMapping,
  PlaneGeometry,
  ReinhardToneMapping,
  Scene,
  SRGBTransfer,
  Vector2,
  WebGLRenderTarget,
  type Object3D,
  type ToneMapping,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { lightExperience } from './lightExperience';

/** Display-referred grade after tone mapping: split tone, soft contrast, vignette, grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float aspect;
    varying vec2 vUv;
    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 c = source.rgb;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(vec3(0.94, 0.985, 1.04), vec3(1.035, 1.0, 0.94), smoothstep(0.05, 0.6, luma));
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      c = mix(vec3(luma), c, 1.06);
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      c *= 1.0 - 0.32 * smoothstep(0.42, 1.15, length(d));
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.018;
      gl_FragColor = vec4(c, source.a);
    }`,
};

/** Sprites and see-through effects must not write into the AO depth/normal buffer. */
class SceneAOPass extends GTAOPass {
  declare _visibilityCache: Object3D[];
  _overrideVisibility() {
    this.scene.traverse((object) => {
      const material = (object as { material?: Material }).material;
      const see =
        (object as { isSprite?: boolean }).isSprite ||
        (object as { isPoints?: boolean }).isPoints ||
        (object as { isLine?: boolean }).isLine ||
        (material && !Array.isArray(material) && material.transparent);
      if (see && object.visible) {
        object.visible = false;
        this._visibilityCache.push(object);
      }
    });
  }
}

/**
 * Links every pass shader off the main thread. A pass that first compiles in
 * `render` blocks until the driver links it: seconds for the bloom and AO
 * loops on ANGLE/D3D11. Disabled passes (AO) are included so turning them on
 * later is free too. `screen` is the last pass, which draws to the canvas and
 * so needs the on-screen variant as well.
 */
function compilePasses(
  gl: WebGLRenderer,
  composer: EffectComposer,
  output: OutputPass,
  screen: Material,
) {
  primeOutput(output, gl);
  const materials = new Set<Material>();
  const visit = (value: unknown) => {
    if (value instanceof Material) materials.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
  };
  for (const pass of [...composer.passes, composer.copyPass])
    Object.values(pass).forEach(visit);
  const quad = new PlaneGeometry(2, 2);
  const sceneOf = (list: Iterable<Material>) => {
    const scene = new Scene();
    for (const material of list) scene.add(new Mesh(quad, material));
    return scene;
  };
  const camera = new OrthographicCamera();
  // Passes draw into half-float targets, so compile that variant.
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType }),
    previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  const offscreen = gl.compileAsync(sceneOf(materials), camera);
  gl.setRenderTarget(null);
  const onscreen = gl.compileAsync(sceneOf([screen]), camera);
  gl.setRenderTarget(previous);
  return Promise.all([offscreen, onscreen])
    .catch(() => {})
    .finally(() => {
      target.dispose();
      quad.dispose();
    });
}

const TONE_DEFINES: Partial<Record<ToneMapping, string>> = {
  [LinearToneMapping]: 'LINEAR_TONE_MAPPING',
  [ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
  [CineonToneMapping]: 'CINEON_TONE_MAPPING',
  [ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
  [AgXToneMapping]: 'AGX_TONE_MAPPING',
  [NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
  [CustomToneMapping]: 'CUSTOM_TONE_MAPPING',
};

/**
 * OutputPass picks its defines on its first render, which would build a new
 * program right then. Set them up front, as its render does, so the program
 * compiled here is the one it uses.
 */
function primeOutput(pass: OutputPass, gl: WebGLRenderer) {
  const defines: Record<string, string> = {};
  if (ColorManagement.getTransfer(gl.outputColorSpace) === SRGBTransfer)
    defines.SRGB_TRANSFER = '';
  const tone = TONE_DEFINES[gl.toneMapping];
  if (tone) defines[tone] = '';
  pass.material.defines = defines;
  pass.material.needsUpdate = true;
  Object.assign(pass, {
    _outputColorSpace: gl.outputColorSpace,
    _toneMapping: gl.toneMapping,
  });
}

function Composer({
  ao,
  msaa,
  bloom,
  covered,
}: {
  ao: boolean;
  msaa: number;
  bloom: boolean;
  covered: boolean;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);
  const pipeline = useMemo(() => {
    const target = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      samples: 4,
    });
    const composer = new EffectComposer(gl, target);
    const occlusion = new SceneAOPass(scene, camera, 1, 1);
    occlusion.updateGtaoMaterial({
      radius: 0.32,
      distanceExponent: 1.4,
      thickness: 1.2,
      scale: 1,
      samples: 12,
    });
    occlusion.updatePdMaterial({ radius: 6, rings: 2, samples: 12 });
    occlusion.blendIntensity = 0.85;
    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.28, 0.5, 1.6);
    const grade = new ShaderPass(GradeShader);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(occlusion);
    composer.addPass(bloom);
    const output = new OutputPass();
    composer.addPass(output);
    composer.addPass(grade);
    return { composer, occlusion, grade, bloom, output };
  }, [gl, scene, camera]);
  useEffect(
    () => () => {
      // The composer frees only its own buffers; each pass owns targets and materials.
      for (const pass of pipeline.composer.passes) pass.dispose();
      pipeline.composer.dispose();
    },
    [pipeline],
  );
  const linked = useRef(false);
  useEffect(() => {
    let live = true;
    linked.current = false;
    const { composer, output, grade } = pipeline;
    void compilePasses(gl, composer, output, grade.material).then(() => {
      if (live) linked.current = true;
    });
    return () => {
      live = false;
    };
  }, [gl, pipeline]);
  useEffect(() => {
    const { composer, occlusion, grade } = pipeline;
    composer.setPixelRatio(dpr);
    composer.setSize(size.width, size.height);
    // ponytail: half-res AO; the denoise pass hides the upsample. Drop it entirely on slow GPUs.
    occlusion.setSize(
      Math.ceil((size.width * dpr) / 2),
      Math.ceil((size.height * dpr) / 2),
    );
    grade.uniforms.aspect.value = size.width / size.height;
  }, [pipeline, size, dpr]);
  useEffect(() => {
    pipeline.occlusion.enabled = ao;
    pipeline.bloom.enabled = bloom;
  }, [pipeline, ao, bloom]);
  useEffect(() => {
    const { composer } = pipeline;
    if (composer.renderTarget1.samples === msaa) return;
    const target = composer.renderTarget1.clone();
    target.samples = msaa;
    composer.reset(target);
  }, [pipeline, msaa]);
  const skipped = useRef(false);
  useFrame((_, delta) => {
    // Until the passes link, keep the last frame rather than block on them.
    if (!linked.current) return;
    skipped.current = covered && !skipped.current;
    if (!skipped.current) pipeline.composer.render(delta);
  }, 1);
  return null;
}

/** Quality rungs, cheapest first. Sustained low fps steps down: AO, then MSAA, then DPR toward 1. */
const LADDER = [
  { ao: false, msaa: 0, dpr: 1 },
  { ao: false, msaa: 0, dpr: 1.25 },
  { ao: false, msaa: 0, dpr: 1.5 },
  { ao: false, msaa: 4, dpr: 1.5 },
  { ao: true, msaa: 4, dpr: 1.5 },
];

function openingTier() {
  // Phones and save-data start on the cheapest rung. Desktop skips AO until
  // the frame rate proves it can climb.
  return lightExperience() ? 0 : 3;
}

/**
 * `covered`: a panel hides most of the room, so it is drawn every other frame.
 * `onDpr` receives the rung's pixel ratio; the Canvas owner applies it.
 */
export function ScenePolish({
  covered,
  onDpr,
}: {
  covered: boolean;
  onDpr: (dpr: number) => void;
}) {
  // Behind the waiting room the room draws a few frames a second on purpose;
  // measuring that would read as a slow GPU and drop the quality for good.
  const measuring = useThree((state) => state.frameloop === 'always');
  const [tier, setTier] = useState(openingTier);
  const capped = lightExperience();
  const ceiling = capped ? 2 : LADDER.length - 1;
  const rung = LADDER[tier] ?? LADDER[0];
  // drei's `flipflops` counts every incline, so a steady 60 fps would hit its
  // fallback in ~10 s. Stop climbing after the first decline instead.
  const declined = useRef(false);
  useEffect(() => {
    onDpr(Math.min(window.devicePixelRatio || 1, rung.dpr));
  }, [rung, onDpr]);
  return (
    <>
      {measuring && (
        <PerformanceMonitor
          onDecline={() => {
            declined.current = true;
            setTier((current) => Math.max(0, current - 1));
          }}
          // Skipped draws inflate the measured fps, so no climbing while covered.
          onIncline={() =>
            covered ||
            declined.current ||
            setTier((current) => Math.min(ceiling, current + 1))
          }
        />
      )}
      <Composer
        ao={rung.ao}
        msaa={rung.msaa}
        bloom={!capped && tier > 0}
        covered={covered}
      />
    </>
  );
}
