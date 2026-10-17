import * as THREE from "three";
import type {
  AnatomyRegionId,
  AnatomyRegion,
  HealthResultRegion,
  RegionAnchor,
} from "./anatomy";
import type { EmbeddedAnatomyAnchors } from "./model";

const MAX_HIGHLIGHT_ANCHORS = 32;
const DEFAULT_HIGHLIGHT_COLOR = new THREE.Color("#00bfa6");
const THROUGH_BODY_DEPTH_RADIUS = 2;

export interface HighlightRegion {
  readonly region: AnatomyRegion;
  readonly strength: number;
  readonly color?: THREE.ColorRepresentation;
}

interface WeightedAnchor {
  readonly anchor: RegionAnchor;
  readonly strength: number;
  readonly color: THREE.Color;
}

interface MaterialReplacement {
  readonly mesh: THREE.Mesh;
  readonly original: THREE.Material | THREE.Material[];
  readonly augmented: THREE.Material | THREE.Material[];
}

interface HighlightUniforms {
  uAnatomyAnchorCount: { value: number };
  uAnatomyAnchorCenters: { value: THREE.Vector3[] };
  uAnatomyAnchorRadii: { value: THREE.Vector3[] };
  uAnatomyAnchorStrengths: { value: number[] };
  uAnatomyAnchorColors: { value: THREE.Color[] };
  uAnatomyTime: { value: number };
}

function collectBodyMeshes(model: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  model.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.geometry.getAttribute("position") !== undefined
    ) {
      meshes.push(object);
    }
  });

  const semanticBodies = meshes.filter(
    ({ userData }) => userData.role === "anatomy_body",
  );
  if (semanticBodies.length > 0) return semanticBodies;

  return meshes.filter(({ name }) => !name.toLowerCase().includes("eye"));
}

function emptyVectorArray(): THREE.Vector3[] {
  return Array.from(
    { length: MAX_HIGHLIGHT_ANCHORS },
    () => new THREE.Vector3(),
  );
}

function emptyNumberArray(): number[] {
  return Array.from({ length: MAX_HIGHLIGHT_ANCHORS }, () => 0);
}

function emptyColorArray(): THREE.Color[] {
  return Array.from({ length: MAX_HIGHLIGHT_ANCHORS }, () =>
    DEFAULT_HIGHLIGHT_COLOR.clone(),
  );
}

export function collectWeightedAnchors(
  regions: readonly HighlightRegion[],
): readonly WeightedAnchor[] {
  return regions
    .flatMap(({ region, strength, color }) =>
      region.anchors.map((anchor) => ({
        anchor,
        strength,
        color: new THREE.Color(color ?? DEFAULT_HIGHLIGHT_COLOR),
      })),
    )
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_HIGHLIGHT_ANCHORS);
}

export function weightForResultRegion(region: HealthResultRegion): number {
  return region.strength === "primary" ? 1 : 0.48;
}

function augmentMaterial(
  source: THREE.Material,
  uniforms: HighlightUniforms,
): THREE.Material {
  const material = source.clone();
  const previousOnBeforeCompile = source.onBeforeCompile.bind(source);
  const previousCacheKey = source.customProgramCacheKey.bind(source);

  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile(shader, renderer);

    shader.uniforms.uAnatomyAnchorCount = uniforms.uAnatomyAnchorCount;
    shader.uniforms.uAnatomyAnchorCenters = uniforms.uAnatomyAnchorCenters;
    shader.uniforms.uAnatomyAnchorRadii = uniforms.uAnatomyAnchorRadii;
    shader.uniforms.uAnatomyAnchorStrengths = uniforms.uAnatomyAnchorStrengths;
    shader.uniforms.uAnatomyAnchorColors = uniforms.uAnatomyAnchorColors;
    shader.uniforms.uAnatomyTime = uniforms.uAnatomyTime;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vAnatomyWorldPosition;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vAnatomyWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
#define ANATOMY_MAX_ANCHORS ${MAX_HIGHLIGHT_ANCHORS}
uniform int uAnatomyAnchorCount;
uniform vec3 uAnatomyAnchorCenters[ANATOMY_MAX_ANCHORS];
uniform vec3 uAnatomyAnchorRadii[ANATOMY_MAX_ANCHORS];
uniform float uAnatomyAnchorStrengths[ANATOMY_MAX_ANCHORS];
uniform vec3 uAnatomyAnchorColors[ANATOMY_MAX_ANCHORS];
uniform float uAnatomyTime;
varying vec3 vAnatomyWorldPosition;

float anatomyHighlight(vec3 bodyPosition, out vec3 highlightColor) {
  float mask = 0.0;
  float colorWeight = 0.0;
  vec3 weightedColor = vec3(0.0);
  for (int i = 0; i < ANATOMY_MAX_ANCHORS; i++) {
    if (i >= uAnatomyAnchorCount) break;
    vec3 delta = (bodyPosition - uAnatomyAnchorCenters[i]) /
      max(uAnatomyAnchorRadii[i], vec3(0.0001));
    float distanceFromCenter = length(delta);
    float softVolume = 1.0 - smoothstep(0.42, 1.08, distanceFromCenter);
    float influence = softVolume * uAnatomyAnchorStrengths[i];
    mask = max(mask, influence);
    weightedColor += uAnatomyAnchorColors[i] * influence;
    colorWeight += influence;
  }
  highlightColor = colorWeight > 0.0001
    ? weightedColor / colorWeight
    : vec3(0.0);
  return clamp(mask * 1.45, 0.0, 1.0);
}`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
  vec3 anatomyColor;
  float highlight = anatomyHighlight(vAnatomyWorldPosition, anatomyColor);
  float pulse = 0.92 + 0.08 * sin(uAnatomyTime * 2.4);
  float glow = highlight * pulse;
  outgoingLight = mix(outgoingLight, anatomyColor, glow * 0.88);
  outgoingLight += anatomyColor * glow * glow * 0.32;
}
#include <opaque_fragment>`,
      );
  };

  material.customProgramCacheKey = () =>
    `${previousCacheKey()}|anatomy-highlight-v2`;
  material.needsUpdate = true;
  return material;
}

/**
 * Adds a transient GPU highlight to body materials while retaining the source
 * material pipeline. Call dispose before disposing or replacing the model.
 */
export class AnatomyHighlighter {
  readonly #uniforms: HighlightUniforms = {
    uAnatomyAnchorCount: { value: 0 },
    uAnatomyAnchorCenters: { value: emptyVectorArray() },
    uAnatomyAnchorRadii: { value: emptyVectorArray() },
    uAnatomyAnchorStrengths: { value: emptyNumberArray() },
    uAnatomyAnchorColors: { value: emptyColorArray() },
    uAnatomyTime: { value: 0 },
  };

  readonly #replacements: MaterialReplacement[] = [];
  readonly #bounds: THREE.Box3;
  readonly #size = new THREE.Vector3();
  readonly #embeddedAnchors: EmbeddedAnatomyAnchors;

  constructor(
    model: THREE.Object3D,
    embeddedAnchors: EmbeddedAnatomyAnchors = {},
  ) {
    const bodyMeshes = collectBodyMeshes(model);
    this.#bounds = new THREE.Box3();
    for (const mesh of bodyMeshes) this.#bounds.expandByObject(mesh);
    this.#bounds.getSize(this.#size);
    this.#embeddedAnchors = embeddedAnchors;

    for (const object of bodyMeshes) {
      const original = object.material;
      const augmented = Array.isArray(original)
        ? original.map((material) => augmentMaterial(material, this.#uniforms))
        : augmentMaterial(original, this.#uniforms);

      object.material = augmented;
      this.#replacements.push({ mesh: object, original, augmented });
    }
  }

  setRegions(regions: readonly HighlightRegion[]): void {
    const resolvedRegions = regions.map(({ region, strength, color }) => ({
      region: {
        ...region,
        anchors:
          this.#embeddedAnchors[region.id as AnatomyRegionId] ?? region.anchors,
      },
      strength,
      color,
    }));
    const anchors = collectWeightedAnchors(resolvedRegions);
    this.#uniforms.uAnatomyAnchorCount.value = anchors.length;

    anchors.forEach(({ anchor, strength }, index) => {
      const center = this.#uniforms.uAnatomyAnchorCenters.value[index];
      const radius = this.#uniforms.uAnatomyAnchorRadii.value[index];
      const color = this.#uniforms.uAnatomyAnchorColors.value[index];
      if (!center || !radius || !color) return;

      const projectsThroughBody = anchor.view === "back";
      center.set(
        this.#bounds.min.x + ((anchor.center[0] + 1) / 2) * this.#size.x,
        this.#bounds.min.y + anchor.center[1] * this.#size.y,
        projectsThroughBody
          ? this.#bounds.min.z + this.#size.z / 2
          : this.#bounds.min.z + ((anchor.center[2] + 1) / 2) * this.#size.z,
      );
      radius.set(
        (anchor.radius[0] / 2) * this.#size.x,
        anchor.radius[1] * this.#size.y,
        projectsThroughBody
          ? this.#size.z * THROUGH_BODY_DEPTH_RADIUS
          : (anchor.radius[2] / 2) * this.#size.z,
      );
      this.#uniforms.uAnatomyAnchorStrengths.value[index] = strength;
      color.copy(anchors[index]?.color ?? DEFAULT_HIGHLIGHT_COLOR);
    });

    for (let index = anchors.length; index < MAX_HIGHLIGHT_ANCHORS; index++) {
      this.#uniforms.uAnatomyAnchorStrengths.value[index] = 0;
    }
  }

  update(timeSeconds: number): void {
    this.#uniforms.uAnatomyTime.value = timeSeconds;
  }

  dispose(): void {
    for (const { mesh, original, augmented } of this.#replacements) {
      mesh.material = original;
      const materials = Array.isArray(augmented) ? augmented : [augmented];
      for (const material of materials) material.dispose();
    }
    this.#replacements.length = 0;
  }
}
