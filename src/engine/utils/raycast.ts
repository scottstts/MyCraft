/**
 * Module: engine/utils/raycast
 * Purpose: Voxel DDA grid-marching raycast for selecting blocks
 * Callers: SelectionSystem, interaction systems
 * Invariants: Pure function; does not mutate world. Uses World.getBlock/isBlockSolid.
 */

import type * as THREE from 'three';
import type { World } from '../world/World';
import { getBlock } from '../world/blocks/BlockRegistry';
import { INTERACTION } from '../../config/constants';

export interface VoxelRaycastHit {
  hit: boolean;
  /** World coords of the hit solid voxel (integer cell). */
  hitCell?: { x: number; y: number; z: number };
  /** World coords of the adjacent empty cell suitable for placement. */
  placeCell?: { x: number; y: number; z: number };
  /** Distance along ray at hit. */
  t?: number;
}

export type VoxelRaycastPredicate = (world: World, x: number, y: number, z: number) => boolean;

/** Clamp vector to unit length to avoid overspeed issues. */
function normalizeSafe(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const len = Math.hypot(x, y, z);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: x / len, y: y / len, z: z / len };
}

/** Floor to integer cell coordinate with correct handling of negatives. */
function toCell(n: number): number {
  return Math.floor(n);
}

/**
 * Grid DDA raycast through voxels.
 * Inputs: camera position (origin), forward direction, world accessor, max distance.
 * Returns: first solid block hit and adjacent place cell.
 */
export function raycastVoxels(
  world: World,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number = INTERACTION.reach,
  predicate?: VoxelRaycastPredicate,
): VoxelRaycastHit {
  // Normalize direction
  const dir = normalizeSafe(direction.x, direction.y, direction.z);
  if (dir.x === 0 && dir.y === 0 && dir.z === 0) return { hit: false };

  // Start cell
  let x = toCell(origin.x);
  let y = toCell(origin.y);
  let z = toCell(origin.z);

  // Step for each axis
  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;

  // Compute initial tMax distances to the first voxel boundary on each axis
  const nextBoundaryX = x + (stepX > 0 ? 1 : 0);
  const nextBoundaryY = y + (stepY > 0 ? 1 : 0);
  const nextBoundaryZ = z + (stepZ > 0 ? 1 : 0);

  const tMaxX = dir.x !== 0 ? (nextBoundaryX - origin.x) / dir.x : Number.POSITIVE_INFINITY;
  const tMaxY = dir.y !== 0 ? (nextBoundaryY - origin.y) / dir.y : Number.POSITIVE_INFINITY;
  const tMaxZ = dir.z !== 0 ? (nextBoundaryZ - origin.z) / dir.z : Number.POSITIVE_INFINITY;

  // Distance between subsequent boundaries on each axis
  const tDeltaX = dir.x !== 0 ? 1 / Math.abs(dir.x) : Number.POSITIVE_INFINITY;
  const tDeltaY = dir.y !== 0 ? 1 / Math.abs(dir.y) : Number.POSITIVE_INFINITY;
  const tDeltaZ = dir.z !== 0 ? 1 / Math.abs(dir.z) : Number.POSITIVE_INFINITY;

  // Mutable copies
  let _tMaxX = tMaxX;
  let _tMaxY = tMaxY;
  let _tMaxZ = tMaxZ;

  // Early check: if starting inside a solid voxel, treat as no hit (we want the first boundary we cross)
  // Some games choose to return this cell; here we skip to avoid self-hit at the eye.

  // March the grid
  let t = 0;
  // We also track the last empty cell we were in to compute placeCell on hit
  let lastX = x;
  let lastY = y;
  let lastZ = z;

  // Hard cap on iterations to avoid infinite loops in degenerate cases
  const maxIters = Math.ceil(maxDistance * 3 + 10);
  for (let iter = 0; iter < maxIters; iter++) {
    // Choose the axis with the smallest tMax*
    if (_tMaxX < _tMaxY) {
      if (_tMaxX < _tMaxZ) {
        // Step X
        lastX = x; lastY = y; lastZ = z;
        x += stepX;
        t = _tMaxX;
        _tMaxX += tDeltaX;
      } else {
        // Step Z
        lastX = x; lastY = y; lastZ = z;
        z += stepZ;
        t = _tMaxZ;
        _tMaxZ += tDeltaZ;
      }
    } else {
      if (_tMaxY < _tMaxZ) {
        // Step Y
        lastX = x; lastY = y; lastZ = z;
        y += stepY;
        t = _tMaxY;
        _tMaxY += tDeltaY;
      } else {
        // Step Z
        lastX = x; lastY = y; lastZ = z;
        z += stepZ;
        t = _tMaxZ;
        _tMaxZ += tDeltaZ;
      }
    }

    if (t > maxDistance) break;

    // Check voxel solidity/selectability at new cell
    let selectable: boolean;
    if (predicate) {
      selectable = predicate(world, x, y, z);
    } else {
      const id = world.getBlock(x, y, z);
      const def = getBlock(id);
      selectable = !!def && (world.isBlockSolid(x, y, z) || def.name === 'grass_tuft');
    }
    if (selectable) {
      return {
        hit: true,
        hitCell: { x, y, z },
        placeCell: { x: lastX, y: lastY, z: lastZ },
        t,
      };
    }
  }

  return { hit: false };
}
