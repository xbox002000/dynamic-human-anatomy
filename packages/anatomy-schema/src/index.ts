/**
 * @dha/anatomy-schema
 * 共用解剖資料模型：靜態解剖資產與動態人體 Rig 透過 anatomicalId 對應。
 * 設計原則：Pose / Activation / Deformation 三者資料來源分離。
 */

export type Side = 'left' | 'right' | 'midline';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** 資料可信度：未經量測或可靠模擬的數值不得標示為真實生理數值 */
export type Confidence = 'placeholder' | 'approximate' | 'literature' | 'measured';

export interface SourceInfo {
  dataset: string;
  license: string;
  attribution?: string;
  url?: string;
  derivedFrom?: string;
}

/** 附著點：座標以所屬骨骼的局部空間表示，才能隨姿勢移動 */
export interface AttachmentPoint {
  bone: string;
  position: Vec3;
  confidence: Confidence;
}

export type MuscleArchitecture = 'fusiform' | 'pennate' | 'bipennate' | 'multipennate' | 'flat' | 'circular' | 'multihead';

export interface MuscleDefinition {
  id: string;
  name: string;
  name_zh: string;
  name_latin?: string;
  side: Side;
  region: string;
  architecture: MuscleArchitecture;
  /** 對應 GLB 中的 mesh 名稱 */
  mesh: string;
  origin: AttachmentPoint[];
  insertion: AttachmentPoint[];
  via_points: AttachmentPoint[];
  joints_crossed: string[];
  function?: string[];
  /** 肌群包含的個別肌肉（群組 mesh 時使用） */
  members?: string[];
  innervation?: string;
  /** 預設啟動程度 0..1（執行期狀態另存於 MuscleState） */
  activation: number;
  deformation_profile: string;
  /** 該 mesh 上的 morph target 名稱對應 */
  morphs?: {
    contract?: string;
    stretch?: string;
    bulge?: string;
  };
  source: SourceInfo;
}

export interface JointAxisLimit {
  axis: 'x' | 'y' | 'z';
  minDeg: number;
  maxDeg: number;
  confidence: Confidence;
  /** 旋轉軸（rest pose 模型空間的單位向量）；正角度 = 繞此向量右手旋轉 */
  vector?: Vec3;
  label?: string;
}

export interface JointDefinition {
  id: string;
  bone: string;
  side: Side;
  restDeg: Vec3;
  limits: JointAxisLimit[];
  mirrorOf?: string;
  /** rest pose 模型空間的關節中心 */
  center?: Vec3;
  /** UI 分組（例如 finger：手指關節預設收合顯示） */
  group?: string;
}

/** 手指鏈：關節與骨段依近端→遠端排列 */
export interface FingerChain {
  id: string;
  name_zh: string;
  joints: string[];
  segments: { bone: string; head: Vec3; tail: Vec3 }[];
}

/** 握持幾何：握把（圓柱）在 rest pose 模型空間的位置，綁在 bone 上 */
export interface GripDefinition {
  id: string;
  side: Side;
  bone: string;
  center: Vec3;
  /** 握把軸向（單位向量） */
  axis: Vec3;
  palmNormal: Vec3;
  /** 握把半徑（公尺） */
  radius: number;
  /** 手指軟組織半徑（骨段中心線到皮膚，公尺） */
  fingerRadius: number;
  confidence: Confidence;
  fingers: FingerChain[];
}

export interface BoneTransform {
  /** 局部旋轉 quaternion (x, y, z, w) */
  rotation: Quat;
  position?: Vec3;
  scale?: Vec3;
}

export interface PoseDefinition {
  id: string;
  name: string;
  bones: Record<string, BoneTransform>;
  /** 關節角度（度），順序對應 JointDefinition.limits；可由此重建 bones */
  joints?: Record<string, number[]>;
  /** 啟動與姿勢分離存放，可選 */
  activation?: Record<string, number>;
}

export interface MotionKeyframe {
  /** 秒 */
  t: number;
  /** 關節角度（度），只需列出有變化的關節 */
  joints?: Record<string, number[]>;
  /** 肌肉啟動 0..1（與姿勢分離的獨立通道） */
  activation?: Record<string, number>;
  label?: string;
}

export type MuscleRole = 'agonist' | 'synergist' | 'antagonist' | 'stabilizer' | 'stretched';

export interface PropDefinition {
  type: 'dumbbell' | 'mat';
  bone?: string;
  massKg?: number;
}

/** 情境動作：姿勢關鍵影格 + 啟動曲線 + 肌肉角色 */
export interface MotionClip {
  id: string;
  name: string;
  name_zh: string;
  description?: string;
  duration: number;
  loop?: boolean;
  keyframes: MotionKeyframe[];
  roles?: Record<string, MuscleRole>;
  props?: PropDefinition[];
  /** 啟動曲線依據 */
  activationConfidence: Confidence;
  phases?: { t0: number; t1: number; label: string }[];
}

export interface AnatomyManifest {
  version: string;
  coordinateSystem: {
    up: 'Y';
    forward: '+Z';
    unit: 'meter';
    handedness: 'right';
  };
  joints: JointDefinition[];
  muscles: MuscleDefinition[];
  /** 非肌肉結構（骨骼等）的顯示名稱 */
  structures?: { id: string; name: string; name_zh: string; category: string; side: Side }[];
  /** 手部握持幾何（每側一筆） */
  grips?: GripDefinition[];
}

/** 執行期肌肉狀態（Deformation 輸入） */
export interface MuscleState {
  id: string;
  length: number;
  restLength: number;
  activation: number;
  /** 0 = 靜止長度, >0 = 縮短比例 */
  contraction: number;
  /** >0 = 被拉長比例 */
  stretch: number;
  bulge: number;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function validateMuscle(m: MuscleDefinition): string[] {
  const errs: string[] = [];
  if (!/^[a-z0-9_]+$/.test(m.id)) errs.push(`${m.id}: id 必須是 snake_case`);
  if (m.side !== 'midline' && !m.id.endsWith(`_${m.side}`)) errs.push(`${m.id}: id 後綴與 side 不一致`);
  if (m.origin.length === 0) errs.push(`${m.id}: 缺少 origin`);
  if (m.insertion.length === 0) errs.push(`${m.id}: 缺少 insertion`);
  if (m.joints_crossed.length === 0) errs.push(`${m.id}: 缺少 joints_crossed`);
  if (m.activation < 0 || m.activation > 1) errs.push(`${m.id}: activation 超出 0..1`);
  if (!m.source?.license) errs.push(`${m.id}: 缺少 license`);
  return errs;
}

export function validateManifest(man: AnatomyManifest): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const jointIds = new Set(man.joints.map((j) => j.id));
  for (const m of man.muscles) {
    if (ids.has(m.id)) errs.push(`重複 id: ${m.id}`);
    ids.add(m.id);
    errs.push(...validateMuscle(m));
    for (const j of m.joints_crossed) if (!jointIds.has(j)) errs.push(`${m.id}: 未定義關節 ${j}`);
  }
  for (const j of man.joints) {
    for (const l of j.limits) if (l.minDeg > l.maxDeg) errs.push(`${j.id}: ${l.axis} min > max`);
  }
  return errs;
}
