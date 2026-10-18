import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface CameraFit {
  center: THREE.Vector3;
  distance: number;
  size: THREE.Vector3;
}

/** Closest and farthest zoom, as multiples of the fitted distance. */
export const ZOOM_RANGE = { min: 0.8, max: 1.25 } as const;

export function fitCameraToObject(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
  fitOffset = 1.22,
): CameraFit {
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const heightDistance = size.y / (2 * Math.tan(verticalFov / 2));
  const widthDistance = size.x / (2 * Math.tan(horizontalFov / 2));
  const distance = fitOffset * (Math.max(heightDistance, widthDistance) + size.z / 2);
  const viewDirection = new THREE.Vector3(0.08, 0.03, 1).normalize();

  controls.target.copy(center);
  // The model only turns left/right (azimuth, unrestricted) with a modest zoom range.
  // The vertical viewing angle is pinned to the fit, so it never tilts or flips.
  controls.minDistance = distance * ZOOM_RANGE.min;
  controls.maxDistance = distance * ZOOM_RANGE.max;
  const polarAngle = Math.acos(viewDirection.y);
  controls.minPolarAngle = polarAngle;
  controls.maxPolarAngle = polarAngle;
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 100;
  camera.position.copy(center).addScaledVector(viewDirection, distance);
  camera.updateProjectionMatrix();
  controls.update();

  return { center, distance, size };
}
