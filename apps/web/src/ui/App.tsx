import { useEffect, useReducer, useRef, useState } from 'react';
import { Vector3 } from 'three';
import type { PoseDefinition } from '@dha/anatomy-schema';
import { AnatomyEngine, type Layer } from '../core/AnatomyEngine';
import { PRESET_POSES, loadSavedPoses, storeSavedPoses } from '../state/presets';
import { ROLE_ZH } from '../animation/motionSampler';
import './app.css';

const base = import.meta.env.BASE_URL;
const MODELS: Record<string, { glb: string; manifest: string; label: string }> = {
  full: { glb: 'full_body.glb', manifest: 'full_body_manifest.json', label: 'Z-Anatomy 全身骨架（CC BY-SA 4.0）· 54 條動態肌肉、其餘肌群為靜態跟隨 · 附著點、關節與啟動曲線為近似值' },
  upper: { glb: 'upper_limbs.glb', manifest: 'upper_limbs_manifest.json', label: 'Z-Anatomy 雙側上肢（CC BY-SA 4.0）· 附著點、關節與啟動曲線為近似值' },
  zanatomy: { glb: 'arm_zanatomy_l.glb', manifest: 'arm_zanatomy_manifest.json', label: 'Z-Anatomy 左上肢（CC BY-SA 4.0）· 附著點與關節為近似推算值' },
  sample: { glb: 'arm_sample.glb', manifest: 'arm_manifest.json', label: '程序化樣本 · 尺寸與附著點為 placeholder，非解剖參考數據' },
};
const DEFAULT_MODEL = 'full';
const MOTIONS = [{ id: 'dumbbell_curl', label: '站姿啞鈴二頭彎舉' }];
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
  const [showFingers, setShowFingers] = useState(false);
  const [gripClosure, setGripClosure] = useState<Record<string, number>>({});

  useEffect(() => {
    const host = hostRef.current!;
    const eng = new AnatomyEngine(host);
    let alive = true;
    const q0 = new URLSearchParams(location.search);
    const model = MODELS[q0.get('model') ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL]!;
    eng
      .load(`${base}models/${model.glb}`, `${base}data/${model.manifest}`)
      .then(() => {
        if (!alive) return;
        eng.subscribe(force);
        // 除錯/驗收用：?pose=pose_elbow_90&select=biceps_brachii_left
        const q = new URLSearchParams(location.search);
        const preset = PRESET_POSES.find((p) => p.id === q.get('pose'));
        if (preset) eng.applyPose(preset);
        // ?j=hip_left:90,0,0;knee_left:100 ：直接指定關節角度（驗收 / 分享用）
        const jq = q.get('j');
        if (jq) {
          const angles: Record<string, number[]> = {};
          for (const part of jq.split(';')) {
            const [id, vals] = part.split(':');
            const nums = (vals ?? '').split(',').map(Number);
            if (id && nums.every(Number.isFinite)) angles[id] = nums;
          }
          eng.pose.setAngles(angles);
        }
        if (q.get('select')) eng.select(q.get('select'));
        // ?ik=dx,dy,dz（左手）/ ?ikr=dx,dy,dz（右手）：把手部相對目前位置移動（公尺），驗收雙側 IK 用
        for (const [param, side] of [['ik', 'left'], ['ikr', 'right']] as const) {
          const d = q.get(param)?.split(',').map(Number);
          if (!d || d.length !== 3 || !d.every(Number.isFinite)) continue;
          const p = eng.effectorPosition(side);
          if (p) {
            const err = eng.solveIK(p.add(new Vector3(d[0], d[1], d[2])), side);
            console.info(`[IK] ${side} residual`, err);
          }
        }
        setEngine(eng);
        (window as unknown as { dha: AnatomyEngine }).dha = eng;
        // M4.2：Visual QA Harness 只在開發模式載入（production build 會整段移除）
        if (import.meta.env.DEV && q.has('qa')) {
          void import('../dev/qaHarness').then((m) => m.installQAHarness(eng));
        }
        // ?motion=dumbbell_curl&t=1.1 ：載入情境動作並跳到指定時間（驗收 / 分享用）
        const mid = q.get('motion');
        if (mid) {
          eng.loadMotion(`${base}data/motions/${mid}.json`).then(() => {
            const t = Number(q.get('t'));
            if (Number.isFinite(t) && q.has('t')) eng.seekMotion(t);
            else eng.playMotion();
          });
        }
      })
      .catch((e: unknown) => {
        console.error('[load] failed', e instanceof Error ? e.stack : e);
        setError(String(e));
      });
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
                {engine?.displayName(s.id)}
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
        <h2>關於 / 授權</h2>
        <p className="muted about">
          程式碼 MIT · 模型 CC BY-SA 4.0
          <br />
          幾何：<a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" target="_blank" rel="noreferrer">Z-Anatomy</a>（CC BY-SA 4.0），衍生自 BodyParts3D © DBCLS（CC BY-SA 2.1 JP）
          <br />
          教學視覺化用途，非臨床數據。
        </p>
      </aside>

      <main className="viewport">
        <div ref={hostRef} className="canvas-host" />
        {!engine && !error && <div className="overlay">載入模型中…</div>}
        {error && <div className="overlay error">載入失敗：{error}</div>}
        <div className="badge">{(MODELS[new URLSearchParams(location.search).get('model') ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL]!).label}</div>
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
              {engine.roleOf(muscleDef.id) && (
                <>
                  <dt>動作角色</dt>
                  <dd><span className={`role ${engine.roleOf(muscleDef.id)}`}>{ROLE_ZH[engine.roleOf(muscleDef.id)!]}</span></dd>
                </>
              )}
              {muscleDef.members && (
                <>
                  <dt>包含</dt>
                  <dd>{muscleDef.members.join('、')}</dd>
                </>
              )}
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
              {engine.pose.jointIds.filter((jid) => showFingers || engine.pose.getDefinition(jid)?.group !== 'finger').map((jid) => {
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
              {engine.hasFootPlant && (
                <label className="slider">
                  <span>腳掌著地</span>
                  <select value={engine.plantMode} onChange={(e) => engine.setPlantMode(e.target.value as 'off' | 'both' | 'left' | 'right')}>
                    <option value="both">雙腳</option>
                    <option value="left">左腳固定</option>
                    <option value="right">右腳固定</option>
                    <option value="off">關閉（骨盆固定）</option>
                  </select>
                </label>
              )}
              {engine.hasIK && (
                <label className="check">
                  <input type="checkbox" checked={engine.isIKEnabled} onChange={(e) => engine.setIKEnabled(e.target.checked)} />
                  IK：拖曳把手移動手部（橘＝左手、藍＝右手，可分別拖曳）
                </label>
              )}
              {engine.hasIK &&
                engine.ikSides
                  .filter((s) => engine.ikErrorOf(s) > 0.005)
                  .map((s) => (
                    <p key={s} className="muted small" data-ik-side={s}>
                      {s === 'left' ? '左手' : '右手'}超出可達範圍 {(engine.ikErrorOf(s) * 100).toFixed(1)} cm
                    </p>
                  ))}
              <label className="check">
                <input type="checkbox" checked={showFingers} onChange={(e) => setShowFingers(e.target.checked)} />
                顯示手指關節
              </label>
              {engine.gripIds.length > 0 && (
                <>
                  <h2>握持</h2>
                  {engine.gripIds.map((gid) => {
                    // 接觸狀態依目前實際手指姿勢即時量測
                    const contact = engine.gripContactOf(gid) ?? {};
                    const gaps = engine.gripGapOf(gid) ?? {};
                    const touched = Object.values(contact).filter(Boolean).length;
                    const total = Object.keys(contact).length;
                    const open = Object.entries(gaps).filter(([f]) => !contact[f]).map(([, g]) => g);
                    const maxGapMm = open.length ? Math.max(...open) * 1000 : 0;
                    const v = gripClosure[gid] ?? (touched > 0 ? 1 : 0);
                    return (
                      <label key={gid} className="slider">
                        <span data-grip={gid} data-touched={touched} data-total={total}>
                          {gid.endsWith('left') ? '左手' : '右手'}握拳 {(v * 100).toFixed(0)}% · 接觸 {touched}/{total} 指
                          {open.length > 0 ? `（未接觸最大間隙 ${maxGapMm.toFixed(0)} mm）` : ''}
                        </span>
                        <input type="range" min={0} max={1} step={0.05} value={v} onChange={(e) => { const c = +e.target.value; setGripClosure({ ...gripClosure, [gid]: c }); engine.setGrip(gid, c); }} />
                      </label>
                    );
                  })}
                  {engine.loads().map((l) => (
                    <p key={l.id} className="muted small">
                      {l.side === 'left' ? '左' : '右'}肘外力矩 {l.torque.toFixed(1)} N·m（{l.massKg} kg × g × 水平力臂 {(l.leverArm * 100).toFixed(1)} cm）
                    </p>
                  ))}
                  {engine.loads().length > 0 && <p className="muted small">靜力近似：只算啞鈴重量，未含前臂自重與加速度。</p>}
                </>
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
              <h2>情境動作</h2>
              <div className="chips">
                {MOTIONS.map((m) => (
                  <button key={m.id} className={engine.activeMotion?.id === m.id ? 'primary' : ''} onClick={() => engine.loadMotion(`${base}data/motions/${m.id}.json`).then(() => engine.playMotion())}>
                    {m.label}
                  </button>
                ))}
                {engine.activeMotion && <button onClick={() => engine.setMotion(null)}>結束動作</button>}
              </div>
              {engine.activeMotion && (
                <div className="motion">
                  <div className="row">
                    <button onClick={() => (engine.motionState.playing ? engine.pauseMotion() : engine.playMotion())}>{engine.motionState.playing ? '❚❚ 暫停' : '▶ 播放'}</button>
                    <select value={engine.motionState.speed} onChange={(e) => engine.setMotionSpeed(+e.target.value)} aria-label="播放速度">
                      {[0.25, 0.5, 1, 1.5].map((s) => (
                        <option key={s} value={s}>{s}×</option>
                      ))}
                    </select>
                    <span className="muted">{engine.motionState.time.toFixed(1)} / {engine.activeMotion.duration.toFixed(1)} s</span>
                  </div>
                  <input className="timeline" type="range" min={0} max={engine.activeMotion.duration} step={0.01} value={engine.motionState.time} onChange={(e) => { engine.pauseMotion(); engine.seekMotion(+e.target.value); }} />
                  <p className="phase">{engine.currentPhase ?? ''}</p>
                  <label className="check">
                    <input type="checkbox" checked={engine.showRoles} onChange={(e) => { engine.showRoles = e.target.checked; engine.seekMotion(engine.motionState.time); }} />
                    以顏色標示肌肉角色
                  </label>
                  <p className="legend roles">
                    <span className="lg agonist" />主動肌 <span className="lg synergist" />協同肌 <span className="lg antagonist" />拮抗肌 <span className="lg stabilizer" />穩定肌
                  </p>
                  <p className="muted small">啟動曲線依教學文獻定性描述（{engine.activeMotion.activationConfidence}），非 EMG 量測。</p>
                </div>
              )}
              <h2>驗收姿勢</h2>
              <div className="chips">
                {PRESET_POSES.map((p) => (
                  <button key={p.id} onClick={() => { engine.setMotion(null); engine.applyPose(p); }}>{p.name}</button>
                ))}
              </div>
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
