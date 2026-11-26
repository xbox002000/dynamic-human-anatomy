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
  /** 接觸判定容差（公尺）：表面間隙小於此值即視為接觸 */
  static readonly CONTACT_TOLERANCE = 0.002;

  /** 指定手指從第 k 段起，所有骨段末端到握把表面的最小間隙（負值 = 穿透） */
  private fingerGap(f: FingerRuntime, fromSeg = 0): number {
    const { center, axis } = this.handleWorld();
    const limit = this.def.radius + this.def.fingerRadius;
    let gap = Infinity;
    for (let m = fromSeg; m < f.segments.length; m++) {
      const s = f.segments[m]!;
      const tip = s.bone.localToWorld(s.tailLocal.clone());
      gap = Math.min(gap, this.distToAxis(tip, center, axis) - limit);
    }
    return gap;
  }

  /**
   * 依「目前實際的手指姿勢」量測每指接觸狀態與間隙（公尺）。
   * solve() 的 contact 一律由此產生，保證與畫面上的手指姿勢一致。
   */
  measure(): { contact: Record<string, boolean>; gap: Record<string, number> } {
    this.root.updateMatrixWorld(true);
    const contact: Record<string, boolean> = {};
    const gap: Record<string, number> = {};
    for (const f of this.fingers) {
      const g = this.fingerGap(f);
      gap[f.id] = g;
      contact[f.id] = g <= GripController.CONTACT_TOLERANCE;
    }
    return { contact, gap };
  }

  /**
   * closure: 0 = 手指伸直, 1 = 完全握緊（接觸握把）。介於中間時按比例縮放接觸角度。
   * 每個關節先粗掃找到第一次碰觸的區間，再二分逼近接觸角，停在「不穿透」的一側。
   * 回傳的 contact / gap 是在最終姿勢（含 closure 縮放）上重新量測的結果。
   */
  solve(closure = 1, step = 2): GripResult & { gap: Record<string, number> } {
    const angles: Record<string, number> = {};
    for (const f of this.fingers) {
      this.openFinger(f);
      for (let k = 0; k < f.joints.length; k++) {
        const jid = f.joints[k]!;
        const max = this.pose.getDefinition(jid)?.limits[0]?.maxDeg ?? 90;
        const start = this.pose.getAngles(jid)[0] ?? 0;
        const gapAt = (deg: number) => {
          this.pose.setAngle(jid, 0, deg, true);
          this.root.updateMatrixWorld(true);
          return this.fingerGap(f, k);
        };
        let lo = start;
        let hi = -Infinity;
        if (gapAt(start) <= 0) {
          hi = start; // 起始就已貼住，不再屈曲
        } else {
          for (let deg = start + step; deg < max + step; deg += step) {
            const d = Math.min(deg, max);
            if (gapAt(d) <= 0) {
              hi = d;
              break;
            }
            lo = d;
          }
        }
        let final = max;
        if (Number.isFinite(hi)) {
          for (let it = 0; it < 12 && hi - lo > 0.05; it++) {
            const mid = (lo + hi) / 2;
            if (gapAt(mid) <= 0) hi = mid;
            else lo = mid;
          }
          final = lo;
        }
        this.pose.setAngle(jid, 0, final, true);
      }
      // 依 closure 在「張開姿勢」與「接觸姿勢」之間內插（開合動畫用）；
      // 兩端都不穿透，且屈曲為單調，所以中間值也不會穿透
      const c = THREE.MathUtils.clamp(closure, 0, 1);
      const open = this.openAngles.get(f.id)!;
      for (const j of f.joints) {
        const closed = this.pose.getAngles(j);
        const o = open[j] ?? closed.map(() => 0);
        closed.forEach((v, i) => this.pose.setAngle(j, i, (o[i] ?? 0) + (v - (o[i] ?? 0)) * c, true));
        angles[j] = this.pose.getAngles(j)[0] ?? 0;
      }
    }
    this.pose.commit();
    const { contact, gap } = this.measure();
    return { contact, gap, angles };
  }

  /** 每指的「張開姿勢」：rest 若已穿透握把（例如拇指），則伸展 / 外展到離開握把 */
  private readonly openAngles = new Map<string, Record<string, number[]>>();

  /** 張開安全間隙（公尺） */
  static readonly OPEN_CLEARANCE = 0.004;

  /**
   * 把手指放到張開姿勢並記錄。先全部歸零；若仍穿透或貼住握把，
   * 以座標搜尋在關節限制內調整各自由度（含拇指 CMC 外展），直到間隙 ≥ OPEN_CLEARANCE。
   */
  private openFinger(f: FingerRuntime): void {
    for (const j of f.joints) {
      const n = this.pose.getAngles(j).length;
      for (let i = 0; i < n; i++) this.pose.setAngle(j, i, 0, true);
    }
    this.root.updateMatrixWorld(true);
    const gap = () => {
      this.root.updateMatrixWorld(true);
      return this.fingerGap(f);
    };
    let best = gap();
    for (let round = 0; round < 40 && best < GripController.OPEN_CLEARANCE; round++) {
      let improved = false;
      for (const j of f.joints) {
        const lims = this.pose.getDefinition(j)?.limits ?? [];
        lims.forEach((_, i) => {
          for (const dir of [-1, 1]) {
            const cur = this.pose.getAngles(j)[i] ?? 0;
            this.pose.setAngle(j, i, cur + dir * 3, true);
            const g = gap();
            if (g > best + 1e-5) {
              best = g;
              improved = true;
            } else {
              this.pose.setAngle(j, i, cur, true);
            }
          }
        });
      }
      if (!improved) break;
    }
    const rec: Record<string, number[]> = {};
    for (const j of f.joints) rec[j] = this.pose.getAngles(j);
    this.openAngles.set(f.id, rec);
  }

  /** 張開手指（回到不穿透握把的張開姿勢） */
  release(): void {
    for (const f of this.fingers) {
      const open = this.openAngles.get(f.id);
      if (!open) {
        this.openFinger(f);
        continue;
      }
      for (const [j, arr] of Object.entries(open)) arr.forEach((v, i) => this.pose.setAngle(j, i, v, true));
    }
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
