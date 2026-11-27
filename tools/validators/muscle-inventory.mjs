#!/usr/bin/env node
/**
 * M4.1：由實際的 manifest 與 GLB 產生肌肉清單（不手寫估計值）。
 * 用法：node tools/validators/muscle-inventory.mjs [glb] [manifest] [out.md]
 * 預設：full_body.glb / full_body_manifest.json → docs/anatomy/muscle-inventory.md
 * 加 --check：不寫檔，只在清單與現有檔案不同時以 exit 1 結束（給 CI 用）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const check = process.argv.includes('--check');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '../..');
const glbPath = args[0] ?? path.join(ROOT, 'apps/web/public/models/full_body.glb');
const manPath = args[1] ?? path.join(ROOT, 'apps/web/public/data/full_body_manifest.json');
const outPath = args[2] ?? path.join(ROOT, 'docs/anatomy/muscle-inventory.md');

const manifest = JSON.parse(readFileSync(manPath, 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(glbPath);

// GLB：每個 node 名稱 → { skinned, morph target 名稱 }
const nodes = new Map();
for (const n of doc.getRoot().listNodes()) {
  const mesh = n.getMesh();
  if (!mesh) continue;
  const names = mesh.getExtras()?.targetNames ?? [];
  const prim = mesh.listPrimitives()[0];
  const nTargets = prim ? prim.listTargets().length : 0;
  nodes.set(n.getName(), { skinned: !!n.getSkin(), morphs: names.length ? names : Array.from({ length: nTargets }, (_, i) => `#${i}`) });
  // 也用 mesh 名稱登記一次（three.js 的 getObjectByName 兩者皆可能命中）
  if (!nodes.has(mesh.getName())) nodes.set(mesh.getName(), nodes.get(n.getName()));
}
const boneNames = new Set(doc.getRoot().listSkins().flatMap((s) => s.listJoints().map((j) => j.getName())));
const jointIds = new Set(manifest.joints.map((j) => j.id));

const rows = [];
const problems = [];
for (const m of manifest.muscles) {
  const pts = [...m.origin, ...m.via_points, ...m.insertion];
  const g = nodes.get(m.mesh);
  const conf = {};
  for (const p of pts) conf[p.confidence] = (conf[p.confidence] ?? 0) + 1;
  const missingBones = pts.map((p) => p.bone).filter((b) => !boneNames.has(b));
  const missingJoints = m.joints_crossed.filter((j) => !jointIds.has(j));
  if (!g) problems.push(`${m.id}: GLB 找不到 mesh ${m.mesh}`);
  else if (!g.skinned) problems.push(`${m.id}: mesh 沒有 skin`);
  for (const k of ['bulge', 'shorten', 'stretch']) if (g && !g.morphs.includes(m.morphs?.[k])) problems.push(`${m.id}: 缺 morph ${k}`);
  if (missingBones.length) problems.push(`${m.id}: 骨骼不存在 ${missingBones.join(',')}`);
  if (missingJoints.length) problems.push(`${m.id}: 關節不存在 ${missingJoints.join(',')}`);
  rows.push({
    id: m.id, region: m.region ?? '', architecture: m.architecture ?? '', profile: m.deformation_profile,
    joints: m.joints_crossed.join(', '), path: pts.map((p) => p.bone).join(' → '),
    conf: Object.entries(conf).map(([k, v]) => `${k}×${v}`).join(', '),
    morphs: g ? g.morphs.join(', ') : '—', skinned: g?.skinned ? 'yes' : 'no',
  });
}

const dynIds = new Set(manifest.muscles.map((m) => m.id));
const structMuscles = (manifest.structures ?? []).filter((s) => s.category === 'muscle');
const staticMuscles = structMuscles.filter((s) => s.static !== false && !dynIds.has(s.id));
const boundDynamic = structMuscles.filter((s) => s.static === false);
const upper = manifest.muscles.filter((m) => ['upper_arm', 'forearm', 'hand', 'elbow'].includes(m.region));
const count = (arr, key) => arr.reduce((a, x) => ((a[x[key] ?? '—'] = (a[x[key] ?? '—'] ?? 0) + 1), a), {});
const fmt = (o) => Object.entries(o).sort().map(([k, v]) => `${k} ${v}`).join('、');

const md = `# 肌肉清單（自動產生）

> 由 \`tools/validators/muscle-inventory.mjs\` 從 \`${path.relative(ROOT, manPath).replace(/\\/g, '/')}\` 與 \`${path.relative(ROOT, glbPath).replace(/\\/g, '/')}\` 產生，請勿手動編輯。
> 所有附著點、經過點與關節範圍都是估計值（confidence 欄），不代表解剖或生理上的精確數據。

## 摘要

| 項目 | 數量 |
|---|---|
| manifest 動態 MuscleDefinition | ${manifest.muscles.length} |
| ├ 上肢動態（upper_arm / forearm / elbow / hand） | ${upper.length} |
| └ 軀幹與下肢動態 | ${manifest.muscles.length - upper.length} |
| 軀幹與下肢肌群 structures（category = muscle） | ${structMuscles.length} |
| ├ 已升級為動態（static: false） | ${boundDynamic.length} |
| └ 靜態（只跟隨骨架做 LBS，沒有 morph） | ${staticMuscles.length} |
| 關節 | ${manifest.joints.length} |
| 握持定義 | ${(manifest.grips ?? []).length} |

- 動態肌肉的 architecture 分佈：${fmt(count(manifest.muscles, 'architecture'))}
- 動態肌肉的 deformation_profile 分佈：${fmt(count(manifest.muscles, 'deformation_profile'))}
- 附著點 confidence 分佈：${fmt(manifest.muscles.flatMap((m) => [...m.origin, ...m.via_points, ...m.insertion]).reduce((a, p) => ((a[p.confidence] = (a[p.confidence] ?? 0) + 1), a), {}))}
- 一致性檢查：${problems.length ? `**${problems.length} 個問題**\n${problems.map((p) => `  - ${p}`).join('\n')}` : '通過（每條動態肌肉的 mesh 有 skin、三個 morph 都在、路徑骨骼與跨越關節都存在）'}

## 動態肌肉（${rows.length}）

| id | 區域 | architecture | profile | 跨越關節 | 路徑骨骼（起點 → 經過點 → 止點） | 附著點 confidence | GLB morph targets | skinned |
|---|---|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.id} | ${r.region} | ${r.architecture} | ${r.profile} | ${r.joints} | ${r.path} | ${r.conf} | ${r.morphs} | ${r.skinned} |`).join('\n')}

## 靜態肌群（${staticMuscles.length}）

| id | 中文名 | 區域 | 綁定骨骼 |
|---|---|---|---|
${staticMuscles.map((s) => `| ${s.id} | ${s.name_zh ?? ''} | ${s.region ?? ''} | ${(s.bones ?? []).join(', ')} |`).join('\n')}

## 腳掌著地（FootPlant）接觸約束

腳掌著地不是存在 manifest 裡的資料，而是 \`apps/web/src/skeleton/FootPlant.ts\` 在載入時從 rest pose 的足部骨骼網格推算的：

| 腳 | 接觸點 | 綁定骨骼 | 推算方式 |
|---|---|---|---|
| 左 / 右 | heel（腳跟） | foot_l / foot_r | \`foot_skeleton_*\` 底面 1.5 cm 內最後方的最低點 |
| 左 / 右 | ball（蹠骨頭下方） | foot_l / foot_r | 同一底面最前方的最低點 |
| 左 / 右 | toe（趾尖） | toes_l / toes_r | \`toe_bones_*\` 最前方的頂點 |

- 地面高度 = rest pose 所有接觸點中最低的 y。
- 這是 **root translation**（只平移骨盆）的著地，不是多關節足部 IK：不會改任何關節角度，所以當姿勢讓兩腳在水平方向互相分開（例如髖外展）時，雙腳模式只能讓兩腳中點不動，各腳仍會滑動。
`;

if (check) {
  const cur = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  if (cur.replace(/\r\n/g, '\n') !== md) {
    console.error(`INVENTORY_STALE ${outPath}：請執行 node tools/validators/muscle-inventory.mjs`);
    process.exit(1);
  }
  console.log('INVENTORY_UP_TO_DATE');
} else {
  writeFileSync(outPath, md);
  console.log(`INVENTORY_OK ${outPath} dynamic=${manifest.muscles.length} static=${staticMuscles.length} problems=${problems.length}`);
}
if (problems.length) process.exit(2);
