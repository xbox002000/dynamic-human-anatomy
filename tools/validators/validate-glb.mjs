#!/usr/bin/env node
// GLB 自動檢查（藍圖 §9 Step 8）：載入、骨骼命名、Skin、Morph Targets、左右側、anatomicalId。
import { NodeIO } from '@gltf-transform/core';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2] ?? 'apps/web/public/models/arm_sample.glb';
const manifestPath = process.argv[3] ?? 'apps/web/public/data/arm_manifest.json';

const REQUIRED_BONES = ['shoulder_l', 'upper_arm_l', 'forearm_l', 'hand_l'];
const errors = [];
const warn = [];
const ok = (m) => console.log('  ✔ ' + m);

const io = new NodeIO();
let doc;
try {
  doc = await io.read(path.resolve(file));
  ok(`載入成功：${file}`);
} catch (e) {
  console.error('✘ GLB 載入失敗', e);
  process.exit(1);
}
const root = doc.getRoot();

// 骨骼
const skins = root.listSkins();
if (skins.length === 0) errors.push('沒有 Skin');
const jointNames = new Set(skins.flatMap((s) => s.listJoints().map((j) => j.getName())));
for (const b of REQUIRED_BONES) if (!jointNames.has(b)) errors.push(`缺少骨骼 ${b}`);
if (errors.length === 0) ok(`骨骼：${[...jointNames].join(', ')}`);

// 左右側命名一致性
for (const n of jointNames) {
  if (n.endsWith('_l') && n.includes('right')) errors.push(`骨骼 ${n} 左右矛盾`);
}

// Meshes
const meshNodes = root.listNodes().filter((n) => n.getMesh());
const byName = new Map(meshNodes.map((n) => [n.getName(), n]));
for (const n of meshNodes) {
  const name = n.getName();
  const extras = n.getExtras() ?? {};
  if (!n.getSkin()) errors.push(`${name}: 未綁定 Skin`);
  if (extras.anatomicalId && extras.anatomicalId !== name) warn.push(`${name}: extras.anatomicalId=${extras.anatomicalId} 與名稱不同`);
  if (!extras.anatomicalId) warn.push(`${name}: 缺少 extras.anatomicalId`);
  if (name.endsWith('_left') && name.includes('right')) errors.push(`${name}: 左右矛盾`);
  // skin weights 檢查
  for (const prim of n.getMesh().listPrimitives()) {
    const w = prim.getAttribute('WEIGHTS_0');
    if (!w) { errors.push(`${name}: 缺少 WEIGHTS_0`); continue; }
    const el = [];
    let bad = 0;
    for (let i = 0; i < w.getCount(); i++) {
      w.getElement(i, el);
      const s = el.reduce((a, b) => a + b, 0);
      if (Math.abs(s - 1) > 0.01) bad++;
    }
    if (bad) errors.push(`${name}: ${bad} 個頂點權重總和 ≠ 1`);
  }
}
ok(`Mesh 數量：${meshNodes.length}（${[...byName.keys()].join(', ')}）`);

// Manifest 交叉檢查
if (existsSync(manifestPath)) {
  const man = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const m of man.muscles ?? []) {
    const node = byName.get(m.mesh);
    if (!node) { errors.push(`manifest ${m.id}: GLB 中找不到 mesh ${m.mesh}`); continue; }
    const targetNames = node.getMesh().getExtras()?.targetNames ?? [];
    for (const key of Object.values(m.morphs ?? {})) {
      if (!targetNames.includes(key)) errors.push(`${m.id}: 缺少 morph target ${key}`);
    }
    for (const a of [...m.origin, ...m.insertion, ...m.via_points]) {
      if (!jointNames.has(a.bone)) errors.push(`${m.id}: 附著骨骼 ${a.bone} 不存在`);
    }
  }
  ok(`manifest 交叉檢查：${(man.muscles ?? []).length} 條肌肉`);
} else {
  warn.push(`找不到 manifest ${manifestPath}，略過交叉檢查`);
}

for (const w of warn) console.log('  ⚠ ' + w);
if (errors.length) {
  for (const e of errors) console.error('  ✘ ' + e);
  console.error(`\n驗證失敗：${errors.length} 個錯誤`);
  process.exit(1);
}
console.log('\nGLB 驗證通過');
