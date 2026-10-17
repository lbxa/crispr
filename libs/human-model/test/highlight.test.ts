import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
  ANATOMY_REGIONS,
  getAnatomyRegion,
  type HealthResultRegion,
} from "../src/anatomy";
import {
  AnatomyHighlighter,
  collectWeightedAnchors,
  weightForResultRegion,
} from "../src/highlight";

describe("anatomy highlights", () => {
  test("gives primary result regions more visual weight", () => {
    const primary: HealthResultRegion = {
      regionId: "heart_circulation",
      strength: "primary",
    };
    const secondary: HealthResultRegion = {
      regionId: "whole_body",
      strength: "secondary",
    };

    expect(weightForResultRegion(primary)).toBe(1);
    expect(weightForResultRegion(secondary)).toBeLessThan(
      weightForResultRegion(primary),
    );
  });

  test("prioritizes stronger anchors and caps the shader payload", () => {
    const anchors = collectWeightedAnchors([
      { region: getAnatomyRegion("major_joints"), strength: 0.48 },
      { region: getAnatomyRegion("lungs_breathing"), strength: 1 },
      { region: getAnatomyRegion("lower_limbs"), strength: 0.48 },
      { region: getAnatomyRegion("upper_limbs"), strength: 0.48 },
      { region: getAnatomyRegion("whole_body"), strength: 0.48 },
    ]);

    expect(anchors.length).toBeLessThanOrEqual(32);
    expect(anchors[0]?.strength).toBe(1);
    expect(anchors[1]?.strength).toBe(1);
  });

  test("provides at least one surface anchor for every region", () => {
    for (const region of ANATOMY_REGIONS) {
      expect(region.anchors.length).toBeGreaterThan(0);
    }
  });

  test("augments and then restores the original body material", () => {
    const original = new THREE.MeshStandardMaterial({ color: "#c7ad9d" });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.5), original);
    body.name = "GEO-body";
    const model = new THREE.Group();
    model.add(body);
    const highlighter = new AnatomyHighlighter(model);
    highlighter.setRegions([
      { region: getAnatomyRegion("heart_circulation"), strength: 1 },
    ]);

    const augmented = body.material as THREE.MeshStandardMaterial;
    const shader = {
      fragmentShader:
        "#include <common>\nvoid main(){ vec3 outgoingLight = vec3(0.0); #include <opaque_fragment> }",
      uniforms: {},
      vertexShader:
        "#include <common>\nvoid main(){ vec3 transformed = position; #include <project_vertex> }",
    };
    augmented.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );

    expect(augmented).not.toBe(original);
    expect(shader.vertexShader).toContain("vAnatomyWorldPosition");
    expect(shader.fragmentShader).toContain("anatomyHighlight");
    expect(
      (
        shader.uniforms as {
          uAnatomyAnchorCount: { value: number };
        }
      ).uAnatomyAnchorCount.value,
    ).toBe(1);

    highlighter.dispose();
    expect(body.material).toBe(original);
  });

  test("assigns independent colors to composed regions", () => {
    const original = new THREE.MeshStandardMaterial();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.5), original);
    body.userData.role = "anatomy_body";
    const model = new THREE.Group();
    model.add(body);
    const highlighter = new AnatomyHighlighter(model);
    highlighter.setRegions([
      {
        region: getAnatomyRegion("heart_circulation"),
        strength: 1,
        color: "#4f7cff",
      },
      {
        region: getAnatomyRegion("lungs_breathing"),
        strength: 1,
        color: "#ff7a6b",
      },
    ]);

    const augmented = body.material as THREE.MeshStandardMaterial;
    const shader = {
      fragmentShader:
        "#include <common>\nvoid main(){ vec3 outgoingLight = vec3(0.0); #include <opaque_fragment> }",
      uniforms: {},
      vertexShader:
        "#include <common>\nvoid main(){ vec3 transformed = position; #include <project_vertex> }",
    };
    augmented.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );

    const uniforms = shader.uniforms as {
      uAnatomyAnchorCount: { value: number };
      uAnatomyAnchorColors: { value: THREE.Color[] };
    };
    expect(uniforms.uAnatomyAnchorCount.value).toBe(3);
    expect(uniforms.uAnatomyAnchorColors.value[0]?.getHexString()).toBe(
      "4f7cff",
    );
    expect(uniforms.uAnatomyAnchorColors.value[1]?.getHexString()).toBe(
      "ff7a6b",
    );

    highlighter.dispose();
  });

  test("uses Blender body semantics without augmenting renamed eye meshes", () => {
    const bodyMaterial = new THREE.MeshStandardMaterial();
    const eyeMaterial = new THREE.MeshStandardMaterial();
    const body = new THREE.Mesh(new THREE.BoxGeometry(), bodyMaterial);
    body.name = "WEB_BODY__male";
    body.userData.role = "anatomy_body";
    const eye = new THREE.Mesh(new THREE.SphereGeometry(), eyeMaterial);
    eye.name = "WEB_AUX__male__01";
    const model = new THREE.Group();
    model.add(body, eye);

    const highlighter = new AnatomyHighlighter(model);

    expect(body.material).not.toBe(bodyMaterial);
    expect(eye.material).toBe(eyeMaterial);

    highlighter.dispose();
    expect(body.material).toBe(bodyMaterial);
  });

  test("projects posterior regions through the body for a front-visible glow", () => {
    const original = new THREE.MeshStandardMaterial();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1), original);
    body.userData.role = "anatomy_body";
    const model = new THREE.Group();
    model.add(body);
    const highlighter = new AnatomyHighlighter(model);
    highlighter.setRegions([
      { region: getAnatomyRegion("kidneys_urinary"), strength: 1 },
    ]);

    const augmented = body.material as THREE.MeshStandardMaterial;
    const shader = {
      fragmentShader:
        "#include <common>\nvoid main(){ vec3 outgoingLight = vec3(0.0); #include <opaque_fragment> }",
      uniforms: {},
      vertexShader:
        "#include <common>\nvoid main(){ vec3 transformed = position; #include <project_vertex> }",
    };
    augmented.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );

    const uniforms = shader.uniforms as {
      uAnatomyAnchorCenters: { value: THREE.Vector3[] };
      uAnatomyAnchorRadii: { value: THREE.Vector3[] };
    };
    expect(uniforms.uAnatomyAnchorCenters.value[0]?.z).toBeCloseTo(0);
    expect(uniforms.uAnatomyAnchorRadii.value[0]?.z).toBe(2);

    highlighter.dispose();
  });
});
