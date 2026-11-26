/**
 * M3：真實 GLB 測試（Z-Anatomy 全身骨架）。
 * 驗收：全身可擺姿（脊柱、骨盆、雙下肢關節存在且方向正確），靜態肌肉在大幅姿勢下不脫離骨骼。
 * 「不脫離」的量測：取每條靜態肌肉的頂點樣本，計算其到最近骨骼頂點的距離，
 * 比較擺姿後與 rest pose 的差值（皆為 skinning 後的實際位置）。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnatomyManifest } from '../../packages/anatomy-schema/src/index';
import { validateManifest } from '../../packages/anatomy-schema/src/index';
import { PoseController } from '../../apps/web/src/skeleton/PoseController';
import { MuscleSystem } from '../../apps/web/src/muscles/MuscleSystem';
import { FootPlant } from '../../apps/web/src/skeleton/FootPlant';

const ROOT = path.resolve(__dirname, '../..');
const GLB = path.join(ROOT, 'apps/web/public/models/full_body.glb');
const MANIFEST = path.join(ROOT, 'apps/web/public/data/full_body_manifest.json');
const SIDES = ['left', 'right'] as const;

let manifest: AnatomyManifest;
let glbBuf: ArrayBuffer;

async function rig() {
  const gltf = await new GLTFLoader().parseAsync(glbBuf.slice(0), '');
  const scene = gltf.scene;
  const pose = new PoseController(scene, manifest.joints);
  pose.reset();
  return { scene, pose };
}

function byCategory(scene: THREE.Object3D) {
  const bones: THREE.SkinnedMesh[] = [];
  const statics: THREE.SkinnedMesh[] = [];
  // M4：靜態肌肉與「由靜態升級的動態肌肉」(bound) 權重同源，一併驗證不脫離骨骼
  const staticIds = new Set(
    (manifest.structures ?? []).filter((s) => (s as { static?: boolean; bound?: boolean }).static || (s as { bound?: boolean }).bound).map((s) => s.id),
  );
  scene.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const id = (o.userData.anatomicalId as string) ?? (o.parent?.userData.anatomicalId as string) ?? o.name;
    const cat = (o.userData.category as string) ?? (o.parent?.userData.category as string);
    o.userData.anatomicalId = id;
    if (cat === 'bone') bones.push(o);
    else if (staticIds.has(id)) statics.push(o);
  });
  return { bones, statics };
}

/** skinning 後的頂點（模型空間），每 step 個取一個 */
function skinned(mesh: THREE.SkinnedMesh, step: number): Float32Array {
  const pos = mesh.geometry.getAttribute('position');
  const n = Math.ceil(pos.count / step);
  const out = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < pos.count; i += step) {
    mesh.getVertexPosition(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    out[k++] = v.x;
    out[k++] = v.y;
    out[k++] = v.z;
  }
  return out;
}

/** 均勻格點空間索引，查最近點距離 */
class Grid {
  private readonly cells = new Map<string, number[]>();
  constructor(private readonly pts: Float32Array, private readonly size = 0.02) {
    for (let i = 0; i < pts.length; i += 3) {
      const key = this.key(pts[i]!, pts[i + 1]!, pts[i + 2]!);
      let c = this.cells.get(key);
      if (!c) this.cells.set(key, (c = []));
      c.push(i);
    }
  }
  private key(x: number, y: number, z: number) {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)},${Math.floor(z / this.size)}`;
  }
  nearest(x: number, y: number, z: number, maxRing = 4): number {
    const cx = Math.floor(x / this.size), cy = Math.floor(y / this.size), cz = Math.floor(z / this.size);
    let best = Infinity;
    for (let r = 0; r <= maxRing; r++) {
      for (let i = -r; i <= r; i++)
        for (let j = -r; j <= r; j++)
          for (let k = -r; k <= r; k++) {
            if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== r) continue;
            const c = this.cells.get(`${cx + i},${cy + j},${cz + k}`);
            if (!c) continue;
            for (const p of c) {
              const d = (this.pts[p]! - x) ** 2 + (this.pts[p + 1]! - y) ** 2 + (this.pts[p + 2]! - z) ** 2;
              if (d < best) best = d;
            }
          }
      if (best < (r * this.size) ** 2) break;
    }
    return Math.sqrt(best);
  }
}

function boneCloud(bones: THREE.SkinnedMesh[]): Float32Array {
  const parts = bones.map((b) => skinned(b, 2));
  const all = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return all;
}

/** 每條靜態肌肉：擺姿後「距骨骼變遠超過 tol」的樣本比例 */
function detachment(scene: THREE.Object3D, rest: Map<string, Float32Array>, tol: number) {
  scene.updateMatrixWorld(true);
  const { bones, statics } = byCategory(scene);
  const grid = new Grid(boneCloud(bones));
  const out: Record<string, { frac: number; p95: number }> = {};
  for (const m of statics) {
    const id = m.userData.anatomicalId as string;
    const pts = skinned(m, 7);
    const r = rest.get(id)!;
    const deltas: number[] = [];
    for (let i = 0; i < pts.length; i += 3) deltas.push(grid.nearest(pts[i]!, pts[i + 1]!, pts[i + 2]!) - r[i / 3]!);
    deltas.sort((a, b) => a - b);
    out[id] = { frac: deltas.filter((d) => d > tol).length / deltas.length, p95: deltas[Math.floor(deltas.length * 0.95)]! };
  }
  return out;
}

function restDistances(scene: THREE.Object3D) {
  scene.updateMatrixWorld(true);
  const { bones, statics } = byCategory(scene);
  const grid = new Grid(boneCloud(bones));
  const rest = new Map<string, Float32Array>();
  for (const m of statics) {
    const pts = skinned(m, 7);
    const d = new Float32Array(pts.length / 3);
    for (let i = 0; i < pts.length; i += 3) d[i / 3] = grid.nearest(pts[i]!, pts[i + 1]!, pts[i + 2]!);
    rest.set(m.userData.anatomicalId as string, d);
  }
  return rest;
}

const POSES: Record<string, Record<string, number[]>> = {
  hip_flex_90_knee_100: { hip_left: [90, 0, 0], knee_left: [100], hip_right: [-15, 0, 0], ankle_right: [15, 0] },
  squat: { hip_left: [100, 10, 0], hip_right: [100, 10, 0], knee_left: [120], knee_right: [120], ankle_left: [15, 0], ankle_right: [15, 0], lumbar: [25, 0, 0] },
  trunk_flex_side_twist: { lumbar: [40, 15, 0], thoracic: [25, 10, 25], pelvis: [10, 0, 0] },
  neck_turn: { neck: [30, 20, 60], head: [15, 0] },
  split: { hip_left: [-15, 40, -30], hip_right: [110, 30, 30], knee_right: [10], toes_left: [50] },
};

beforeAll(() => {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as AnatomyManifest;
  const b = readFileSync(GLB);
  glbBuf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
});

describe('full_body.glb 結構', () => {
  it('manifest 通過 schema 驗證', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('中軸骨架與雙下肢骨骼、關節都存在', async () => {
    const { scene, pose } = await rig();
    const names = new Set<string>();
    scene.traverse((o) => o instanceof THREE.Bone && names.add(o.name));
    for (const b of ['pelvis', 'lumbar', 'chest', 'neck', 'head']) expect(names.has(b), b).toBe(true);
    for (const s of ['l', 'r']) for (const b of ['thigh', 'shin', 'foot', 'toes', 'shoulder', 'upper_arm', 'hand']) expect(names.has(`${b}_${s}`), `${b}_${s}`).toBe(true);
    for (const j of ['pelvis', 'lumbar', 'thoracic', 'neck', 'head', ...SIDES.flatMap((s) => ['hip', 'knee', 'ankle', 'toes', 'shoulder', 'elbow', 'wrist'].map((j) => `${j}_${s}`))])
      expect(pose.getDefinition(j), j).toBeTruthy();
  });

  it('骨盆是根骨骼，上肢掛在胸椎、下肢掛在骨盆', async () => {
    const { scene } = await rig();
    const get = (n: string) => scene.getObjectByName(n) as THREE.Bone;
    expect(get('pelvis').parent instanceof THREE.Bone).toBe(false);
    expect(get('shoulder_l').parent?.name).toBe('chest');
    expect(get('thigh_r').parent?.name).toBe('pelvis');
    expect(get('chest').parent?.name).toBe('lumbar');
  });

  it('每塊骨骼與靜態肌肉都綁到骨架，兩側靜態肌肉成對', async () => {
    const { scene } = await rig();
    const { bones, statics } = byCategory(scene);
    expect(bones.length).toBeGreaterThan(20);
    expect(statics.length).toBeGreaterThanOrEqual(70);
    const ids = new Set(statics.map((m) => m.userData.anatomicalId as string));
    for (const id of ids) {
      if (id.endsWith('_left')) expect(ids.has(id.replace(/_left$/, '_right')), id).toBe(true);
    }
  });

  it('動態肌肉：上肢 30 條 + 軀幹下肢 24 條（M4），皆含三個 morph', async () => {
    const { scene } = await rig();
    expect(manifest.muscles.length).toBe(54);
    const lower = manifest.muscles.filter((m) => !['upper_arm', 'forearm', 'hand'].includes((m as { region?: string }).region ?? ''));
    expect(lower.length).toBeGreaterThanOrEqual(24);
    const muscles = new MuscleSystem(scene, manifest.muscles);
    for (const id of muscles.ids) {
      const dict = muscles.getMesh(id)?.morphTargetDictionary ?? {};
      for (const k of ['bulge', 'shorten', 'stretch']) expect(dict[k], `${id}.${k}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('全身擺姿方向', () => {
  const pos = (scene: THREE.Object3D, n: string) => {
    scene.updateMatrixWorld(true);
    return (scene.getObjectByName(n) as THREE.Bone).getWorldPosition(new THREE.Vector3());
  };
  for (const side of SIDES) {
    const s = side[0];
    it(`${side}：髖屈曲讓膝往前上、膝屈曲讓踝往後、只動該側`, async () => {
      const { scene, pose } = await rig();
      const knee0 = pos(scene, `shin_${s}`), other0 = pos(scene, `foot_${s === 'l' ? 'r' : 'l'}`);
      pose.setAngles({ [`hip_${side}`]: [90, 0, 0] });
      const knee1 = pos(scene, `shin_${s}`);
      expect(knee1.z - knee0.z).toBeGreaterThan(0.3); // GL +Z = 前
      expect(knee1.y - knee0.y).toBeGreaterThan(0.3);
      expect(pos(scene, `foot_${s === 'l' ? 'r' : 'l'}`).distanceTo(other0)).toBeLessThan(1e-6);
      pose.reset();
      const ankle0 = pos(scene, `foot_${s}`);
      pose.setAngles({ [`knee_${side}`]: [90] });
      expect(pos(scene, `foot_${s}`).z - ankle0.z).toBeLessThan(-0.3);
    });
  }

  it('腰椎前屈讓頭往前下，左側屈讓頭往左', async () => {
    const { scene, pose } = await rig();
    const h0 = pos(scene, 'head');
    pose.setAngles({ lumbar: [40, 0, 0] });
    const h1 = pos(scene, 'head');
    expect(h1.z - h0.z).toBeGreaterThan(0.2);
    expect(h1.y).toBeLessThan(h0.y);
    pose.reset();
    pose.setAngles({ lumbar: [0, 20, 0] });
    expect(pos(scene, 'head').x - h0.x).toBeGreaterThan(0.1); // GL +X = 左
  });

  it('上半身轉動時雙手跟著胸椎移動', async () => {
    const { scene, pose } = await rig();
    const l0 = pos(scene, 'hand_l');
    pose.setAngles({ thoracic: [0, 0, 30] });
    expect(pos(scene, 'hand_l').distanceTo(l0)).toBeGreaterThan(0.05);
  });
});

describe('M4：軀幹與下肢動態肌肉的路徑長度隨姿勢變化', () => {
  const state = (muscles: MuscleSystem, id: string) => {
    muscles.update();
    const s = muscles.getState(id)!;
    expect(s, id).toBeTruthy();
    return s;
  };
  const cases: [string, Record<string, number[]>, string[], string[]][] = [
    // [名稱, 姿勢, 應縮短, 應拉長]
    ['膝屈曲 100°', { knee_left: [100] }, ['hamstrings_left'], ['quadriceps_left']],
    ['深蹲（髖 100° + 膝 120°）', { hip_left: [100, 0, 0], knee_left: [120], ankle_left: [15, 0] }, [], ['quadriceps_left', 'gluteus_maximus_left']],
    ['髖屈曲 90°', { hip_left: [90, 0, 0] }, ['iliopsoas_left'], ['hamstrings_left', 'gluteus_maximus_left']],
    ['軀幹前屈 40°', { lumbar: [40, 0, 0], thoracic: [20, 0, 0] }, ['rectus_abdominis_left', 'rectus_abdominis_right'], ['erector_spinae_left', 'erector_spinae_right']],
  ];
  for (const [name, angles, shorter, longer] of cases) {
    it(name, async () => {
      const { scene, pose } = await rig();
      const muscles = new MuscleSystem(scene, manifest.muscles);
      const rest: Record<string, number> = {};
      for (const id of [...shorter, ...longer]) rest[id] = state(muscles, id).length;
      pose.setAngles(angles);
      for (const id of shorter) expect(state(muscles, id).length, `${id} 應縮短`).toBeLessThan(rest[id]! * 0.97);
      for (const id of longer) expect(state(muscles, id).length, `${id} 應拉長`).toBeGreaterThan(rest[id]! * 1.03);
    });
  }
});

describe('M4：腳掌著地', () => {
  const SQUAT = POSES.squat!;
  it('off：骨盆固定，深蹲時雙腳離地', async () => {
    const { scene, pose } = await rig();
    const fp = new FootPlant(scene);
    fp.mode = 'off';
    pose.postApply = () => fp.apply();
    pose.setAngles(SQUAT);
    expect(fp.support('left')!.now.y - fp.groundY).toBeGreaterThan(0.05);
  });

  it('both：深蹲時最低支撐點貼地、雙腳中點不滑動；無外展時每腳滑動 < 1 cm', async () => {
    const { scene, pose } = await rig();
    const fp = new FootPlant(scene);
    pose.postApply = () => fp.apply();
    // 含 10° 外展：兩腳對稱張開（骨盆平移無法抵銷，需腿部 IK），但中點應不動
    pose.setAngles(SQUAT);
    let l = fp.support('left')!, r = fp.support('right')!;
    expect(Math.min(l.now.y, r.now.y) - fp.groundY).toBeCloseTo(0, 3);
    const mid = l.now.clone().add(r.now).sub(l.rest).sub(r.rest).multiplyScalar(0.5);
    expect(Math.hypot(mid.x, mid.z)).toBeLessThan(0.005);
    // 無外展的深蹲：每隻腳都幾乎不滑動
    pose.reset();
    pose.setAngles({ ...SQUAT, hip_left: [100, 0, 0], hip_right: [100, 0, 0] });
    l = fp.support('left')!;
    r = fp.support('right')!;
    for (const s of [l, r]) expect(Math.hypot(s.now.x - s.rest.x, s.now.z - s.rest.z)).toBeLessThan(0.01);
    // 骨盆確實下降
    expect((scene.getObjectByName('pelvis') as THREE.Bone).position.length()).toBeGreaterThan(0);
  });

  it('left：單腳站立抬右腿，左腳支撐點完全不動、右腳離地', async () => {
    const { scene, pose } = await rig();
    const fp = new FootPlant(scene);
    fp.mode = 'left';
    pose.postApply = () => fp.apply();
    pose.setAngles({ hip_right: [90, 0, 0], knee_right: [90], lumbar: [10, 0, 0] });
    const l = fp.support('left')!;
    expect(l.now.distanceTo(l.rest)).toBeLessThan(0.005);
    expect(fp.support('right')!.now.y - fp.groundY).toBeGreaterThan(0.1);
  });

  it('reset 後骨盆回到 rest 位置', async () => {
    const { scene, pose } = await rig();
    const pelvis = scene.getObjectByName('pelvis') as THREE.Bone;
    const p0 = pelvis.position.clone();
    const fp = new FootPlant(scene);
    pose.postApply = () => fp.apply();
    pose.setAngles(SQUAT);
    pose.reset();
    expect(pelvis.position.distanceTo(p0)).toBeLessThan(1e-3);
  });
});

describe('靜態肌肉不脫離骨骼（skinning 後實測）', () => {
  for (const [name, angles] of Object.entries(POSES)) {
    it(name, async () => {
      const { scene, pose } = await rig();
      const rest = restDistances(scene);
      pose.setAngles(angles);
      const res = detachment(scene, rest, 0.015);
      const bad = Object.entries(res).filter(([, r]) => r.frac > 0.05 || r.p95 > 0.02);
      if (process.env.DHA_DEBUG)
        console.log(name, Object.entries(res).sort((a, b) => b[1].p95 - a[1].p95).slice(0, 6).map(([id, r]) => `${id} p95=${(r.p95 * 1000).toFixed(1)}mm frac=${(r.frac * 100).toFixed(1)}%`).join(' | '));
      expect(bad.map(([id, r]) => `${id} p95=${(r.p95 * 1000).toFixed(1)}mm frac=${(r.frac * 100).toFixed(1)}%`)).toEqual([]);
    }, 60000);
  }
});
