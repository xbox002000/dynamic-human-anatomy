/** 純數學工具（無 Three.js 依賴，方便單元測試） */

export type P3 = readonly [number, number, number];

export function polylineLength(points: readonly P3[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    len += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return len;
}

const clamp01 = (v: number) => (v <= 0 ? 0 : v > 1 ? 1 : v);

export interface DeformInput {
  length: number;
  restLength: number;
  activation: number;
  /** 視為「完全縮短」的應變（相對 rest），預設 0.30 */
  maxShortening?: number;
  /** 視為「完全拉長」的應變，預設 0.20 */
  maxLengthening?: number;
}

export interface DeformOutput {
  /** 0..1 縮短比例（純幾何，只由路徑長度決定） */
  contraction: number;
  /** 0..1 拉長比例（純幾何，只由路徑長度決定） */
  stretch: number;
  /** 0..1 肌腹隆起（幾何縮短 + 主動啟動） */
  bulge: number;
  /** morph 權重：徑向隆起（可由 activation 驅動） */
  bulgeWeight: number;
  /** morph 權重：縱向縮短（只由幾何縮短驅動，activation 不得影響） */
  shortenWeight: number;
  /** morph 權重：拉長變細 */
  stretchWeight: number;
}

/**
 * Procedural deformation profile: fusiform_v2（M2.6）
 * - 縱向長度只由 Pose 決定：shortenWeight = contraction（幾何），與 activation 無關。
 *   等長收縮（activation 高、長度不變）時肌肉不會變短。
 * - activation 只影響徑向：肌腹更飽滿（bulge），並抵銷部分拉長變細。
 * 純視覺模型，不代表真實肌力或生理數值。
 */
export function fusiformV2(i: DeformInput): DeformOutput {
  const maxS = i.maxShortening ?? 0.3;
  const maxL = i.maxLengthening ?? 0.2;
  const strain = (i.length - i.restLength) / i.restLength; // <0 縮短
  const contraction = clamp01(-strain / maxS);
  const stretch = clamp01(strain / maxL);
  const a = clamp01(i.activation);
  const bulge = clamp01(contraction * 0.7 + a * (0.4 + 0.6 * contraction));
  return {
    contraction,
    stretch,
    bulge,
    bulgeWeight: bulge,
    shortenWeight: contraction,
    stretchWeight: clamp01(stretch * (1 - 0.6 * a)),
  };
}

/** 舊名保留為別名，避免既有 manifest 失效 */
export const fusiformV1 = fusiformV2;

export const DEFORMATION_PROFILES: Record<string, (i: DeformInput) => DeformOutput> = {
  fusiform_v1: fusiformV2,
  fusiform_v2: fusiformV2,
};
