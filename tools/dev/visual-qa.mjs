#!/usr/bin/env node
/**
 * M4.2 Visual QA runner：啟動（或連接）Vite dev server，以 CDP 驅動 headless Edge / Chrome，
 * 依 tools/dev/qa-poses.json 套用固定姿勢、固定相機截圖，並輸出姿勢資料與檢查結果。
 *
 * 用法：
 *   node tools/dev/visual-qa.mjs                 # 全部 8 組姿勢 → artifacts/visual-qa/m4.2/
 *   node tools/dev/visual-qa.mjs --smoke         # CI 用：只跑 P01/P03/P05 正面，檢查載入、錯誤、套用姿勢
 *   node tools/dev/visual-qa.mjs --url http://localhost:5173   # 使用已啟動的 dev server
 *   node tools/dev/visual-qa.mjs --only P03,P07 --out tmp/qa
 * 環境變數：BROWSER（瀏覽器執行檔路徑）。
 * 結束碼：0 = 全部檢查通過；1 = 有檢查失敗或頁面錯誤；2 = 無法啟動 / 載入。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SMOKE = argv.includes('--smoke');
const OUT = path.resolve(ROOT, opt('--out', SMOKE ? 'artifacts/visual-qa/smoke' : 'artifacts/visual-qa/m4.2'));
const ONLY = opt('--only', SMOKE ? 'P01,P03,P05' : '')?.split(',').filter(Boolean) ?? [];
const PORT = Number(opt('--port', '5199'));
let baseUrl = opt('--url', '');
const W = 1280, H = 960;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanups = [];
const cleanup = () => { while (cleanups.length) { try { cleanups.pop()(); } catch {} } };
const fail = (code, msg) => { console.error(msg); cleanup(); process.exit(code); };
process.on('SIGINT', () => fail(130, 'interrupted'));

function killTree(p) {
  if (!p?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch {} } }
}

function findBrowser() {
  const c = [process.env.BROWSER, process.env.EDGE, process.env.CHROME,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'].filter(Boolean);
  return c.find((p) => existsSync(p));
}

// ---------------------------------------------------------------- dev server
if (!baseUrl) {
  baseUrl = `http://localhost:${PORT}`;
  const dev = spawn('pnpm', ['--filter', '@dha/web', 'dev', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, shell: process.platform === 'win32', detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  let devLog = '';
  dev.stdout.on('data', (d) => (devLog += d));
  dev.stderr.on('data', (d) => (devLog += d));
  cleanups.push(() => killTree(dev));
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await sleep(500);
    try { up = (await fetch(baseUrl + '/')).ok; } catch {}
    if (dev.exitCode !== null) break;
  }
  if (!up) fail(2, `DEV_SERVER_FAILED\n${devLog.slice(-2000)}`);
  console.log(`dev server up at ${baseUrl}`);
}

// ---------------------------------------------------------------- browser + CDP
const exe = findBrowser();
if (!exe) fail(2, 'NO_BROWSER：請設定 BROWSER 環境變數');
const cdpPort = 9300 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(path.join(tmpdir(), 'dha-qa-'));
const br = spawn(exe, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
  `--window-size=${W},${H}`, '--no-first-run', '--disable-extensions', '--hide-scrollbars', `--user-data-dir=${prof}`,
  `--remote-debugging-port=${cdpPort}`, 'about:blank',
], { stdio: 'ignore', detached: process.platform !== 'win32' });
cleanups.push(() => { killTree(br); setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 300); });

let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) {
  await sleep(250);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
}
if (!wsUrl) fail(2, 'NO_CDP_TARGET');
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0;
const pending = new Map();
const consoleErrors = [];
const consoleWarnings = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 600);
    if (m.params.type === 'error') consoleErrors.push(text);
    else if (m.params.type === 'warning') consoleWarnings.push(text);
  }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 800));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ''}`.slice(0, 600));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
}
const qa = (call) => evaluate(`(async () => { const qa = window.__dhaQA; return await qa.${call}; })()`);

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const t0 = Date.now();
await send('Page.navigate', { url: `${baseUrl}/?qa=1` });
let ready = false;
while (!ready && Date.now() - t0 < 120000) {
  await sleep(300);
  try { ready = (await evaluate('!!(window.__dhaQA && window.__dhaQA.ready)')) === true; } catch {}
  const loadFailed = await evaluate("!!document.querySelector('.overlay.error')").catch(() => false);
  if (loadFailed) fail(2, `LOAD_FAILED: ${await evaluate("document.querySelector('.overlay.error').textContent")}\n${consoleErrors.join('\n')}`);
}
if (!ready) fail(2, `QA_HARNESS_NOT_READY after ${Date.now() - t0} ms\n${consoleErrors.join('\n')}`);
const loadMs = Date.now() - t0;
console.log(`model loaded + harness ready in ${loadMs} ms`);

// UI 面板會蓋住畫面：截圖只取 canvas 區域
const rect = await evaluate(`(() => { const c = document.querySelector('canvas[data-framed]'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);

// ---------------------------------------------------------------- poses
const spec = JSON.parse(readFileSync(path.join(ROOT, 'tools/dev/qa-poses.json'), 'utf8'));
const joints = new Map((await qa('joints()')).map((j) => [j.id, j.limits]));
const poses = spec.poses.filter((p) => !ONLY.length || ONLY.includes(p.id));
mkdirSync(OUT, { recursive: true });

const TOL_GROUND = 0.005; // 支撐點高度容差 5 mm
const results = [];
async function shoot(file) {
  await qa('frames(4)');
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(path.join(OUT, file), buf);
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

for (const p of poses) {
  const views = SMOKE ? ['front'] : p.views;
  const errBefore = consoleErrors.length;
  const checks = [];
  // 角度範圍檢查（spec 本身不可超出 limits）
  for (const [jid, vals] of Object.entries(p.angles)) {
    const lim = joints.get(jid);
    if (!lim) { checks.push({ name: `joint ${jid} exists`, pass: false }); continue; }
    vals.forEach((v, i) => {
      const [axis, lo, hi] = lim[i] ?? [];
      checks.push({ name: `${jid}[${axis}]=${v} within ${lo}..${hi}`, pass: v >= lo && v <= hi });
    });
  }
  await qa('reset()');
  await qa(`setPlantMode(${JSON.stringify(p.plant ?? 'both')})`);
  const applied = await qa(`setAngles(${JSON.stringify(p.angles)})`);
  for (const [jid, vals] of Object.entries(p.angles)) {
    const got = applied[jid] ?? [];
    checks.push({ name: `${jid} applied`, pass: vals.every((v, i) => Math.abs((got[i] ?? NaN) - v) < 1e-6), detail: `requested ${vals} got ${got.map((x) => +x.toFixed(3))}` });
  }
  if (p.activation) await qa(`setActivations(${JSON.stringify(p.activation)})`);
  if (p.select) await qa(`select(${JSON.stringify(p.select)})`);
  const snap = await qa('snapshot()');
  // 足部：只對「應支撐」的腳檢查高度；水平滑動只記錄不判定（root translation 不保證）
  const planted = p.plant === 'both' ? ['left', 'right'] : p.plant === 'off' ? [] : [p.plant];
  const g = snap.feet;
  if (p.plant === 'both') {
    const lowest = Math.min(g.left.heightAboveGround, g.right.heightAboveGround);
    checks.push({ name: 'both: lowest support on ground', pass: Math.abs(lowest) < TOL_GROUND, detail: `lowest=${(lowest * 1000).toFixed(1)} mm` });
  } else {
    for (const s of planted) checks.push({ name: `${s}: support on ground`, pass: Math.abs(g[s].heightAboveGround) < TOL_GROUND, detail: `${(g[s].heightAboveGround * 1000).toFixed(1)} mm` });
    for (const s of planted) checks.push({ name: `${s}: support not slipping`, pass: g[s].horizontalSlip < TOL_GROUND, detail: `${(g[s].horizontalSlip * 1000).toFixed(1)} mm` });
  }
  const bad = Object.entries(snap.muscles).filter(([, m]) => !Number.isFinite(m.ratio) || m.ratio <= 0);
  checks.push({ name: 'all muscle path lengths finite & positive', pass: bad.length === 0, detail: bad.map(([k]) => k).join(',') });

  const shots = [];
  for (const v of views) {
    let target = 'undefined', zoom = 1;
    if (p.focus) { const bp = await qa(`bonePos(${JSON.stringify(p.focus.bone)})`); if (bp) { target = JSON.stringify(bp); zoom = p.focus.zoom ?? 1; } }
    // 全身視角 + 局部視角（若有 focus）
    await qa(`setCamera(${JSON.stringify(v)}, 1)`);
    const f = `${p.id}_${v}.png`;
    shots.push({ view: v, file: f, sha: await shoot(f) });
    if (p.focus && !SMOKE) {
      await qa(`setCamera(${JSON.stringify(v)}, ${zoom}, ${target})`);
      const f2 = `${p.id}_${v}_detail.png`;
      shots.push({ view: `${v}+detail`, file: f2, sha: await shoot(f2) });
    }
  }
  // isolate：只顯示選取肌肉，拍「rest vs 姿勢」對照（判斷形變 / 蒙皮權重問題）
  if (p.isolate && p.select && !SMOKE) {
    let target = 'undefined', zoom = 1;
    const iso = async (tag) => {
      await qa('setIsolated(true)');
      for (const v of views) {
        await qa(`setCamera(${JSON.stringify(v)}, ${zoom}, ${target})`);
        const f = `${p.id}_${v}_isolated_${tag}.png`;
        shots.push({ view: `${v}+isolated_${tag}`, file: f, sha: await shoot(f) });
      }
    };
    if (p.focus) { const bp = await qa(`bonePos(${JSON.stringify(p.focus.bone)})`); if (bp) { target = JSON.stringify(bp); zoom = p.focus.zoom ?? 1; } }
    await iso('pose');
    await qa('reset()');
    await qa(`select(${JSON.stringify(p.select)})`);
    if (p.focus) { const bp = await qa(`bonePos(${JSON.stringify(p.focus.bone)})`); if (bp) target = JSON.stringify(bp); }
    await iso('rest');
  }
  const newErrors = consoleErrors.slice(errBefore);
  checks.push({ name: 'no console errors', pass: newErrors.length === 0, detail: newErrors.join(' | ').slice(0, 400) });
  const pass = checks.every((c) => c.pass);
  const watch = Object.fromEntries(Object.entries(snap.muscles).filter(([, m]) => Math.abs(m.ratio - 1) > 0.02).sort((a, b) => Math.abs(b[1].ratio - 1) - Math.abs(a[1].ratio - 1)).slice(0, 12));
  results.push({ id: p.id, name: p.name, plant: p.plant, angles: p.angles, applied, activation: p.activation ?? {}, pelvis: snap.pelvis, feet: snap.feet, changedMuscles: watch, shots, checks, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${p.id} ${p.name}  feet L=${g.left?.kind}/${(g.left?.heightAboveGround * 1000).toFixed(1)}mm slip ${(g.left?.horizontalSlip * 1000).toFixed(1)}mm  R=${g.right?.kind}/${(g.right?.heightAboveGround * 1000).toFixed(1)}mm slip ${(g.right?.horizontalSlip * 1000).toFixed(1)}mm  shots=${shots.length}`);
  for (const c of checks.filter((c) => !c.pass)) console.log(`   ✗ ${c.name} ${c.detail ?? ''}`);
}

// ---------------------------------------------------------------- repeatability：同一姿勢重拍兩次
const rep = [];
for (const p of poses.slice(0, SMOKE ? 1 : 3)) {
  await qa('reset()');
  await qa(`setPlantMode(${JSON.stringify(p.plant ?? 'both')})`);
  await qa(`setAngles(${JSON.stringify(p.angles)})`);
  if (p.activation) await qa(`setActivations(${JSON.stringify(p.activation)})`);
  if (p.select) await qa(`select(${JSON.stringify(p.select)})`);
  await qa(`setCamera("front", 1)`);
  const a = await shoot(`_repeat_${p.id}.png`);
  const first = results.find((r) => r.id === p.id).shots.find((s) => s.view === 'front').sha;
  rep.push({ id: p.id, first, again: a, identical: a === first });
  rmSync(path.join(OUT, `_repeat_${p.id}.png`), { force: true });
}

const summary = {
  generatedAt: new Date().toISOString(), baseUrl, browser: path.basename(exe), viewport: [W, H], canvas: rect, loadMs, smoke: SMOKE,
  pass: results.every((r) => r.pass) && consoleErrors.length === 0,
  consoleErrors, consoleWarnings: [...new Set(consoleWarnings)].slice(0, 30), repeatability: rep, results,
};
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(summary, null, 2));
console.log(`repeatability: ${rep.map((r) => `${r.id}=${r.identical ? 'identical' : 'DIFFERENT'}`).join(' ')}`);
console.log(`console errors: ${consoleErrors.length}, warnings: ${consoleWarnings.length}`);
console.log(`${summary.pass ? 'VISUAL_QA_PASS' : 'VISUAL_QA_FAIL'} → ${path.relative(ROOT, OUT)}`);
ws.close();
cleanup();
setTimeout(() => process.exit(summary.pass ? 0 : 1), 600);
