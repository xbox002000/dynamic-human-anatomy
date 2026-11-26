#!/usr/bin/env node
// 雙側上肢管線：依 upper_limbs_parts.json 抽出 Z-Anatomy 零件 → Blender 綁定 → GLB 驗證
// 用法：node tools/pipeline/upper-limbs.mjs [--skip-extract]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const cfgPath = path.join(root, 'tools/pipeline/upper_limbs_parts.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const src = path.join(root, 'assets/source/anatomy-explorer/public/models');
const raw = path.join(root, 'assets/working/zanatomy_upper_limbs.glb');
const outGlb = path.join(root, 'apps/web/public/models/upper_limbs.glb');
const outManifest = path.join(root, 'apps/web/public/data/upper_limbs_manifest.json');
const outBlend = path.join(root, 'assets/working/upper_limbs.blend');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = [
  ...Object.values(cfg.bones).flatMap((b) => b.parts),
  ...cfg.muscles.flatMap((m) => m.parts),
];
const regex = `^(${names.map(esc).join('|')})\\.(l|r)$`;

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
console.log('\nUPPER_LIMBS_OK');
