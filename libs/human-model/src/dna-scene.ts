import * as THREE from "three";
import {
  DNA_BASES,
  DNA_FINDING_COLOR,
  type DnaInterval,
  type DnaBase,
  type DnaViewMode,
  type SequenceWindow,
} from "./dna-sequence";

const PAIRS = 96;
const SPACING = 0.42;
const RADIUS = 2.05;
const TUBE_RADIUS = 0.036;
const TURN = (Math.PI * 2) / 10.5;
const SEGMENTS = 5;

type DnaRenderer = Pick<
  THREE.WebGLRenderer,
  | "setSize"
  | "setPixelRatio"
  | "setClearColor"
  | "render"
  | "dispose"
  | "forceContextLoss"
  | "outputColorSpace"
  | "toneMapping"
  | "toneMappingExposure"
>;

/** Owns a fixed GPU pool; genome size never changes geometry or draw-call count. */
export class DnaScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-4, 4, 8, -8, 0.1, 60);
  private readonly cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  private readonly backboneMaterial = new THREE.MeshStandardMaterial({
    color: "#63736d",
    metalness: 0,
    roughness: 0.78,
  });
  private readonly baseMaterial = new THREE.MeshPhysicalMaterial({
    metalness: 0.08,
    roughness: 0.28,
    clearcoat: 0.7,
    clearcoatRoughness: 0.18,
  });
  private readonly backbones = new THREE.InstancedMesh(
    this.cylinder,
    this.backboneMaterial,
    PAIRS * SEGMENTS * 2,
  );
  private readonly bases = new THREE.InstancedMesh(
    this.cylinder,
    this.baseMaterial,
    PAIRS * 2,
  );
  private readonly transform = new THREE.Object3D();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly color = new THREE.Color();
  private readonly renderer: DnaRenderer;
  private readonly observer: ResizeObserver;
  private readonly motion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private frame: number | undefined;
  private previousTime = 0;
  private position = 0;
  private target = 0;
  private orientation = 0.3;
  private unwind = 0;
  private unwindTarget = 0;
  private active = false;
  private disposed = false;
  private lost = false;
  private sequence: SequenceWindow | undefined;
  private highlights: readonly DnaInterval[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly length: number,
    private readonly onError: () => void,
    createRenderer?: (canvas: HTMLCanvasElement) => DnaRenderer,
  ) {
    this.renderer =
      createRenderer?.(canvas) ??
      new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.camera.position.set(0, 0, 22);
    this.scene.add(new THREE.AmbientLight("#ffffff", 0.65));
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#c8d9da", 0.75));
    const key = new THREE.DirectionalLight("#ffffff", 1.25);
    key.position.set(1.5, 3, 4);
    const rim = new THREE.DirectionalLight("#8ee8dc", 0.45);
    rim.position.set(-3, 2.7, -2.8);
    const fill = new THREE.DirectionalLight("#dceff7", 0.35);
    fill.position.set(2, 1.5, -2);
    this.scene.add(key, rim, fill, this.backbones, this.bases);
    for (const mesh of [this.backbones, this.bases]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // The entire fixed pool spans this viewport; per-instance culling is unnecessary.
      mesh.frustumCulled = false;
    }
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    document.addEventListener("visibilitychange", this.visibilityChanged);
    this.motion.addEventListener("change", this.invalidate);
    canvas.addEventListener("webglcontextlost", this.contextLost);
    this.resize();
  }

  setPosition(position: number, immediate = false) {
    this.target = position;
    if (immediate || Math.abs(position - this.position) > PAIRS) {
      this.position = position;
      this.orientation = THREE.MathUtils.euclideanModulo(
        position * 0.28 * TURN + 0.3,
        Math.PI * 2,
      );
    }
    this.invalidate();
  }

  setMode(mode: DnaViewMode, immediate = false) {
    this.unwindTarget = mode === "ladder" ? 1 : 0;
    if (immediate) this.unwind = this.unwindTarget;
    this.invalidate();
  }

  setSequence(sequence: SequenceWindow) {
    this.sequence = sequence;
    this.invalidate();
  }

  setHighlights(highlights: readonly DnaInterval[]) {
    this.highlights = highlights;
    this.invalidate();
  }

  setActive(active: boolean) {
    this.active = active;
    this.visibilityChanged();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.motion.removeEventListener("change", this.invalidate);
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    for (const mesh of [this.backbones, this.bases]) mesh.dispose();
    this.cylinder.dispose();
    this.backboneMaterial.dispose();
    this.baseMaterial.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private readonly resize = () => {
    if (this.disposed) return;
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height, false);
    const halfHeight = Math.max(((height / 20) * SPACING) / 2, 4.5);
    const halfWidth = Math.max(3.1, (halfHeight * width) / height);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  };

  private readonly contextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.visibilityChanged();
    this.onError();
  };

  private readonly visibilityChanged = () => {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.previousTime = 0;
    this.invalidate();
  };

  private readonly invalidate = () => {
    if (
      this.disposed ||
      this.lost ||
      !this.active ||
      document.hidden ||
      this.frame !== undefined
    )
      return;
    this.frame = requestAnimationFrame(this.render);
  };

  private point(index: number, side: number, vector: THREE.Vector3) {
    // Reduce continuous local twist rather than collapsing the rungs through each other.
    const angle =
      ((index - this.position) * TURN + this.orientation) * (1 - this.unwind) +
      side * Math.PI;
    return vector.set(
      Math.cos(angle) * RADIUS,
      (this.position - index) * SPACING,
      Math.sin(angle) * RADIUS,
    );
  }

  private cylinderBetween(
    mesh: THREE.InstancedMesh,
    slot: number,
    radius: number,
  ) {
    this.direction.subVectors(this.to, this.from);
    const distance = this.direction.length();
    this.transform.position.copy(this.from).add(this.to).multiplyScalar(0.5);
    this.transform.quaternion.setFromUnitVectors(
      this.up,
      this.direction.normalize(),
    );
    this.transform.scale.set(radius, distance, radius);
    this.transform.updateMatrix();
    mesh.setMatrixAt(slot, this.transform.matrix);
  }

  private readonly render = (time: number) => {
    this.frame = undefined;
    if (this.disposed || this.lost || !this.active || document.hidden) return;
    const delta = this.previousTime
      ? Math.min((time - this.previousTime) / 1000, 0.05)
      : 1 / 60;
    this.previousTime = time;
    const previousPosition = this.position;
    this.position = this.motion.matches
      ? this.target
      : THREE.MathUtils.damp(this.position, this.target, 18, delta);
    if (Math.abs(this.position - this.target) < 0.001)
      this.position = this.target;
    this.orientation = this.motion.matches
      ? 0.3
      : this.orientation + (this.position - previousPosition) * 0.28 * TURN;
    this.unwind = this.motion.matches
      ? this.unwindTarget
      : THREE.MathUtils.damp(this.unwind, this.unwindTarget, 8, delta);
    if (Math.abs(this.unwind - this.unwindTarget) < 0.0005)
      this.unwind = this.unwindTarget;
    // Whole turns are equivalent at either endpoint. Keep angles continuous during a morph.
    if (this.unwind === 0 || this.unwind === 1)
      this.orientation = THREE.MathUtils.euclideanModulo(
        this.orientation,
        Math.PI * 2,
      );
    const first = Math.floor(this.position) - PAIRS / 2;
    let backboneSlot = 0;
    for (let slot = 0; slot < PAIRS; slot++) {
      const index = first + slot;
      const valid = index >= 0 && index < this.length;
      const highlighted =
        valid &&
        this.highlights.some(({ start, end }) => index >= start && index < end);
      const base = this.sequence?.bases[index - this.sequence.start] as
        DnaBase | undefined;
      for (let side = 0; side < 2; side++) {
        const instance = slot * 2 + side;
        this.point(index, side, this.from);
        this.to.set(0, this.from.y, 0);
        this.cylinderBetween(this.bases, instance, valid ? TUBE_RADIUS : 0);
        const letter = base && side === 1 ? DNA_BASES[base].complement : base;
        this.bases.setColorAt(
          instance,
          this.color.set(
            highlighted ? DNA_FINDING_COLOR : DNA_BASES[letter ?? "N"].color,
          ),
        );
        for (let segment = 0; segment < SEGMENTS; segment++) {
          this.point(index + segment / SEGMENTS, side, this.from);
          this.point(index + (segment + 1) / SEGMENTS, side, this.to);
          this.cylinderBetween(
            this.backbones,
            backboneSlot++,
            valid && index + 1 < this.length ? TUBE_RADIUS : 0,
          );
        }
      }
    }
    for (const mesh of [this.backbones, this.bases])
      mesh.instanceMatrix.needsUpdate = true;
    if (this.bases.instanceColor) this.bases.instanceColor.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    if (this.position !== this.target || this.unwind !== this.unwindTarget)
      this.invalidate();
    else this.previousTime = 0;
  };
}
