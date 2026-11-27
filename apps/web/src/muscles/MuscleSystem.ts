import * as THREE from 'three';
import type { AttachmentPoint, MuscleDefinition, MuscleState } from '@dha/anatomy-schema';
import { clamp01 } from '@dha/anatomy-schema';
import { DEFORMATION_PROFILES, polylineLength, type P3 } from './muscleMath';

function morphIndex(dict: Record<string, number>, name: string | undefined): number {
  return name !== undefined ? dict[name] ?? -1 : -1;
}

interface PathPoint {
  bone: THREE.Bone;
  local: THREE.Vector3;
}

interface MuscleRuntime {
  def: MuscleDefinition;
  mesh: THREE.SkinnedMesh | null;
  path: PathPoint[];
  restLength: number;
  state: MuscleState;
  bulgeIdx: number;
  shortenIdx: number;
  stretchIdx: number;
}

/**
 * Muscle Registry + State + Morph Driver。
 * 資料流：Pose(骨骼) → 路徑長度 → deformation profile + activation → morphTargetInfluences
 * Activation 與 Pose 為兩個獨立輸入。
 */
export class MuscleSystem {
  private readonly muscles = new Map<string, MuscleRuntime>();
  private readonly listeners = new Set<() => void>();
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly root: THREE.Object3D, defs: MuscleDefinition[]) {
    root.updateMatrixWorld(true);
    for (const def of defs) {
      const obj = root.getObjectByName(def.mesh);
      const mesh = obj instanceof THREE.SkinnedMesh ? obj : (obj?.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh | undefined) ?? null;
      const pts = [...def.origin, ...def.via_points, ...def.insertion];
      const path = pts.map((p) => this.toLocal(p)).filter((p): p is PathPoint => !!p);
      const dict = mesh?.morphTargetDictionary ?? {};
      const rt: MuscleRuntime = {
        def,
        mesh,
        path,
        restLength: 1,
        // 舊版 manifest 只有 contract（隆起+縮短混合）：視為 bulge，避免 activation 驅動縱向縮短的同時仍能顯示隆起
        bulgeIdx: morphIndex(dict, def.morphs?.bulge ?? def.morphs?.contract),
        shortenIdx: morphIndex(dict, def.morphs?.shorten),
        stretchIdx: morphIndex(dict, def.morphs?.stretch),
        state: { id: def.id, length: 1, restLength: 1, activation: def.activation, contraction: 0, stretch: 0, bulge: 0 },
      };
      rt.restLength = this.measure(rt);
      rt.state.restLength = rt.restLength;
      rt.state.length = rt.restLength;
      if (!mesh) console.warn(`[MuscleSystem] 找不到 mesh ${def.mesh}`);
      if (path.length < 2) console.warn(`[MuscleSystem] ${def.id} 路徑點不足`);
      this.muscles.set(def.id, rt);
    }
  }

  /** rest pose 下的模型空間座標 → 骨骼局部座標 */
  private toLocal(p: AttachmentPoint): PathPoint | null {
    const bone = this.root.getObjectByName(p.bone);
    if (!(bone instanceof THREE.Bone)) return null;
    const world = new THREE.Vector3(...p.position).applyMatrix4(this.root.matrixWorld);
    const local = bone.worldToLocal(world.clone());
    return { bone, local };
  }

  private worldPath(rt: MuscleRuntime): THREE.Vector3[] {
    return rt.path.map((p) => p.bone.localToWorld(p.local.clone()));
  }

  private measure(rt: MuscleRuntime): number {
    const inv = this.root.matrixWorld.clone().invert();
    const pts = this.worldPath(rt).map((v) => {
      v.applyMatrix4(inv);
      return [v.x, v.y, v.z] as P3;
    });
    return polylineLength(pts) || 1;
  }

  get ids(): string[] {
    return [...this.muscles.keys()];
  }

  getDefinition(id: string): MuscleDefinition | undefined {
    return this.muscles.get(id)?.def;
  }

  getState(id: string): MuscleState | undefined {
    const s = this.muscles.get(id)?.state;
    return s ? { ...s } : undefined;
  }

  getMesh(id: string): THREE.SkinnedMesh | null {
    return this.muscles.get(id)?.mesh ?? null;
  }

  /** 由 mesh 反查 anatomicalId */
  idForObject(obj: THREE.Object3D): string | undefined {
    for (const [id, rt] of this.muscles) if (rt.mesh === obj) return id;
    return undefined;
  }

  pathWorld(id: string): THREE.Vector3[] {
    const rt = this.muscles.get(id);
    return rt ? this.worldPath(rt) : [];
  }

  setActivation(id: string, a: number): void {
    const rt = this.muscles.get(id);
    if (!rt) return;
    rt.state.activation = clamp01(a);
    this.update();
  }

  setActivations(values: Record<string, number>): void {
    for (const [id, a] of Object.entries(values)) {
      const rt = this.muscles.get(id);
      if (rt) rt.state.activation = clamp01(a);
    }
    this.update();
  }

  activations(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, rt] of this.muscles) out[id] = rt.state.activation;
    return out;
  }

  /** 每次 Pose 或 Activation 改變後呼叫 */
  update(): void {
    this.root.updateMatrixWorld(true);
    for (const rt of this.muscles.values()) {
      const length = this.measure(rt);
      const profile = DEFORMATION_PROFILES[rt.def.deformation_profile] ?? DEFORMATION_PROFILES.fusiform_v1!;
      const dp = rt.def.deformation_params;
      const out = profile({
        length,
        restLength: rt.restLength,
        activation: rt.state.activation,
        maxShortening: dp?.max_shortening,
        maxLengthening: dp?.max_lengthening,
      });
      Object.assign(rt.state, { length, contraction: out.contraction, stretch: out.stretch, bulge: out.bulge });
      const inf = rt.mesh?.morphTargetInfluences;
      if (inf) {
        if (rt.bulgeIdx >= 0) inf[rt.bulgeIdx] = out.bulgeWeight;
        if (rt.shortenIdx >= 0) inf[rt.shortenIdx] = out.shortenWeight;
        if (rt.stretchIdx >= 0) inf[rt.stretchIdx] = out.stretchWeight;
      }
    }
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 用於除錯：tmp 向量避免 GC */
  get scratch(): THREE.Vector3 {
    return this.tmp;
  }
}
