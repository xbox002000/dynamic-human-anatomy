import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { JointDefinition } from '../../packages/anatomy-schema/src/index';
import { PoseController } from '../../apps/web/src/skeleton/PoseController';
import { IKController } from '../../apps/web/src/skeleton/IKController';

/** 建立與 arm_sample 相同的 4 骨鏈：肩(0) → 肘(0.30) → 腕(0.55) → 手端(0.65)，沿 +X */
function buildArm() {
  const root = new THREE.Group();
  const mk = (name: string, x: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, 0, 0);
    return b;
  };
  const shoulder = mk('shoulder_l', 0);
  const upper = mk('upper_arm_l', 0);
  const fore = mk('forearm_l', 0.3);
  const hand = mk('hand_l', 0.25);
  root.add(shoulder);
  shoulder.add(upper);
  upper.add(fore);
  fore.add(hand);
  const joints: JointDefinition[] = [
    {
      id: 'shoulder_left', bone: 'upper_arm_l', side: 'left', restDeg: [0, 0, 0],
      limits: [
        { axis: 'y', minDeg: -40, maxDeg: 110, confidence: 'placeholder', vector: [0, -1, 0] },
        { axis: 'z', minDeg: -80, maxDeg: 60, confidence: 'placeholder', vector: [0, 0, 1] },
        { axis: 'x', minDeg: -70, maxDeg: 70, confidence: 'placeholder', vector: [1, 0, 0] },
      ],
    },
    {
      id: 'elbow_left', bone: 'forearm_l', side: 'left', restDeg: [0, 0, 0],
      limits: [{ axis: 'y', minDeg: 0, maxDeg: 145, confidence: 'approximate', vector: [0, -1, 0] }],
    },
  ];
  const pose = new PoseController(root, joints);
  const ik = new IKController(root, pose, { effector: 'hand_l', joints: ['shoulder_left', 'elbow_left'] });
  return { pose, ik };
}

describe('IKController', () => {
  it('reaches a target inside the workspace', () => {
    const { ik, pose } = buildArm();
    const target = new THREE.Vector3(0.3, 0.05, 0.2); // 需屈肘才能到達
    const err = ik.solve(target);
    expect(err).toBeLessThan(0.005);
    expect(pose.getAngles('elbow_left')[0]).toBeGreaterThan(20);
  });

  it('never violates joint limits', () => {
    const { ik, pose } = buildArm();
    for (const t of [new THREE.Vector3(0.1, 0, -0.4), new THREE.Vector3(-0.2, 0.3, 0.1), new THREE.Vector3(2, 2, 2)]) {
      ik.solve(t);
      const [e] = pose.getAngles('elbow_left');
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(145);
      const [a, b, c] = pose.getAngles('shoulder_left');
      expect(a).toBeGreaterThanOrEqual(-40);
      expect(a).toBeLessThanOrEqual(110);
      expect(b).toBeGreaterThanOrEqual(-80);
      expect(b).toBeLessThanOrEqual(60);
      expect(c).toBeGreaterThanOrEqual(-70);
      expect(c).toBeLessThanOrEqual(70);
    }
  });

  it('unreachable target → arm stretches toward it and reports residual', () => {
    const { ik } = buildArm();
    const err = ik.solve(new THREE.Vector3(2, 0, 0));
    expect(err).toBeGreaterThan(1.4);
    expect(err).toBeLessThan(1.5); // 末端為腕（hand_l 骨根），臂長 0.55 m → 最近約 1.45 m
  });
});
