import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ANATOMY_REGIONS } from "./anatomy";
import { fitCameraToObject } from "./camera";
import { AnatomyHighlighter } from "./highlight";
import {
  disposeHumanModel,
  getEmbeddedAnatomyAnchors,
  loadHumanModel,
} from "./model";
import type { ModelProfile } from "./profiles";
import type { HumanModelHighlight, HumanModelState } from "./types";

type SceneRenderer = Pick<
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

/** Test seams at the GPU and network boundaries, not scene policy. */
export interface SceneDependencies {
  createRenderer?: (canvas: HTMLCanvasElement) => SceneRenderer;
  loadModel?: typeof loadHumanModel;
}

/** Owns one canvas, its async model generation, and every associated GPU resource. */
export class HumanModelScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  private readonly renderer: SceneRenderer;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly motion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private model: THREE.Group | undefined;
  private highlighter: AnatomyHighlighter | undefined;
  private highlights: readonly HumanModelHighlight[] = [];
  private loading: AbortController | undefined;
  private generation = 0;
  private disposed = false;
  private visible = true;
  private frame: number | undefined;
  private contextLost = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onState: (state: HumanModelState) => void,
    private readonly dependencies: SceneDependencies = {},
  ) {
    this.renderer =
      dependencies.createRenderer?.(canvas) ??
      new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "default",
      });
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    // Free horizontal turning with slight tilt and zoom (limits set in fitCameraToObject); no panning.
    this.controls.enableZoom = true;
    this.controls.zoomSpeed = 0.6;
    this.controls.enablePan = false;
    this.controls.listenToKeyEvents(canvas);
    this.controls.addEventListener("change", this.invalidate);

    this.scene.add(new THREE.AmbientLight("#ffffff", 0.65));
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#c8d9da", 0.75));
    const key = new THREE.DirectionalLight("#ffffff", 1.25);
    key.position.set(1.5, 3, 4);
    const rim = new THREE.DirectionalLight("#8ee8dc", 0.45);
    rim.position.set(-3, 2.7, -2.8);
    const fill = new THREE.DirectionalLight("#dceff7", 0.35);
    fill.position.set(2, 1.5, -2);
    this.scene.add(key, rim, fill);

    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? false;
      this.invalidate();
    });
    this.intersectionObserver.observe(canvas);
    document.addEventListener("visibilitychange", this.invalidate);
    this.motion.addEventListener("change", this.invalidate);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.resize();
  }

  async setModel(profile: ModelProfile, url?: string): Promise<void> {
    if (this.disposed || this.contextLost) return;
    const generation = ++this.generation;
    this.loading?.abort();
    const loading = new AbortController();
    this.loading = loading;
    this.releaseModel();
    this.onState({ status: "loading", profile });
    console.debug("human_model_loading", { profile });
    try {
      const model = await (this.dependencies.loadModel ?? loadHumanModel)(
        profile,
        () => undefined,
        { url, signal: loading.signal },
      );
      if (
        this.disposed ||
        generation !== this.generation ||
        loading.signal.aborted
      ) {
        disposeHumanModel(model);
        return;
      }
      this.model = model;
      this.scene.add(model);
      this.highlighter = new AnatomyHighlighter(
        model,
        getEmbeddedAnatomyAnchors(model),
      );
      this.setHighlights(this.highlights);
      this.resetView();
      this.onState({ status: "ready", profile });
      console.debug("human_model_ready", { profile });
    } catch (error) {
      if (
        this.disposed ||
        generation !== this.generation ||
        loading.signal.aborted
      )
        return;
      this.releaseModel();
      this.onState({
        status: "error",
        message: "The 3D model could not be loaded. Retry to reconnect.",
      });
      console.error("human_model_failed", {
        profile,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  setHighlights(highlights: readonly HumanModelHighlight[]): void {
    this.highlights = highlights;
    this.highlighter?.setRegions(
      highlights.flatMap((highlight) => {
        const region = ANATOMY_REGIONS.find(
          ({ id }) => id === highlight.regionId,
        );
        return region
          ? [
              {
                region,
                color: highlight.color,
                strength: Math.min(1, Math.max(0, highlight.strength ?? 1)),
              },
            ]
          : [];
      }),
    );
    this.invalidate();
  }

  resetView(): void {
    if (this.model) fitCameraToObject(this.camera, this.controls, this.model);
    this.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.loading?.abort();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener("visibilitychange", this.invalidate);
    this.motion.removeEventListener("change", this.invalidate);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.controls.removeEventListener("change", this.invalidate);
    this.controls.dispose();
    this.releaseModel();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.scene.clear();
  }

  private releaseModel(): void {
    this.highlighter?.dispose();
    this.highlighter = undefined;
    if (this.model) {
      this.model.removeFromParent();
      disposeHumanModel(this.model);
      this.model = undefined;
    }
    this.invalidate();
  }

  private readonly resize = (): void => {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0 || this.disposed) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.resetView();
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.loading?.abort();
    this.onState({
      status: "error",
      message: "The 3D display was interrupted. Retry to restore it.",
    });
  };

  private readonly invalidate = (): void => {
    if (
      this.disposed ||
      this.contextLost ||
      this.frame !== undefined ||
      !this.visible ||
      document.hidden
    )
      return;
    this.frame = requestAnimationFrame(this.render);
  };

  private readonly render = (time: number): void => {
    this.frame = undefined;
    if (this.disposed || this.contextLost || !this.visible || document.hidden)
      return;
    const moving = this.controls.update();
    this.highlighter?.update(this.motion.matches ? 0 : time / 1000);
    this.renderer.render(this.scene, this.camera);
    if (moving || (this.highlights.length > 0 && !this.motion.matches))
      this.invalidate();
  };
}
