/**
 * Terrain generation utilities shared between main thread and workers
 * Input: world coordinates and seed
 * Output: terrain height values using same algorithm as generator worker
 */

import { createNoise2D } from 'simplex-noise';

// Noise configuration (must match generator.worker.ts)
const NOISE_SCALE = 0.01; // Lower values = smoother terrain
const BASE_HEIGHT = 32;    // Base terrain height
const AMPLITUDE = 16;      // Height variation
export const WATER_LEVEL = 26; // keep in sync with generator.worker.ts

/**
 * Get terrain height at a specific world position
 */
export function getHeightAtPosition(x: number, z: number, seed: number): number {
  const noise2D = createNoise2D(() => seed);
  const noiseValue = noise2D(x * NOISE_SCALE, z * NOISE_SCALE);
  return Math.floor(BASE_HEIGHT + AMPLITUDE * noiseValue);
}

/**
 * Find a suitable spawn position above ground
 */
export function findSpawnPosition(seed: number, spawnX = 0, spawnZ = 0): { x: number; y: number; z: number } {
  const height = getHeightAtPosition(spawnX, spawnZ, seed);
  return {
    x: spawnX,
    y: height + 4, // Spawn 4 blocks above ground as per plan
    z: spawnZ
  };
}