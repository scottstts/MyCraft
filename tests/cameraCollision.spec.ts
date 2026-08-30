import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { constrainCameraToSolidVoxels } from '../src/engine/utils/cameraCollision';
import type { World } from '../src/engine/world/World';

function solidBelowSurface(surfaceY: number): World {
  return {
    isBlockSolid: (_x: number, y: number) => y < surfaceY,
  } as World;
}

describe('third-person camera voxel constraint', () => {
  it('hard-clips the camera sphere before it crosses terrain', () => {
    const pivot = new THREE.Vector3(0.5, 1.7, 0.5);
    const candidate = new THREE.Vector3(0.5, -2, 4.5);

    constrainCameraToSolidVoxels(solidBelowSurface(1), pivot, candidate, 0.2, 0.04);

    expect(candidate.y).toBeGreaterThan(1.2);
    expect(candidate.distanceTo(pivot)).toBeLessThan(new THREE.Vector3(0.5, -2, 4.5).distanceTo(pivot));
  });

  it('preserves an unobstructed orbit position', () => {
    const world = { isBlockSolid: () => false } as unknown as World;
    const pivot = new THREE.Vector3(0, 2, 0);
    const candidate = new THREE.Vector3(0, 4, 4);
    const expected = candidate.clone();

    constrainCameraToSolidVoxels(world, pivot, candidate);

    expect(candidate.equals(expected)).toBe(true);
  });

  it('enforces a terrain-surface floor even when the orbit extends over open air', () => {
    const world = { isBlockSolid: () => false } as unknown as World;
    const pivot = new THREE.Vector3(0, 2, 0);
    const candidate = new THREE.Vector3(0, -3, 4);

    constrainCameraToSolidVoxels(world, pivot, candidate, 0.2, 0.04, 1.2);

    expect(candidate.y).toBe(1.2);
  });

  it('keeps the camera sphere clear of a diagonal voxel corner', () => {
    const world = {
      isBlockSolid: (x: number, y: number, z: number) => x === 1 && y === 1 && z === 1,
    } as unknown as World;
    const pivot = new THREE.Vector3(0.5, 1.5, 0.5);
    const candidate = new THREE.Vector3(0.9, 1.5, 0.9);

    constrainCameraToSolidVoxels(world, pivot, candidate, 0.2, 0.04);

    expect(candidate.x).toBeLessThan(0.8);
    expect(candidate.z).toBeLessThan(0.8);
  });
});
