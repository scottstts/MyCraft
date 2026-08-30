/**
 * Module: engine/utils/cameraCollision
 * Purpose: Hard-constrain a third-person camera sphere against solid voxels
 * Invariants: Mutates and returns `candidate`; final pose respects minimumY
 */

import * as THREE from 'three';
import type { World } from '../world/World';
import { raycastVoxels } from './raycast';

const DEFAULT_RADIUS = 0.2;
const DEFAULT_PADDING = 0.04;

const OFFSETS = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
] as const;

const sweepDirection = new THREE.Vector3();
const sweepOrigin = new THREE.Vector3();

/**
 * Sweep a small camera sphere from the orbit pivot to a candidate position.
 * Seven parallel voxel rays conservatively cover the sphere's center and six
 * axial extremes, preventing both the eye and near-plane neighborhood from
 * crossing terrain.
 */
export function constrainCameraToSolidVoxels(
  world: World,
  pivot: THREE.Vector3,
  candidate: THREE.Vector3,
  radius = DEFAULT_RADIUS,
  padding = DEFAULT_PADDING,
  minimumY = Number.NEGATIVE_INFINITY,
): THREE.Vector3 {
  candidate.y = Math.max(candidate.y, minimumY);
  sweepDirection.subVectors(candidate, pivot);
  const desiredDistance = sweepDirection.length();
  if (desiredDistance <= 1e-6) return candidate.copy(pivot);
  sweepDirection.multiplyScalar(1 / desiredDistance);

  let allowedDistance = desiredDistance;
  const safeRadius = Math.max(0, radius);
  for (const offset of OFFSETS) {
    sweepOrigin.copy(pivot).addScaledVector(offset, safeRadius);
    const hit = raycastVoxels(
      world,
      sweepOrigin,
      sweepDirection,
      desiredDistance,
      (voxelWorld, x, y, z) => voxelWorld.isBlockSolid(x, y, z),
    );
    if (hit.hit && hit.t !== undefined) {
      allowedDistance = Math.min(allowedDistance, Math.max(0, hit.t - Math.max(0, padding)));
    }
  }

  if (allowedDistance < desiredDistance) {
    candidate.copy(pivot).addScaledVector(sweepDirection, allowedDistance);
  }
  return candidate;
}
