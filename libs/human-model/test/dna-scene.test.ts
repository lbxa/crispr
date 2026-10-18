import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import * as THREE from "three";
import { DnaScene } from "../src/dna-scene";
import { DNA_BASES, DNA_FINDING_COLOR } from "../src/dna-sequence";

let browser: Window;
let runtime: DnaScene | undefined;
let frames: Map<number, FrameRequestCallback>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const disconnected = mock(() => undefined);

beforeEach(() => {
  browser = new Window();
  frames = new Map();
  let id = 0;
  const globals = {
    window: browser,
    document: browser.document,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    ResizeObserver: class {
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

function fixture() {
  const canvas = document.createElement("canvas");
  const renderer = {
    setSize: mock(() => undefined),
    setPixelRatio: mock(() => undefined),
    setClearColor: mock(() => undefined),
    render: mock((_scene: THREE.Scene, _camera: THREE.Camera) => undefined),
    dispose: mock(() => undefined),
    forceContextLoss: mock(() => undefined),
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
  };
  const onError = mock(() => undefined);
  runtime = new DnaScene(canvas, 248_000_000, onError, () => renderer);
  return { runtime, renderer, canvas, onError };
}

function renderFrame(time = 16) {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(time));
}

function settleFrames() {
  for (let index = 0; index < 180 && frames.size; index++)
    renderFrame(32 + index * 16);
  expect(frames.size).toBe(0);
}

test("finding colors follow exact half-open reference spans in both DNA modes", () => {
  const { runtime, renderer } = fixture();
  runtime.setActive(true);
  runtime.setPosition(1000, true);
  runtime.setSequence({ start: 900, bases: "A".repeat(200) });
  runtime.setHighlights([{ start: 1000, end: 1002 }]);
  renderFrame();
  const scene = renderer.render.mock.calls[0]![0];
  const bases = scene.children.find(
    (child) => child instanceof THREE.InstancedMesh && child.count === 192,
  ) as THREE.InstancedMesh;
  const color = new THREE.Color();
  const red = new THREE.Color(DNA_FINDING_COLOR);
  const normal = new THREE.Color(DNA_BASES.A.color);
  for (const mode of ["helix", "ladder"] as const) {
    runtime.setMode(mode, true);
    renderFrame();
    for (const [slot, expected] of [
      [47, normal],
      [48, red],
      [49, red],
      [50, normal],
    ] as const) {
      bases.getColorAt(slot * 2, color);
      expect(color.r).toBeCloseTo(expected.r, 5);
      expect(color.g).toBeCloseTo(expected.g, 5);
      expect(color.b).toBeCloseTo(expected.b, 5);
    }
  }
  runtime.setHighlights([]);
  renderFrame();
  bases.getColorAt(48 * 2, color);
  expect(color.r).toBeCloseTo(normal.r, 5);
});

test("large navigation retains the same two instanced meshes and finite GPU transforms", () => {
  const { runtime, renderer } = fixture();
  runtime.setActive(true);
  runtime.setPosition(1_024_000, true);
  renderFrame();
  const scene = renderer.render.mock.calls[0]![0];
  const meshes = scene.children.filter(
    (child): child is THREE.InstancedMesh =>
      child instanceof THREE.InstancedMesh,
  );
  expect(meshes).toHaveLength(2);
  const counts = meshes.map((mesh) => mesh.count);
  for (const position of [0, 100_000_000, 247_999_999]) {
    runtime.setPosition(position, true);
    renderFrame();
    expect(meshes.map((mesh) => mesh.count)).toEqual(counts);
    for (const mesh of meshes)
      expect([...mesh.instanceMatrix.array].every(Number.isFinite)).toBe(true);
  }
  expect(frames.size).toBe(0);
});

test("pane hiding cancels motion and disposal releases every GPU resource exactly once", () => {
  const { runtime, renderer } = fixture();
  runtime.setActive(true);
  renderFrame();
  const scene = renderer.render.mock.calls[0]![0];
  const meshes = scene.children.filter(
    (child): child is THREE.InstancedMesh =>
      child instanceof THREE.InstancedMesh,
  );
  const geometries = new Set(meshes.map((mesh) => mesh.geometry));
  const materials = new Set(
    meshes.map((mesh) => mesh.material as THREE.Material),
  );
  const releases: ReturnType<typeof mock>[] = [];
  for (const resource of meshes) {
    const release = mock(() => undefined);
    resource.addEventListener("dispose", release);
    releases.push(release);
  }
  for (const resource of geometries) {
    const release = mock(() => undefined);
    resource.addEventListener("dispose", release);
    releases.push(release);
  }
  for (const resource of materials) {
    const release = mock(() => undefined);
    resource.addEventListener("dispose", release);
    releases.push(release);
  }
  runtime.setPosition(10);
  expect(frames.size).toBe(1);
  runtime.setActive(false);
  expect(frames.size).toBe(0);
  runtime.setPosition(20);
  expect(frames.size).toBe(0);
  runtime.setActive(true);
  expect(frames.size).toBe(1);
  runtime.dispose();
  runtime.dispose();
  expect(frames.size).toBe(0);
  for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
  expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
  expect(disconnected).toHaveBeenCalledTimes(1);
});

test("context loss stops drawing and reports a recoverable failure", () => {
  const { runtime, canvas, onError } = fixture();
  runtime.setActive(true);
  canvas.dispatchEvent(
    new browser.Event("webglcontextlost", {
      cancelable: true,
    }) as unknown as Event,
  );
  expect(onError).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
  runtime.setPosition(100);
  expect(frames.size).toBe(0);
});

test("unwinding produces two planar rails and complementary half-rungs using the same GPU pool", () => {
  const { runtime, renderer } = fixture();
  runtime.setActive(true);
  runtime.setPosition(1_024_000, true);
  runtime.setSequence({ start: 1_023_952, bases: "A".repeat(96) });
  renderFrame();
  const scene = renderer.render.mock.calls[0]![0];
  const meshes = scene.children.filter(
    (child): child is THREE.InstancedMesh =>
      child instanceof THREE.InstancedMesh,
  );
  const backbones = meshes.find((mesh) => mesh.instanceColor === null)!;
  const bases = meshes.find((mesh) => mesh.instanceColor !== null)!;
  const counts = meshes.map((mesh) => mesh.count);
  runtime.setMode("ladder");
  renderFrame(32);
  expect(frames.size).toBe(1);
  settleFrames();
  const matrix = new THREE.Matrix4();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const color = new THREE.Color();
  for (let index = 0; index < bases.count / 2; index++) {
    bases.getMatrixAt(index * 2, matrix);
    right.setFromMatrixPosition(matrix);
    bases.getMatrixAt(index * 2 + 1, matrix);
    left.setFromMatrixPosition(matrix);
    expect(right.x).toBeCloseTo(1.025);
    expect(left.x).toBeCloseTo(-1.025);
    expect(right.y).toBeCloseTo(left.y);
    expect(right.z).toBeCloseTo(0);
    expect(left.z).toBeCloseTo(0);
    bases.getColorAt(index * 2, color);
    expect(color.r).toBeCloseTo(new THREE.Color(DNA_BASES.A.color).r);
    bases.getColorAt(index * 2 + 1, color);
    expect(color.r).toBeCloseTo(new THREE.Color(DNA_BASES.T.color).r);
  }
  for (let index = 0; index < backbones.count; index++) {
    backbones.getMatrixAt(index, matrix);
    const rail = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(Math.abs(rail.x)).toBeCloseTo(2.05);
    expect(rail.z).toBeCloseTo(0);
  }
  runtime.setPosition(200_000_000, true);
  renderFrame();
  bases.getMatrixAt(96, matrix);
  expect(new THREE.Vector3().setFromMatrixPosition(matrix).z).toBeCloseTo(0);
  expect(meshes.map((mesh) => mesh.count)).toEqual(counts);
  expect(
    scene.children.filter((child) => child instanceof THREE.InstancedMesh),
  ).toEqual(meshes);
});

test("an interrupted unwind reverses smoothly and stops drawing once the helix is restored", () => {
  const { runtime, renderer } = fixture();
  runtime.setActive(true);
  runtime.setPosition(1_024_000, true);
  renderFrame();
  const scene = renderer.render.mock.calls[0]![0];
  const bases = scene.children.find(
    (child): child is THREE.InstancedMesh =>
      child instanceof THREE.InstancedMesh && child.instanceColor !== null,
  )!;
  const original = [...bases.instanceMatrix.array];
  runtime.setMode("ladder");
  renderFrame(32);
  expect([...bases.instanceMatrix.array]).not.toEqual(original);
  runtime.setMode("helix");
  settleFrames();
  expect([...bases.instanceMatrix.array]).toEqual(original);
});

test("reduced motion switches directly to a flat ladder without continuing an animation", () => {
  Object.defineProperty(browser, "matchMedia", {
    value: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  const { runtime, renderer } = fixture();
  runtime.setActive(true);
  runtime.setPosition(1_024_000, true);
  runtime.setMode("ladder");
  renderFrame();
  expect(frames.size).toBe(0);
  const scene = renderer.render.mock.calls[0]![0];
  const bases = scene.children.find(
    (child): child is THREE.InstancedMesh =>
      child instanceof THREE.InstancedMesh && child.instanceColor !== null,
  )!;
  const matrix = new THREE.Matrix4();
  bases.getMatrixAt(96, matrix);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  expect(position.x).toBeCloseTo(1.025);
  expect(position.z).toBeCloseTo(0);
});

function reducedMotion() {
  Object.defineProperty(browser, "matchMedia", {
    value: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
}

test("gliding slides through intermediate positions, then settles and reports completion", () => {
  const { runtime } = fixture();
  const seen: (number | null)[] = [];
  runtime.onGlide = (position) => seen.push(position);
  runtime.setActive(true);
  runtime.setPosition(1000, true);
  renderFrame(0);
  runtime.glideTo(5000);
  for (let time = 16; time <= 3000 && frames.size; time += 16)
    renderFrame(time);
  expect(frames.size).toBe(0);
  const moving = seen.filter((value): value is number => value !== null);
  expect(moving.length).toBeGreaterThan(5);
  expect(moving[0]).toBe(1000); // the first frame starts where it was
  expect(moving[2]).toBeGreaterThan(1000);
  expect(moving.at(-1)).toBeLessThanOrEqual(5000);
  expect(moving).toEqual([...moving].sort((a, b) => a - b));
  expect(seen.at(-1)).toBeNull();
});

test("a glide that is interrupted hands control back to the new target", () => {
  const { runtime } = fixture();
  const seen: (number | null)[] = [];
  runtime.onGlide = (position) => seen.push(position);
  runtime.setActive(true);
  runtime.setPosition(1000, true);
  renderFrame(0);
  runtime.glideTo(900_000);
  renderFrame(16);
  renderFrame(32);
  runtime.setPosition(1010);
  expect(seen.at(-1)).toBeNull();
  const before = seen.length;
  settleFrames();
  expect(seen.length).toBe(before); // no further glide reports after the interruption
});

test("reduced motion jumps instead of gliding", () => {
  reducedMotion();
  const { runtime } = fixture();
  const seen: (number | null)[] = [];
  runtime.onGlide = (position) => seen.push(position);
  runtime.setActive(true);
  runtime.glideTo(250_000);
  renderFrame();
  expect(frames.size).toBe(0);
  // No animated frames, but the listener is told straight away that the slide is over.
  expect(seen).toEqual([null]);
});

test("unseen findings breathe while seen findings stay still", () => {
  const { runtime, renderer } = fixture();
  runtime.setActive(true);
  runtime.setPosition(1000, true);
  runtime.setSequence({ start: 900, bases: "A".repeat(200) });
  runtime.setHighlights([
    { start: 1000, end: 1002, pulse: true },
    { start: 1010, end: 1012 },
  ]);
  renderFrame(0);
  const scene = renderer.render.mock.calls[0]![0];
  const bases = scene.children.find(
    (child): child is THREE.InstancedMesh =>
      child instanceof THREE.InstancedMesh && child.count === 192,
  )!;
  const color = (slot: number) => {
    const out = new THREE.Color();
    bases.getColorAt(slot * 2, out);
    return out;
  };
  const red = new THREE.Color(DNA_FINDING_COLOR);
  renderFrame(833); // breathing is at its lowest: plain finding colour
  expect(color(48).r).toBeCloseTo(red.r, 3);
  expect(color(48).g).toBeCloseTo(red.g, 3);
  renderFrame(1110); // breathing is at its peak: brightened toward white
  expect(color(48).g).toBeGreaterThan(red.g + 0.1);
  expect(color(58).g).toBeCloseTo(red.g, 3); // a seen finding does not pulse
  expect(frames.size).toBe(1); // keeps animating while a pulse is on screen
  runtime.setHighlights([{ start: 1000, end: 1002 }]);
  renderFrame(1400);
  expect(frames.size).toBe(0);
});

test("reduced motion keeps unseen findings static", () => {
  reducedMotion();
  const { runtime } = fixture();
  runtime.setActive(true);
  runtime.setPosition(1000, true);
  runtime.setHighlights([{ start: 1000, end: 1002, pulse: true }]);
  renderFrame(1110);
  expect(frames.size).toBe(0);
});
