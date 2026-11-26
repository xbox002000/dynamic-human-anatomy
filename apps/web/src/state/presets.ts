import type { PoseDefinition } from '@dha/anatomy-schema';

/** 藍圖 Phase 3 驗收姿勢：伸直 / 45° / 90° / 130°（肘屈曲） */
const elbow = (deg: number, bi: number, tri: number, name: string): PoseDefinition => ({
  id: `pose_elbow_${deg}`,
  name,
  bones: {},
  joints: { shoulder_left: [0, 0, 0], elbow_left: [deg] },
  activation: { biceps_brachii_left: bi, brachialis_left: Math.min(1, bi * 1.1), triceps_brachii_left: tri },
});

export const PRESET_POSES: PoseDefinition[] = [
  elbow(0, 0, 0, '手臂完全伸直'),
  elbow(45, 0.3, 0.05, '肘屈曲 45°'),
  elbow(90, 0.8, 0.1, '肘屈曲 90°'),
  elbow(130, 0.6, 0.05, '肘屈曲 130°'),
];

const KEY = 'dha.savedPoses.v1';

export function loadSavedPoses(): PoseDefinition[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as PoseDefinition[];
  } catch {
    return [];
  }
}

export function storeSavedPoses(p: PoseDefinition[]): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}
