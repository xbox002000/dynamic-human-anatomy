#!/usr/bin/env node
// 列出 GLB 內 mesh 節點名稱、三角形數與包圍盒，可用正規表示式過濾。
// 用法：node tools/validators/inspect-glb.mjs <file.glb> [regex]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [file, pattern] = process.argv.slice(2);
const LIMIT = Number(process.env.INSPECT_LIMIT || 80);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const re = pattern ? new RegExp(pattern, 'i') : null;
const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
console.log(`mesh nodes: ${nodes.length}, extensions: ${doc.getRoot().listExtensionsUsed().map((e) => e.extensionName).join(', ')}`);
let shown = 0;
for (const n of nodes) {
  const name = n.getName();
  if (re && !re.test(name)) continue;
  let tris = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of n.getMesh().listPrimitives()) {
    const idx = p.getIndices();
    const pos = p.getAttribute('POSITION');
    tris += (idx ? idx.getCount() : pos.getCount()) / 3;
    const mn = pos.getMin([]);
    const mx = pos.getMax([]);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], mn[i]); max[i] = Math.max(max[i], mx[i]); }
  }
  const t = n.getTranslation();
  const s = n.getScale();
  const r = n.getRotation();
  console.log(`${name}\t tris=${tris}\t min=${min.map((v) => v.toFixed(3))}\t max=${max.map((v) => v.toFixed(3))}\t T=${t.map((v) => v.toFixed(3))} R=${r.map((v) => v.toFixed(2))} S=${s.map((v) => v.toFixed(3))}\t parent=${n.getParentNode()?.getName() ?? '-'}\t extras=${JSON.stringify(n.getExtras())}`);
  if (++shown >= LIMIT) { console.log('... (truncated)'); break; }
}
