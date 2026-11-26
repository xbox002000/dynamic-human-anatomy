/**
 * M2.6：真實 GLB 測試（Z-Anatomy 雙側上肢）。
 * 直接在 Node 用 three 的 GLTFLoader 解析 apps/web/public/models/upper_limbs.glb，
 * 以真實骨骼與肌肉驗證：兩側結構、肌肉長度隨姿勢、activation 不驅動縱向縮短、握持接觸一致、雙側 IK 獨立。
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
import { GripController } from '../../apps/web/src/skeleton/GripController';
import { IKController } from '../../apps/web/src/skeleton/IKController';

const ROOT = path.resolve(__dirname, '../..');
const GLB = path.join(ROOT, 'apps/web/public/models/upper_limbs.glb');
const MANIFEST = path.join(ROOT, 'apps/web/public/data/upper_limbs_manifest.json');
const SIDES = [
  { side: 'left', s: 'l' },
  { side: 'right', s: 'r' },
] as const;

let scene: THREE.Object3D;
let manifest: AnatomyManifest;

async function loadScene(): Promise<THREE.Object3D> {
  const buf = readFileSync(GLB);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new GLTFLoader().parseAsync(ab, '');
  return gltf.scene;
}

/**
 * 每個測試都用重新解析的場景：PoseController 建構時會把骨骼「目前」的旋轉當作 rest，
 * 共用場景會讓上一個測試留下的姿勢污染下一個測試。
 */
async function rig() {
  scene = await loadScene();
  const pose = new PoseController(scene, manifest.joints);
  pose.reset();
  const muscles = new MuscleSystem(scene, manifest.muscles);
  pose.subscribe(() => muscles.update());
  muscles.update();
  return { pose, muscles };
}

beforeAll(async () => {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as AnatomyManifest;
  scene = await loadScene();
});

describe('upper_limbs.glb 結構（雙側）', async () => {
  it('manifest 通過 schema 驗證', async () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('兩側主要骨骼與手指骨骼都存在', async () => {
    for (const { s } of SIDES) {
      for (const b of ['shoulder', 'upper_arm', 'forearm', 'hand', 'thumb_mc', 'thumb_prox', 'thumb_dist']) {
        expect(scene.getObjectByName(`${b}_${s}`), `${b}_${s}`).toBeInstanceOf(THREE.Bone);
      }
      for (const f of ['index', 'middle', 'ring', 'little']) {
        for (const seg of ['prox', 'mid', 'dist']) {
          expect(scene.getObjectByName(`${f}_${seg}_${s}`), `${f}_${seg}_${s}`).toBeInstanceOf(THREE.Bone);
        }
      }
    }
  });

  it('每條肌肉都是 SkinnedMesh，有 bulge / shorten / stretch morph，附著骨骼存在', async () => {
    for (const m of manifest.muscles) {
      const mesh = scene.getObjectByName(m.mesh);
      expect(mesh, m.mesh).toBeInstanceOf(THREE.SkinnedMesh);
      const dict = (mesh as THREE.SkinnedMesh).morphTargetDictionary ?? {};
      for (const k of ['bulge', 'shorten', 'stretch']) expect(dict[k], `${m.id}.${k}`).toBeTypeOf('number');
      for (const a of [...m.origin, ...m.via_points, ...m.insertion]) {
        expect(scene.getObjectByName(a.bone), `${m.id} → ${a.bone}`).toBeInstanceOf(THREE.Bone);
        expect(a.bone.endsWith(m.side === 'left' ? '_l' : '_r') || a.bone === 'chest', `${m.id} 附著骨骼 ${a.bone} 側別`).toBe(true);
      }
    }
  });

  it('左右肌肉一一對應，起點左右鏡像（x 號相反）', async () => {
    const left = manifest.muscles.filter((m) => m.side === 'left');
    const right = manifest.muscles.filter((m) => m.side === 'right');
    expect(left.length).toBe(right.length);
    expect(left.length).toBeGreaterThan(0);
    for (const l of left) {
      const r = manifest.muscles.find((m) => m.id === l.id.replace(/_left$/, '_right'));
      expect(r, l.id).toBeDefined();
      const lx = l.origin[0]!.position[0];
      const rx = r!.origin[0]!.position[0];
      expect(Math.sign(lx), l.id).toBe(-Math.sign(rx));
      expect(Math.abs(Math.abs(lx) - Math.abs(rx)), `${l.id} 鏡像誤差`).toBeLessThan(0.03);
    }
  });
});

describe('肌肉長度隨姿勢（真實骨骼）', async () => {
  for (const { side } of SIDES) {
    it(`${side}：肘屈曲 0→120°，二頭肌縮短、三頭肌拉長，另一側不變`, async () => {
      const { pose, muscles } = await rig();
      const other = side === 'left' ? 'right' : 'left';
      const len = (id: string) => muscles.getState(id)!.length;
      const bi0 = len(`biceps_brachii_${side}`);
      const tri0 = len(`triceps_brachii_${side}`);
      const otherBi0 = len(`biceps_brachii_${other}`);
      pose.setAngle(`elbow_${side}`, 0, 120);
      expect(len(`biceps_brachii_${side}`)).toBeLessThan(bi0 * 0.97);
      expect(len(`triceps_brachii_${side}`)).toBeGreaterThan(tri0);
      expect(len(`biceps_brachii_${other}`)).toBeCloseTo(otherBi0, 6);
    });
  }

  it('activation 不改變長度，也不改變 shorten morph 權重（只改 bulge）', async () => {
    const { pose, muscles } = await rig();
    pose.setAngle('elbow_left', 0, 60);
    const id = 'biceps_brachii_left';
    const mesh = muscles.getMesh(id)!;
    const dict = mesh.morphTargetDictionary!;
    muscles.setActivation(id, 0);
    const s0 = muscles.getState(id)!;
    const shorten0 = mesh.morphTargetInfluences![dict.shorten!]!;
    const bulge0 = mesh.morphTargetInfluences![dict.bulge!]!;
    muscles.setActivation(id, 1);
    const s1 = muscles.getState(id)!;
    expect(s1.length).toBeCloseTo(s0.length, 9);
    expect(s1.contraction).toBe(s0.contraction);
    expect(mesh.morphTargetInfluences![dict.shorten!]).toBe(shorten0);
    expect(mesh.morphTargetInfluences![dict.bulge!]!).toBeGreaterThan(bulge0);
  });
});

describe('GripController：接觸狀態與實際手指姿勢一致', async () => {
  for (const { side } of SIDES) {
    it(`${side}：握緊後每指接觸、不穿透；張開某指後該指回報未接觸`, async () => {
      const { pose } = await rig();
      const def = manifest.grips!.find((g) => g.side === side)!;
      const grip = new GripController(scene, pose, def);
      const res = grip.solve(1);
      const tol = GripController.CONTACT_TOLERANCE;
      // solve 回傳的接觸 = 依最終姿勢量測的接觸
      expect(res.contact).toEqual(grip.measure().contact);
      for (const [f, g] of Object.entries(res.gap)) {
        expect(g, `${f} 穿透握把`).toBeGreaterThan(-tol);
        if (res.contact[f]) expect(g, `${f} 標為接觸但有間隙`).toBeLessThanOrEqual(tol);
      }
      const touched = Object.values(res.contact).filter(Boolean).length;
      expect(touched, `${side} 接觸指數 ${JSON.stringify(res.contact)} gap=${JSON.stringify(res.gap)}`).toBeGreaterThanOrEqual(4);

      // 改變實際姿勢：把一根接觸中的長指（非拇指；拇指 rest 本來就壓在握把位置）完全伸直
      const finger = def.fingers.find((f) => f.id !== 'thumb' && res.contact[f.id])!;
      expect(finger, '至少一根長指接觸').toBeDefined();
      for (const j of finger.joints) pose.setAngle(j, 0, 0, true);
      const after = grip.measure();
      expect(after.contact[finger.id]).toBe(false);
      expect(after.gap[finger.id]!).toBeGreaterThan(tol);

      // 半握（closure 0.5）時不應回報全部接觸
      const half = grip.solve(0.5);
      expect(Object.values(half.contact).filter(Boolean).length).toBeLessThan(touched);
      grip.release();
      expect(Object.values(grip.measure().contact).some(Boolean)).toBe(false);
    });
  }
});

describe('雙側 IK：左右手獨立', async () => {
  for (const { side, s } of SIDES) {
    it(`${side}：拖曳到可達目標，誤差 < 5 mm，另一側手部不動`, async () => {
      const { pose } = await rig();
      pose.setAngle(`elbow_${side}`, 0, 30);
      const other = SIDES.find((x) => x.side !== side)!;
      const ik = new IKController(scene, pose, { effector: `hand_${s}`, joints: [`shoulder_${side}`, `elbow_${side}`] });
      const otherIk = new IKController(scene, pose, { effector: `hand_${other.s}`, joints: [`shoulder_${other.side}`, `elbow_${other.side}`] });
      const otherBefore = otherIk.effectorWorld();
      const target = ik.effectorWorld().add(new THREE.Vector3(0, 0.06, 0.06));
      const err = ik.solve(target, 60);
      expect(err).toBeLessThan(0.005);
      expect(otherIk.effectorWorld().distanceTo(otherBefore)).toBeLessThan(1e-6);
      // 只動到該側關節
      expect(pose.getAngles(`shoulder_${other.side}`).every((a) => a === 0)).toBe(true);
    });
  }
});
