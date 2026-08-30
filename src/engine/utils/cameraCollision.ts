/**
 * Module: engine/utils/cameraCollision
 * Purpose: Hard-constrain a third-person camera sphere against solid voxels
 * Invariants: Mutates and returns `candidate`; final pose respects minimumY
 */

import * as THREE from 'three';
import type { World } from '../world/World';
const DEFAULT_RADIUS = 0.2;
const DEFAULT_PADDING = 0.04;

const sweepDirection = new THREE.Vector3();

function segmentEntryDistance(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number | null {
  let entry = 0;
  let exit = maxDistance;
  const origins = [origin.x, origin.y, origin.z];
  const directions = [direction.x, direction.y, direction.z];
  const minima = [minX, minY, minZ];
  const maxima = [maxX, maxY, maxZ];

  for (let axis = 0; axis < 3; axis += 1) {
    const axisDirection = directions[axis];
    const axisOrigin = origins[axis];
    if (Math.abs(axisDirection) <= 1e-9) {
      if (axisOrigin < minima[axis] || axisOrigin > maxima[axis]) return null;
      continue;
    }

    let near = (minima[axis] - axisOrigin) / axisDirection;
    let far = (maxima[axis] - axisOrigin) / axisDirection;
    if (near > far) [near, far] = [far, near];
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (entry > exit) return null;
  }

  return exit >= 0 && entry <= maxDistance ? Math.max(0, entry) : null;
}

/**
 * Sweep a small camera sphere from the orbit pivot to a candidate position.
 * Solid voxel boxes are expanded by the camera radius before a segment/AABB
 * test. This conservative Minkowski sweep covers diagonal voxel corners that
 * a finite bundle of parallel rays can miss.
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

  const safeRadius = Math.max(0, radius);
  const minX = Math.floor(Math.min(pivot.x, candidate.x) - safeRadius);
  const minY = Math.floor(Math.min(pivot.y, candidate.y) - safeRadius);
  const minZ = Math.floor(Math.min(pivot.z, candidate.z) - safeRadius);
  const maxX = Math.floor(Math.max(pivot.x, candidate.x) + safeRadius);
  const maxY = Math.floor(Math.max(pivot.y, candidate.y) + safeRadius);
  const maxZ = Math.floor(Math.max(pivot.z, candidate.z) + safeRadius);
  let allowedDistance = desiredDistance;

  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (!world.isBlockSolid(x, y, z)) continue;
        const entryDistance = segmentEntryDistance(
          pivot,
          sweepDirection,
          desiredDistance,
          x - safeRadius,
          y - safeRadius,
          z - safeRadius,
          x + 1 + safeRadius,
          y + 1 + safeRadius,
          z + 1 + safeRadius,
        );
        if (entryDistance !== null) {
          allowedDistance = Math.min(
            allowedDistance,
            Math.max(0, entryDistance - Math.max(0, padding)),
          );
        }
      }
    }
  }

  if (allowedDistance < desiredDistance) {
    candidate.copy(pivot).addScaledVector(sweepDirection, allowedDistance);
  }
  return candidate;
}
