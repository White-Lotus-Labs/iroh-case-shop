import { describe, expect, it } from 'vitest';
import {
  Bone,
  Group,
  ShaderLib,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import {
  actionAt,
  restBlend,
  sample,
  sampleNumber,
  solveTwoBone,
} from '../src/scene/irohMotion';
import {
  patchHairShell,
  patchHostBody,
  stepActivity,
} from '../src/scene/IrohModel';
import { ACTIONS } from '../src/scene/irohMotion';

function arm() {
  const root = new Group();
  const upper = new Bone();
  const lower = new Bone();
  const end = new Bone();
  lower.position.set(0, -0.4, 0);
  end.position.set(0, -0.35, 0);
  root.add(upper);
  upper.add(lower);
  lower.add(end);
  root.updateMatrixWorld(true);
  return { upper, lower, end };
}

describe('Iroh motion', () => {
  it('lands the wrist on a reachable target with the elbow toward the pole', () => {
    const { upper, lower, end } = arm();
    const target = new Vector3(0.3, -0.25, 0.35);
    const pole = new Vector3(0, -0.3, -1);
    solveTwoBone(upper, lower, end, target, pole);
    expect(end.getWorldPosition(new Vector3()).distanceTo(target)).toBeLessThan(
      1e-3,
    );
    const along = target.clone().normalize();
    const elbow = lower.getWorldPosition(new Vector3());
    const off = (p: Vector3) => p.clone().addScaledVector(along, -p.dot(along));
    expect(off(elbow).dot(off(pole))).toBeGreaterThan(0);
  });

  it('reaches straight toward a target that is too far', () => {
    const { upper, lower, end } = arm();
    const target = new Vector3(2, 0, 0);
    solveTwoBone(upper, lower, end, target, new Vector3(0, -1, 0));
    const tip = end.getWorldPosition(new Vector3());
    expect(tip.length()).toBeCloseTo(0.75, 2);
    expect(tip.normalize().dot(target.normalize())).toBeGreaterThan(0.999);
  });

  it('eases between keys and holds the last one', () => {
    expect(sample('sip', 'cup', 0)).toMatchObject({
      from: 'rest',
      to: 'sip',
      mix: 0,
    });
    expect(sample('sip', 'cup', 0.8)?.mix).toBeCloseTo(0.5, 5);
    expect(sampleNumber('sip', 'lids', 1.6)).toBeCloseTo(0.55, 5);
    expect(sample('sip', 'cup', 99)).toMatchObject({
      from: 'rest',
      to: 'rest',
    });
    expect(sample('nod', 'cup', 1)).toBeUndefined();
  });

  it('returns the hands to the bind pose at the end of a sip', () => {
    expect(restBlend('sip', 'rest', 0)).toBe(0);
    expect(restBlend('sip', 'rest', 1)).toBe(1);
    expect(restBlend('rest', 'sip', 0)).toBe(1);
    expect(restBlend('rest', 'rest', 0.2)).toBe(1);
    expect(restBlend('lift', 'pour', 0.5)).toBe(0);
    const end = sample('sip', 'cup', 5.5);
    expect(end && restBlend(end.from, end.to, end.mix)).toBe(1);
  });

  it('shakes his head once on an error, then settles', () => {
    expect(actionAt('error', 0)).toBe('shake');
    for (let n = 1; n < 30; n++) expect(actionAt('error', n)).not.toBe('shake');
    expect(actionAt('researching', 0)).toBe('pour');
  });

  it('finds every shader hook it patches', () => {
    const body = {
      uniforms: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    } as unknown as WebGLProgramParametersWithUniforms;
    patchHostBody({})(body);
    expect(body.fragmentShader).toContain('irohEye( 1');
    expect(body.fragmentShader).toContain(
      'float wrap = 0.45 * vMask.r * ( 1.0 - eyeMask );',
    );
    expect(body.fragmentShader).toContain('crease * vMask.r');
    expect(body.fragmentShader).toContain('metalnessFactor, 0.0');
    expect(body.fragmentShader).toContain('specularColor *= 1.0 - eyeMask');
    expect(body.fragmentShader).toContain('roundDisk( i,');
    expect(body.fragmentShader).not.toContain('return base');
    const shell = {
      uniforms: {},
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    } as unknown as WebGLProgramParametersWithUniforms;
    patchHairShell({})(shell);
    expect(shell.vertexShader).toContain('shell * shellLength');
  });
});

describe('Iroh activity scheduler', () => {
  const sipping = () => ({
    activity: 'idle' as const,
    index: 1,
    action: 'sip' as const,
    start: 0,
  });
  const end = ACTIONS.sip.length + 0.1;

  it('drops a change that reverts before the action ends', () => {
    const m = sipping();
    stepActivity(m, 'researching', 1);
    stepActivity(m, 'idle', 2);
    stepActivity(m, 'idle', end);
    expect(m).toMatchObject({ activity: 'idle', index: 2, action: 'rest' });
  });

  it('plays a change that holds once the action ends', () => {
    const m = sipping();
    stepActivity(m, 'researching', 1);
    expect(m.action).toBe('sip');
    stepActivity(m, 'researching', end);
    expect(m).toMatchObject({ activity: 'researching', action: 'pour' });
  });
});
