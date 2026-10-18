import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ZOOM_RANGE, fitCameraToObject } from "../src/camera";

describe("fitCameraToObject", () => {
  test("frames a portrait object and updates clipping planes", () => {
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    const controls = {
      maxDistance: Infinity,
      minDistance: 0,
      target: new THREE.Vector3(),
      update: () => true,
    } as unknown as OrbitControls;
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.3));

    const result = fitCameraToObject(camera, controls, model);

    expect(result.size.y).toBeCloseTo(1.8);
    expect(result.distance).toBeGreaterThan(1.8);
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.far).toBeGreaterThan(camera.near);
    expect(controls.target.distanceTo(result.center)).toBeLessThan(0.0001);
  });

  test("pins the vertical angle and allows zoom while horizontal turning stays unrestricted", () => {
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    const controls = {
      maxDistance: Infinity,
      minDistance: 0,
      minPolarAngle: 0,
      maxPolarAngle: Math.PI,
      minAzimuthAngle: -Infinity,
      maxAzimuthAngle: Infinity,
      target: new THREE.Vector3(),
      update: () => true,
    } as unknown as OrbitControls;
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.3));

    const result = fitCameraToObject(camera, controls, model);

    expect(controls.minDistance).toBeCloseTo(result.distance * ZOOM_RANGE.min);
    expect(controls.maxDistance).toBeCloseTo(result.distance * ZOOM_RANGE.max);
    expect(controls.minPolarAngle).toBe(controls.maxPolarAngle);
    // The camera sits at the pinned angle, measured from the up axis.
    const offset = camera.position.clone().sub(result.center).normalize();
    expect(Math.acos(offset.y)).toBeCloseTo(controls.minPolarAngle, 6);
    expect(controls.minAzimuthAngle).toBe(-Infinity);
    expect(controls.maxAzimuthAngle).toBe(Infinity);
  });
});
