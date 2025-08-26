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

// Island terrain configuration
const WATER_LEVEL = 42;                 // Global water table
const BEDROCK_LEVEL = 3;                // Stone below this level

// Island shape parameters
const ISLAND_RADIUS_BASE = 0.7;         // Base island radius as fraction of world size
const COASTLINE_NOISE_SCALE = 0.02;     // Coastline variation frequency
const COASTLINE_NOISE_AMP = 0.15;       // Coastline variation amplitude (fraction of radius)

// Terrain noise scales and amplitudes
const ELEVATION_SCALE = 0.008;          // Large-scale elevation changes
const ELEVATION_AMPLITUDE = 25;         // Height variation from elevation noise
const HILLS_SCALE = 0.02;               // Medium-scale hills and valleys
const HILLS_AMPLITUDE = 12;             // Hills height variation
const DETAIL_SCALE = 0.08;              // Fine detail noise
const DETAIL_AMPLITUDE = 2;             // Small-scale height variation
const WARP_SCALE = 0.015;               // Domain warp scale
const WARP_AMPLITUDE = 6.0;             // Domain warp strength

// Lake generation parameters
const LAKE_THRESHOLD = -0.3;            // Elevation threshold for lakes
const LAKE_DEPTH = 8;                   // Maximum lake depth

// Ocean floor generation parameters
const OCEAN_DEPTH_MIN = 5;              // Minimum ocean depth below water level
const OCEAN_DEPTH_MAX = 15;             // Maximum ocean depth below water level
const OCEAN_FLOOR_SCALE = 0.012;        // Ocean floor variation frequency
const OCEAN_FLOOR_AMPLITUDE = 0.6;      // Ocean floor height variation (0-1)

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


function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Island terrain generation with natural features
function createHeightFunction(seed: number, worldRadius?: number) {
  const rngCoastline = mulberry32(seed ^ 0x9e3779b9);
  const rngElevation = mulberry32(seed ^ 0x85ebca6b);
  const rngHills     = mulberry32(seed ^ 0xc2b2ae35);
  const rngDetail    = mulberry32(seed ^ 0x27d4eb2f);
  const rngWarpX     = mulberry32(seed ^ 0xa24baed6);
  const rngWarpZ     = mulberry32(seed ^ 0x3bd39e10);
  const rngLakes     = mulberry32(seed ^ 0x1a2b3c4d);
  const rngOceanFloor = mulberry32(seed ^ 0x5f7a2e1c);

  const nCoastline = createNoise2D(rngCoastline);
  const nElevation = createNoise2D(rngElevation);
  const nHills     = createNoise2D(rngHills);
  const nDetail    = createNoise2D(rngDetail);
  const nWarpX     = createNoise2D(rngWarpX);
  const nWarpZ     = createNoise2D(rngWarpZ);
  const nLakes     = createNoise2D(rngLakes);
  const nOceanFloor = createNoise2D(rngOceanFloor);

  // Use provided world radius or estimate from chunk size (assume 7x7 default, 48x48 chunks)
  const effectiveRadius = worldRadius || (7 * 48 / 2);

  return (x: number, z: number): { height: number; isLand: boolean } => {
    // Domain warp for natural terrain variation
    const wx = nWarpX(x * WARP_SCALE, z * WARP_SCALE) * WARP_AMPLITUDE;
    const wz = nWarpZ(x * WARP_SCALE, z * WARP_SCALE) * WARP_AMPLITUDE;
    const sx = x + wx;
    const sz = z + wz;

    // Distance from center for island shape
    const distanceFromCenter = Math.sqrt(x * x + z * z);
    const normalizedDistance = distanceFromCenter / effectiveRadius;

    // Island mask with noisy coastline
    const coastlineNoise = nCoastline(x * COASTLINE_NOISE_SCALE, z * COASTLINE_NOISE_SCALE);
    const islandRadius = ISLAND_RADIUS_BASE + coastlineNoise * COASTLINE_NOISE_AMP;
    const isLand = normalizedDistance < islandRadius;

    if (!isLand) {
      // Ocean floor with varied terrain
      const oceanFloorNoise = fbm((a, b) => nOceanFloor(a * OCEAN_FLOOR_SCALE, b * OCEAN_FLOOR_SCALE), x, z, 3, 2.0, 0.5);
      const depthVariation = OCEAN_DEPTH_MIN + (OCEAN_DEPTH_MAX - OCEAN_DEPTH_MIN) * (oceanFloorNoise * OCEAN_FLOOR_AMPLITUDE + 0.5);
      const oceanFloorHeight = WATER_LEVEL - Math.floor(depthVariation);
      return { height: Math.max(BEDROCK_LEVEL + 1, oceanFloorHeight), isLand: false };
    }

    // Island terrain generation
    const falloffMask = 1.0 - smoothstep(islandRadius * 0.6, islandRadius * 0.95, normalizedDistance);
    
    // Base elevation rising from coast to center
    const baseElevation = WATER_LEVEL + falloffMask * 20;
    
    // Large-scale elevation changes
    const elevation = fbm((a, b) => nElevation(a * ELEVATION_SCALE, b * ELEVATION_SCALE), sx, sz, 4, 2.0, 0.6);
    const elevationHeight = elevation * ELEVATION_AMPLITUDE * falloffMask;
    
    // Hills and valleys
    const hills = fbm((a, b) => nHills(a * HILLS_SCALE, b * HILLS_SCALE), sx, sz, 3, 2.0, 0.5);
    const hillHeight = hills * HILLS_AMPLITUDE * falloffMask;
    
    // Fine detail
    const detail = nDetail(sx * DETAIL_SCALE, sz * DETAIL_SCALE);
    const detailHeight = detail * DETAIL_AMPLITUDE;
    
    // Lake generation (depressions in terrain)
    const lakeNoise = nLakes(x * 0.01, z * 0.01);
    const lakeDepression = lakeNoise < LAKE_THRESHOLD ? 
      (lakeNoise - LAKE_THRESHOLD) * LAKE_DEPTH * falloffMask : 0;
    
    const totalHeight = baseElevation + elevationHeight + hillHeight + detailHeight + lakeDepression;
    
    return { 
      height: Math.floor(Math.max(BEDROCK_LEVEL + 1, totalHeight)), 
      isLand: true 
    };
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
  const { key, cx, cy, cz, seed, worldRadius } = request.payload;
  
  // Create height function with seed and world radius
  const heightAt = createHeightFunction(seed, worldRadius);
  
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
  heightAt: (x: number, z: number) => { height: number; isLand: boolean }
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
      
      // Generate terrain data
      const terrainData = heightAt(worldX, worldZ);
      const { height, isLand } = terrainData;
      
      // Calculate slope for surface block determination
      const heightNeighborX = heightAt(worldX + 1, worldZ).height;
      const heightNeighborZ = heightAt(worldX, worldZ + 1).height;
      const slope = Math.max(Math.abs(heightNeighborX - height), Math.abs(heightNeighborZ - height));
      
      // Distance from water level for beach determination
      const distanceFromWater = height - WATER_LEVEL;
      
      // Fill column from bottom up
      for (let ly = 0; ly < CHUNK_SIZE.y; ly++) {
        const worldY = cy * CHUNK_SIZE.y + ly;
        const index = localToIndex(lx, ly, lz);
        
        if (worldY <= height) {
          // Solid blocks (land)
          if (worldY < BEDROCK_LEVEL) {
            // Bedrock layer
            voxels[index] = STONE;
          } else if (worldY === height) {
            // Surface layer - determine block type based on context
            if (!isLand) {
              // Ocean floor
              voxels[index] = SAND;
            } else if (distanceFromWater <= 3) {
              // Beach areas near water level
              voxels[index] = SAND;
            } else if (slope >= 3) {
              // Steep slopes expose stone
              voxels[index] = STONE;
            } else {
              // Normal land surface
              voxels[index] = GRASS;
            }
          } else if (worldY > height - 4 && worldY < height) {
            // Sub-surface layers (dirt or sand)
            if (!isLand || distanceFromWater <= 3) {
              voxels[index] = SAND;
            } else {
              voxels[index] = DIRT;
            }
          } else {
            // Deep layers are stone
            voxels[index] = STONE;
          }
        } else if (worldY <= WATER_LEVEL) {
          // Water areas
          if (isLand && worldY === WATER_LEVEL && height < worldY) {
            // Lakes on land - only at surface level
            voxels[index] = WATER;
          } else if (!isLand && worldY === WATER_LEVEL) {
            // Ocean water - only at surface level
            voxels[index] = WATER;
          } else {
            // Air (includes ocean space below surface and above ground)
            voxels[index] = AIR;
          }
        } else {
          // Air above water level
          voxels[index] = AIR;
        }
      }
    }
  }
}
