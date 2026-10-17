import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import * as THREE from "three";
import { HumanModelScene } from "../src/scene";
import type { loadHumanModel } from "../src/model";
import type { HumanModelState } from "../src/types";

let browser: Window;
let runtime: HumanModelScene | undefined;
const originals = new Map<string, PropertyDescriptor | undefined>();
const disconnected = mock(() => undefined);

beforeEach(() => {
  browser = new Window();
  const globals = {
    window: browser,
    document: browser.document,
    requestAnimationFrame: mock(() => 1),
    cancelAnimationFrame: mock(() => undefined),
    ResizeObserver: class {
      observe() {}
      disconnect() {
        disconnected();
      }
    },
    IntersectionObserver: class {
      observe() {}
      disconnect() {
        disconnected();
      }
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  disconnected.mockClear();
});
afterEach(async () => {
  runtime?.dispose();
  runtime = undefined;
  await browser.happyDOM.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

function fixture(loadModel: typeof loadHumanModel) {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const renderer = {
    setSize: mock(() => undefined),
    setPixelRatio: mock(() => undefined),
    setClearColor: mock(() => undefined),
    render: mock(() => undefined),
    dispose: mock(() => undefined),
    forceContextLoss: mock(() => undefined),
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
  };
  const states: HumanModelState[] = [];
  runtime = new HumanModelScene(canvas, (state) => states.push(state), {
    createRenderer: () => renderer,
    loadModel,
  });
  return { scene: runtime, states, renderer, canvas };
}

function model() {
  const geometry = new THREE.BoxGeometry();
  const dispose = mock(geometry.dispose.bind(geometry));
  geometry.dispose = dispose;
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  return { group, dispose };
}

test("a stale profile load is disposed and cannot replace the newer selection", async () => {
  let finishMale!: (model: THREE.Group) => void;
  let finishFemale!: (model: THREE.Group) => void;
  const load = mock<typeof loadHumanModel>(
    (profile) =>
      new Promise((resolve) => {
        if (profile === "male") finishMale = resolve;
        else finishFemale = resolve;
      }),
  );
  const { scene, states } = fixture(load);
  const male = model();
  const female = model();
  const first = scene.setModel("male");
  const second = scene.setModel("female");
  finishFemale(female.group);
  await second;
  finishMale(male.group);
  await first;
  expect(states.filter((state) => state.status === "ready")).toEqual([
    { status: "ready", profile: "female" },
  ]);
  expect(male.dispose).toHaveBeenCalledTimes(1);
  expect(female.dispose).not.toHaveBeenCalled();
  scene.dispose();
  expect(female.dispose).toHaveBeenCalledTimes(1);
});

test("unmount aborts pending loads, disposes late results, and cleans resources once", async () => {
  let finish!: (model: THREE.Group) => void;
  let signal: AbortSignal | undefined;
  const { scene, states, renderer } = fixture(
    (_profile, _progress, options) => {
      signal = options?.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  const pending = scene.setModel("male");
  scene.dispose();
  scene.dispose();
  const late = model();
  finish(late.group);
  await pending;
  expect(signal?.aborted).toBe(true);
  expect(states).toEqual([{ status: "loading", profile: "male" }]);
  expect(late.dispose).toHaveBeenCalledTimes(1);
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
  expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
  expect(disconnected).toHaveBeenCalledTimes(2);
});

test("highlight changes retain the loaded model and renderer", async () => {
  const loaded = model();
  const load = mock(async () => loaded.group);
  const { scene } = fixture(load);
  await scene.setModel("male");
  scene.setHighlights([{ regionId: "liver", color: "#00bfa6" }]);
  scene.setHighlights([]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(loaded.dispose).not.toHaveBeenCalled();
});

test("context loss aborts the request and reports a recoverable display error", async () => {
  let finish!: (model: THREE.Group) => void;
  const { scene, canvas, states } = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = scene.setModel("male");
  canvas.dispatchEvent(
    new browser.Event("webglcontextlost", {
      cancelable: true,
    }) as unknown as Event,
  );
  const late = model();
  finish(late.group);
  await pending;
  expect(states.at(-1)).toMatchObject({ status: "error" });
  expect(states.some((state) => state.status === "ready")).toBe(false);
  expect(late.dispose).toHaveBeenCalledTimes(1);
});
