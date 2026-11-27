/**
 * M4.2 Visual QA Harness（只在 Vite DEV 模式掛載，production build 不包含）。
 * 由 tools/dev/visual-qa.mjs 透過 CDP 呼叫 window.__dhaQA。
 * 相機取景以「載入時的 rest pose 包圍盒」為準，之後不隨姿勢改變，讓不同姿勢的截圖可比較。
 */
import * as THREE from 'three';
import type { AnatomyEngine, Layer } from '../core/AnatomyEngine';
import type { PlantMode } from '../skeleton/FootPlant';

export type QAView = 'front' | 'threeQuarter' | 'side' | 'back';

const VIEW_DIRS: Record<QAView, [number, number, number]> = {
  // GL：+Z = 人體前方、+X = 人體左側
  front: [0, 0.08, 1],
  threeQuarter: [0.75, 0.18, 0.9],
  side: [1, 0.05, 0],
  back: [0, 0.08, -1],
};

export interface QASnapshot {
  pelvis: [number, number, number];
  groundY: number | null;
  plantMode: PlantMode;
  feet: Record<'left' | 'right', { kind: string; now: [number, number, number]; rest: [number, number, number]; heightAboveGround: number; horizontalSlip: number } | null>;
  muscles: Record<string, { ratio: number; contraction: number; stretch: number; bulge: number; activation: number }>;
  errors: string[];
}

const r5 = (v: THREE.Vector3): [number, number, number] => [+v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5)];

export function installQAHarness(eng: AnatomyEngine): void {
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${String(e.reason)}`));

  eng.pose.reset();
  eng.model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(eng.model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  let current: { view: QAView; zoom: number; target?: [number, number, number] } = { view: 'front', zoom: 1 };

  const sm = eng.sm;
  const setCamera = (view: QAView = 'front', zoom = 1, target?: [number, number, number]) => {
    current = { view, zoom, target };
    sm.controls.enableDamping = false;
    const tgt = target ? new THREE.Vector3(...target) : center.clone();
    const dist = (Math.max(size.y, size.x) / 2 / Math.tan(THREE.MathUtils.degToRad(sm.camera.fov / 2))) * 1.15 / zoom;
    sm.controls.target.copy(tgt);
    sm.camera.position.copy(tgt).add(new THREE.Vector3(...VIEW_DIRS[view]).normalize().multiplyScalar(dist));
    sm.camera.near = dist / 100;
    sm.camera.far = dist * 20;
    sm.camera.updateProjectionMatrix();
    sm.controls.update();
  };

  const frames = (n = 3) =>
    new Promise<void>((res) => {
      const step = (k: number) => (k <= 0 ? res() : requestAnimationFrame(() => step(k - 1)));
      step(n);
    });

  const snapshot = (ids?: string[]): QASnapshot => {
    eng.model.updateMatrixWorld(true);
    const pelvis = eng.model.getObjectByName('pelvis')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
    const g = eng.groundY;
    const foot = (side: 'left' | 'right') => {
      const s = eng.footSupport(side);
      if (!s) return null;
      return {
        kind: s.kind,
        now: r5(s.now),
        rest: r5(s.rest),
        heightAboveGround: +(s.now.y - (g ?? 0)).toFixed(5),
        horizontalSlip: +Math.hypot(s.now.x - s.rest.x, s.now.z - s.rest.z).toFixed(5),
      };
    };
    const muscles: QASnapshot['muscles'] = {};
    for (const id of ids ?? eng.muscles.ids) {
      const st = eng.muscles.getState(id);
      if (!st) continue;
      muscles[id] = {
        ratio: +(st.length / st.restLength).toFixed(4),
        contraction: +st.contraction.toFixed(3),
        stretch: +st.stretch.toFixed(3),
        bulge: +st.bulge.toFixed(3),
        activation: +st.activation.toFixed(3),
      };
    }
    return { pelvis: r5(pelvis), groundY: g, plantMode: eng.plantMode, feet: { left: foot('left'), right: foot('right') }, muscles, errors: [...errors] };
  };

  const api = {
    ready: true,
    joints: () => eng.manifest.joints.map((j) => ({ id: j.id, limits: j.limits.map((l) => [l.axis, l.minDeg, l.maxDeg, l.label]) })),
    /** 回到 rest pose（所有關節角度 = restDeg、activation = 0、FootPlant = both、所有圖層開啟、取消選取） */
    reset: async () => {
      eng.stop();
      eng.setMotion?.(null);
      eng.pose.reset();
      eng.muscles.setActivations(Object.fromEntries(eng.muscles.ids.map((id) => [id, 0])));
      if (eng.hasFootPlant) eng.setPlantMode('both');
      for (const l of ['skin', 'muscle', 'bone'] as Layer[]) eng.setLayer(l, true);
      eng.select(null);
      eng.setIsolated(false);
      setCamera(current.view, current.zoom, current.target);
      await frames();
    },
    /** 套用關節角度；超出 limits 的值由 PoseController 夾住，回傳實際角度 */
    setAngles: async (angles: Record<string, number[]>) => {
      eng.pose.setAngles(angles);
      await frames();
      const out: Record<string, number[]> = {};
      for (const id of Object.keys(angles)) out[id] = eng.pose.getAngles(id) ?? [];
      return out;
    },
    setPlantMode: async (m: PlantMode) => {
      eng.setPlantMode(m);
      await frames();
    },
    setActivations: async (a: Record<string, number>) => {
      eng.muscles.setActivations(a);
      await frames();
    },
    setLayers: async (l: Partial<Record<Layer, boolean>>) => {
      for (const [k, v] of Object.entries(l)) eng.setLayer(k as Layer, !!v);
      await frames();
    },
    select: async (id: string | null) => {
      eng.select(id);
      await frames();
    },
    /** 只顯示目前選取項目（對應 UI「只顯示選取項目」） */
    setIsolated: async (v: boolean) => {
      eng.setIsolated(v);
      await frames();
    },
    setCamera: async (view: QAView, zoom = 1, target?: [number, number, number]) => {
      setCamera(view, zoom, target);
      await frames();
    },
    /** 骨骼的世界座標（給相機對準局部） */
    bonePos: (name: string) => {
      eng.model.updateMatrixWorld(true);
      const b = eng.model.getObjectByName(name);
      return b ? r5(b.getWorldPosition(new THREE.Vector3())) : null;
    },
    frames,
    snapshot,
  };
  (window as unknown as { __dhaQA: typeof api }).__dhaQA = api;
  setCamera('front');
}
