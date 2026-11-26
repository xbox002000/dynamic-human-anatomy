import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Renderer / Camera / Lights / 迴圈。不含任何解剖邏輯。 */
export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private grid!: THREE.GridHelper;
  private readonly updaters = new Set<(dt: number) => void>();
  private readonly clock = new THREE.Clock();
  private raf = 0;
  private readonly ro: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x14171c);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.2);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 2, 2);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.8);
    rim.position.set(-2, 1, -2);
    this.scene.add(hemi, key, rim);

    const grid = new THREE.GridHelper(2, 20, 0x2a3038, 0x20252c);
    grid.position.y = -0.3;
    this.grid = grid;
    this.scene.add(grid);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.loop();
  }

  /** 依物件包圍盒設定相機 */
  frame(obj: THREE.Object3D, dir = new THREE.Vector3(1, 0.25, 0.7)): void {
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(center);
    this.grid.position.y = box.min.y - size * 0.05;
    this.camera.position.copy(center).add(dir.normalize().multiplyScalar(size * 2.1));
    this.camera.near = size / 100;
    this.camera.far = size * 50;
    this.camera.updateProjectionMatrix();
    // 供自動截圖等工具判斷模型已載入並完成取景
    this.renderer.domElement.dataset.framed = '1';
  }

  onUpdate(fn: (dt: number) => void): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.clock.getDelta();
    for (const fn of this.updaters) fn(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
