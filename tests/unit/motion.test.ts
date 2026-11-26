import { describe, expect, it } from 'vitest';
import type { MotionClip } from '../../packages/anatomy-schema/src/index';
import { expandBilateral, roleFor, sampleMotion } from '../../apps/web/src/animation/motionSampler';
import curl from '../../apps/web/public/data/motions/dumbbell_curl.json';
import upper from '../../apps/web/public/data/upper_limbs_manifest.json';

const clip = curl as unknown as MotionClip;

describe('dumbbell curl clip', () => {
  it('keyframes are time-ordered and end at duration', () => {
    const ts = clip.keyframes.map((k) => k.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    expect(ts[ts.length - 1]).toBeCloseTo(clip.duration);
  });

  it('elbow flexes to the top and returns', () => {
    expect(sampleMotion(clip, 0).joints.elbow![0]).toBeLessThan(10);
    expect(sampleMotion(clip, 1.8).joints.elbow![0]).toBeGreaterThan(130);
    expect(sampleMotion(clip, 4.3).joints.elbow![0]).toBeLessThan(10);
  });

  it('agonist activation peaks during concentric phase, antagonist stays low', () => {
    const mid = sampleMotion(clip, 1.1).activation;
    expect(mid.biceps_brachii).toBeGreaterThan(0.7);
    expect(mid.triceps_brachii).toBeLessThan(0.15);
    expect(sampleMotion(clip, 1.1).phase).toContain('向心');
  });

  it('loop wraps time', () => {
    expect(sampleMotion(clip, clip.duration + 1.1).joints.elbow![0]).toBeCloseTo(sampleMotion(clip, 1.1).joints.elbow![0]!);
  });

  it('every activation key resolves to real bilateral muscles in the manifest', () => {
    const ids = upper.muscles.map((m) => m.id);
    for (const key of Object.keys(clip.keyframes[0]!.activation!)) {
      const out = expandBilateral({ [key]: 1 }, ids);
      expect(Object.keys(out).sort()).toEqual([`${key}_left`, `${key}_right`]);
    }
    const joints = upper.joints.map((j) => j.id);
    for (const key of Object.keys(clip.keyframes[0]!.joints!)) {
      expect(Object.keys(expandBilateral({ [key]: [0] }, joints))).toHaveLength(2);
    }
  });

  it('roles resolve for sided ids', () => {
    expect(roleFor(clip, 'biceps_brachii_left')).toBe('agonist');
    expect(roleFor(clip, 'triceps_brachii_right')).toBe('antagonist');
  });
});
