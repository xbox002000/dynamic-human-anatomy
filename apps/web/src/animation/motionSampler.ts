import type { MotionClip, MotionKeyframe, MuscleRole } from '@dha/anatomy-schema';

/** 純函式：無 Three.js 依賴，可單元測試 */

export interface MotionSample {
  joints: Record<string, number[]>;
  activation: Record<string, number>;
  phase?: string;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 找出 t 所在的關鍵影格區間 */
function bracket(kfs: MotionKeyframe[], t: number): [MotionKeyframe, MotionKeyframe, number] {
  if (t <= kfs[0]!.t) return [kfs[0]!, kfs[0]!, 0];
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!;
    const b = kfs[i + 1]!;
    if (t <= b.t) return [a, b, b.t > a.t ? (t - a.t) / (b.t - a.t) : 1];
  }
  const last = kfs[kfs.length - 1]!;
  return [last, last, 0];
}

/** 在時間 t 取樣（鍵為「不含側別」的通用名稱） */
export function sampleMotion(clip: MotionClip, t: number): MotionSample {
  const time = clip.loop ? ((t % clip.duration) + clip.duration) % clip.duration : Math.min(Math.max(t, 0), clip.duration);
  const [a, b, k0] = bracket(clip.keyframes, time);
  const k = smooth(k0);
  const joints: Record<string, number[]> = {};
  for (const id of new Set([...Object.keys(a.joints ?? {}), ...Object.keys(b.joints ?? {})])) {
    const ja = a.joints?.[id] ?? b.joints?.[id] ?? [];
    const jb = b.joints?.[id] ?? ja;
    joints[id] = ja.map((v, i) => v + ((jb[i] ?? v) - v) * k);
  }
  const activation: Record<string, number> = {};
  for (const id of new Set([...Object.keys(a.activation ?? {}), ...Object.keys(b.activation ?? {})])) {
    const va = a.activation?.[id] ?? b.activation?.[id] ?? 0;
    const vb = b.activation?.[id] ?? va;
    activation[id] = va + (vb - va) * k0; // 啟動線性內插，避免平滑造成延遲
  }
  const phase = clip.phases?.find((p) => time >= p.t0 && time < p.t1)?.label;
  return { joints, activation, phase };
}

/** 把通用鍵展開到實際存在的 ID（bilateral：`x` → `x_left`、`x_right`；已帶側別或完全相符則原樣） */
export function expandBilateral<T>(values: Record<string, T>, available: readonly string[]): Record<string, T> {
  const set = new Set(available);
  const out: Record<string, T> = {};
  for (const [key, v] of Object.entries(values)) {
    if (set.has(key)) {
      out[key] = v;
      continue;
    }
    for (const s of ['left', 'right']) if (set.has(`${key}_${s}`)) out[`${key}_${s}`] = v;
  }
  return out;
}

export function roleFor(clip: MotionClip | null, muscleId: string): MuscleRole | undefined {
  if (!clip?.roles) return undefined;
  return clip.roles[muscleId] ?? clip.roles[muscleId.replace(/_(left|right)$/, '')];
}

export const ROLE_ZH: Record<MuscleRole, string> = {
  agonist: '主動肌',
  synergist: '協同肌',
  antagonist: '拮抗肌',
  stabilizer: '穩定肌',
  stretched: '伸展目標',
};
