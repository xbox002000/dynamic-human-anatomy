#!/usr/bin/env node
// 以 headless 模式執行 Blender 腳本。Blender 路徑優先讀 BLENDER_EXE 環境變數。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_EXE = 'G:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
const exe = process.env.BLENDER_EXE || DEFAULT_EXE;
if (!existsSync(exe)) {
  console.error(`找不到 Blender：${exe}（可設定 BLENDER_EXE）`);
  process.exit(2);
}

const script = process.argv[2];
if (!script) {
  console.error('用法：node tools/blender/run-blender.mjs <script.py> [args...]');
  process.exit(2);
}
const root = process.cwd();
const extra = process.argv.slice(3);
const args = extra.length
  ? extra
  : [
      path.join(root, 'apps/web/public/models/arm_sample.glb'),
      path.join(root, 'assets/working/arm_sample.blend'),
    ];

const r = spawnSync(exe, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', path.resolve(script), '--', ...args], {
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
