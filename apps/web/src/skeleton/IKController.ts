import * as THREE from 'three';
import type { PoseController } from './PoseController';

/**
 * 數值 IK：在「關節角度空間」求解，因此自動遵守 PoseController 的關節限制，
 * 而且結果仍是可儲存的 FK 姿勢（Pose 為唯一資料來源）。
 * 方法：阻尼最小平方（Damped Least Squares），Jacobian 以有限差分估計。
 */
export interface IKChain {
  effector: string; // 末端骨骼名稱（取其世界位置）
  joints: string[]; // 參與的關節 ID（PoseController）
}

export class IKController {
  private readonly effector: THREE.Bone;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly root: THREE.Object3D,
    private readonly pose: PoseController,
    private readonly chain: IKChain,
  ) {
    const e = root.getObjectByName(chain.effector);
    if (!(e instanceof THREE.Bone)) throw new Error(`IK 末端骨骼不存在：${chain.effector}`);
    this.effector = e;
  }

  effectorWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.effector.getWorldPosition(out);
  }

  /** 回傳求解後與目標的距離（公尺） */
  solve(target: THREE.Vector3, iterations = 30, lambda = 0.15): number {
    const dofs: { joint: string; i: number }[] = [];
    for (const j of this.chain.joints) {
      const n = this.pose.getAngles(j).length;
      for (let i = 0; i < n; i++) dofs.push({ joint: j, i });
    }
    const h = 0.5; // 度
    let err = Infinity;
    for (let it = 0; it < iterations; it++) {
      const p0 = this.effectorWorld(new THREE.Vector3());
      const e = target.clone().sub(p0);
      err = e.length();
      if (err < 1e-4) break;
      // Jacobian 3 x n（單位：公尺/度）
      const J: THREE.Vector3[] = dofs.map(({ joint, i }) => {
        const a = this.pose.getAngles(joint);
        const orig = a[i]!;
        this.pose.setAngle(joint, i, orig + h, true);
        let p1 = this.effectorWorld(this.tmp).clone();
        let step = this.pose.getAngles(joint)[i]! - orig;
        if (Math.abs(step) < 1e-6) {
          // 碰到上限，改往負方向差分
          this.pose.setAngle(joint, i, orig - h, true);
          p1 = this.effectorWorld(this.tmp).clone();
          step = this.pose.getAngles(joint)[i]! - orig;
        }
        this.pose.setAngle(joint, i, orig, true);
        return Math.abs(step) < 1e-6 ? new THREE.Vector3() : p1.sub(p0).divideScalar(step);
      });
      // DLS：Δθ = Jᵀ (J Jᵀ + λ²I)⁻¹ e
      const JJt = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
      const m = JJt.elements; // column-major
      const scale = 1 / (h * 20); // 讓 λ 與單位無關
      for (const c of J) {
        const v = [c.x, c.y, c.z];
        for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) m[k * 3 + r]! += v[r]! * v[k]!;
      }
      // 阻尼隨 Jacobian 尺度自適應，避免單位（m/deg）造成步長過小
      const trace = (m[0]! + m[4]! + m[8]!) / 3;
      const l2 = lambda * lambda * trace + 1e-12 * scale;
      m[0]! += l2;
      m[4]! += l2;
      m[8]! += l2;
      const y = e.clone().applyMatrix3(JJt.invert());
      for (let d = 0; d < dofs.length; d++) {
        const { joint, i } = dofs[d]!;
        const delta = THREE.MathUtils.clamp(J[d]!.dot(y), -15, 15);
        this.pose.setAngle(joint, i, this.pose.getAngles(joint)[i]! + delta, true);
      }
    }
    this.pose.commit();
    return this.effectorWorld(new THREE.Vector3()).distanceTo(target);
  }
}
