// M4.2：不重建 full_body.glb，直接修正 full_body_manifest.json 的內收肌群起點（左右鏡像）。
// 起點 / 止點只是執行期路徑資料，不影響 GLB 內的 morph 或蒙皮。
// 與 tools/pipeline/m4-dynamic.mjs 的 adductors.origin_pt 一致：髖中心內側 4.87 cm、下方 6 cm、前方 2.5 cm（approximate）。
// 下次以 Blender 重建 full_body 時，body_ext.py 的 lm_point(medial) 會產生相同結果。
// 只做文字層級替換（保留原檔數字格式，例如 0.0），讓 diff 只包含被修改的座標。可重複執行。
import { readFileSync, writeFileSync } from 'node:fs';

const P = 'apps/web/public/data/full_body_manifest.json';
const MEDIAL = 0.0487, DOWN = 0.06, FRONT = 0.025;
let t = readFileSync(P, 'utf8');
const m = JSON.parse(t);
const r5 = (v) => +v.toFixed(5);
for (const s of ['left', 'right']) {
  const h = m.joints.find((j) => j.id === `hip_${s}`);
  const d = m.muscles.find((x) => x.id === `adductors_${s}`);
  if (!h || !d) throw new Error(`missing hip_${s} / adductors_${s}`);
  const c = h.center;
  const sg = s === 'left' ? 1 : -1; // glTF：左側 x > 0，內側 = 往 x = 0
  const o = [r5(c[0] - sg * MEDIAL), r5(c[1] - DOWN), r5(c[2] + FRONT)];
  // 在文字中定位：該肌肉 "id" → 其後第一個 "origin" → 其後第一個 "position": [ ... ]
  const idAt = t.indexOf(`"id": "adductors_${s}"`);
  if (idAt < 0) throw new Error(`text id adductors_${s} not found`);
  const orAt = t.indexOf('"origin"', idAt);
  const posAt = t.indexOf('"position"', orAt);
  const open = t.indexOf('[', posAt), close = t.indexOf(']', open);
  const body = t.slice(open + 1, close);
  const indent = (body.match(/\n([ \t]+)\S/) ?? [, '            '])[1];
  const nl = t.includes('\r\n') ? '\r\n' : '\n';
  const tailIndent = (body.match(/\n([ \t]*)$/) ?? [, '          '])[1];
  const rep = nl + o.map((v) => indent + v).join(',' + nl) + nl + tailIndent;
  console.log(s, 'old', d.origin[0].position, 'new', o);
  t = t.slice(0, open + 1) + rep + t.slice(close);
}
// 臀大肌：形變範圍上限（與 m4-dynamic.mjs 的 gluteus_maximus.deformation_params 一致）
const PARAMS = { gluteus_maximus: { max_lengthening: 0.32 } };
for (const [base, params] of Object.entries(PARAMS)) {
  for (const s of ['left', 'right']) {
    const id = `${base}_${s}`;
    const idAt = t.indexOf(`"id": "${id}"`);
    if (idAt < 0) throw new Error(`text id ${id} not found`);
    const nextId = t.indexOf('"id": "', idAt + 5);
    const dpAt = t.indexOf('"deformation_profile"', idAt);
    if (dpAt < 0 || (nextId > 0 && dpAt > nextId)) throw new Error(`${id}: deformation_profile not found`);
    const existing = t.indexOf('"deformation_params"', idAt);
    if (existing > 0 && (nextId < 0 || existing < nextId)) { console.log(id, 'deformation_params already present'); continue; }
    const lineEnd = t.indexOf('\n', dpAt);
    const lineStart = t.lastIndexOf('\n', dpAt) + 1;
    const indent = t.slice(lineStart, dpAt);
    const cr = t[lineEnd - 1] === '\r' ? '\r' : '';
    const ins = `${indent}"deformation_params": ${JSON.stringify(params).replace(/:/g, ': ').replace(/,/g, ', ')},${cr}\n`;
    t = t.slice(0, lineEnd + 1) + ins + t.slice(lineEnd + 1);
    console.log(id, 'deformation_params', params);
  }
}
const check = JSON.parse(t);
for (const s of ['left', 'right']) console.log('verify', s, check.muscles.find((x) => x.id === `gluteus_maximus_${s}`).deformation_params);
for (const s of ['left', 'right']) console.log('verify', s, check.muscles.find((x) => x.id === `adductors_${s}`).origin[0].position);
writeFileSync(P, t);
