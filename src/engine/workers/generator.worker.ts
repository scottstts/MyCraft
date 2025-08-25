/**
 * Generator Worker - Creates chunk terrain data
 * Input: chunk coordinates + seed
 * Output: ChunkData with voxels filled with terrain using heightmap
 */

import { createNoise2D } from 'simplex-noise';
import { CHUNK_SIZE } from '../../config/constants.js';
import { localToIndex } from '../utils/coords.js';
import type { 
  WorkerRequest, 
  GenerateChunkRequest,
  ChunkDataResponse
} from '../../types/workers.js';
import type { ChunkData } from '../../types/index.js';
import { isGenerateChunkRequest } from '../../types/workers.js';

// Noise configuration (richer terrain)
const BASE_HEIGHT = 38;                 // Base terrain height
const PLAINS_AMPLITUDE = 18;            // Plains variation
const MOUNTAIN_AMPLITUDE = 38;          // Mountain variation
const BEDROCK_LEVEL = 3;                // Stone below this level
const WATER_LEVEL = 42;                 // Global water table

const PLAINS_SCALE = 0.007;             // Larger scale -> smoother plains
const HILLS_SCALE = 0.015;              // Mid-scale detail
const MOUNTAIN_SCALE = 0.02;            // Mountain noise scale
const BIOME_SCALE = 0.0025;             // Biome blending scale
const WARP_SCALE = 0.02;                // Domain warp scale
const WARP_AMPLITUDE = 8.0;             // Domain warp strength (in world units)

// Seeded RNG for simplex-noise
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
  let amp = 1.0;
  let sum = 0.0;
  let sumAmp = 0.0;
  let fx = x;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    sum += noise(fx, fz) * amp; // noise in [-1,1]
    sumAmp += amp;
    fx *= lacunarity;
    fz *= lacunarity;
    amp *= gain;
  }
  return sumAmp > 0 ? sum / sumAmp : 0;
}

function ridge(noise: (x: number, z: number) => number, x: number, z: number, octaves = 3, lacunarity = 2.0, gain = 0.5, exponent = 1.5): number {
  // Ridged multifractal: 1 - abs(noise)
  let amp = 1.0;
  let sum = 0.0;
  let sumAmp = 0.0;
  let fx = x;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(fx, fz)); // [0,2]
    sum += Math.pow(n, exponent) * amp;
    sumAmp += amp;
    fx *= lacunarity;
    fz *= lacunarity;
    amp *= gain;
  }
  return sumAmp > 0 ? (sum / sumAmp) * 2 - 1 : 0; // roughly [-1,1]
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Height calculation with domain warp and biome blending
function createHeightFunction(seed: number) {
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

  return (x: number, z: number): number => {
    // Domain warp
    const wx = nWarpX(x * WARP_SCALE, z * WARP_SCALE) * WARP_AMPLITUDE;
    const wz = nWarpZ(x * WARP_SCALE, z * WARP_SCALE) * WARP_AMPLITUDE;
    const sx = x + wx;
    const sz = z + wz;

    // Biome mask in [0,1]
    const biome = (nBiome(x * BIOME_SCALE, z * BIOME_SCALE) + 1) * 0.5;
    const mountainMask = smoothstep(0.35, 0.8, biome);

    // Plains + hills
    const plains = fbm((a, b) => nPlains(a * PLAINS_SCALE, b * PLAINS_SCALE), sx, sz, 4, 2.0, 0.5);
    const hills  = fbm((a, b) => nHills(a * HILLS_SCALE, b * HILLS_SCALE), sx, sz, 3, 2.0, 0.5);
    const plainsHills = (plains * 0.7 + hills * 0.3);

    // Mountains (ridged)
    const mountains = ridge((a, b) => nMount(a * MOUNTAIN_SCALE, b * MOUNTAIN_SCALE), sx, sz, 3, 2.0, 0.5, 1.7);

    const hPlains = PLAINS_AMPLITUDE * plainsHills;     // ~[-PLAINS_AMPLITUDE, +PLAINS_AMPLITUDE]
    const hMount  = MOUNTAIN_AMPLITUDE * mountains;     // ~[-MOUNTAIN_AMPLITUDE, +MOUNTAIN_AMPLITUDE]
    const height  = BASE_HEIGHT + (1 - mountainMask) * hPlains + mountainMask * hMount;
    return Math.floor(height);
  };
}

// Handle messages from main thread
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  
  if (isGenerateChunkRequest(request)) {
    handleGenerateChunk(request);
  } else {
    console.warn('[GeneratorWorker] Unknown request type:', request);
  }
};

function handleGenerateChunk(request: GenerateChunkRequest): void {
  const { key, cx, cy, cz, seed } = request.payload;
  
  // Create height function with seed
  const heightAt = createHeightFunction(seed);
  
  // Create voxel array
  const totalVoxels = CHUNK_SIZE.x * CHUNK_SIZE.y * CHUNK_SIZE.z;
  const voxels = new Uint8Array(totalVoxels);
  
  // Generate terrain for this chunk
  generateTerrain(voxels, cx, cy, cz, heightAt);
  
  
  const chunkData: ChunkData = {
    size: CHUNK_SIZE,
    voxels: voxels
  };
  
  const response: ChunkDataResponse = {
    type: 'CHUNK_DATA',
    key: key,
    payload: chunkData
  };
  
  // Transfer the voxels array for performance
  self.postMessage(response, { transfer: [voxels.buffer] });
}

function generateTerrain(
  voxels: Uint8Array,
  cx: number,
  cy: number,
  cz: number,
  heightAt: (x: number, z: number) => number
): void {
  // Block IDs
  const AIR = 0;
  const GRASS = 1;
  const DIRT = 2;
  const STONE = 3;
  const SAND = 4;
  const WATER = 5;
  
  // Process each column in the chunk
  for (let lx = 0; lx < CHUNK_SIZE.x; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE.z; lz++) {
      // Convert to world coordinates
      const worldX = cx * CHUNK_SIZE.x + lx;
      const worldZ = cz * CHUNK_SIZE.z + lz;
      
      // Generate terrain height
      const height = heightAt(worldX, worldZ);
      // Approximate slope: difference with neighbors (forward differences)
      const hdx = Math.abs(heightAt(worldX + 1, worldZ) - height);
      const hdz = Math.abs(heightAt(worldX, worldZ + 1) - height);
      const slope = Math.max(hdx, hdz);
      
      // Fill column from bottom up
      for (let ly = 0; ly < CHUNK_SIZE.y; ly++) {
        const worldY = cy * CHUNK_SIZE.y + ly;
        const index = localToIndex(lx, ly, lz);
        
        // Natural layering rules
        // - Ground: stone deep, then 2 layers of dirt (or sand near water), then grass top unless steep slope => exposed stone
        // - Water: fill up to WATER_LEVEL for deeper lakes
        if (worldY <= height) {
          if (worldY < BEDROCK_LEVEL) {
            voxels[index] = STONE;
          } else if (worldY === height) {
            if (height <= WATER_LEVEL + 1) {
              voxels[index] = SAND;
            } else {
              // Expose stone on steep slopes
              voxels[index] = slope >= 2 ? STONE : GRASS;
            }
          } else if (worldY > height - 3) {
            voxels[index] = (height <= WATER_LEVEL + 1) ? SAND : DIRT;
          } else {
            voxels[index] = STONE;
          }
        } else if (worldY <= WATER_LEVEL && height < WATER_LEVEL) {
          // Fill water from ground+1 up to water level
          voxels[index] = WATER;
        } else {
          voxels[index] = AIR;
        }
      }
    }
  }
}
