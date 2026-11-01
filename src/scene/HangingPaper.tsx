import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  LineBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';

// Paper bend ported from ThreeUI "3D Paper": the sheet conserves arc length by
// integrating a bend angle across its width, and normals are rebuilt from the
// analytic tangents. Retuned for a hanging sheet: the top edge is held by its
// rod, the free bottom edge carries the curl, and the amplitude is ~1/3.
const SW = 0.5;
const SH = 0.72;
const SWAY_PERIOD = 6.2;
const TIME_SCALE = 1.2;
const REDUCED_TIME = 2.4;
const HOVER_DEPTH = 0.25;
// The shelf is scaled independently from the papers, putting its front lip at
// x ~= -0.52. Keep every sheet in front of it so the two outer portraits are
// not clipped where the side shelves project into the middle bay.
const HANGING_X = -0.61;

const ART = [
  '/images/shelf/spirit-1.d17cfc.webp',
  '/images/shelf/spirit-2.db8327.webp',
  '/images/shelf/spirit-3.bd8816.webp',
];

// Podium order, left to right from the room: rank 2, rank 1, rank 3.
const SHEETS = [
  { art: 1, z: -0.62, drop: 0.08, scale: 1, phase: 2.1 },
  { art: 0, z: 0, drop: 0.11, scale: 1.08, phase: 0 },
  { art: 2, z: 0.62, drop: 0.08, scale: 1, phase: 4.2 },
] as const;

const WAVE = /* glsl */ `
uniform float uTime, uAmp, uFreq, uTwist, uRipple, uPhase;
uniform vec2 uSize;
varying vec3 vSheetPos;
varying vec3 vSheetN;

float sAmp(float u, float v) { return uAmp * (0.10 + pow(u, 1.35)) * (0.18 + 0.96 * (1.0 - v)); }
float sAmpV(float u) { return -uAmp * (0.10 + pow(u, 1.35)) * 0.96; }
float sPhase(float u, float v) { return uFreq * u + uTwist * v + uTime * 0.40 + uPhase; }
float sTheta(float u, float v) { return sAmp(u, v) * sin(sPhase(u, v)); }
float sThetaV(float u, float v) {
  float ph = sPhase(u, v);
  return sAmpV(u) * sin(ph) + sAmp(u, v) * cos(ph) * uTwist;
}
float sYoff(float u, float v) {
  float a = 2.05 * u + uTime * 0.47 + uPhase;
  float b = 3.35 * u - 1.55 * v + uTime * 0.63 + uPhase;
  return uRipple * uSize.y * (1.0 - v) * (0.021 * sin(a) + 0.013 * sin(b));
}
float sYdU(float u, float v) {
  float a = 2.05 * u + uTime * 0.47 + uPhase;
  float b = 3.35 * u - 1.55 * v + uTime * 0.63 + uPhase;
  return uRipple * uSize.y * (1.0 - v) * (0.0431 * cos(a) + 0.0436 * cos(b));
}
float sYdV(float u, float v) {
  float a = 2.05 * u + uTime * 0.47 + uPhase;
  float b = 3.35 * u - 1.55 * v + uTime * 0.63 + uPhase;
  return uRipple * uSize.y * (-(0.021 * sin(a) + 0.013 * sin(b))
    - (1.0 - v) * 0.013 * 1.55 * cos(b));
}

void sheetPoint(vec2 q, out vec3 P, out vec3 N) {
  float u = q.x, v = q.y;
  float x = 0.0, z = 0.0, xe = 0.0, ze = 0.0;
  float dxv = 0.0, dzv = 0.0, dxe = 0.0, dze = 0.0;
  const int NS = 20;
  float h = 1.0 / float(NS);
  for (int i = 0; i < NS; i++) {
    float uu = (float(i) + 0.5) * h;
    float w = clamp((u - (uu - 0.5 * h)) / h, 0.0, 1.0);
    float th = sTheta(uu, v);
    float dt = sThetaV(uu, v);
    float c = cos(th), sn = sin(th);
    xe += c * h;           ze += sn * h;
    dxe += -sn * dt * h;   dze += c * dt * h;
    x += c * h * w;        z += sn * h * w;
    dxv += -sn * dt * h * w; dzv += c * dt * h * w;
  }
  float W = uSize.x, H = uSize.y;
  float th0 = sTheta(u, v);
  P = vec3((x - xe * 0.5) * W, (v - 0.5) * H + sYoff(u, v), (z - ze * 0.5) * W);
  vec3 Tu = vec3(W * cos(th0), sYdU(u, v), W * sin(th0));
  vec3 Tv = vec3((dxv - dxe * 0.5) * W, H + sYdV(u, v), (dzv - dze * 0.5) * W);
  N = normalize(cross(Tu, Tv));
}
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform float uRim, uRimA, uHover;
uniform vec3 uRimCol, uHoverPos, uHoverCol;
varying vec3 vSheetPos;
varying vec3 vSheetN;
`;

// Fresnel edge light from the original, plus a soft local "touch" light
// evaluated in object space so hovering never adds a scene light.
const FRAGMENT_OUT = /* glsl */ `
  float fres = pow(1.0 - clamp(abs(dot(geometryNormal, geometryViewDir)), 0.0, 1.0), 3.2);
  vec3 toLight = uHoverPos - vSheetPos;
  float dist2 = dot(toLight, toLight);
  float lambert = abs(dot(normalize(vSheetN), toLight * inversesqrt(max(dist2, 1e-6))));
  float glow = uHover * lambert / (1.0 + dist2 * 6.0);
  outgoingLight = outgoingLight * (1.0 + 0.9 * glow) + diffuseColor.rgb * uHoverCol * glow * 0.8;
  outgoingLight += fres * uRim * uRimCol * (1.0 + 0.6 * uHover);
  gl_FragColor = vec4(outgoingLight, clamp(diffuseColor.a + fres * uRimA, 0.0, 1.0));
`;

type SheetUniforms = {
  uPhase: { value: number };
  uHover: { value: number };
  uHoverPos: { value: Vector3 };
};

function stringGeometry() {
  const half = SW / 2 + 0.006;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [0, 0, 0, -half, -1, 0, 0, 0, 0, half, -1, 0],
      3,
    ),
  );
  return geometry;
}

/** Ranks 1-3 hang as poster papers in the Shelf's open middle bay. */
export function HangingPaper({
  reduced,
  emphasized,
  onSelect,
}: {
  reduced: boolean;
  emphasized: boolean;
  onSelect: () => void;
}) {
  const textures = useTexture(ART);
  const gl = useThree((state) => state.gl);
  const pivots = useRef<(Group | null)[]>([]);
  const hoverTarget = useRef([0, 0, 0]);

  const {
    sheet,
    rod,
    string,
    rodMaterial,
    stringMaterial,
    shared,
    materials,
    sheetUniforms,
  } = useMemo(() => {
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    for (const texture of textures) {
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = anisotropy;
    }
    const shared = {
      uTime: { value: REDUCED_TIME },
      uAmp: { value: 0.39 },
      uFreq: { value: 4.7 },
      uTwist: { value: 1.3 },
      uRipple: { value: 0.34 },
      uSize: { value: new Vector2(SW, SH) },
      uRim: { value: 0.22 },
      uRimA: { value: 0.5 },
      uRimCol: { value: new Vector3(1, 0.9, 0.74) },
      uHoverCol: { value: new Vector3(1, 0.82, 0.58) },
    };
    const sheetUniforms: SheetUniforms[] = SHEETS.map((s) => ({
      uPhase: { value: s.phase },
      uHover: { value: 0 },
      uHoverPos: { value: new Vector3(0, 0, HOVER_DEPTH) },
    }));
    const materials = SHEETS.map((s, index) => {
      const material = new MeshPhysicalMaterial({
        map: textures[s.art],
        color: '#a9a191',
        side: DoubleSide,
        roughness: 0.74,
        metalness: 0,
        clearcoat: 0.08,
        clearcoatRoughness: 0.5,
        specularIntensity: 0.6,
        transparent: false,
        opacity: 1,
      });
      material.onBeforeCompile = (
        shader: WebGLProgramParametersWithUniforms,
      ) => {
        Object.assign(shader.uniforms, shared, sheetUniforms[index]);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${WAVE}`)
          .replace(
            '#include <beginnormal_vertex>',
            `vec3 sheetP; vec3 objectNormal;
              sheetPoint(uv, sheetP, objectNormal);
              vSheetPos = sheetP; vSheetN = objectNormal;
              #ifdef USE_TANGENT
                vec3 objectTangent = vec3( tangent.xyz );
              #endif`,
          )
          .replace('#include <begin_vertex>', 'vec3 transformed = sheetP;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
          .replace('#include <opaque_fragment>', FRAGMENT_OUT);
      };
      return material;
    });
    return {
      sheet: new PlaneGeometry(SW, SH, 20, 28),
      rod: new CylinderGeometry(0.0075, 0.0075, SW + 0.034, 8),
      string: stringGeometry(),
      rodMaterial: new MeshStandardMaterial({
        color: '#6b4526',
        roughness: 0.55,
        metalness: 0.1,
      }),
      stringMaterial: new LineBasicMaterial({ color: '#3b2717' }),
      shared,
      materials,
      sheetUniforms,
    };
  }, [textures, gl]);

  useEffect(
    () => () => {
      for (const disposable of [
        sheet,
        rod,
        string,
        rodMaterial,
        stringMaterial,
        ...materials,
      ])
        disposable.dispose();
    },
    [sheet, rod, string, rodMaterial, stringMaterial, materials],
  );

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    shared.uTime.value = reduced ? REDUCED_TIME : t * TIME_SCALE;
    const k = Math.min(1, delta * 4);
    const omega = (Math.PI * 2) / SWAY_PERIOD;
    for (let i = 0; i < SHEETS.length; i++) {
      const hover = sheetUniforms[i].uHover;
      hover.value += (hoverTarget.current[i] - hover.value) * k;
      const pivot = pivots.current[i];
      if (!pivot) continue;
      const phase = omega * t + SHEETS[i].phase;
      pivot.rotation.set(
        reduced ? 0 : Math.sin(phase) * 0.032,
        reduced ? 0 : Math.sin(phase * 0.5 + 1.3) * 0.028,
        reduced ? 0 : Math.sin(phase + 1.9) * 0.01,
      );
    }
  });

  const onMove = (index: number) => (event: ThreeEvent<PointerEvent>) => {
    if (!event.uv) return;
    sheetUniforms[index].uHoverPos.value.set(
      (event.uv.x - 0.5) * SW,
      (event.uv.y - 0.5) * SH,
      HOVER_DEPTH,
    );
  };

  return (
    <group
      name="hanging-paper"
      position={[HANGING_X, 2.15, 0]}
      scale={emphasized ? 1.06 : 1}
    >
      {SHEETS.map((s, index) => (
        <group
          key={s.art}
          position={[0, 0, s.z]}
          rotation={[0, -Math.PI / 2 + 0.14, 0]}
          scale={s.scale}
        >
          <group
            ref={(node) => {
              pivots.current[index] = node;
            }}
          >
            <lineSegments
              geometry={string}
              material={stringMaterial}
              scale={[1, s.drop, 1]}
            />
            <mesh
              geometry={rod}
              material={rodMaterial}
              position={[0, -s.drop, 0]}
              rotation={[0, 0, Math.PI / 2]}
              castShadow
            />
            <mesh
              name={`hanging-paper-rank-${s.art + 1}`}
              geometry={sheet}
              material={materials[index]}
              position={[0, -s.drop - 0.004 - SH / 2, 0]}
              castShadow
              onClick={(event) => {
                event.stopPropagation();
                onSelect();
              }}
              onPointerOver={(event) => {
                event.stopPropagation();
                hoverTarget.current[index] = 1;
                document.body.style.cursor = 'pointer';
                onMove(index)(event);
              }}
              onPointerMove={onMove(index)}
              onPointerOut={() => {
                hoverTarget.current[index] = 0;
                document.body.style.cursor = '';
              }}
            />
          </group>
        </group>
      ))}
    </group>
  );
}
