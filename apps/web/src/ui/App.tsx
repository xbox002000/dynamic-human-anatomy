import { useEffect, useReducer, useRef, useState } from 'react';
import { Vector3 } from 'three';
import type { PoseDefinition } from '@dha/anatomy-schema';
import { AnatomyEngine, type Layer } from '../core/AnatomyEngine';
import { PRESET_POSES, loadSavedPoses, storeSavedPoses } from '../state/presets';
import './app.css';

const base = import.meta.env.BASE_URL;
const MODELS: Record<string, { glb: string; manifest: string; label: string }> = {
  zanatomy: { glb: 'arm_zanatomy_l.glb', manifest: 'arm_zanatomy_manifest.json', label: 'Z-Anatomy 左上肢（CC BY-SA 4.0）· 附著點與關節為近似推算值' },
  sample: { glb: 'arm_sample.glb', manifest: 'arm_manifest.json', label: '程序化樣本 · 尺寸與附著點為 placeholder，非解剖參考數據' },
};
const CATEGORY_ZH: Record<string, string> = { muscle: '肌肉', bone: '骨骼', skin: '皮膚', other: '其他' };
const LAYER_ZH: Record<Layer, string> = { skin: '皮膚', muscle: '肌肉', bone: '骨骼' };

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<AnatomyEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [search, setSearch] = useState('');
  const [saved, setSaved] = useState<PoseDefinition[]>(() => loadSavedPoses());
  const [poseName, setPoseName] = useState('');

  useEffect(() => {
    const host = hostRef.current!;
    const eng = new AnatomyEngine(host);
    let alive = true;
    const q0 = new URLSearchParams(location.search);
    const model = MODELS[q0.get('model') ?? 'zanatomy'] ?? MODELS.zanatomy!;
    eng
      .load(`${base}models/${model.glb}`, `${base}data/${model.manifest}`)
      .then(() => {
        if (!alive) return;
        eng.subscribe(force);
        // 除錯/驗收用：?pose=pose_elbow_90&select=biceps_brachii_left
        const q = new URLSearchParams(location.search);
        const preset = PRESET_POSES.find((p) => p.id === q.get('pose'));
        if (preset) eng.applyPose(preset);
        if (q.get('select')) eng.select(q.get('select'));
        // ?ik=dx,dy,dz：把手部相對目前位置移動（公尺），驗收 IK 用
        const ik = q.get('ik')?.split(',').map(Number);
        if (ik && ik.length === 3 && ik.every(Number.isFinite)) {
          const p = eng.effectorPosition();
          if (p) {
            const err = eng.solveIK(p.add(new Vector3(ik[0], ik[1], ik[2])));
            console.info('[IK] residual', err);
          }
        }
        setEngine(eng);
        (window as unknown as { dha: AnatomyEngine }).dha = eng;
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      alive = false;
      eng.dispose();
    };
  }, []);

  const sel = engine?.selection ?? null;
  const muscleDef = sel ? engine?.muscles.getDefinition(sel) : undefined;
  const muscleState = sel ? engine?.muscles.getState(sel) : undefined;
  const structures = (engine?.structures() ?? []).filter((s) => s.id.includes(search.trim().toLowerCase()));

  const savePose = () => {
    if (!engine) return;
    const name = poseName.trim() || `姿勢 ${saved.length + 1}`;
    const p = engine.capturePose(name);
    p.id = `${p.id}_${Date.now()}`;
    const next = [...saved, p];
    setSaved(next);
    storeSavedPoses(next);
    setPoseName('');
  };

  const removePose = (id: string) => {
    const next = saved.filter((p) => p.id !== id);
    setSaved(next);
    storeSavedPoses(next);
  };

  const exportPoses = () => {
    const blob = new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'poses.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="layout">
      <aside className="panel left">
        <h1>解剖結構</h1>
        <input className="search" placeholder="搜尋 anatomicalId…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul className="tree">
          {structures.map((s) => (
            <li key={s.id}>
              <button className={s.id === sel ? 'active' : ''} onClick={() => engine?.select(s.id)}>
                <span className={`dot ${s.category}`} />
                {engine?.muscles.getDefinition(s.id)?.name_zh ?? s.id}
                <small>{CATEGORY_ZH[s.category] ?? s.category}</small>
              </button>
            </li>
          ))}
        </ul>
        <h2>圖層</h2>
        {engine &&
          (Object.keys(LAYER_ZH) as Layer[]).map((l) => (
            <label key={l} className="check">
              <input type="checkbox" checked={engine.getLayers()[l]} onChange={(e) => engine.setLayer(l, e.target.checked)} />
              {LAYER_ZH[l]}
            </label>
          ))}
        {engine && (
          <label className="check">
            <input type="checkbox" checked={engine.isIsolated} disabled={!sel} onChange={(e) => engine.setIsolated(e.target.checked)} />
            只顯示選取項目
          </label>
        )}
      </aside>

      <main className="viewport">
        <div ref={hostRef} className="canvas-host" />
        {!engine && !error && <div className="overlay">載入模型中…</div>}
        {error && <div className="overlay error">載入失敗：{error}</div>}
        <div className="badge">{(MODELS[new URLSearchParams(location.search).get('model') ?? 'zanatomy'] ?? MODELS.zanatomy!).label}</div>
      </main>

      <aside className="panel right">
        <h1>資訊</h1>
        {!sel && <p className="muted">點選 3D 模型或左側清單中的結構。</p>}
        {sel && !muscleDef && <p>{sel}</p>}
        {muscleDef && muscleState && engine && (
          <div className="info">
            <h2>{muscleDef.name_zh}</h2>
            <p className="muted">
              {muscleDef.name} · <i>{muscleDef.name_latin}</i>
            </p>
            <dl>
              <dt>ID</dt>
              <dd><code>{muscleDef.id}</code></dd>
              <dt>起點</dt>
              <dd>{muscleDef.origin.map((o) => o.bone).join(', ')} <span className="tag">{muscleDef.origin[0]?.confidence}</span></dd>
              <dt>止點</dt>
              <dd>{muscleDef.insertion.map((o) => o.bone).join(', ')}</dd>
              <dt>跨越關節</dt>
              <dd>{muscleDef.joints_crossed.join(', ')}</dd>
              <dt>功能</dt>
              <dd>{muscleDef.function?.join('、')}</dd>
              <dt>神經支配</dt>
              <dd>{muscleDef.innervation}</dd>
              <dt>來源 / 授權</dt>
              <dd>{muscleDef.source.dataset} / {muscleDef.source.license}</dd>
            </dl>
            <h3>肌肉狀態</h3>
            <Meter label="長度比" value={muscleState.length / muscleState.restLength} max={1.4} fmt={(v) => v.toFixed(3)} />
            <Meter label="縮短" value={muscleState.contraction} />
            <Meter label="拉長" value={muscleState.stretch} />
            <Meter label="隆起" value={muscleState.bulge} />
            <label className="slider">
              <span>啟動程度 {(muscleState.activation * 100).toFixed(0)}%</span>
              <input type="range" min={0} max={1} step={0.01} value={muscleState.activation} onChange={(e) => engine.muscles.setActivation(muscleDef.id, +e.target.value)} />
            </label>
            <p className="legend"><span className="lg o" />起點 <span className="lg v" />經過點 <span className="lg i" />止點</p>
          </div>
        )}
      </aside>

      <footer className="panel bottom">
        {engine && (
          <>
            <section>
              <h2>關節（FK）</h2>
              {engine.pose.jointIds.map((jid) => {
                const def = engine.pose.getDefinition(jid)!;
                const angles = engine.pose.getAngles(jid);
                return def.limits.map((l, i) => (
                  <label key={`${jid}-${i}`} className="slider">
                    <span>{jid} · {l.label ?? l.axis} {angles[i]?.toFixed(0)}°</span>
                    <input type="range" min={l.minDeg} max={l.maxDeg} step={1} value={angles[i] ?? 0} onChange={(e) => engine.pose.setAngle(jid, i, +e.target.value)} />
                  </label>
                ));
              })}
              <button onClick={() => engine.pose.reset()}>重設姿勢</button>
              {engine.hasIK && (
                <label className="check">
                  <input type="checkbox" checked={engine.isIKEnabled} onChange={(e) => engine.setIKEnabled(e.target.checked)} />
                  IK：拖曳橘色把手移動手部{engine.ikError > 0.005 ? `（超出可達範圍 ${(engine.ikError * 100).toFixed(1)} cm）` : ''}
                </label>
              )}
            </section>
            <section>
              <h2>肌肉啟動</h2>
              {engine.muscles.ids.map((mid) => {
                const st = engine.muscles.getState(mid)!;
                return (
                  <label key={mid} className="slider">
                    <span>{engine.muscles.getDefinition(mid)?.name_zh} {(st.activation * 100).toFixed(0)}%</span>
                    <input type="range" min={0} max={1} step={0.01} value={st.activation} onChange={(e) => engine.muscles.setActivation(mid, +e.target.value)} />
                  </label>
                );
              })}
            </section>
            <section>
              <h2>驗收姿勢</h2>
              <div className="chips">
                {PRESET_POSES.map((p) => (
                  <button key={p.id} onClick={() => engine.applyPose(p)}>{p.name}</button>
                ))}
              </div>
              <button className="primary" disabled={engine.isPlaying} onClick={() => engine.play(PRESET_POSES)}>▶ 播放 0→130°</button>
            </section>
            <section>
              <h2>儲存 / 重播</h2>
              <div className="row">
                <input placeholder="姿勢名稱" value={poseName} onChange={(e) => setPoseName(e.target.value)} />
                <button onClick={savePose}>儲存</button>
              </div>
              <ul className="saved">
                {saved.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => engine.applyPose(p)}>{p.name}</button>
                    <button className="x" onClick={() => removePose(p.id)} aria-label="刪除">×</button>
                  </li>
                ))}
              </ul>
              <div className="row">
                <button disabled={saved.length < 2 || engine.isPlaying} onClick={() => engine.play(saved)}>▶ 重播已存姿勢</button>
                {engine.isPlaying && <button onClick={() => engine.stop()}>■ 停止</button>}
                <button disabled={!saved.length} onClick={exportPoses}>匯出 JSON</button>
              </div>
            </section>
          </>
        )}
      </footer>
    </div>
  );
}

function Meter({ label, value, max = 1, fmt }: { label: string; value: number; max?: number; fmt?: (v: number) => string }) {
  return (
    <div className="meter">
      <span>{label}</span>
      <div className="bar"><div style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div>
      <span className="num">{fmt ? fmt(value) : `${(value * 100).toFixed(0)}%`}</span>
    </div>
  );
}
