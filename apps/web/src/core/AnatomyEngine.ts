import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnatomyManifest, MotionClip, MuscleRole, PoseDefinition } from '@dha/anatomy-schema';
import { validateManifest } from '@dha/anatomy-schema';
import { SceneManager } from './SceneManager';
import { PoseController } from '../skeleton/PoseController';
import { MuscleSystem } from '../muscles/MuscleSystem';
import { IKController } from '../skeleton/IKController';
import { GripController, elbowLoadTorque } from '../skeleton/GripController';
import { expandBilateral, roleFor, sampleMotion } from '../animation/motionSampler';

export type Layer = 'skin' | 'muscle' | 'bone';

/** 3D 引擎門面：UI 只透過此類別操作，不直接碰 Mesh（藍圖 §8.1） */
export class AnatomyEngine {
  readonly sm: SceneManager;
  pose!: PoseController;
  muscles!: MuscleSystem;
  manifest!: AnatomyManifest;
  private root!: THREE.Object3D;
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly baseColor = new Map<string, THREE.Color>();
  private readonly layers: Record<Layer, boolean> = { skin: true, muscle: true, bone: true };
  private selected: string | null = null;
  private isolated = false;
  private readonly listeners = new Set<() => void>();
  private readonly raycaster = new THREE.Raycaster();
  private pathLine: THREE.Line | null = null;
  private readonly pathDots = new THREE.Group();
  private playback: { frames: PoseDefinition[]; t: number; speed: number } | null = null;

  constructor(container: HTMLElement) {
    this.sm = new SceneManager(container);
    this.sm.scene.add(this.pathDots);
    this.sm.onUpdate((dt) => this.tick(dt));
    this.bindPicking(container);
  }

  async load(glbUrl: string, manifestUrl: string): Promise<void> {
    const [gltf, manifest] = await Promise.all([
      new GLTFLoader().loadAsync(glbUrl),
      fetch(manifestUrl).then((r) => r.json() as Promise<AnatomyManifest>),
    ]);
    const errs = validateManifest(manifest);
    if (errs.length) console.warn('[manifest]', errs);
    this.manifest = manifest;
    this.root = gltf.scene;
    this.sm.scene.add(this.root);

    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // glTF 匯出可能把 mesh 包在同名 node 底下；以 extras.anatomicalId 為準
      const id = (o.userData.anatomicalId as string) ?? (o.parent?.userData.anatomicalId as string) ?? o.name;
      o.userData.anatomicalId = id;
      o.userData.category = o.userData.category ?? o.parent?.userData.category;
      o.frustumCulled = false;
      const mat = (o.material as THREE.MeshStandardMaterial).clone();
      if (o.userData.category === 'skin') {
        mat.transparent = true;
        mat.opacity = 0.28;
        mat.depthWrite = false;
        o.renderOrder = 10;
      }
      o.material = mat;
      this.meshes.set(id, o);
      this.baseColor.set(id, mat.color.clone());
    });

    this.pose = new PoseController(this.root, manifest.joints);
    this.muscles = new MuscleSystem(this.root, manifest.muscles);
    this.grips.clear();
    for (const g of manifest.grips ?? []) {
      try {
        this.grips.set(g.id, new GripController(this.root, this.pose, g));
      } catch (e) {
        console.warn('[Grip] 未啟用', g.id, e);
      }
    }
    try {
      this.ik = new IKController(this.root, this.pose, { effector: 'hand_l', joints: ['shoulder_left', 'elbow_left'] });
      this.ikHandle = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 20, 14),
        new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.85, depthTest: false }),
      );
      this.ikHandle.renderOrder = 30;
      this.ikHandle.visible = this.ikEnabled;
      this.sm.scene.add(this.ikHandle);
      this.pose.subscribe(() => this.syncHandle());
      this.syncHandle();
    } catch (e) {
      console.warn('[IK] 未啟用', e);
    }
    this.pose.subscribe(() => this.muscles.update());
    this.muscles.subscribe(() => {
      this.refreshVisuals();
      this.emit();
    });
    this.muscles.update();
    this.sm.frame(this.root);
  }

  // ------------------------------------------------------------ selection
  get selection(): string | null {
    return this.selected;
  }

  select(id: string | null): void {
    this.selected = id && this.meshes.has(id) ? id : null;
    this.applyVisibility();
    this.refreshVisuals();
    this.emit();
  }

  setIsolated(v: boolean): void {
    this.isolated = v;
    this.applyVisibility();
    this.emit();
  }

  get isIsolated(): boolean {
    return this.isolated;
  }

  structures(): { id: string; category: string }[] {
    return [...this.meshes.entries()].map(([id, m]) => ({ id, category: String(m.userData.category ?? 'other') }));
  }

  displayName(id: string): string {
    return this.muscles?.getDefinition(id)?.name_zh ?? this.manifest?.structures?.find((s) => s.id === id)?.name_zh ?? id;
  }

  // ------------------------------------------------------------ layers
  getLayers(): Record<Layer, boolean> {
    return { ...this.layers };
  }

  setLayer(layer: Layer, on: boolean): void {
    this.layers[layer] = on;
    this.applyVisibility();
    this.emit();
  }

  private applyVisibility(): void {
    for (const [id, m] of this.meshes) {
      const cat = m.userData.category as Layer;
      let vis = this.layers[cat] ?? true;
      if (this.isolated && this.selected) vis = id === this.selected;
      m.visible = vis;
    }
  }

  // ------------------------------------------------------------ visuals
  private refreshVisuals(): void {
    for (const [id, m] of this.meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      const base = this.baseColor.get(id)!;
      mat.color.copy(base);
      mat.emissive.setRGB(0, 0, 0);
      const st = this.muscles?.getState(id);
      if (st) {
        // 啟動程度以紅→亮橘的自發光顯示（視覺化，不代表真實肌電）
        mat.emissive.setRGB(0.55 * st.activation, 0.18 * st.activation, 0);
        const role = this.showRoles ? this.roleOf(id) : undefined;
        if (role) mat.emissive.lerp(ROLE_COLOR[role], 0.35 + 0.4 * st.activation);
      }
      if (id === this.selected) mat.emissive.add(new THREE.Color(0.1, 0.22, 0.35));
    }
    this.drawPath();
  }

  private drawPath(): void {
    if (this.pathLine) {
      this.sm.scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
      this.pathLine = null;
    }
    this.pathDots.clear();
    const id = this.selected;
    if (!id || !this.muscles.getDefinition(id)) return;
    const pts = this.muscles.pathWorld(id);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.pathLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x5fd4ff, depthTest: false }));
    this.pathLine.renderOrder = 20;
    this.sm.scene.add(this.pathLine);
    const def = this.muscles.getDefinition(id)!;
    const nO = def.origin.length;
    const nI = def.insertion.length;
    pts.forEach((p, i) => {
      const color = i < nO ? 0x4cff7a : i >= pts.length - nI ? 0xffd24c : 0x5fd4ff;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      dot.position.copy(p);
      dot.renderOrder = 21;
      this.pathDots.add(dot);
    });
  }

  // ------------------------------------------------------------ picking
  private bindPicking(el: HTMLElement): void {
    let down = { x: 0, y: 0 };
    const ndcOf = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      if (!this.ik || !this.ikHandle || !this.ikEnabled) return;
      this.raycaster.setFromCamera(ndcOf(e), this.sm.camera);
      if (this.raycaster.intersectObject(this.ikHandle, false).length) {
        // 拖曳平面：通過把手、面向相機
        const n = this.sm.camera.getWorldDirection(new THREE.Vector3()).negate();
        this.dragPlane.setFromNormalAndCoplanarPoint(n, this.ikHandle.position);
        this.dragging = true;
        this.sm.controls.enabled = false;
        el.setPointerCapture(e.pointerId);
        e.stopPropagation();
      }
    }, { capture: true });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging || !this.ik) return;
      this.raycaster.setFromCamera(ndcOf(e), this.sm.camera);
      const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new THREE.Vector3());
      if (hit) {
        this.ikTarget.copy(hit);
        this.ikError = this.ik.solve(hit);
        this.ikHandle!.position.copy(hit);
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (this.dragging) {
        this.dragging = false;
        this.sm.controls.enabled = true;
        el.releasePointerCapture(e.pointerId);
        this.syncHandle();
        return;
      }
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return; // 拖曳旋轉不算點擊
      this.raycaster.setFromCamera(ndcOf(e), this.sm.camera);
      const candidates = [...this.meshes.values()].filter((m) => m.visible && m.userData.category !== 'skin');
      const hit = this.raycaster.intersectObjects(candidates, false)[0];
      this.select(hit ? (hit.object.userData.anatomicalId as string) : null);
    });
  }

  // ------------------------------------------------------------ IK
  private ik: IKController | null = null;
  private ikHandle: THREE.Mesh | null = null;
  private ikEnabled = true;
  private dragging = false;
  private readonly dragPlane = new THREE.Plane();
  private readonly ikTarget = new THREE.Vector3();
  /** 最近一次 IK 求解後與目標的距離（公尺），超出可達範圍時 > 0 */
  ikError = 0;

  get hasIK(): boolean {
    return !!this.ik;
  }

  get isIKEnabled(): boolean {
    return this.ikEnabled;
  }

  setIKEnabled(v: boolean): void {
    this.ikEnabled = v;
    if (this.ikHandle) this.ikHandle.visible = v;
    this.emit();
  }

  /** 以程式設定 IK 目標（測試 / 自動化用），回傳誤差 */
  solveIK(target: THREE.Vector3): number {
    if (!this.ik) return Infinity;
    this.ikError = this.ik.solve(target);
    this.syncHandle();
    return this.ikError;
  }

  effectorPosition(): THREE.Vector3 | null {
    return this.ik ? this.ik.effectorWorld() : null;
  }

  private syncHandle(): void {
    if (!this.ik || !this.ikHandle || this.dragging) return;
    this.ikHandle.position.copy(this.ik.effectorWorld());
  }

  // ------------------------------------------------------------ pose / playback
  capturePose(name: string): PoseDefinition {
    const id = 'pose_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'pose_' + Date.now();
    return this.pose.toPose(id, name, this.muscles.activations());
  }

  applyPose(p: PoseDefinition): void {
    if (p.joints) this.pose.setAngles(expandBilateral(p.joints, this.pose.jointIds));
    else this.pose.applyPose(p);
    if (p.activation) this.muscles.setActivations(expandBilateral(p.activation, this.muscles.ids));
  }

  play(frames: PoseDefinition[], secondsPerSegment = 1.2): void {
    if (frames.length < 2) return;
    this.playback = { frames, t: 0, speed: 1 / secondsPerSegment };
    this.emit();
  }

  stop(): void {
    this.playback = null;
    this.emit();
  }

  get isPlaying(): boolean {
    return !!this.playback;
  }

  private tick(dt: number): void {
    if (this.motion && this.motionPlaying) {
      this.motionTime += dt * this.motionSpeed;
      if (!this.motion.loop && this.motionTime >= this.motion.duration) {
        this.motionTime = this.motion.duration;
        this.motionPlaying = false;
      }
      this.applyMotionSample();
      return;
    }
    const pb = this.playback;
    if (!pb) return;
    pb.t += dt * pb.speed;
    const seg = Math.floor(pb.t);
    if (seg >= pb.frames.length - 1) {
      this.applyPose(pb.frames[pb.frames.length - 1]!);
      this.playback = null;
      this.emit();
      return;
    }
    const a = pb.frames[seg]!;
    const b = pb.frames[seg + 1]!;
    const k = smooth(pb.t - seg);
    const joints: Record<string, number[]> = {};
    for (const id of Object.keys(a.joints ?? {})) {
      const ja = a.joints![id]!;
      const jb = b.joints?.[id] ?? ja;
      joints[id] = ja.map((v, i) => v + ((jb[i] ?? v) - v) * k);
    }
    const act: Record<string, number> = {};
    for (const id of Object.keys(a.activation ?? {})) {
      const va = a.activation![id]!;
      const vb = b.activation?.[id] ?? va;
      act[id] = va + (vb - va) * k;
    }
    this.pose.setAngles(joints);
    this.muscles.setActivations(act);
  }

  // ------------------------------------------------------------ motion clips（情境動作）
  private motion: MotionClip | null = null;
  private motionTime = 0;
  private motionPlaying = false;
  private motionSpeed = 1;
  private readonly props: THREE.Object3D[] = [];
  private lastEmit = 0;
  showRoles = true;
  currentPhase: string | undefined;

  get activeMotion(): MotionClip | null {
    return this.motion;
  }

  get motionState(): { time: number; playing: boolean; speed: number } {
    return { time: this.motionTime, playing: this.motionPlaying, speed: this.motionSpeed };
  }

  async loadMotion(url: string): Promise<MotionClip> {
    const clip = (await fetch(url).then((r) => r.json())) as MotionClip;
    this.setMotion(clip);
    return clip;
  }

  setMotion(clip: MotionClip | null): void {
    this.motion = clip;
    this.motionTime = 0;
    this.motionPlaying = false;
    this.playback = null;
    this.attachProps();
    if (clip) this.applyMotionSample();
    this.refreshVisuals();
    this.emit();
  }

  playMotion(): void {
    if (!this.motion) return;
    if (!this.motion.loop && this.motionTime >= this.motion.duration) this.motionTime = 0;
    this.motionPlaying = true;
    this.emit();
  }

  pauseMotion(): void {
    this.motionPlaying = false;
    this.emit();
  }

  seekMotion(t: number): void {
    if (!this.motion) return;
    this.motionTime = THREE.MathUtils.clamp(t, 0, this.motion.duration);
    this.applyMotionSample();
    this.emit();
  }

  setMotionSpeed(s: number): void {
    this.motionSpeed = s;
    this.emit();
  }

  roleOf(muscleId: string): MuscleRole | undefined {
    return roleFor(this.motion, muscleId);
  }

  private applyMotionSample(): void {
    if (!this.motion) return;
    const s = sampleMotion(this.motion, this.motionTime);
    this.currentPhase = s.phase;
    this.pose.setAngles(expandBilateral(s.joints, this.pose.jointIds));
    this.muscles.setActivations(expandBilateral(s.activation, this.muscles.ids));
    // UI 節流：約 15 Hz 通知一次（3D 每幀更新）
    const now = performance.now();
    if (now - this.lastEmit > 66) {
      this.lastEmit = now;
      this.emit();
    }
  }

  /** 依動作定義在指定骨骼上掛道具（啞鈴）：握把放進掌心的握持圓柱，手指逐關節收合直到接觸 */
  private attachProps(): void {
    for (const p of this.props) p.removeFromParent();
    this.props.length = 0;
    this.heldMass.clear();
    this.gripContact.clear();
    for (const g of this.grips.values()) g.release();
    for (const def of this.motion?.props ?? []) {
      if (def.type !== 'dumbbell' || !def.bone) continue;
      const bone = this.root.getObjectByName(def.bone);
      if (!(bone instanceof THREE.Bone)) continue;
      const grip = [...this.grips.values()].find((g) => g.def.bone === def.bone);
      const db = makeDumbbell(grip?.def.radius ?? 0.015);
      if (grip) {
        db.position.copy(grip.centerLocal);
        db.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), grip.axisLocal);
        bone.add(db);
        const res = grip.solve(1);
        this.gripContact.set(grip.def.id, res.contact);
        this.heldMass.set(grip.def.id, def.massKg ?? 0);
      } else {
        bone.updateMatrixWorld(true);
        const child = bone.children.find((c) => c instanceof THREE.Bone);
        const len = child ? child.position.length() : 0.08;
        db.position.set(0, len * 0.45, 0);
        db.rotation.set(0, 0, Math.PI / 2);
        bone.add(db);
      }
      this.props.push(db);
    }
  }

  // ------------------------------------------------------------ grip / load
  private readonly grips = new Map<string, GripController>();
  private readonly gripContact = new Map<string, Record<string, boolean>>();
  private readonly heldMass = new Map<string, number>();

  get gripIds(): string[] {
    return [...this.grips.keys()];
  }

  /** 手動握拳 / 張開（closure 0..1）；沒有道具時握把為虛擬圓柱 */
  setGrip(id: string, closure: number): void {
    const g = this.grips.get(id);
    if (!g) return;
    if (closure <= 0) g.release();
    else this.gripContact.set(id, g.solve(closure).contact);
    this.emit();
  }

  gripContactOf(id: string): Record<string, boolean> | undefined {
    return this.gripContact.get(id);
  }

  /** 每側：握持重量對肘關節的外力矩（N·m）與水平力臂（m） */
  loads(): { id: string; side: string; massKg: number; torque: number; leverArm: number }[] {
    const out: { id: string; side: string; massKg: number; torque: number; leverArm: number }[] = [];
    for (const [id, g] of this.grips) {
      const mass = this.heldMass.get(id) ?? 0;
      if (!mass) continue;
      const elbow = this.manifest.joints.find((j) => j.id === `elbow_${g.def.side}`);
      const fore = elbow ? this.root.getObjectByName(elbow.bone) : null;
      if (!fore) continue;
      const ew = fore.getWorldPosition(new THREE.Vector3());
      const { center } = g.handleWorld();
      out.push({ id, side: g.def.side, massKg: mass, ...elbowLoadTorque(mass, ew, center) });
    }
    return out;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  dispose(): void {
    this.sm.dispose();
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 啞鈴（Y 軸為握把方向，單位：公尺） */
function makeDumbbell(radius = 0.015): THREE.Group {
  const g = new THREE.Group();
  g.name = 'prop_dumbbell';
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.7, roughness: 0.35 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.8, roughness: 0.25 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.14, 20), grip);
  g.add(handle);
  for (const y of [-0.1, 0.1]) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 28), metal);
    plate.position.y = y;
    g.add(plate);
  }
  g.traverse((o) => (o.userData.category = 'prop'));
  return g;
}

const ROLE_COLOR: Record<MuscleRole, THREE.Color> = {
  agonist: new THREE.Color(0.75, 0.3, 0.0),
  synergist: new THREE.Color(0.55, 0.45, 0.0),
  antagonist: new THREE.Color(0.0, 0.25, 0.6),
  stabilizer: new THREE.Color(0.2, 0.35, 0.2),
  stretched: new THREE.Color(0.45, 0.0, 0.55),
};
