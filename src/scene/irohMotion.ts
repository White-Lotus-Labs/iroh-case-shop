import { MathUtils, Quaternion, Vector3, type Object3D } from 'three';

export type IrohActivity = 'idle' | 'researching' | 'responding' | 'error';

export type CupPose = 'rest' | 'receive' | 'sip';
export type PotPose = 'rest' | 'lift' | 'pour';
export type Look = 'visitor' | 'cup' | 'ahead';

/** One beat of an action. Channels a key leaves out keep easing between the keys that set them. */
type Key = {
  at: number;
  cup?: CupPose;
  pot?: PotPose;
  look?: Look;
  /** Upper lids, 0 open to 1 closed. */
  lids?: number;
  /** Head pitch offset, radians down. */
  nod?: number;
  /** Head yaw offset, radians. */
  shake?: number;
  /** Chest lean forward, radians. */
  lean?: number;
  /** Tea stream from spout to cup, 0 or 1. */
  stream?: number;
};

type Action = { length: number; keys: Key[] };

export const ACTIONS = {
  rest: { length: 4.5, keys: [{ at: 0 }] },
  sip: {
    length: 6,
    keys: [
      { at: 0, cup: 'rest', look: 'cup', lids: 0, nod: 0, lean: 0 },
      { at: 1.6, cup: 'sip', lids: 0.55, nod: -0.08, lean: 0.06 },
      { at: 3.4, cup: 'sip', lids: 0.72, nod: -0.12 },
      { at: 4.9, cup: 'rest', look: 'visitor', lids: 0, nod: 0, lean: 0 },
    ],
  },
  pour: {
    length: 8,
    keys: [
      { at: 0, cup: 'rest', pot: 'rest', look: 'cup', stream: 0, lean: 0 },
      { at: 1.7, cup: 'receive', pot: 'lift', lean: 0.08 },
      { at: 2.7, pot: 'pour', stream: 0 },
      { at: 2.95, stream: 1 },
      { at: 4.7, pot: 'pour', stream: 1 },
      { at: 4.95, stream: 0 },
      { at: 5.4, pot: 'lift' },
      { at: 7, cup: 'rest', pot: 'rest', lean: 0 },
    ],
  },
  nod: {
    length: 2.4,
    keys: [
      { at: 0, look: 'visitor', nod: 0 },
      { at: 0.4, nod: 0.16 },
      { at: 0.8, nod: 0.02 },
      { at: 1.2, nod: 0.12 },
      { at: 1.8, nod: 0 },
    ],
  },
  shake: {
    length: 2.6,
    keys: [
      { at: 0, look: 'visitor', shake: 0, lids: 0 },
      { at: 0.45, shake: 0.2, lids: 0.3 },
      { at: 0.95, shake: -0.2 },
      { at: 1.45, shake: 0.12 },
      { at: 2, shake: 0, lids: 0 },
    ],
  },
} satisfies Record<string, Action>;

export type ActionName = keyof typeof ACTIONS;

const PLAYLISTS: Record<
  IrohActivity,
  { list: ActionName[]; loopFrom: number }
> = {
  idle: {
    list: ['rest', 'sip', 'rest', 'rest', 'pour', 'sip', 'rest'],
    loopFrom: 0,
  },
  researching: { list: ['pour', 'sip', 'rest'], loopFrom: 0 },
  responding: {
    list: ['nod', 'rest', 'sip', 'rest', 'nod', 'rest', 'rest'],
    loopFrom: 0,
  },
  error: { list: ['shake', 'rest', 'rest', 'sip', 'rest'], loopFrom: 1 },
};

/** The nth action Iroh plays for an activity; error shakes once, then settles. */
export function actionAt(activity: IrohActivity, n: number): ActionName {
  const { list, loopFrom } = PLAYLISTS[activity];
  if (n < list.length) return list[n];
  return list[loopFrom + ((n - loopFrom) % (list.length - loopFrom))];
}

export const DEFAULT_LOOK: Record<IrohActivity, Look> = {
  idle: 'visitor',
  researching: 'cup',
  responding: 'visitor',
  error: 'ahead',
};

type Channel = Exclude<keyof Key, 'at'>;
type Sample<T> = { from: T; to: T; mix: number };

// Sampled several times a frame, so each action's keys per channel are filtered once.
const channelKeys: Partial<
  Record<ActionName, Partial<Record<Channel, Key[]>>>
> = {};
function keysOf(name: ActionName, channel: Channel) {
  const byChannel = (channelKeys[name] ??= {});
  return (byChannel[channel] ??= (ACTIONS[name].keys as Key[]).filter(
    (key) => key[channel] !== undefined,
  ));
}

/** Eases a channel between the keys around time t; undefined if the action never sets it. */
export function sample<C extends Channel>(
  name: ActionName,
  channel: C,
  t: number,
): Sample<NonNullable<Key[C]>> | undefined {
  const keys = keysOf(name, channel);
  if (!keys.length) return undefined;
  const next = keys.findIndex((key) => key.at > t);
  const prev = next === -1 ? keys.length - 1 : Math.max(0, next - 1);
  const a = keys[prev];
  const b = next === -1 || next === 0 ? a : keys[next];
  const span = b.at - a.at;
  const mix = span > 0 ? MathUtils.smootherstep(t, a.at, b.at) : 0;
  return {
    from: a[channel] as NonNullable<Key[C]>,
    to: b[channel] as NonNullable<Key[C]>,
    mix,
  };
}

/** 1 when the prop is on the rest pose, 0 when it is fully on another pose. */
export function restBlend(from: string, to: string, mix: number) {
  if (from === 'rest' && to === 'rest') return 1;
  if (to === 'rest') return mix;
  if (from === 'rest') return 1 - mix;
  return 0;
}

export function sampleNumber(
  name: ActionName,
  channel: 'lids' | 'nod' | 'shake' | 'lean' | 'stream',
  t: number,
) {
  const s = sample(name, channel, t);
  return s ? MathUtils.lerp(s.from, s.to, s.mix) : 0;
}

const va = new Vector3();
const vb = new Vector3();
const vc = new Vector3();
const vt = new Vector3();
const vp = new Vector3();
const axis = new Vector3();
const pq = new Quaternion();
const dq = new Quaternion();
const lq = new Quaternion();

/** Turns a bone so its world rotation becomes q × its current world rotation. */
export function rotateWorld(bone: Object3D, q: Quaternion) {
  bone.parent!.getWorldQuaternion(pq);
  lq.copy(pq).invert().multiply(q).multiply(pq);
  bone.quaternion.premultiply(lq).normalize();
  bone.updateMatrixWorld(true);
}

/** Sets a bone's world rotation. */
export function setWorldQuaternion(bone: Object3D, q: Quaternion) {
  bone.parent!.getWorldQuaternion(pq);
  bone.quaternion.copy(pq.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

function turn(bone: Object3D, from: Vector3, to: Vector3) {
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
  dq.setFromUnitVectors(from.normalize(), to.normalize());
  rotateWorld(bone, dq);
}

/**
 * Analytic two-bone IK in world space: bends `lower` so the chain spans the
 * distance to `target`, swings `upper` onto it, then twists the elbow toward
 * `pole`. `end` is the bone whose origin should land on the target.
 */
export function solveTwoBone(
  upper: Object3D,
  lower: Object3D,
  end: Object3D,
  target: Vector3,
  pole: Vector3,
) {
  upper.getWorldPosition(va);
  lower.getWorldPosition(vb);
  end.getWorldPosition(vc);
  const l1 = va.distanceTo(vb);
  const l2 = vb.distanceTo(vc);
  const d = MathUtils.clamp(
    va.distanceTo(target),
    Math.abs(l1 - l2) + 1e-4,
    l1 + l2 - 1e-4,
  );

  const u = vt.subVectors(va, vb);
  const v = vp.subVectors(vc, vb);
  const current = u.angleTo(v);
  const wanted = Math.acos(
    MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1),
  );
  // A straight arm has no bend plane; any will do, the twist below fixes it.
  axis.crossVectors(u, v);
  if (axis.lengthSq() < 1e-10) axis.crossVectors(u, vp.subVectors(pole, va));
  if (axis.lengthSq() < 1e-10)
    axis.crossVectors(
      u,
      vp.set(Math.abs(u.x) < 0.9 * u.length() ? 1 : 0, 1, 0),
    );
  rotateWorld(lower, dq.setFromAxisAngle(axis.normalize(), wanted - current));

  end.getWorldPosition(vc);
  turn(upper, vc.sub(va), vt.subVectors(target, va));

  const along = vt.subVectors(target, va).normalize();
  lower.getWorldPosition(vb);
  const elbow = vb.sub(va);
  elbow.addScaledVector(along, -elbow.dot(along));
  const hint = vp.subVectors(pole, va);
  hint.addScaledVector(along, -hint.dot(along));
  if (elbow.lengthSq() < 1e-10 || hint.lengthSq() < 1e-10) return;
  const angle = elbow.angleTo(hint);
  const sign = Math.sign(axis.crossVectors(elbow, hint).dot(along)) || 1;
  rotateWorld(upper, dq.setFromAxisAngle(along, angle * sign));
}

/** Yaw (left +) and pitch (up +) from one point toward another, facing +Z at rest. */
export function lookAngles(from: Vector3, to: Vector3): [number, number] {
  const dir = va.subVectors(to, from);
  return [
    Math.atan2(dir.x, dir.z),
    Math.atan2(dir.y, Math.hypot(dir.x, dir.z)),
  ];
}
