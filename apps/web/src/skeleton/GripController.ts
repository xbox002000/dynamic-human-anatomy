import * as THREE from 'three';
import type { GripDefinition } from '@dha/anatomy-schema';
import type { PoseController } from './PoseController';

interface SegmentRuntime {
  bone: THREE.Bone;
  /** 骨段遠端（tail）在骨骼局部空間的位置 */
  tailLocal: THREE.Vector3;
}

interface FingerRuntime {
  id: string;
  joints: string[];
  segments: SegmentRuntime[];
}

export interface GripResult {
  /** 每根手指是否接觸到握把 */
  contact: Record<string, boolean>;
  /** 每個手指關節最後的屈曲角度（度） */
  angles: Record<string, number>;
}

/**
 * 握持求解：握把是一個綁在掌骨（hand bone）上的圓柱。
 * 每根手指由近端到遠端逐關節屈曲，直到該骨段遠端碰到圓柱表面（握把半徑 + 手指軟組織半徑）為止，
 * 再讓下一個關節繼續收合，因此手指會包覆握把而不是穿透它。
 * 結果仍寫回 PoseController 的關節角度（Pose 為唯一資料來源）。
 */
export class GripController {
  readonly def: GripDefinition;
  private readonly hand: THREE.Bone;
  /** 握把中心 / 軸向（hand bone 局部空間） */
  readonly centerLocal: THREE.Vector3;
  readonly axisLocal: THREE.Vector3;
  private readonly fingers: FingerRuntime[] = [];

  constructor(
    private readonly root: THREE.Object3D,
    private readonly pose: PoseController,
    def: GripDefinition,
  ) {
    this.def = def;
    const hand = root.getObjectByName(def.bone);
    if (!(hand instanceof THREE.Bone)) throw new Error(`握持骨骼不存在：${def.bone}`);
    this.hand = hand;
    // 以 rest pose 換算局部座標：暫存並歸零手指角度
    const saved = this.saveAngles(def);
    this.setAll(def, 0);
    root.updateMatrixWorld(true);
    const toWorld = (v: number[]) => new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(root.matrixWorld);
    this.centerLocal = hand.worldToLocal(toWorld(def.center));
    const axisWorld = new THREE.Vector3(...def.axis).transformDirection(root.matrixWorld);
    const handQInv = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.axisLocal = axisWorld.applyQuaternion(handQInv).normalize();
    for (const f of def.fingers) {
      const segments: SegmentRuntime[] = [];
      for (const s of f.segments) {
        const bone = root.getObjectByName(s.bone);
        if (!(bone instanceof THREE.Bone)) continue;
        segments.push({ bone, tailLocal: bone.worldToLocal(toWorld(s.tail)) });
      }
      if (segments.length === f.joints.length) this.fingers.push({ id: f.id, joints: f.joints, segments });
    }
    this.restore(saved);
  }

  get fingerIds(): string[] {
    return this.fingers.map((f) => f.id);
  }

  /** 握把在世界空間的中心與軸向 */
  handleWorld(): { center: THREE.Vector3; axis: THREE.Vector3 } {
    this.root.updateMatrixWorld(true);
    const center = this.hand.localToWorld(this.centerLocal.clone());
    const axis = this.axisLocal.clone().applyQuaternion(this.hand.getWorldQuaternion(new THREE.Quaternion())).normalize();
    return { center, axis };
  }

  /** 點到握把中心線的距離（世界空間，公尺） */
  private distToAxis(p: THREE.Vector3, c: THREE.Vector3, a: THREE.Vector3): number {
    const d = p.clone().sub(c);
    return d.sub(a.clone().multiplyScalar(d.dot(a))).length();
  }

  /**
   * closure: 0 = 手指伸直, 1 = 完全握緊（接觸握把）。介於中間時按比例縮放接觸角度。
   * 回傳每指是否接觸；不發出 PoseController 通知以外的副作用。
   */
  solve(closure = 1, step = 1.5): GripResult {
    const contact: Record<string, boolean> = {};
    const angles: Record<string, number> = {};
    const limit = this.def.radius + this.def.fingerRadius;
    for (const f of this.fingers) {
      for (const j of f.joints) this.pose.setAngle(j, 0, 0, true);
      let touched = false;
      for (let k = 0; k < f.joints.length; k++) {
        const jid = f.joints[k]!;
        const max = this.pose.getDefinition(jid)?.limits[0]?.maxDeg ?? 90;
        let deg = 0;
        for (; deg <= max; deg += step) {
          this.pose.setAngle(jid, 0, deg, true);
          const { center, axis } = this.handleWorld();
          // 檢查此骨段以及其遠端所有骨段的末端
          let hit = false;
          for (let m = k; m < f.segments.length; m++) {
            const s = f.segments[m]!;
            const tip = s.bone.localToWorld(s.tailLocal.clone());
            if (this.distToAxis(tip, center, axis) <= limit) {
              hit = true;
              break;
            }
          }
          if (hit) {
            touched = true;
            break;
          }
        }
        // 停在接觸前一格；若整段都沒碰到就停在上限
        const final = Math.min(max, Math.max(0, deg - (deg <= max ? step : 0)));
        this.pose.setAngle(jid, 0, final, true);
      }
      contact[f.id] = touched;
      // 依 closure 縮放（開合動畫用）
      for (const j of f.joints) {
        const a = this.pose.getAngles(j)[0] ?? 0;
        const v = a * THREE.MathUtils.clamp(closure, 0, 1);
        this.pose.setAngle(j, 0, v, true);
        angles[j] = v;
      }
    }
    this.pose.commit();
    return { contact, angles };
  }

  /** 張開手指 */
  release(): void {
    this.setAll(this.def, 0);
    this.pose.commit();
  }

  private saveAngles(def: GripDefinition): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const f of def.fingers) for (const j of f.joints) out[j] = this.pose.getAngles(j);
    return out;
  }

  private setAll(def: GripDefinition, deg: number): void {
    for (const f of def.fingers) for (const j of f.joints) {
      const n = this.pose.getAngles(j).length;
      for (let i = 0; i < n; i++) this.pose.setAngle(j, i, deg, true);
    }
  }

  private restore(saved: Record<string, number[]>): void {
    for (const [j, arr] of Object.entries(saved)) arr.forEach((v, i) => this.pose.setAngle(j, i, v, true));
    this.root.updateMatrixWorld(true);
  }
}

/**
 * 靜力學：前臂接近水平時重物對肘關節的外力矩最大。
 * τ = m · g · d⊥，d⊥ = 肘關節中心到握把中心在水平面上的距離（重力 −Y）。
 */
export function elbowLoadTorque(massKg: number, elbowWorld: THREE.Vector3, gripWorld: THREE.Vector3, g = 9.81): { torque: number; leverArm: number } {
  const dx = gripWorld.x - elbowWorld.x;
  const dz = gripWorld.z - elbowWorld.z;
  const leverArm = Math.hypot(dx, dz);
  return { torque: massKg * g * leverArm, leverArm };
}
