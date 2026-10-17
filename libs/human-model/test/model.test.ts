import { describe, expect, mock, test } from "bun:test";
import * as THREE from "three";
import { disposeHumanModel, MODEL_PROFILES } from "../src/model";

describe("model profiles", () => {
  test("exposes distinct male and female assets", () => {
    expect(MODEL_PROFILES.male.url).toBe(
      "/models/segmented/realistic-male-segmented.glb",
    );
    expect(MODEL_PROFILES.female.url).toBe(
      "/models/segmented/realistic-female-segmented.glb",
    );
    expect(MODEL_PROFILES.male.index).not.toBe(MODEL_PROFILES.female.index);
  });

  test("disposes shared geometry, material, and texture only once", () => {
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));

    const geometryDispose = mock(() => undefined);
    const materialDispose = mock(() => undefined);
    const textureDispose = mock(() => undefined);
    geometry.dispose = geometryDispose;
    material.dispose = materialDispose;
    texture.dispose = textureDispose;

    disposeHumanModel(root);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
});
