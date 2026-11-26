#!/usr/bin/env node
// M3 全身管線：依 full_body_parts.json（extends upper_limbs_parts.json）抽出 Z-Anatomy 零件 → Blender 綁定 → GLB 驗證
// 用法：node tools/pipeline/full-body.mjs [--skip-extract]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const cfgPath = path.join(root, 'tools/pipeline/full_body_parts.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const base = JSON.parse(readFileSync(path.join(root, 'tools/pipeline', cfg.extends), 'utf8'));
const src = path.join(root, 'assets/source/anatomy-explorer/public/models');
const raw = path.join(root, 'assets/working/zanatomy_full_body.glb');
const outGlb = path.join(root, 'apps/web/public/models/full_body.glb');
const outManifest = path.join(root, 'apps/web/public/data/full_body_manifest.json');
const outBlend = path.join(root, 'assets/working/full_body.blend');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = [
  ...Object.values(base.bones).flatMap((b) => b.parts),
  ...base.muscles.flatMap((m) => m.parts),
  ...cfg.body.bones.flatMap((b) => b.parts),
  ...cfg.body.muscles.flatMap((m) => m.parts),
];
// 中線結構沒有後綴，因此後綴為選擇性
const regex = `^(${[...new Set(names)].map(esc).join('|')})(\\.(l|r))?$`;

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.map((a) => (a.length > 80 ? a.slice(0, 77) + '...' : a)).join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!process.argv.includes('--skip-extract')) {
  run(process.execPath, ['tools/model_optimizer/extract-parts.mjs', raw, regex, path.join(src, 'skeleton.glb'), path.join(src, 'muscles.glb')]);
}
run(process.execPath, ['tools/blender/run-blender.mjs', 'tools/blender/build_upper_limbs.py', raw, cfgPath, outGlb, outManifest, outBlend]);
run(process.execPath, ['tools/validators/validate-glb.mjs', outGlb, outManifest]);
console.log('\nFULL_BODY_OK');
