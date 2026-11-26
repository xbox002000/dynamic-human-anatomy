#!/usr/bin/env node
// 從 anatomy-explorer（Z-Anatomy 衍生，CC BY-SA 4.0）的分層 GLB 抽出指定結構，
// 解壓 meshopt / 反量化後輸出成 Blender 可直接匯入的單一 GLB。
// 用法：node tools/model_optimizer/extract-parts.mjs <out.glb> <regex> <in1.glb> [in2.glb ...]
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, mergeDocuments, prune, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const [out, pattern, ...inputs] = process.argv.slice(2);
if (!out || !pattern || inputs.length === 0) {
  console.error('用法：extract-parts.mjs <out.glb> <regex> <in.glb...>');
  process.exit(2);
}
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const re = new RegExp(pattern, 'i');

const target = new Document();
target.createBuffer();
const scene = target.createScene('parts');
let kept = 0;

for (const file of inputs) {
  const doc = await io.read(file);
  await doc.transform(dequantize());
  // 移除不符合的 mesh node（保留其世界變換資訊：這些 GLB 的 mesh 皆為根節點）
  for (const n of doc.getRoot().listNodes()) {
    if (n.getMesh() && !re.test(n.getName())) n.dispose();
  }
  await doc.transform(prune());
  const layer = file.replace(/^.*[\\/]/, '').replace(/\.glb$/i, '');
  for (const n of doc.getRoot().listNodes()) {
    if (!n.getMesh()) continue;
    n.setExtras({ ...(n.getExtras() ?? {}), sourceLayer: layer, sourceName: n.getName() });
    kept++;
  }
  mergeDocuments(target, doc);
}

// merge 會帶入每份文件的 scene；把所有 mesh node 收進同一個 scene
for (const s of target.getRoot().listScenes()) {
  if (s === scene) continue;
  for (const child of s.listChildren()) scene.addChild(child);
  s.dispose();
}
target.getRoot().setDefaultScene(scene);
for (const ext of target.getRoot().listExtensionsUsed()) ext.dispose();
await target.transform(unpartition(), prune());
await new NodeIO().write(out, target);
console.log(`EXTRACT_OK ${kept} nodes -> ${out}`);
for (const n of scene.listChildren()) console.log('  ' + n.getName());
