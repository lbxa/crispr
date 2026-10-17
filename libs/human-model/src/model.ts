import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { MODEL_PROFILES, type ModelProfile } from "./profiles";
export { MODEL_PROFILES, type ModelProfile } from "./profiles";
import type { AnatomyRegionId, BodyView, RegionAnchor } from "./anatomy";

export interface LoadProgress {
  loaded: number;
  total: number;
  percentage: number | null;
}

export type EmbeddedAnatomyAnchors = Partial<
  Record<AnatomyRegionId, readonly RegionAnchor[]>
>;

const PROXY_REGION_IDS: Readonly<Record<string, AnatomyRegionId>> = {
  brain: "head_brain",
  digestive: "digestive_tract",
  digestive_tract: "digestive_tract",
  head_brain: "head_brain",
  heart: "heart_circulation",
  heart_circulation: "heart_circulation",
  kidneys: "kidneys_urinary",
  kidneys_urinary: "kidneys_urinary",
  left_knee: "major_joints",
  left_shoulder: "major_joints",
  liver: "liver",
  lungs: "lungs_breathing",
  lungs_breathing: "lungs_breathing",
  lower_limbs: "lower_limbs",
  lower_spine: "spine_back",
  major_joints: "major_joints",
  neck_thyroid: "neck_thyroid",
  pancreas: "pancreas_metabolism",
  pancreas_metabolism: "pancreas_metabolism",
  pelvis: "pelvic_health",
  pelvic_health: "pelvic_health",
  right_knee: "major_joints",
  right_shoulder: "major_joints",
  skin: "skin",
  spine_back: "spine_back",
  systemic: "whole_body",
  thyroid: "neck_thyroid",
  upper_limbs: "upper_limbs",
  upper_spine: "spine_back",
  whole_body: "whole_body",
};

interface ProxyTransform {
  readonly center: THREE.Vector3;
  readonly radius: THREE.Vector3;
  readonly regionId: AnatomyRegionId;
  readonly view: BodyView;
}

function proxyView(value: unknown): BodyView {
  if (value === "anterior" || value === "front") return "front";
  if (value === "posterior" || value === "back") return "back";
  return "both";
}

function proxyRegionId(object: THREE.Object3D): AnatomyRegionId | undefined {
  const rawId =
    typeof object.userData.region_id === "string"
      ? object.userData.region_id
      : object.name.match(/^ANATOMY_REGION__([^_]+(?:_[^_]+)*)__\d+$/)?.[1];
  return rawId ? PROXY_REGION_IDS[rawId] : undefined;
}

function isAnatomyProxy(object: THREE.Object3D): boolean {
  return (
    object.userData.role === "anatomy_region_proxy" ||
    object.name.startsWith("ANATOMY_REGION__")
  );
}

function collectProxyTransforms(model: THREE.Group): {
  proxies: THREE.Object3D[];
  transforms: ProxyTransform[];
} {
  const proxies: THREE.Object3D[] = [];
  const transforms: ProxyTransform[] = [];
  model.updateMatrixWorld(true);

  model.traverse((object) => {
    if (!isAnatomyProxy(object)) return;
    proxies.push(object);

    const regionId = proxyRegionId(object);
    if (!regionId) return;

    const center = object.getWorldPosition(new THREE.Vector3());
    const radius = object.getWorldScale(new THREE.Vector3());
    radius.set(Math.abs(radius.x), Math.abs(radius.y), Math.abs(radius.z));
    transforms.push({
      center,
      radius,
      regionId,
      view: proxyView(object.userData.view),
    });
  });

  return { proxies, transforms };
}

function detachAndDisposeProxies(proxies: readonly THREE.Object3D[]): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  for (const proxy of proxies) proxy.removeFromParent();
  for (const proxy of proxies) {
    proxy.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of objectMaterials) materials.add(material);
    });
  }

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function normalizeProxyTransforms(
  transforms: readonly ProxyTransform[],
  bounds: THREE.Box3,
): EmbeddedAnatomyAnchors {
  const size = bounds.getSize(new THREE.Vector3());
  const anchors: Partial<Record<AnatomyRegionId, RegionAnchor[]>> = {};

  for (const transform of transforms) {
    const regionAnchors = anchors[transform.regionId] ?? [];
    regionAnchors.push({
      center: [
        ((transform.center.x - bounds.min.x) / size.x) * 2 - 1,
        (transform.center.y - bounds.min.y) / size.y,
        ((transform.center.z - bounds.min.z) / size.z) * 2 - 1,
      ],
      radius: [
        (transform.radius.x / size.x) * 2,
        transform.radius.y / size.y,
        (transform.radius.z / size.z) * 2,
      ],
      view: transform.view,
    });
    anchors[transform.regionId] = regionAnchors;
  }

  return anchors;
}

export function getEmbeddedAnatomyAnchors(
  model: THREE.Object3D,
): EmbeddedAnatomyAnchors {
  return (model.userData.anatomyRegionAnchors ?? {}) as EmbeddedAnatomyAnchors;
}

export function hasEmbeddedAnatomyAnchors(model: THREE.Object3D): boolean {
  return Object.keys(getEmbeddedAnatomyAnchors(model)).length > 0;
}

function applyClinicalSurface(model: THREE.Object3D): void {
  const configuredMaterials = new Set<THREE.Material>();

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = false;
    child.receiveShadow = false;
    if (!child.geometry.hasAttribute("normal"))
      child.geometry.computeVertexNormals();

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      if (configuredMaterials.has(material)) continue;
      configuredMaterials.add(material);
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;

      material.color.set("#d8e1e3");
      material.flatShading = false;
      material.emissive.set("#91a5a8");
      material.emissiveIntensity = 0.1;
      material.roughness = 0.94;
      material.metalness = 0;
      material.aoMapIntensity = 0;
      material.normalScale.setScalar(0.18);
      material.needsUpdate = true;
    }
  });
}

export async function loadHumanModel(
  profile: ModelProfile,
  onProgress: (progress: LoadProgress) => void,
  options: { url?: string; signal?: AbortSignal } = {},
): Promise<THREE.Group> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const response = await fetch(options.url ?? MODEL_PROFILES[profile].url, {
    signal: options.signal,
  });
  if (!response.ok)
    throw new Error(`Model request failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  options.signal?.throwIfAborted();
  const gltf = await loader.parseAsync(bytes, "");
  if (options.signal?.aborted) {
    disposeHumanModel(gltf.scene);
    options.signal.throwIfAborted();
  }
  onProgress({
    loaded: bytes.byteLength,
    total: bytes.byteLength,
    percentage: 100,
  });
  const model = gltf.scene;
  const { proxies, transforms } = collectProxyTransforms(model);
  detachAndDisposeProxies(proxies);
  applyClinicalSurface(model);

  const sourceBounds = new THREE.Box3().setFromObject(model);
  model.userData.anatomyRegionAnchors = normalizeProxyTransforms(
    transforms,
    sourceBounds,
  );
  const center = sourceBounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= sourceBounds.min.y;
  model.position.z -= center.z;
  model.updateMatrixWorld(true);

  return model;
}

export function disposeHumanModel(model: THREE.Object3D): void {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    if (!disposedGeometries.has(child.geometry)) {
      child.geometry.dispose();
      disposedGeometries.add(child.geometry);
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      if (disposedMaterials.has(material)) continue;

      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
          value.dispose();
          disposedTextures.add(value);
        }
      }

      material.dispose();
      disposedMaterials.add(material);
    }
  });
}
