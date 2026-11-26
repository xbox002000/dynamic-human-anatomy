// 開發用：以 Chrome DevTools Protocol 驅動 headless Edge，等模型載入後再截圖。
// 用法：node tools/dev/cdp-shot.mjs <url> <out.png> [waitAfterLoadMs=3000] [timeoutMs=90000]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, waitArg, toArg] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: cdp-shot.mjs <url> <out.png> [waitAfterLoadMs] [timeoutMs]');
  process.exit(2);
}
const waitAfter = Number(waitArg ?? 3000);
const timeout = Number(toArg ?? 90000);
const edge = process.env.EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(tmpdir(), 'dha-cdp-'));
const proc = spawn(edge, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1600,1000', '--no-first-run', '--disable-extensions', `--user-data-dir=${prof}`,
  `--remote-debugging-port=${port}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killAll = () => { try { proc.kill(); } catch {} setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 500); };
const timer = setTimeout(() => { console.error('CDP TIMEOUT'); killAll(); process.exit(1); }, timeout);

let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) { console.error('no CDP target'); killAll(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
let loaded = false;
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (m.params.type === 'error' || m.params.type === 'warning') errors.push(`${m.params.type}: ${text.slice(0, 400)}`);
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
const t0 = Date.now();
while (!loaded && Date.now() - t0 < timeout - waitAfter - 5000) {
  await sleep(300);
  const r = await send('Runtime.evaluate', { expression: "!!document.querySelector('canvas[data-framed]')", returnByValue: true });
  loaded = r.result?.result?.value === true;
}
console.log(loaded ? `loaded after ${Date.now() - t0} ms` : 'WARN: load marker not seen');
await sleep(waitAfter);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('wrote', out);
for (const e of errors.slice(0, 10)) console.log(e);
clearTimeout(timer);
ws.close();
killAll();
setTimeout(() => process.exit(0), 800);
