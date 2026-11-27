import * as THREE from 'three';

/**
 * M4：腳掌著地（root motion）。
 * 骨盆仍是骨架的根，但擺姿後平移骨盆，讓支撐腳的接觸點回到地面（rest pose 的腳底高度）。
 * 姿勢的唯一來源仍是關節角度：骨盆平移是由角度推導出的結果，不另外存。
 *
 * 每隻腳 3 個接觸點（皆由 rest pose 的足部骨骼網格推算，approximate）：
 *   heel（腳跟，綁 foot 骨）、ball（蹠骨頭下方，綁 foot 骨）、toe（趾尖，綁 toes 骨）。
 * 每隻腳取目前最低的接觸點作為支撐點。
 *
 * 模式：
 *   off   — 不平移（骨盆固定在空中，M3 行為）
 *   both  — 高度：兩腳中較低者貼地；水平：兩腳支撐點的位移取平均（對稱動作如深蹲時兩腳都不滑動）
 *   left / right — 該腳的支撐點完全固定（單腳站立、弓步）
 */
export type PlantMode = 'off' | 'both' | 'left' | 'right';

export type ContactKind = 'heel' | 'ball' | 'toe';

interface Contact {
  kind: ContactKind;
  bone: THREE.Bone;
  local: THREE.Vector3;
  rest: THREE.Vector3; // rest pose 世界座標
}

const SIDES = { left: 'l', right: 'r' } as const;

export class FootPlant {
  mode: PlantMode = 'both';
  private readonly pelvis: THREE.Bone;
  private readonly restPos: THREE.Vector3;
  private readonly feet = new Map<'left' | 'right', Contact[]>();
  readonly groundY: number;

  constructor(private readonly root: THREE.Object3D) {
    const pelvis = root.getObjectByName('pelvis');
    if (!(pelvis instanceof THREE.Bone)) throw new Error('FootPlant：找不到 pelvis 骨骼');
    this.pelvis = pelvis;
    this.restPos = pelvis.position.clone();
    root.updateMatrixWorld(true);
    let ground = Infinity;
    for (const [side, s] of Object.entries(SIDES) as ['left' | 'right', string][]) {
      const foot = root.getObjectByName(`foot_${s}`);
      const toes = root.getObjectByName(`toes_${s}`);
      const mesh = findMesh(root, `foot_skeleton_${side}`);
      const toeMesh = findMesh(root, `toe_bones_${side}`);
      if (!(foot instanceof THREE.Bone) || !(toes instanceof THREE.Bone) || !mesh) continue;
      const pts = worldVerts(mesh);
      const minY = Math.min(...pts.map((p) => p.y));
      ground = Math.min(ground, minY);
      // 底面附近（最低 1.5 cm）的頂點：最後方 = 腳跟，最前方 = 蹠骨頭下方（GL +Z = 前）
      const sole = pts.filter((p) => p.y < minY + 0.015);
      const heel = lowestNear(sole, sole.reduce((a, p) => (p.z < a.z ? p : a)));
      const ball = lowestNear(sole, sole.reduce((a, p) => (p.z > a.z ? p : a)));
      const tp = toeMesh ? worldVerts(toeMesh) : [];
      const tip = tp.length ? tp.reduce((a, p) => (p.z > a.z ? p : a)) : ball.clone();
      this.feet.set(side, [
        { kind: 'heel', bone: foot, local: foot.worldToLocal(heel.clone()), rest: heel },
        { kind: 'ball', bone: foot, local: foot.worldToLocal(ball.clone()), rest: ball },
        { kind: 'toe', bone: toes, local: toes.worldToLocal(tip.clone()), rest: tip },
      ]);
    }
    if (!this.feet.size) throw new Error('FootPlant：找不到足部骨骼網格');
    // 地面高度取 rest pose 接觸點的最低值（而非網格最低頂點），確保 rest pose 時骨盆位移為 0
    void ground;
    this.groundY = Math.min(...[...this.feet.values()].flat().map((c) => c.rest.y));
  }

  /** 腳的支撐點（目前最低的接觸點）：{ now, rest } 世界座標 */
  support(side: 'left' | 'right'): { now: THREE.Vector3; rest: THREE.Vector3; kind: ContactKind } | null {
    const cs = this.feet.get(side);
    if (!cs) return null;
    let best: { now: THREE.Vector3; rest: THREE.Vector3; kind: ContactKind } | null = null;
    for (const c of cs) {
      const now = c.bone.localToWorld(c.local.clone());
      if (!best || now.y < best.now.y) best = { now, rest: c.rest, kind: c.kind };
    }
    return best;
  }

  /** 在所有關節角度套用之後呼叫 */
  apply(): void {
    this.pelvis.position.copy(this.restPos);
    this.root.updateMatrixWorld(true);
    if (this.mode === 'off') return;
    const sides = this.mode === 'both' ? (['left', 'right'] as const) : ([this.mode] as const);
    const sup = sides.map((s) => this.support(s)).filter((x): x is NonNullable<typeof x> => !!x);
    if (!sup.length) return;
    const delta = new THREE.Vector3();
    for (const s of sup) delta.add(s.rest.clone().sub(s.now));
    delta.divideScalar(sup.length);
    // 高度：最低的支撐點貼地（另一腳可以離地，例如抬腿）
    delta.y = this.groundY - Math.min(...sup.map((s) => s.now.y));
    if (this.mode !== 'both') delta.y = sup[0]!.rest.y - sup[0]!.now.y;
    // 世界位移 → pelvis 父節點的局部位移
    const parent = this.pelvis.parent!;
    const a = parent.worldToLocal(new THREE.Vector3());
    const b = parent.worldToLocal(delta.clone());
    this.pelvis.position.add(b.sub(a));
    this.root.updateMatrixWorld(true);
  }
}

function findMesh(root: THREE.Object3D, id: string): THREE.SkinnedMesh | null {
  let out: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (out || !(o instanceof THREE.SkinnedMesh)) return;
    const oid = (o.userData.anatomicalId as string) ?? (o.parent?.userData.anatomicalId as string) ?? o.name;
    if (oid === id || o.name === id) out = o;
  });
  return out;
}

function worldVerts(mesh: THREE.SkinnedMesh): THREE.Vector3[] {
  const pos = mesh.geometry.getAttribute('position');
  const out: THREE.Vector3[] = [];
  const step = Math.max(1, Math.floor(pos.count / 4000));
  for (let i = 0; i < pos.count; i += step) {
    const v = new THREE.Vector3();
    mesh.getVertexPosition(i, v);
    out.push(v.applyMatrix4(mesh.matrixWorld));
  }
  return out;
}

/** 在 ref 附近 2 cm 內取最低的點，避免選到邊緣離群點 */
function lowestNear(pts: THREE.Vector3[], ref: THREE.Vector3): THREE.Vector3 {
  const near = pts.filter((p) => Math.hypot(p.x - ref.x, p.z - ref.z) < 0.02);
  return near.reduce((a, p) => (p.y < a.y ? p : a), ref).clone();
}
