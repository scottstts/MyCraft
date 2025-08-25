/**
 * Terrain generation utilities shared between main thread and workers
 * Input: world coordinates and seed
 * Output: terrain height values using same algorithm as generator worker
 */

import { createNoise2D } from 'simplex-noise';

// Must roughly mirror generator.worker.ts
const BASE_HEIGHT = 38;
const PLAINS_AMPLITUDE = 18;
const MOUNTAIN_AMPLITUDE = 38;
export const WATER_LEVEL = 42; // keep in sync with generator.worker.ts

const PLAINS_SCALE = 0.007;
const HILLS_SCALE = 0.015;
const MOUNTAIN_SCALE = 0.02;
const BIOME_SCALE = 0.0025;
const WARP_SCALE = 0.02;
const WARP_AMPLITUDE = 8.0;

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function fbm(noise: (x: number, z: number) => number, x: number, z: number, octaves = 4, lacunarity = 2.0, gain = 0.5): number {
  let amp = 1.0, sum = 0.0, sumAmp = 0.0;
  let fx = x, fz = z;
  for (let i = 0; i < octaves; i++) {
    sum += noise(fx, fz) * amp;
    sumAmp += amp;
    fx *= lacunarity; fz *= lacunarity; amp *= gain;
  }
  return sumAmp > 0 ? sum / sumAmp : 0;
}

function ridge(noise: (x: number, z: number) => number, x: number, z: number, octaves = 3, lacunarity = 2.0, gain = 0.5, exponent = 1.7): number {
  let amp = 1.0, sum = 0.0, sumAmp = 0.0;
  let fx = x, fz = z;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(fx, fz));
    sum += Math.pow(n, exponent) * amp;
    sumAmp += amp;
    fx *= lacunarity; fz *= lacunarity; amp *= gain;
  }
  return sumAmp > 0 ? (sum / sumAmp) * 2 - 1 : 0;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Get terrain height at a specific world position
 */
export function getHeightAtPosition(x: number, z: number, seed: number): number {
  const rngPlains = mulberry32(seed ^ 0x9e3779b9);
  const rngHills  = mulberry32(seed ^ 0x85ebca6b);
  const rngMount  = mulberry32(seed ^ 0xc2b2ae35);
  const rngBiome  = mulberry32(seed ^ 0x27d4eb2f);
  const rngWarpX  = mulberry32(seed ^ 0xa24baed6);
  const rngWarpZ  = mulberry32(seed ^ 0x3bd39e10);

  const nPlains = createNoise2D(rngPlains);
  const nHills  = createNoise2D(rngHills);
  const nMount  = createNoise2D(rngMount);
  const nBiome  = createNoise2D(rngBiome);
  const nWarpX  = createNoise2D(rngWarpX);
  const nWarpZ  = createNoise2D(rngWarpZ);

  const wx = nWarpX(x * WARP_SCALE, z * WARP_SCALE) * WARP_AMPLITUDE;
  const wz = nWarpZ(x * WARP_SCALE, z * WARP_SCALE) * WARP_AMPLITUDE;
  const sx = x + wx;
  const sz = z + wz;

  const biome = (nBiome(x * BIOME_SCALE, z * BIOME_SCALE) + 1) * 0.5;
  const mountainMask = smoothstep(0.35, 0.8, biome);

  const plains = fbm((a, b) => nPlains(a * PLAINS_SCALE, b * PLAINS_SCALE), sx, sz, 4, 2.0, 0.5);
  const hills  = fbm((a, b) => nHills(a * HILLS_SCALE, b * HILLS_SCALE), sx, sz, 3, 2.0, 0.5);
  const plainsHills = (plains * 0.7 + hills * 0.3);
  const mountains = ridge((a, b) => nMount(a * MOUNTAIN_SCALE, b * MOUNTAIN_SCALE), sx, sz, 3, 2.0, 0.5, 1.7);

  const hPlains = PLAINS_AMPLITUDE * plainsHills;
  const hMount  = MOUNTAIN_AMPLITUDE * mountains;
  const height  = BASE_HEIGHT + (1 - mountainMask) * hPlains + mountainMask * hMount;
  return Math.floor(height);
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
