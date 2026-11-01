import { Vector3 } from 'three';
export type SceneMood =
  | 'waiting'
  | 'pouring'
  | 'supported'
  | 'challenged'
  | 'mixed'
  | 'unknown'
  | 'card'
  | 'error';
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
export const smootherstep = (n: number) => {
  const t = clamp01(n);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const damp = (
  current: number,
  target: number,
  rate: number,
  dt: number,
) => target + (current - target) * Math.exp(-rate * dt);
export const travelDuration = (distance: number) =>
  Math.min(1.48, 0.52 + Math.sqrt(Math.max(0, distance)) * 0.4);
/** Quintic travel with damped carry preserves velocity when a destination changes mid-move.
 * End velocity/acceleration are zero. Position and look target have separate momentum.
 * No timer, render loop, FOV animation or request ownership lives here. */
export class CameraTravel {
  readonly position: Vector3;
  readonly target: Vector3;
  readonly velocity = new Vector3();
  readonly targetVelocity = new Vector3();
  private from = new Vector3();
  private fromTarget = new Vector3();
  private to = new Vector3();
  private toTarget = new Vector3();
  private initialVelocity = new Vector3();
  private initialTargetVelocity = new Vector3();
  private elapsed = 0;
  private duration = 1;
  active = false;
  constructor(position: Vector3, target: Vector3) {
    this.position = position.clone();
    this.target = target.clone();
  }
  retarget(position: Vector3, target: Vector3, duration?: number) {
    this.from.copy(this.position);
    this.fromTarget.copy(this.target);
    this.to.copy(position);
    this.toTarget.copy(target);
    this.initialVelocity.copy(this.velocity);
    this.initialTargetVelocity.copy(this.targetVelocity);
    this.duration =
      duration ??
      travelDuration(
        Math.max(
          this.from.distanceTo(position),
          this.fromTarget.distanceTo(target) * 0.35,
        ),
      );
    this.elapsed = 0;
    this.active = true;
  }
  finish() {
    this.position.copy(this.to);
    this.target.copy(this.toTarget);
    this.velocity.set(0, 0, 0);
    this.targetVelocity.set(0, 0, 0);
    this.active = false;
  }
  step(dt: number) {
    if (!this.active) return;
    this.elapsed += Math.max(0, dt);
    const t = clamp01(this.elapsed / this.duration);
    if (t === 1) {
      this.finish();
      return;
    }
    const s = smootherstep(t),
      ds = (30 * t * t * (t - 1) * (t - 1)) / this.duration;
    // Preserve the initial derivative, but shed old-direction momentum within
    // 160ms. A long Hermite carry can overshoot on interrupted return trips.
    const decay = Math.exp(-this.elapsed / 0.16);
    const carry = this.elapsed * decay * (1 - s);
    const carryVelocity =
      decay * ((1 - this.elapsed / 0.16) * (1 - s) - this.elapsed * ds);
    this.position
      .copy(this.from)
      .lerp(this.to, s)
      .addScaledVector(this.initialVelocity, carry);
    this.target
      .copy(this.fromTarget)
      .lerp(this.toTarget, s)
      .addScaledVector(this.initialTargetVelocity, carry);
    this.velocity
      .copy(this.to)
      .sub(this.from)
      .multiplyScalar(ds)
      .addScaledVector(this.initialVelocity, carryVelocity);
    this.targetVelocity
      .copy(this.toTarget)
      .sub(this.fromTarget)
      .multiplyScalar(ds)
      .addScaledVector(this.initialTargetVelocity, carryVelocity);
    // A 2mm final settling arc, confined to the last third; no elastic overshoot.
    if (t > 0.68) {
      const u = (t - 0.68) / 0.32;
      this.position.y += 0.002 * Math.sin(Math.PI * u) ** 2;
      this.velocity.y +=
        (0.002 * Math.PI * Math.sin(2 * Math.PI * u)) / (0.32 * this.duration);
    }
  }
}
export function pourPose(seconds: number) {
  const tilt =
    0.52 *
    smootherstep((seconds - 0.28) / 0.22) *
    (1 - smootherstep((seconds - 0.77) / 0.2));
  const stream =
    smootherstep((seconds - 0.42) / 0.1) *
    (1 - smootherstep((seconds - 0.76) / 0.12));
  return { tilt, stream };
}
export function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
