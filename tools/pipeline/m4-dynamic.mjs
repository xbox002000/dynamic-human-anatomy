// 一次性：在 full_body_parts.json 的 M4 主要肌群加上 dynamic 區段（起止點、跨越關節、形變增益）。
// 地標點 *_pt / via：at = 關節（hip/knee/ankle/mtp），up = 沿身體上方偏移，depth = 往 side（anterior/posterior）偏移，單位公尺。
// 數值為依教科書解剖位置估計的近似值（approximate），用於讓路徑長度隨姿勢合理變化。
import { readFileSync, writeFileSync } from 'node:fs';

const P = 'tools/pipeline/full_body_parts.json';
const LEG = [0.3, 0.12];
const TRUNK = [0.15, 0.08];
const D = {
  // 臀大肌：路徑繞過髖關節後方（坐骨結節附近）→ 止於股骨臀肌粗隆，髖屈曲時拉長
  gluteus_maximus: { origin: 'pelvis', insertion: 'thigh', joints: ['hip'], shape: LEG, architecture: 'flat', name_latin: 'Musculus gluteus maximus',
    insertion_pt: { at: 'hip', up: -0.1, side: 'posterior', depth: 0.02 },
    via: [{ bone: 'pelvis', at: 'hip', up: -0.01, side: 'posterior', depth: 0.07 }],
    function: ['髖關節伸展', '髖關節外旋'], innervation: 'Inferior gluteal nerve (L5–S2)' },
  gluteus_medius_minimus: { origin: 'pelvis', insertion: 'thigh', joints: ['hip'], shape: LEG, architecture: 'flat',
    function: ['髖關節外展', '單腳站立時穩定骨盆'], innervation: 'Superior gluteal nerve (L4–S1)' },
  iliopsoas: { origin: 'lumbar', insertion: 'thigh', joints: ['lumbar', 'hip'], shape: LEG,
    via: [{ bone: 'pelvis', at: 'hip', up: 0.02, side: 'anterior', depth: 0.03 }],
    function: ['髖關節屈曲'], innervation: 'Femoral nerve (L1–L3) 與腰神經叢分支' },
  // 股四頭肌：體積以三條股肌（起於股骨）為主，路徑起點放在股骨前上方；深蹲時整體應拉長（股直肌跨髖的效果不納入路徑長度）
  quadriceps: { origin: 'thigh', insertion: 'shin', joints: ['hip', 'knee'], shape: LEG, architecture: 'multihead',
    origin_pt: { at: 'hip', up: -0.08, side: 'anterior', depth: 0.03 },
    insertion_pt: { at: 'knee', up: -0.07, side: 'anterior', depth: 0.03 },
    via: [{ bone: 'thigh', at: 'knee', up: 0.01, side: 'anterior', depth: 0.045 }],
    function: ['膝關節伸展', '股直肌輔助髖關節屈曲'], innervation: 'Femoral nerve (L2–L4)' },
  hamstrings: { origin: 'pelvis', insertion: 'shin', joints: ['hip', 'knee'], shape: LEG, architecture: 'multihead',
    insertion_pt: { at: 'knee', up: -0.04, side: 'posterior', depth: 0.02 },
    via: [{ bone: 'thigh', at: 'knee', up: 0.03, side: 'posterior', depth: 0.04 }],
    function: ['膝關節屈曲', '髖關節伸展'], innervation: 'Sciatic nerve (L5–S2)' },
  adductors: { origin: 'pelvis', insertion: 'thigh', joints: ['hip'], shape: LEG, architecture: 'multihead',
    function: ['髖關節內收'], innervation: 'Obturator nerve (L2–L4)；內收大肌後部為 Sciatic nerve' },
  gastrocnemius: { origin: 'thigh', insertion: 'foot', joints: ['knee', 'ankle'], shape: LEG, architecture: 'bipennate',
    origin_pt: { at: 'knee', up: 0.02, side: 'posterior', depth: 0.03 },
    insertion_pt: { at: 'ankle', up: -0.03, side: 'posterior', depth: 0.05 },
    function: ['踝關節蹠屈', '輔助膝關節屈曲'], innervation: 'Tibial nerve (S1–S2)' },
  soleus: { origin: 'shin', insertion: 'foot', joints: ['ankle'], shape: LEG, architecture: 'multipennate',
    insertion_pt: { at: 'ankle', up: -0.03, side: 'posterior', depth: 0.05 },
    function: ['踝關節蹠屈', '站立姿勢穩定'], innervation: 'Tibial nerve (S1–S2)' },
  tibialis_anterior: { origin: 'shin', insertion: 'foot', joints: ['ankle'], shape: LEG,
    insertion_pt: { at: 'ankle', up: -0.03, side: 'anterior', depth: 0.04 },
    via: [{ bone: 'shin', at: 'ankle', up: 0.03, side: 'anterior', depth: 0.035 }],
    function: ['踝關節背屈', '足內翻'], innervation: 'Deep fibular nerve (L4–L5)' },
  rectus_abdominis: { origin: 'pelvis', insertion: 'chest', joints: ['lumbar', 'thoracic'], shape: TRUNK, architecture: 'flat',
    function: ['軀幹前屈', '增加腹壓'], innervation: 'Thoracoabdominal nerves (T7–T12)' },
  abdominal_obliques: { origin: 'pelvis', insertion: 'chest', joints: ['lumbar', 'thoracic'], shape: TRUNK, architecture: 'flat',
    function: ['軀幹側屈與旋轉', '軀幹前屈'], innervation: 'Thoracoabdominal nerves (T7–T12)、Iliohypogastric nerve' },
  // 豎脊肌：沿棘突後方走行，經 L5/S1 與 T12/L1 後方，軀幹前屈時拉長
  erector_spinae: { origin: 'pelvis', insertion: 'chest', joints: ['lumbar', 'thoracic'], shape: TRUNK, architecture: 'multihead',
    via: [
      { bone: 'lumbar', at: 'j_ls', up: 0.0, side: 'posterior', depth: 0.07 },
      { bone: 'chest', at: 'j_tl', up: 0.0, side: 'posterior', depth: 0.07 },
    ],
    function: ['軀幹伸展', '單側收縮時側屈'], innervation: 'Dorsal rami of spinal nerves' },
};

// 解析 → 修改 → 重新輸出；body.muscles 維持「一條肌群一行」的格式，其餘區段原樣保留。
const t = readFileSync(P, 'utf8');
const cfg = JSON.parse(t);
const muscles = cfg.body.muscles;
for (const [id, d] of Object.entries(D)) {
  const m = muscles.find((x) => x.id === id);
  if (!m) throw new Error(`找不到肌群 ${id}`);
  m.dynamic = d; // 可重複執行：直接覆寫
}
const one = (o) => JSON.stringify(o).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/^\{/, '{ ').replace(/\}$/, ' }');
const block = muscles.map((m) => '      ' + one(m)).join(',\n');
const start = t.indexOf('"muscles": [', t.indexOf('"body"'));
const open = t.indexOf('[', start);
let depth = 0, end = open;
for (let i = open; i < t.length; i++) {
  if (t[i] === '[') depth++;
  else if (t[i] === ']' && --depth === 0) { end = i; break; }
}
const out = t.slice(0, open + 1) + '\n' + block + '\n    ' + t.slice(end);
JSON.parse(out);
writeFileSync(P, out);
console.log('M4 dynamic 已寫入', Object.keys(D).length, '組');
