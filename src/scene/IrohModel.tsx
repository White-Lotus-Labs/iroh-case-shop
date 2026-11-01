import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  BackSide,
  Color,
  CylinderGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  ShaderChunk,
  SkinnedMesh,
  Vector2,
  Vector3,
  type Bone,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import {
  ACTIONS,
  actionAt,
  DEFAULT_LOOK,
  lookAngles,
  restBlend,
  rotateWorld,
  sample,
  sampleNumber,
  setWorldQuaternion,
  solveTwoBone,
  type ActionName,
  type CupPose,
  type IrohActivity,
  type Look,
  type PotPose,
} from './irohMotion';
import { lightExperience } from './lightExperience';
import { LOOK } from './stations';

/** Built by scripts/host-model/build.mjs. */
const MODEL = '/models/iroh-host.2a7606.glb';
const MODEL_LIGHT = '/models/iroh-host-1k.470287.glb';

/** Painted eye opening fitted by prepare.py; lengths are metres on the face. */
type EyeFrame = {
  uv: [number, number];
  toPlane: number[];
  toUv: number[];
  width: number;
  top: number[];
  bottom: number[];
};

/** Lid samples across each eye; matches EYE_COLUMNS in prepare.py. */
const EYE_COLUMNS = 16;

/** Round the fitted lid so the opening is not a 16-sided polygon. */
function smoothEye(eye: EyeFrame): EyeFrame {
  const blur = (values: number[]) =>
    values.map((value, i) =>
      i === 0 || i === values.length - 1
        ? value
        : values[i - 1] * 0.25 + value * 0.5 + values[i + 1] * 0.25,
    );
  let top = eye.top;
  let bottom = eye.bottom;
  for (let pass = 0; pass < 2; pass++) {
    top = blur(top);
    bottom = blur(bottom);
  }
  return { ...eye, top, bottom };
}

type Uniforms = WebGLProgramParametersWithUniforms['uniforms'];

function patch(source: string, find: string, replace: string) {
  if (!source.includes(find)) throw new Error(`Iroh shader: no ${find}`);
  return source.replace(find, replace);
}

const BODY_VERTEX_COMMON = /* glsl */ `
attribute vec4 _mask;
varying vec4 vMask;
varying vec3 vRest;`;

const BODY_FRAGMENT_COMMON = /* glsl */ `
varying vec4 vMask;
varying vec3 vRest;
uniform vec2 eyeC[2];
uniform mat2 eyeP[2];
uniform mat2 eyeU[2];
uniform float eyeA[2];
uniform float eyeTop[${EYE_COLUMNS * 2}];
uniform float eyeBot[${EYE_COLUMNS * 2}];
uniform vec2 eyeGaze;
uniform float eyeLid;
float eyeMask = 0.0;
float lidMask = 0.0;
vec4 region = vec4( 0.0 );`;

/**
 * A procedural eye over the painted one: sclera with lid shadow, brown iris
 * that follows the gaze, catchlights, and an upper lid that closes over
 * skin sampled from the cheek. Plane units are metres on the face.
 */
const EYE_FUNCTION = /* glsl */ `
vec2 roundDisk( const in int i, const in vec2 d ) {
  mat2 m = eyeP[ i ];
  float e00 = m[ 0 ].x, e10 = m[ 0 ].y, e01 = m[ 1 ].x, e11 = m[ 1 ].y;
  float det = e00 * e11 - e01 * e10;
  vec2 uv = vec2( e11 * d.x - e01 * d.y, - e10 * d.x + e00 * d.y ) / det;
  vec2 c0 = m[ 0 ];
  float l0 = length( c0 );
  c0 /= l0;
  vec2 c1 = normalize( m[ 1 ] - c0 * dot( m[ 1 ], c0 ) );
  float s = 0.5 * ( l0 + length( m[ 1 ] ) );
  return ( c0 * uv.x + c1 * uv.y ) * s;
}
vec3 irohEye( const in int i, const in vec3 base, inout float mask ) {
  vec2 p = eyeP[ i ] * ( vMapUv - eyeC[ i ] );
  float x = p.x / ( eyeA[ i ] * 1.04 );
  float f = clamp( x * 0.5 + 0.5, 0.0, 1.0 ) * ${EYE_COLUMNS - 1}.0;
  float j0 = min( floor( f ), ${EYE_COLUMNS - 2}.0 );
  int j = i * ${EYE_COLUMNS} + int( j0 );
  float top0 = mix( eyeTop[ j ], eyeTop[ j + 1 ], f - j0 ) + 0.0012;
  // The painted eye hangs below the fitted lid, so the lower lid drops to cover it.
  float bot = mix( eyeBot[ j ], eyeBot[ j + 1 ], f - j0 ) - 0.012;
  int c = i * ${EYE_COLUMNS} + ${EYE_COLUMNS / 2};
  float midY = mix( eyeBot[ c ], eyeTop[ c ], 0.055 );
  float top = mix( top0, bot, eyeLid );
  // No early return: a branch here makes fwidth flicker, so the lid pixels jump.
  float aa = max( fwidth( p.y ), 0.0007 );
  float window = ( 1.0 - smoothstep( 1.05, 1.2, abs( x ) ) ) * ( 1.0 - smoothstep( 0.08, 0.1, abs( p.y ) ) );
  float inX = 1.0 - smoothstep( 0.96, 1.0, abs( x ) );
  float open = smoothstep( - aa, aa, top - p.y ) * smoothstep( - aa, aa, p.y - bot ) * inX * window;
  float lidded = smoothstep( - aa, aa, top0 - p.y ) * smoothstep( - aa, aa, p.y - top ) * inX * window;
  float height = max( top0 - bot, 1e-4 );
  float shade = mix( 0.55, 1.0, smoothstep( 0.0, height * 0.45, top - p.y ) ) * mix( 0.75, 1.0, 1.0 - x * x );
  vec3 col = vec3( 0.72, 0.66, 0.58 ) * shade;
  float ri = 0.018;
  vec2 gaze = clamp( eyeGaze, vec2( - 1.0 ), vec2( 1.0 ) );
  vec2 d = roundDisk( i, p - vec2( gaze.x * eyeA[ i ] * 0.22, midY + gaze.y * 0.0012 ) );
  float r = length( d ) / ri;
  float edge = max( fwidth( r ), 0.04 );
  float rings = atan( d.y, d.x ) * 7.0;
  float streak = mix( 1.0, 0.9 + 0.1 * sin( rings ), 1.0 - smoothstep( 0.5, 1.4, fwidth( rings ) ) );
  vec3 iris = mix( vec3( 0.55, 0.22, 0.05 ), vec3( 0.26, 0.09, 0.02 ), smoothstep( 0.15, 0.95, r ) ) * streak;
  iris *= mix( 1.0, 0.62, smoothstep( 0.82, 1.0, r ) );
  iris = mix( vec3( 0.008, 0.006, 0.005 ), iris, smoothstep( 0.36, 0.36 + edge, r ) );
  iris *= mix( 0.55, 1.0, smoothstep( 0.0, height * 0.4, top - p.y ) );
  col = mix( iris, col, smoothstep( 1.0 - edge, 1.0 + edge, r ) );
  float px = max( fwidth( d.x ), 0.0004 );
  float c1 = length( d - vec2( - 0.28, 0.3 ) * ri );
  float c2 = length( d - vec2( 0.22, - 0.16 ) * ri );
  float wet = ( 1.0 - smoothstep( 0.16 * ri, 0.16 * ri + px * 2.0, c1 ) ) * 0.75
    + ( 1.0 - smoothstep( 0.08 * ri, 0.08 * ri + px * 2.0, c2 ) ) * 0.28;
  col += vec3( 0.55, 0.5, 0.42 ) * wet * shade * smoothstep( 1.0, 0.75, r );
  vec3 skin = texture2D( map, eyeC[ i ] + eyeU[ i ] * vec2( p.x, bot - 0.012 ) ).rgb;
  skin *= mix( 0.72, 0.96, smoothstep( top, top0, p.y ) );
  vec3 outColor = mix( mix( base, skin, lidded ), col, open );
  float lash = ( 1.0 - smoothstep( 0.0015, 0.0015 + aa, abs( p.y - top - 0.0006 ) ) ) * ( 1.0 - smoothstep( 0.9, 1.1, abs( x ) ) ) * window;
  outColor = mix( outColor, vec3( 0.03, 0.02, 0.015 ), lash * 0.92 );
  mask = max( mask, open );
  lidMask = max( lidMask, lidded );
  return outColor;
}`;

const BODY_SURFACE = /* glsl */ `
diffuseColor.rgb = irohEye( 0, diffuseColor.rgb, eyeMask );
diffuseColor.rgb = irohEye( 1, diffuseColor.rgb, eyeMask );
// The eye under the lid is masked as glossy cloth; shade the lid as skin.
// SKIN_DIFFUSE keeps vMask: skin wrap on the eyeball's normals lights the lid pink.
region = mix( vMask, vec4( 1.0, 0.0, 0.0, 0.0 ), lidMask );
float skinTone = region.r * ( 1.0 - eyeMask );
float luma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( luma ), diffuseColor.rgb, 0.7 ) * vec3( 1.04, 0.94, 0.93 ), skinTone );`;

const BODY_ROUGHNESS = /* glsl */ `
roughnessFactor = mix( roughnessFactor, max( roughnessFactor, 0.62 ), region.r );
roughnessFactor = mix( roughnessFactor, max( roughnessFactor, 0.75 ), region.g );
roughnessFactor = mix( roughnessFactor, 1.0, eyeMask );`;

/** A fine plain weave on the robe, faded out before it can alias. */
const BODY_WEAVE = /* glsl */ `
float crease = smoothstep( 0.2, 0.65, length( normal - nonPerturbedNormal ) );
// The normal map carries the sculpted iris, which would show through the lid.
normal = normalize( mix( normal, nonPerturbedNormal, max( max( eyeMask, lidMask ), crease * vMask.r ) ) );
{
  vec3 q = vRest * 1500.0;
  float fade = region.b * ( 1.0 - smoothstep( 0.6, 1.6, length( fwidth( q ) ) ) );
  if ( fade > 0.0 ) {
    float h = 0.5 * ( sin( q.x ) + sin( q.z ) ) * sin( q.y ) * 0.3 * fade;
    vec2 dH = vec2( dFdx( h ), dFdy( h ) );
    vec3 sx = normalize( dFdx( - vViewPosition ) );
    vec3 sy = normalize( dFdy( - vViewPosition ) );
    vec3 r1 = cross( sy, normal );
    vec3 r2 = cross( normal, sx );
    float det = dot( sx, r1 ) * faceDirection;
    normal = normalize( abs( det ) * normal - sign( det ) * ( dH.x * r1 + dH.y * r2 ) );
  }
}`;

const BODY_MATERIAL = /* glsl */ `
material.roughness = mix( material.roughness, 1.0, eyeMask );
material.specularColor *= 1.0 - eyeMask;
material.specularF90 = mix( material.specularF90, 0.0, eyeMask );
#ifdef USE_SHEEN
  material.sheenColor *= region.b * ( 1.0 - eyeMask );
#endif`;

/** Wrap light and a warm terminator on skin; everything else stays Lambert. */
const SKIN_DIFFUSE = /* glsl */ `
float nl = dot( geometryNormal, directLight.direction );
float wrap = 0.45 * vMask.r * ( 1.0 - eyeMask );
vec3 scatter = vec3( 0.14, 0.035, 0.02 ) * vMask.r * ( 1.0 - eyeMask ) * smoothstep( - 0.35, 0.0, nl ) * ( 1.0 - smoothstep( 0.0, 0.5, nl ) );
reflectedLight.directDiffuse += directLight.color * ( saturate( ( nl + wrap ) / ( 1.0 + wrap ) ) + scatter ) * BRDF_Lambert( material.diffuseColor ) * mix( 1.0, 0.62, eyeMask );`;

export function patchHostBody(uniforms: Uniforms) {
  return (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    let v = shader.vertexShader;
    v = patch(v, '#include <common>', `#include <common>${BODY_VERTEX_COMMON}`);
    v = patch(
      v,
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvMask = _mask;\nvRest = position;',
    );
    shader.vertexShader = v;
    let f = shader.fragmentShader;
    f = patch(
      f,
      '#include <common>',
      `#include <common>${BODY_FRAGMENT_COMMON}`,
    );
    f = patch(
      f,
      '#include <map_pars_fragment>',
      `#include <map_pars_fragment>${EYE_FUNCTION}`,
    );
    f = patch(
      f,
      '#include <map_fragment>',
      `#include <map_fragment>${BODY_SURFACE}`,
    );
    f = patch(
      f,
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>${BODY_ROUGHNESS}`,
    );
    // Tripo's metalness map sparks on skin. Those pixels jump as the head moves.
    f = patch(
      f,
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
metalnessFactor = mix( metalnessFactor, 0.0, max( region.r, eyeMask ) );`,
    );
    f = patch(
      f,
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>${BODY_WEAVE}`,
    );
    f = patch(
      f,
      '#include <lights_physical_fragment>',
      `#include <lights_physical_fragment>${BODY_MATERIAL}`,
    );
    f = patch(
      f,
      '#include <lights_physical_pars_fragment>',
      patch(
        ShaderChunk.lights_physical_pars_fragment,
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        SKIN_DIFFUSE,
      ),
    );
    shader.fragmentShader = f;
  };
}

const NOISE = /* glsl */ `
float irohHash( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
float irohNoise( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( irohHash( i ), irohHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( irohHash( i + vec3( 0, 1, 0 ) ), irohHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( irohHash( i + vec3( 0, 0, 1 ) ), irohHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( irohHash( i + vec3( 0, 1, 1 ) ), irohHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}`;

/**
 * Advance Iroh's playlist at `now`. A new activity waits for the current
 * action to end (or cuts a rest short). The latest activity wins, so a flip
 * that reverts before then (A -> B -> A) changes nothing.
 */
export function stepActivity(
  m: {
    activity: IrohActivity;
    index: number;
    action: ActionName;
    start: number;
  },
  activity: IrohActivity,
  now: number,
) {
  const change = activity !== m.activity;
  if (
    now - m.start < ACTIONS[m.action].length &&
    !(change && m.action === 'rest')
  )
    return;
  if (change) {
    m.activity = activity;
    m.index = 0;
  } else m.index++;
  m.action = actionAt(m.activity, m.index);
  m.start = now;
}

/**
 * One fur shell over the beard and hair. Each shell sits further out along
 * the skinned normal; strands are streaks of noise that run downward, thin
 * out with height, and glow warm at the tips against the light.
 */
export function patchHairShell(uniforms: Uniforms) {
  return (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    let v = shader.vertexShader;
    v = patch(
      v,
      '#include <common>',
      '#include <common>\nuniform float shell;\nuniform float shellLength;\nvarying vec3 vRest;',
    );
    v = patch(
      v,
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvRest = position;',
    );
    v = patch(
      v,
      '#include <skinning_vertex>',
      '#include <skinning_vertex>\ntransformed += normalize( objectNormal ) * shell * shellLength;\ntransformed.y -= shell * shell * shellLength * 0.6;',
    );
    shader.vertexShader = v;
    let f = shader.fragmentShader;
    f = patch(
      f,
      '#include <common>',
      `#include <common>\nuniform float shell;\nvarying vec3 vRest;${NOISE}`,
    );
    f = patch(
      f,
      '#include <map_fragment>',
      `#include <map_fragment>
vec3 strandP = vRest * vec3( 520.0, 70.0, 520.0 );
float strand = mix( irohNoise( strandP ), 0.5, smoothstep( 0.25, 1.1, fwidth( strandP.x ) ) );
float hi = max( max( diffuseColor.r, diffuseColor.g ), diffuseColor.b );
float lo = min( min( diffuseColor.r, diffuseColor.g ), diffuseColor.b );
float hairness = smoothstep( 0.1, 0.2, hi ) * ( 1.0 - smoothstep( 0.2, 0.35, ( hi - lo ) / max( hi, 1e-3 ) ) );
diffuseColor.a = clamp( ( strand * hairness - shell ) * 3.0 + 0.5, 0.0, 1.0 );
diffuseColor.rgb *= mix( 0.62, 1.08, shell );`,
    );
    f = patch(
      f,
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vec3( 1.0, 0.8, 0.55 ) * shell * pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 ) * 0.35;`,
    );
    shader.fragmentShader = f;
  };
}

type BoneName =
  | 'root'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'mouth'
  | `${'shoulder' | 'upperarm' | 'forearm' | 'hand'}_${'L' | 'R'}`
  | 'cup'
  | 'spout';

type Rig = {
  armature: Object3D;
  bones: Record<BoneName, Bone>;
  rest: [Bone, Quaternion][];
  eyeGaze: Vector2;
  eyeLid: { value: number };
};

function buildRig(scene: Object3D, shells: number): Rig {
  const bones = {} as Record<BoneName, Bone>;
  let body: SkinnedMesh | undefined;
  let hair: SkinnedMesh | undefined;
  scene.traverse((node) => {
    if ((node as Bone).isBone) bones[node.name as BoneName] = node as Bone;
    if (node.name === 'IrohBody') body = node as SkinnedMesh;
    if (node.name === 'IrohHair') hair = node as SkinnedMesh;
  });
  if (!body || !hair) throw new Error('Iroh model: missing body or hair');

  const eyes = JSON.parse(body.userData.irohEyes) as Record<
    'R' | 'L',
    EyeFrame
  >;
  const pair = [eyes.R, eyes.L].map(smoothEye);
  const eyeGaze = new Vector2();
  const eyeLid = { value: 0 };
  const source = body.material as MeshStandardMaterial;
  const material = new MeshPhysicalMaterial({
    map: source.map,
    normalMap: source.normalMap,
    normalScale: source.normalScale,
    roughnessMap: source.roughnessMap,
    metalnessMap: source.metalnessMap,
    roughness: source.roughness,
    metalness: source.metalness,
    sheen: 1,
    sheenRoughness: 0.55,
    sheenColor: new Color(0.5, 0.36, 0.26),
  });
  material.onBeforeCompile = patchHostBody({
    eyeC: { value: new Float32Array(pair.flatMap((eye) => eye.uv)) },
    eyeP: { value: new Float32Array(pair.flatMap((eye) => eye.toPlane)) },
    eyeU: { value: new Float32Array(pair.flatMap((eye) => eye.toUv)) },
    eyeA: { value: new Float32Array(pair.map((eye) => eye.width)) },
    eyeTop: { value: new Float32Array(pair.flatMap((eye) => eye.top)) },
    eyeBot: { value: new Float32Array(pair.flatMap((eye) => eye.bottom)) },
    eyeGaze: { value: eyeGaze },
    eyeLid,
  });
  body.material = material;
  body.castShadow = body.receiveShadow = true;

  for (let i = 1; i <= shells; i++) {
    const shellMaterial = new MeshStandardMaterial({
      map: source.map,
      roughness: 0.85,
      metalness: 0,
      alphaTest: 0.5,
      alphaToCoverage: true,
    });
    shellMaterial.onBeforeCompile = patchHairShell({
      shell: { value: i / shells },
      shellLength: { value: 0.008 },
    });
    const layer = new SkinnedMesh(hair.geometry, shellMaterial);
    layer.position.copy(hair.position);
    layer.quaternion.copy(hair.quaternion);
    layer.scale.copy(hair.scale);
    layer.bind(hair.skeleton, hair.bindMatrix);
    hair.parent!.add(layer);
  }
  hair.visible = false;

  return {
    armature: bones.root.parent!,
    bones,
    rest: Object.values(bones).map((bone) => [bone, bone.quaternion.clone()]),
    eyeGaze,
    eyeLid,
  };
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const DOWN = new Vector3(0, -1, 0);
// ponytail: offsets and tilts are in world axes; the host is never rotated.
const RECEIVE = new Vector3(0.2, -0.15, 0.05);
const SIP = new Vector3(0, -0.02, 0.07);
const LIFT = new Vector3(0.035, 0.17, 0);
const POUR = new Vector3(0.03, 0.1, 0);
const AHEAD = new Vector3(0, -0.25, 1);
const POLE_R = new Vector3(-0.15, -0.1, -0.05);
const POLE_L = new Vector3(0.15, -0.1, -0.05);

type Target = { p: Vector3; q: Quaternion };
const target = () => ({ p: new Vector3(), q: new Quaternion() });

/** Rest positions and rotations captured once the host is placed. */
type Rest = {
  cup: Vector3;
  spout: Vector3;
  wristR: Vector3;
  wristL: Vector3;
  handR: Quaternion;
  handL: Quaternion;
  elbowR: Vector3;
  elbowL: Vector3;
};

function captureRest(rig: Rig): Rest {
  rig.armature.updateWorldMatrix(true, true);
  const { bones } = rig;
  return {
    cup: bones.cup.getWorldPosition(new Vector3()),
    spout: bones.spout.getWorldPosition(new Vector3()),
    wristR: bones.hand_R.getWorldPosition(new Vector3()),
    wristL: bones.hand_L.getWorldPosition(new Vector3()),
    handR: bones.hand_R.getWorldQuaternion(new Quaternion()),
    handL: bones.hand_L.getWorldQuaternion(new Quaternion()),
    elbowR: bones.forearm_R.getWorldPosition(new Vector3()),
    elbowL: bones.forearm_L.getWorldPosition(new Vector3()),
  };
}

function cupTarget(pose: CupPose, rest: Rest, mouth: Vector3, out: Target) {
  switch (pose) {
    case 'rest':
      out.p.copy(rest.cup);
      out.q.identity();
      return out;
    case 'receive':
      out.p.copy(rest.cup).add(RECEIVE);
      out.q.identity();
      return out;
    case 'sip':
      out.p.copy(mouth).add(SIP);
      out.q.setFromAxisAngle(X, -0.6);
      return out;
    default: {
      const unknown: never = pose;
      throw new Error(`Unknown cup pose ${unknown}`);
    }
  }
}

function potTarget(pose: PotPose, rest: Rest, out: Target) {
  switch (pose) {
    case 'rest':
      out.p.copy(rest.spout);
      out.q.identity();
      return out;
    case 'lift':
      out.p.copy(rest.cup).add(RECEIVE).add(LIFT);
      out.q.setFromAxisAngle(Z, 0.2);
      return out;
    case 'pour':
      out.p.copy(rest.cup).add(RECEIVE).add(POUR);
      out.q.setFromAxisAngle(Z, 0.8);
      return out;
    default: {
      const unknown: never = pose;
      throw new Error(`Unknown pot pose ${unknown}`);
    }
  }
}

function lookTarget(
  look: Look,
  head: Vector3,
  camera: Vector3,
  cup: Vector3,
  out: Vector3,
) {
  switch (look) {
    case 'visitor':
      return out.copy(camera);
    case 'cup':
      return out.copy(cup);
    case 'ahead':
      return out.copy(head).add(AHEAD);
    default: {
      const unknown: never = look;
      throw new Error(`Unknown look ${unknown}`);
    }
  }
}

/** Dev-only `?irohPose=pour:3.5` holds one action frame, for shots. */
function useFrozenPose() {
  const [pose, setPose] = useState<{ action: ActionName; at: number } | null>(
    null,
  );
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const raw = new URLSearchParams(window.location.search).get('irohPose');
    const [action, at] = raw?.split(':') ?? [];
    if (action && action in ACTIONS)
      setPose({ action: action as ActionName, at: +at || 0 });
  }, []);
  return pose;
}

/**
 * The sculpted, rigged Iroh. He breathes, blinks, follows the visitor or his
 * cup with head and eyes, and plays short actions picked by activity: sips,
 * pours with a tea stream, nods, and a head shake on errors. Reduced motion
 * holds the rest pose. He stays hidden until his shaders are compiled.
 */
export function IrohModel({
  reduced,
  activity,
  lit = false,
  onActivate,
}: {
  reduced: boolean;
  activity: IrohActivity;
  /** The Host seal is hovered. The pointer on the mesh is tracked here too. */
  lit?: boolean;
  /** Same action as the Host seal: travel there, or open the panel. */
  onActivate?: () => void;
}) {
  const light = useMemo(lightExperience, []);
  const { scene } = useGLTF(light ? MODEL_LIGHT : MODEL);
  const rig = useMemo(
    () => (scene.userData.rig ??= buildRig(scene, light ? 6 : 10)) as Rig,
    [scene, light],
  );
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const room = useThree((state) => state.scene);
  const [ready, setReady] = useState(false);
  const [over, setOver] = useState(false);
  const cursor = useRef(false);
  const hover = (on: boolean) => {
    setOver(on);
    if (cursor.current === on) return;
    cursor.current = on;
    document.body.style.cursor = on ? 'pointer' : '';
  };
  useEffect(
    () => () => {
      if (cursor.current) document.body.style.cursor = '';
    },
    [],
  );
  // A second skinned copy, pushed out a few pixels. A plain mesh stays in the
  // bind pose and draws yellow lines through the robe.
  const rim = useRef<{
    material: MeshBasicMaterial;
    shell: SkinnedMesh;
    size: Vector2;
    thickness: { value: number };
  } | null>(null);
  useEffect(() => {
    if (!ready) return;
    let body: SkinnedMesh | undefined;
    scene.traverse((node) => {
      if (node.name === 'IrohBody') body = node as SkinnedMesh;
    });
    if (!body?.parent) return;
    const size = new Vector2(1, 1);
    const thickness = { value: 2.5 };
    const material = new MeshBasicMaterial({
      color: '#e9c983',
      side: BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    material.customProgramCacheKey = () => 'iroh-rim';
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSize = { value: size };
      shader.uniforms.uThickness = thickness;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vec2 rimDir = (projectionMatrix * vec4(normalMatrix * objectNormal, 0.0)).xy;
         gl_Position.xy += normalize(rimDir + vec2(1e-5)) * uThickness / uSize * gl_Position.w * 2.0;`,
      );
    };
    const shell = new SkinnedMesh(body.geometry, material);
    shell.name = 'iroh-rim';
    shell.bind(body.skeleton, body.bindMatrix);
    shell.position.copy(body.position);
    shell.quaternion.copy(body.quaternion);
    shell.scale.copy(body.scale);
    shell.raycast = () => null;
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.visible = false;
    body.parent.add(shell);
    rim.current = { material, shell, size, thickness };
    return () => {
      shell.removeFromParent();
      material.dispose();
      rim.current = null;
    };
  }, [scene, ready]);
  const rimOpacity = useRef(0);
  useFrame((_, delta) => {
    const edge = rim.current;
    if (!edge) return;
    const goal = ready && (lit || over) ? 1 : 0;
    rimOpacity.current = reduced
      ? goal
      : MathUtils.damp(rimOpacity.current, goal, 10, delta);
    edge.material.opacity = rimOpacity.current;
    edge.shell.visible = rimOpacity.current > 0.02;
    gl.getDrawingBufferSize(edge.size);
    edge.thickness.value = 6 * gl.getPixelRatio();
  });
  useEffect(() => {
    let live = true;
    gl.compileAsync(scene, camera, room)
      .catch(() => undefined)
      .then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [gl, scene, camera, room]);
  useEffect(() => {
    if (!ready) return;
    // Lets shots and browser tests wait for the model.
    gl.domElement.dataset.irohHost = 'model';
    return () => void delete gl.domElement.dataset.irohHost;
  }, [gl, ready]);

  const frozen = useFrozenPose();
  const stream = useRef<Mesh>(null);
  // A unit stream hanging from its top, so it can sit at the spout.
  const teaGeometry = useMemo(
    () =>
      new CylinderGeometry(0.0045, 0.0035, 1, 8, 1, true).translate(0, -0.5, 0),
    [],
  );
  useEffect(() => () => teaGeometry.dispose(), [teaGeometry]);
  const state = useRef({
    rest: null as Rest | null,
    activity,
    index: 0,
    action: actionAt(activity, 0) as ActionName,
    start: -1,
    // His own clock: r3f zeroes clock.elapsedTime on every setFrameloop, and
    // the waiting room toggles it, which left start/nextBlink hours ahead.
    clock: 0,
    yaw: 0,
    pitch: 0,
    gaze: new Vector2(),
    saccade: new Vector2(),
    nextSaccade: 0,
    nextBlink: 2,
    posed: false,
  });
  const scratch = useMemo(
    () => ({
      q: new Quaternion(),
      q2: new Quaternion(),
      head: new Vector3(),
      mouth: new Vector3(),
      cupNow: new Vector3(),
      look: new Vector3(),
      viewer: new Vector3(),
      a: target(),
      b: target(),
      wrist: new Vector3(),
      pole: new Vector3(),
      spout: new Vector3(),
    }),
    [],
  );

  useFrame(({ camera: view }, delta) => {
    const m = state.current;
    const s = scratch;
    const { bones } = rig;
    for (const [bone, q] of rig.rest) bone.quaternion.copy(q);
    rig.armature.updateMatrixWorld(true);
    m.rest ??= captureRest(rig);
    const rest = m.rest;

    if (reduced && !frozen) {
      rig.eyeGaze.set(0, 0);
      rig.eyeLid.value = 0;
      if (stream.current) stream.current.visible = false;
      return;
    }

    const now = (m.clock += delta);
    if (m.start < 0) m.start = now;
    if (!frozen) stepActivity(m, activity, now);
    const action = frozen?.action ?? m.action;
    const t = frozen ? frozen.at : now - m.start;
    const dt = frozen ? 1 : delta;

    const breath = frozen ? 0 : Math.sin(now * 0.74);
    const lean = sampleNumber(action, 'lean', t) + breath * 0.012;
    rotateWorld(bones.spine, s.q.setFromAxisAngle(X, lean * 0.4));
    rotateWorld(bones.chest, s.q.setFromAxisAngle(X, lean * 0.6));

    bones.cup.getWorldPosition(s.cupNow);
    bones.head.getWorldPosition(s.head);
    const lookSample = sample(action, 'look', t);
    const look =
      lookSample && lookSample.mix < 0.5
        ? lookSample.from
        : (lookSample?.to ?? DEFAULT_LOOK[m.activity]);
    lookTarget(look, s.head, view.getWorldPosition(s.viewer), s.cupNow, s.look);
    const [yawWanted, pitchWanted] = lookAngles(s.head, s.look);
    const yaw =
      MathUtils.clamp(yawWanted, -0.55, 0.55) +
      sampleNumber(action, 'shake', t);
    const pitch =
      MathUtils.clamp(pitchWanted, -0.45, 0.3) - sampleNumber(action, 'nod', t);
    m.yaw = MathUtils.damp(m.yaw, yaw, 5, dt);
    m.pitch = MathUtils.damp(m.pitch, pitch, 4, dt);
    for (const [bone, share] of [
      [bones.neck, 0.4],
      [bones.head, 0.6],
    ] as const) {
      s.q.setFromAxisAngle(Y, m.yaw * share);
      s.q.multiply(s.q2.setFromAxisAngle(X, -m.pitch * share));
      rotateWorld(bone, s.q);
    }

    if (!frozen && now > m.nextSaccade) {
      m.saccade
        .set(Math.random() - 0.5, Math.random() - 0.5)
        .multiplyScalar(0.12);
      m.nextSaccade = now + 1.4 + Math.random() * 2.4;
    }
    const gazeX = MathUtils.clamp(
      (yawWanted - m.yaw) / 0.35 + m.saccade.x,
      -1,
      1,
    );
    const gazeY = MathUtils.clamp(
      (pitchWanted - m.pitch) / 0.3 + m.saccade.y,
      -1,
      1,
    );
    m.gaze.set(
      MathUtils.damp(m.gaze.x, gazeX, 10, dt),
      MathUtils.damp(m.gaze.y, gazeY, 10, dt),
    );
    rig.eyeGaze.copy(m.gaze);
    if (!frozen && now > m.nextBlink + 0.16)
      m.nextBlink = now + 2.5 + Math.random() * 3.5;
    const blinkPhase = frozen ? -1 : (now - m.nextBlink) / 0.16;
    const blink =
      blinkPhase >= 0 && blinkPhase <= 1 ? 1 - Math.abs(blinkPhase * 2 - 1) : 0;
    rig.eyeLid.value = Math.max(sampleNumber(action, 'lids', t), blink);

    bones.mouth.getWorldPosition(s.mouth);
    const arms = [
      [
        'cup',
        bones.upperarm_R,
        bones.forearm_R,
        bones.hand_R,
        rest.cup,
        rest.wristR,
        rest.handR,
        rest.elbowR,
        POLE_R,
      ],
      [
        'pot',
        bones.upperarm_L,
        bones.forearm_L,
        bones.hand_L,
        rest.spout,
        rest.wristL,
        rest.handL,
        rest.elbowL,
        POLE_L,
      ],
    ] as const;
    for (const [
      prop,
      upper,
      lower,
      hand,
      pivot,
      wristRest,
      handRest,
      elbowRest,
      poleOffset,
    ] of arms) {
      const poses =
        prop === 'cup' ? sample(action, 'cup', t) : sample(action, 'pot', t);
      if (!poses) continue;
      if (prop === 'cup') {
        cupTarget(poses.from as CupPose, rest, s.mouth, s.a);
        cupTarget(poses.to as CupPose, rest, s.mouth, s.b);
      } else {
        potTarget(poses.from as PotPose, rest, s.a);
        potTarget(poses.to as PotPose, rest, s.b);
      }
      const back = restBlend(poses.from, poses.to, poses.mix);
      // The solved rest pose is not the bind pose, so a full rest skips IK.
      if (back >= 1) continue;
      s.a.p.lerp(s.b.p, poses.mix);
      s.a.q.slerp(s.b.q, poses.mix);
      s.wrist.subVectors(wristRest, pivot).applyQuaternion(s.a.q).add(s.a.p);
      solveTwoBone(
        upper,
        lower,
        hand,
        s.wrist,
        s.pole.addVectors(elbowRest, poleOffset),
      );
      setWorldQuaternion(hand, s.q.copy(s.a.q).multiply(handRest));
      if (back > 0) {
        for (const bone of [upper, lower, hand]) {
          const bind = rig.rest.find(([item]) => item === bone)![1];
          bone.quaternion.slerp(bind, back);
        }
      }
    }

    const tea = stream.current;
    if (tea) {
      tea.visible = sampleNumber(action, 'stream', t) > 0.5;
      if (tea.visible) {
        bones.spout.getWorldPosition(s.spout);
        bones.cup.getWorldPosition(s.cupNow).y -= 0.015;
        tea.parent!.worldToLocal(tea.position.copy(s.spout));
        const drop = s.cupNow.sub(s.spout);
        tea.scale.set(1, drop.length(), 1);
        tea.quaternion.setFromUnitVectors(DOWN, drop.normalize());
      }
    }
  });

  return (
    <>
      <group visible={ready} position-y={0.1}>
        <primitive
          object={scene}
          onPointerOver={(event: ThreeEvent<PointerEvent>) => {
            if (!onActivate) return;
            event.stopPropagation();
            hover(true);
          }}
          onPointerOut={() => hover(false)}
          onClick={(event: ThreeEvent<MouseEvent>) => {
            if (!onActivate || event.delta > LOOK.dragPx) return;
            event.stopPropagation();
            onActivate();
          }}
        />
      </group>
      <mesh ref={stream} geometry={teaGeometry} visible={false}>
        <meshStandardMaterial
          color="#8f4f16"
          emissive="#2a1204"
          roughness={0.12}
          transparent
          opacity={0.85}
        />
      </mesh>
    </>
  );
}
