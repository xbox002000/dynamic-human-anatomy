import * as THREE from 'three';
import type { JointDefinition, PoseDefinition } from '@dha/anatomy-schema';

interface JointRuntime {
  def: JointDefinition;
  bone: THREE.Bone;
  restLocal: THREE.Quaternion;
  /** 各自由度在骨骼局部空間的旋轉軸 */
  localAxes: THREE.Vector3[];
  angles: number[];
}

/**
 * FK 姿勢控制：以「關節角度（度）」為唯一姿勢來源。
 * 軸向定義於 rest pose 的模型空間（manifest），初始化時轉成骨骼局部軸。
 * 角度一律經過關節限制 clamp。
 */
export class PoseController {
  private readonly joints = new Map<string, JointRuntime>();
  private readonly listeners = new Set<() => void>();

  constructor(root: THREE.Object3D, defs: JointDefinition[]) {
    root.updateMatrixWorld(true);
    const rootInv = new THREE.Quaternion();
    root.getWorldQuaternion(rootInv).invert();
    for (const def of defs) {
      const bone = root.getObjectByName(def.bone);
      if (!(bone instanceof THREE.Bone)) {
        console.warn(`[PoseController] 找不到骨骼 ${def.bone}`);
        continue;
      }
      // 骨骼在模型空間的 rest 旋轉
      const boneModelQ = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv);
      const inv = boneModelQ.clone().invert();
      const localAxes = def.limits.map((l) => {
        const v = l.vector ? new THREE.Vector3(...l.vector) : axisVector(l.axis);
        return v.normalize().applyQuaternion(inv).normalize();
      });
      this.joints.set(def.id, {
        def,
        bone,
        restLocal: bone.quaternion.clone(),
        localAxes,
        angles: def.limits.map((_, i) => def.restDeg[i] ?? 0),
      });
    }
    this.applyAll();
  }

  get jointIds(): string[] {
    return [...this.joints.keys()];
  }

  getDefinition(id: string): JointDefinition | undefined {
    return this.joints.get(id)?.def;
  }

  getAngles(id: string): number[] {
    return [...(this.joints.get(id)?.angles ?? [])];
  }

  setAngle(id: string, dof: number, deg: number, silent = false): void {
    const j = this.joints.get(id);
    if (!j) return;
    const lim = j.def.limits[dof];
    if (!lim) return;
    j.angles[dof] = THREE.MathUtils.clamp(deg, lim.minDeg, lim.maxDeg);
    this.apply(j);
    if (!silent) this.emit();
  }

  /** 批次靜默修改後通知訂閱者 */
  commit(): void {
    this.emit();
  }

  setAngles(values: Record<string, number[]>): void {
    for (const [id, arr] of Object.entries(values)) {
      const j = this.joints.get(id);
      if (!j) continue;
      arr.forEach((deg, i) => {
        const lim = j.def.limits[i];
        if (lim) j.angles[i] = THREE.MathUtils.clamp(deg, lim.minDeg, lim.maxDeg);
      });
      this.apply(j);
    }
    this.emit();
  }

  reset(): void {
    for (const j of this.joints.values()) j.angles = j.def.limits.map((_, i) => j.def.restDeg[i] ?? 0);
    this.applyAll();
    this.emit();
  }

  snapshot(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [id, j] of this.joints) out[id] = [...j.angles];
    return out;
  }

  /** 匯出完整 Bone Transform（藍圖 §7.3），同時保存關節角度以便重建 */
  toPose(id: string, name: string, activation?: Record<string, number>): PoseDefinition {
    const bones: PoseDefinition['bones'] = {};
    for (const j of this.joints.values()) {
      const q = j.bone.quaternion;
      bones[j.bone.name] = { rotation: [q.x, q.y, q.z, q.w] };
    }
    return { id, name, bones, joints: this.snapshot(), activation };
  }

  applyPose(p: PoseDefinition): void {
    if (p.joints) {
      this.setAngles(p.joints);
      return;
    }
    for (const j of this.joints.values()) {
      const t = p.bones[j.bone.name];
      if (t) j.bone.quaternion.set(...t.rotation);
    }
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private applyAll(): void {
    for (const j of this.joints.values()) this.apply(j);
  }

  private apply(j: JointRuntime): void {
    const q = j.restLocal.clone();
    const tmp = new THREE.Quaternion();
    j.localAxes.forEach((axis, i) => {
      tmp.setFromAxisAngle(axis, THREE.MathUtils.degToRad(j.angles[i] ?? 0));
      q.multiply(tmp);
    });
    j.bone.quaternion.copy(q);
    j.bone.updateMatrixWorld(true);
  }

  /**
   * M4：所有角度套用完、通知訂閱者之前執行（例：FootPlant 平移骨盆讓腳著地）。
   * 只在非靜默更新時執行；IK 的有限差分走靜默路徑，不受影響。
   */
  postApply: (() => void) | null = null;

  private emit(): void {
    this.postApply?.();
    for (const fn of this.listeners) fn();
  }
}

function axisVector(a: 'x' | 'y' | 'z'): THREE.Vector3 {
  return a === 'x' ? new THREE.Vector3(1, 0, 0) : a === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
}
