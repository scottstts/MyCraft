/**
 * Terrain generation utilities shared between main thread and workers
 * Input: world coordinates and seed
 * Output: terrain height values using same algorithm as generator worker
 */

import { createNoise2D } from 'simplex-noise';
import { CHUNK_SIZE, PLAYER } from '../../config/constants';

// Must roughly mirror generator.worker.ts island configuration
export const WATER_LEVEL = 42; // keep in sync with generator.worker.ts
const BEDROCK_LEVEL = 3;

// Island shape parameters
const ISLAND_RADIUS_BASE = 0.7;
const COASTLINE_NOISE_SCALE = 0.02;
const COASTLINE_NOISE_AMP = 0.15;

// Terrain noise scales and amplitudes
const ELEVATION_SCALE = 0.008;
const ELEVATION_AMPLITUDE = 25;
const HILLS_SCALE = 0.02;
const HILLS_AMPLITUDE = 12;
const DETAIL_SCALE = 0.08;
const DETAIL_AMPLITUDE = 2;
const WARP_SCALE = 0.015;
const WARP_AMPLITUDE = 6.0;

// Lake generation parameters
const LAKE_THRESHOLD = -0.3;
const LAKE_DEPTH = 8;

// Ocean floor generation parameters (must mirror generator.worker.ts)
const OCEAN_FLOOR_SCALE = 0.012;        // Ocean floor variation frequency

export interface TerrainSample {
  height: number;
  /** True only outside the noisy island mask; inland lake depressions are false. */
  isOcean: boolean;
}

export type TerrainSampler = (x: number, z: number) => TerrainSample;

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


function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Create a cached terrain sampler using the same noise streams as generation.
 * The returned classification distinguishes the exterior ocean from inland
 * lake depressions that are still part of the island mask.
 */
export function createTerrainSampler(seed: number, worldRadius?: number): TerrainSampler {
  const rngCoastline = mulberry32(seed ^ 0x9e3779b9);
  const rngElevation = mulberry32(seed ^ 0x85ebca6b);
  const rngHills = mulberry32(seed ^ 0xc2b2ae35);
  const rngDetail = mulberry32(seed ^ 0x27d4eb2f);
  const rngWarpX = mulberry32(seed ^ 0xa24baed6);
  const rngWarpZ = mulberry32(seed ^ 0x3bd39e10);
  const rngLakes = mulberry32(seed ^ 0x1a2b3c4d);
  const rngOceanFloor = mulberry32(seed ^ 0x5f7a2e1c);

  const nCoastline = createNoise2D(rngCoastline);
  const nElevation = createNoise2D(rngElevation);
  const nHills = createNoise2D(rngHills);
  const nDetail = createNoise2D(rngDetail);
  const nWarpX = createNoise2D(rngWarpX);
  const nWarpZ = createNoise2D(rngWarpZ);
  const nLakes = createNoise2D(rngLakes);
  const nOceanFloor = createNoise2D(rngOceanFloor);

  // Use the provided world radius or a medium-footprint fallback with the
  // fixed large chunk dimensions.
  const estimatedRadius = worldRadius || (7 * CHUNK_SIZE.x / 2);

  return (x: number, z: number): TerrainSample => {
    // Domain warp for natural terrain variation
    const wx = nWarpX(x * WARP_SCALE, z * WARP_SCALE) * WARP_AMPLITUDE;
    const wz = nWarpZ(x * WARP_SCALE, z * WARP_SCALE) * WARP_AMPLITUDE;
    const sx = x + wx;
    const sz = z + wz;

    // Distance from center for island shape
    const distanceFromCenter = Math.sqrt(x * x + z * z);
    const normalizedDistance = distanceFromCenter / estimatedRadius;

    // Island mask with noisy coastline
    const coastlineNoise = nCoastline(x * COASTLINE_NOISE_SCALE, z * COASTLINE_NOISE_SCALE);
    const islandRadius = ISLAND_RADIUS_BASE + coastlineNoise * COASTLINE_NOISE_AMP;
    const isOcean = normalizedDistance >= islandRadius;

    if (isOcean) {
      // Ocean floor with gradient drop based on distance from island
      // (match generator.worker.ts)
      const oceanFloorNoise = fbm(
        (a, b) => nOceanFloor(a * OCEAN_FLOOR_SCALE, b * OCEAN_FLOOR_SCALE),
        x,
        z,
        3,
        2.0,
        0.5,
      );

      // Calculate gradient depth based on distance from island edge
      const islandEdgeDistance = Math.max(0, normalizedDistance - islandRadius);
      const maxDistanceFromIsland = Math.max(1e-6, 1.0 - islandRadius); // avoid div by zero
      const normalizedDepthDistance = Math.min(1.0, islandEdgeDistance / maxDistanceFromIsland);

      // Smooth gradient from shallow near coastline to deep at edges
      const gradientDepth = smoothstep(0.0, 1.0, normalizedDepthDistance);

      // Near coastline: shallow (close to land level), far away: deep
      const minDepthNearCoast = 2;  // Very shallow near coastline
      const maxDepthAtEdge = 25;    // Deep at the edge of the world
      const baseDepth = minDepthNearCoast + (maxDepthAtEdge - minDepthNearCoast) * gradientDepth;

      // Add noise variation but scale it down to preserve the gradient
      const noiseVariation = oceanFloorNoise * 3.0; // Reduced noise impact
      const finalDepth = baseDepth + noiseVariation;

      const oceanFloorHeight = WATER_LEVEL - Math.floor(finalDepth);
      return {
        height: Math.max(BEDROCK_LEVEL + 1, oceanFloorHeight),
        isOcean: true,
      };
    }

    // Island terrain generation
    const falloffMask = 1.0 - smoothstep(islandRadius * 0.6, islandRadius * 0.95, normalizedDistance);

    // Base elevation rising from coast to center
    const baseElevation = WATER_LEVEL + falloffMask * 20;

    // Large-scale elevation changes
    const elevation = fbm(
      (a, b) => nElevation(a * ELEVATION_SCALE, b * ELEVATION_SCALE),
      sx,
      sz,
      4,
      2.0,
      0.6,
    );
    const elevationHeight = elevation * ELEVATION_AMPLITUDE * falloffMask;

    // Hills and valleys
    const hills = fbm((a, b) => nHills(a * HILLS_SCALE, b * HILLS_SCALE), sx, sz, 3, 2.0, 0.5);
    const hillHeight = hills * HILLS_AMPLITUDE * falloffMask;

    // Fine detail
    const detail = nDetail(sx * DETAIL_SCALE, sz * DETAIL_SCALE);
    const detailHeight = detail * DETAIL_AMPLITUDE;

    // Lake generation (depressions in terrain)
    const lakeNoise = nLakes(x * 0.01, z * 0.01);
    const lakeDepression = lakeNoise < LAKE_THRESHOLD
      ? (lakeNoise - LAKE_THRESHOLD) * LAKE_DEPTH * falloffMask
      : 0;

    const totalHeight = baseElevation + elevationHeight + hillHeight + detailHeight + lakeDepression;

    return {
      height: Math.floor(Math.max(BEDROCK_LEVEL + 1, totalHeight)),
      isOcean: false,
    };
  };
}

/** Get a single terrain sample while retaining the old height-only entry point. */
export function getTerrainSampleAtPosition(x: number, z: number, seed: number, worldRadius?: number): TerrainSample {
  return createTerrainSampler(seed, worldRadius)(x, z);
}

/** Get terrain height at a specific world position using island generation. */
export function getHeightAtPosition(x: number, z: number, seed: number, worldRadius?: number): number {
  return getTerrainSampleAtPosition(x, z, seed, worldRadius).height;
}

/** Return the same ocean-only mask used by the terrain generator. */
export function isOceanAtPosition(x: number, z: number, seed: number, worldRadius?: number): boolean {
  return getTerrainSampleAtPosition(x, z, seed, worldRadius).isOcean;
}

/**
 * Find a suitable player eye position on the island.
 *
 * The returned Y value is already at the player's eye height above the top
 * terrain block. Keeping the spawn on the surface avoids the old startup
 * drop and gives both the controller and character the same initial pose.
 */
export function findSpawnPosition(seed: number, spawnX = 0, spawnZ = 0, worldRadius?: number): { x: number; y: number; z: number } {
  // Try to find a good spawn location on the island, starting from the requested position
  // but falling back to known good locations if needed
  const candidatePositions = [
    { x: spawnX, z: spawnZ }, // Requested position
    { x: 0, z: 0 },           // Center
    { x: 10, z: 10 },         // Slightly offset from center
    { x: -10, z: -10 },       // Other side of center
    { x: 20, z: 0 },          // Along main axes
    { x: 0, z: 20 },
  ];
  
  let bestSpawn = { x: spawnX, z: spawnZ, height: WATER_LEVEL - 10 };
  
  // Find the highest valid land position among candidates
  for (const pos of candidatePositions) {
    const height = getHeightAtPosition(pos.x, pos.z, seed, worldRadius);
    
    // Prefer positions that are above water level (on land)
    if (height > WATER_LEVEL && height > bestSpawn.height) {
      bestSpawn = { x: pos.x, z: pos.z, height };
    }
  }
  
  // If no land was found, use the highest position we found
  if (bestSpawn.height <= WATER_LEVEL) {
    for (const pos of candidatePositions) {
      const height = getHeightAtPosition(pos.x, pos.z, seed, worldRadius);
      if (height > bestSpawn.height) {
        bestSpawn = { x: pos.x, z: pos.z, height };
      }
    }
  }
  
  // The terrain height is the occupied block coordinate, so the walkable
  // surface is one block above it. Return the eye position, not a temporary
  // high camera position that needs to fall through the world.
  return {
    x: bestSpawn.x,
    y: bestSpawn.height + 1 + PLAYER.eyeHeight,
    z: bestSpawn.z
  };
}
