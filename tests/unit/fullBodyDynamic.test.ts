/**
 * M4.1：全身動態肌肉與 FootPlant 的整合測試（真實 full_body.glb）。
 * 只驗證幾何與資料一致性（路徑長度方向、morph 驅動、著地平移），不代表生理準確度。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnatomyManifest, MuscleDefinition } from '../../packages/anatomy-schema/src/index';
import { PoseController } from '../../apps/web/src/skeleton/PoseController';
import { MuscleSystem } from '../../apps/web/src/muscles/MuscleSystem';
import { FootPlant } from '../../apps/web/src/skeleton/FootPlant';

const ROOT = path.resolve(__dirname, '../..');
const GLB = path.join(ROOT, 'apps/web/public/models/full_body.glb');
const MANIFEST = path.join(ROOT, 'apps/web/public/data/full_body_manifest.json');

let manifest: AnatomyManifest;
let glbBuf: ArrayBuffer;

beforeAll(() => {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as AnatomyManifest;
  const b = readFileSync(GLB);
  glbBuf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
});

async function rig() {
  const gltf = await new GLTFLoader().parseAsync(glbBuf.slice(0), '');
  const scene = gltf.scene;
  const pose = new PoseController(scene, manifest.joints);
  pose.reset();
  const muscles = new MuscleSystem(scene, manifest.muscles);
  return { scene, pose, muscles };
}

const weights = (muscles: MuscleSystem, def: MuscleDefinition) => {
  const mesh = muscles.getMesh(def.id)!;
  const dict = mesh.morphTargetDictionary!;
  const inf = mesh.morphTargetInfluences!;
  return { bulge: inf[dict[def.morphs!.bulge!]!]!, shorten: inf[dict[def.morphs!.shorten!]!]!, stretch: inf[dict[def.morphs!.stretch!]!]! };
};

describe('M4.1：每條動態肌肉的資料與 GLB 一致', () => {
  it('mesh 是 SkinnedMesh、三個 morph 存在、路徑骨骼存在、長度有限且為正、confidence 皆為 approximate', async () => {
    const { scene, muscles } = await rig();
    expect(manifest.muscles.length).toBe(54);
    const bad: string[] = [];
    for (const def of manifest.muscles) {
      const mesh = muscles.getMesh(def.id);
      if (!(mesh instanceof THREE.SkinnedMesh)) bad.push(`${def.id}: 不是 SkinnedMesh`);
      const dict = mesh?.morphTargetDictionary ?? {};
      for (const k of ['bulge', 'shorten', 'stretch'] as const) {
        const name = def.morphs?.[k];
        if (!name || dict[name] === undefined) bad.push(`${def.id}: 缺 morph ${k}`);
      }
      const pts = [...def.origin, ...def.via_points, ...def.insertion];
      for (const p of pts) {
        if (!(scene.getObjectByName(p.bone) instanceof THREE.Bone)) bad.push(`${def.id}: 骨骼 ${p.bone} 不存在`);
        if (p.confidence !== 'approximate') bad.push(`${def.id}: confidence=${p.confidence}（估計資料必須標為 approximate）`);
      }
      if (def.origin.length < 1 || def.insertion.length < 1) bad.push(`${def.id}: 缺起點或止點`);
      const s = muscles.getState(def.id)!;
      if (!Number.isFinite(s.restLength) || s.restLength <= 0.005) bad.push(`${def.id}: restLength=${s.restLength}`);
      for (const j of def.joints_crossed) if (!manifest.joints.some((x) => x.id === j)) bad.push(`${def.id}: 關節 ${j} 不存在`);
    }
    expect(bad).toEqual([]);
  });

  it('rest pose 下所有肌肉 shorten / stretch 權重約為 0', async () => {
    const { muscles } = await rig();
    muscles.update();
    for (const def of manifest.muscles) {
      const w = weights(muscles, def);
      expect(w.shorten, def.id).toBeLessThan(1e-3);
      expect(w.stretch, def.id).toBeLessThan(1e-3);
    }
  });

  it('activation 不改變幾何縮短，只獨立改變 bulge', async () => {
    const { pose, muscles } = await rig();
    // 一個讓多數肌肉長度偏離 rest 的混合姿勢
    pose.setAngles({ elbow_left: [90], elbow_right: [60], hip_left: [60, 10, 0], knee_left: [70], ankle_left: [-20, 0], lumbar: [20, 0, 0], wrist_left: [30, 0] });
    const ids = manifest.muscles.map((m) => m.id);
    muscles.setActivations(Object.fromEntries(ids.map((id) => [id, 0])));
    const off = new Map(manifest.muscles.map((d) => [d.id, { s: muscles.getState(d.id)!, w: weights(muscles, d) }]));
    muscles.setActivations(Object.fromEntries(ids.map((id) => [id, 1])));
    const bad: string[] = [];
    for (const d of manifest.muscles) {
      const a = off.get(d.id)!, s = muscles.getState(d.id)!, w = weights(muscles, d);
      if (Math.abs(s.length - a.s.length) > 1e-9) bad.push(`${d.id}: length 隨 activation 改變`);
      if (Math.abs(s.contraction - a.s.contraction) > 1e-9) bad.push(`${d.id}: contraction 隨 activation 改變`);
      if (Math.abs(w.shorten - a.w.shorten) > 1e-9) bad.push(`${d.id}: shorten 權重隨 activation 改變`);
      if (!(w.bulge > a.w.bulge + 0.3)) bad.push(`${d.id}: bulge 沒有隨 activation 上升 (${a.w.bulge.toFixed(3)} → ${w.bulge.toFixed(3)})`);
    }
    expect(bad).toEqual([]);
  });

  it('擺動所跨越的關節時，每條肌肉的 shorten 或 stretch 權重會更新', async () => {
    const { pose, muscles } = await rig();
    const bad: string[] = [];
    for (const def of manifest.muscles) {
      let best = 0;
      for (const jid of def.joints_crossed) {
        const j = pose.getDefinition(jid)!;
        j.limits.forEach((lim, axis) => {
          for (const deg of [lim.minDeg, lim.maxDeg]) {
            const v = j.limits.map((_, i) => (i === axis ? deg : j.restDeg[i] ?? 0));
            pose.reset();
            pose.setAngles({ [jid]: v });
            muscles.update();
            const w = weights(muscles, def);
            best = Math.max(best, w.shorten, w.stretch);
          }
        });
      }
      if (best < 0.02) bad.push(`${def.id}: 跨越關節走到極限，形變權重最大只有 ${best.toFixed(4)}`);
    }
    pose.reset();
    expect(bad).toEqual([]);
  });
});

describe('M4.1：更多下肢與軀幹肌群的路徑長度方向', () => {
  // [名稱, 姿勢, 應縮短, 應拉長]
  const cases: [string, Record<string, number[]>, string[], string[]][] = [
    ['髖外展 40°', { hip_left: [0, 40, 0] }, [], ['adductors_left']],
    ['髖內收 −25°', { hip_left: [0, -25, 0] }, ['adductors_left'], []],
    ['踝背屈 20°', { ankle_left: [20, 0] }, ['tibialis_anterior_left'], ['gastrocnemius_left', 'soleus_left']],
    ['踝蹠屈 −40°', { ankle_left: [-40, 0] }, ['gastrocnemius_left', 'soleus_left'], ['tibialis_anterior_left']],
    ['膝屈曲 90°（踝不動）：腓腸肌跨膝而縮短，比目魚肌不跨膝', { knee_left: [90] }, ['gastrocnemius_left'], []],
    ['軀幹左側屈', { lumbar: [0, 20, 0], thoracic: [0, 20, 0] }, ['abdominal_obliques_left'], ['abdominal_obliques_right']],
    ['軀幹右側屈', { lumbar: [0, -20, 0], thoracic: [0, -20, 0] }, ['abdominal_obliques_right'], ['abdominal_obliques_left']],
    ['軀幹前屈 40°', { lumbar: [40, 0, 0], thoracic: [20, 0, 0] }, ['abdominal_obliques_left', 'abdominal_obliques_right'], []],
  ];
  for (const [name, angles, shorter, longer] of cases) {
    it(name, async () => {
      const { pose, muscles } = await rig();
      muscles.update();
      const rest = new Map([...shorter, ...longer].map((id) => [id, muscles.getState(id)!.length]));
      pose.setAngles(angles);
      muscles.update();
      for (const id of shorter) expect(muscles.getState(id)!.length, `${id} 應縮短`).toBeLessThan(rest.get(id)! * 0.98);
      for (const id of longer) expect(muscles.getState(id)!.length, `${id} 應拉長`).toBeGreaterThan(rest.get(id)! * 1.02);
    });
  }

  it('比目魚肌不跨膝：只屈膝時長度不變', async () => {
    const { pose, muscles } = await rig();
    muscles.update();
    const l0 = muscles.getState('soleus_left')!.length;
    pose.setAngles({ knee_left: [90] });
    muscles.update();
    // 浮點誤差（矩陣串接）約 1e-6 量級；路徑真正變化會在 1e-2 量級
    expect(Math.abs(muscles.getState('soleus_left')!.length / l0 - 1)).toBeLessThan(1e-4);
  });
});

/**
 * FootPlant 是 root translation：只平移骨盆，不改任何關節角度。
 * 它不是多關節足部 IK；兩腳在水平方向被姿勢拉開時（例如髖外展），雙腳模式只能讓「中點」不動，
 * 各腳會滑動，以下測試會把這個滑動量明確量出來，而不是假設它為 0。
 */
describe('M4.1：FootPlant（root translation 著地）', () => {
  async function planted(mode: 'off' | 'both' | 'left' | 'right') {
    const r = await rig();
    const fp = new FootPlant(r.scene);
    fp.mode = mode;
    r.pose.postApply = () => fp.apply();
    r.pose.reset();
    return { ...r, fp, pelvis: r.scene.getObjectByName('pelvis') as THREE.Bone };
  }
  const slip = (s: { now: THREE.Vector3; rest: THREE.Vector3 }) => Math.hypot(s.now.x - s.rest.x, s.now.z - s.rest.z);

  it('rest pose：兩種單腳與雙腳模式的骨盆位移都是 0、支撐點在地面', async () => {
    for (const mode of ['both', 'left', 'right'] as const) {
      const { fp, pelvis } = await planted(mode);
      const p0 = pelvis.position.clone();
      fp.apply();
      expect(pelvis.position.distanceTo(p0), mode).toBeLessThan(1e-6);
      for (const side of ['left', 'right'] as const) expect(fp.support(side)!.now.y - fp.groundY, `${mode}/${side}`).toBeCloseTo(0, 4);
    }
  });

  for (const side of ['left', 'right'] as const) {
    const other = side === 'left' ? 'right' : 'left';
    it(`${side} 單腳支撐：抬起 ${other} 腿時 ${side} 腳支撐點不動、${other} 腳離地`, async () => {
      const { pose, fp } = await planted(side);
      pose.setAngles({ [`hip_${other}`]: [90, 0, 0], [`knee_${other}`]: [90], lumbar: [10, 0, 0] });
      const s = fp.support(side)!;
      expect(s.now.distanceTo(s.rest)).toBeLessThan(0.005);
      expect(fp.support(other)!.now.y - fp.groundY).toBeGreaterThan(0.1);
    });

    it(`${side} 單腳支撐 + 同側髖外展 30°：支撐腳仍固定（另一腳不保證著地）`, async () => {
      const { pose, fp } = await planted(side);
      pose.setAngles({ [`hip_${side}`]: [0, 30, 0] });
      const s = fp.support(side)!;
      expect(s.now.distanceTo(s.rest)).toBeLessThan(0.005);
    });
  }

  it('雙腳支撐：對稱深蹲（無外展）兩腳都貼地且幾乎不滑動', async () => {
    const { pose, fp } = await planted('both');
    pose.setAngles({ hip_left: [100, 0, 0], hip_right: [100, 0, 0], knee_left: [120], knee_right: [120], ankle_left: [15, 0], ankle_right: [15, 0], lumbar: [25, 0, 0] });
    for (const side of ['left', 'right'] as const) {
      const s = fp.support(side)!;
      expect(s.now.y - fp.groundY, side).toBeLessThan(0.005);
      expect(slip(s), side).toBeLessThan(0.01);
    }
  });

  it('雙腳支撐 + 雙髖外展 20°：中點不動，但各腳會滑動（root translation 的已知限制）', async () => {
    const { pose, fp } = await planted('both');
    pose.setAngles({ hip_left: [0, 20, 0], hip_right: [0, 20, 0] });
    const l = fp.support('left')!, r = fp.support('right')!;
    const mid = l.now.clone().add(r.now).sub(l.rest).sub(r.rest).multiplyScalar(0.5);
    expect(Math.hypot(mid.x, mid.z)).toBeLessThan(0.005);
    expect(Math.min(l.now.y, r.now.y) - fp.groundY).toBeCloseTo(0, 3);
    // 骨盆平移無法同時抵銷兩腳往外張開：這裡確認滑動量確實存在，並記錄其大小
    expect(slip(l)).toBeGreaterThan(0.01);
    expect(slip(r)).toBeGreaterThan(0.01);
  });

  it('雙腳支撐 + 單側髖外展：最低支撐點貼地、另一腳可能離地', async () => {
    const { pose, fp } = await planted('both');
    pose.setAngles({ hip_left: [0, 30, 0] });
    const l = fp.support('left')!, r = fp.support('right')!;
    expect(Math.min(l.now.y, r.now.y) - fp.groundY).toBeCloseTo(0, 3);
    expect(Math.max(l.now.y, r.now.y) - fp.groundY).toBeGreaterThanOrEqual(-1e-4);
  });

  it('踝蹠屈（墊腳）：支撐點換成前足 / 趾尖，仍貼地，骨盆上升', async () => {
    const { pose, fp, pelvis, scene } = await planted('both');
    scene.updateMatrixWorld(true);
    const y0 = pelvis.getWorldPosition(new THREE.Vector3()).y;
    pose.setAngles({ ankle_left: [-40, 0], ankle_right: [-40, 0] });
    const l = fp.support('left')!;
    expect(l.now.y - fp.groundY).toBeCloseTo(0, 3);
    expect(pelvis.getWorldPosition(new THREE.Vector3()).y - y0).toBeGreaterThan(0.02);
  });

  it('踝背屈：支撐點換成腳跟，仍貼地', async () => {
    const { pose, fp } = await planted('both');
    pose.setAngles({ ankle_left: [20, 0], ankle_right: [20, 0] });
    expect(Math.min(fp.support('left')!.now.y, fp.support('right')!.now.y) - fp.groundY).toBeCloseTo(0, 3);
  });

  it('reset 後骨盆回到 rest 位置（所有模式）', async () => {
    for (const mode of ['both', 'left', 'right', 'off'] as const) {
      const { pose, pelvis } = await planted(mode);
      const p0 = pelvis.position.clone();
      pose.setAngles({ hip_left: [100, 10, 0], knee_left: [120], hip_right: [40, 0, 0], ankle_left: [15, 0] });
      pose.reset();
      expect(pelvis.position.distanceTo(p0), mode).toBeLessThan(1e-4);
    }
  });

  it('重複套用同一姿勢不會累積漂移', async () => {
    const { pose, fp, pelvis } = await planted('both');
    const angles = { hip_left: [100, 10, 0], hip_right: [100, 10, 0], knee_left: [120], knee_right: [120], ankle_left: [15, 0], ankle_right: [15, 0] };
    pose.setAngles(angles);
    const p1 = pelvis.position.clone();
    for (let i = 0; i < 50; i++) {
      pose.setAngles(angles);
      fp.apply();
    }
    expect(pelvis.position.distanceTo(p1)).toBeLessThan(1e-6);
  });

  it('off 模式：骨盆完全不動', async () => {
    const { pose, pelvis } = await planted('off');
    const p0 = pelvis.position.clone();
    pose.setAngles({ hip_left: [100, 0, 0], knee_left: [120] });
    expect(pelvis.position.distanceTo(p0)).toBeLessThan(1e-9);
  });
});
