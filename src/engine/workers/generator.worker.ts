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

// Noise configuration
const NOISE_SCALE = 0.01; // Lower values = smoother terrain
const BASE_HEIGHT = 32;    // Base terrain height
const AMPLITUDE = 16;      // Height variation
const BEDROCK_LEVEL = 3;   // Stone below this level
const WATER_LEVEL = 26;    // Global water table for shallow lakes

// Height calculation function (duplicated in TerrainGenerator.ts for main thread use)
function getHeightAtPosition(x: number, z: number, noise2D: (x: number, z: number) => number): number {
  const noiseValue = noise2D(x * NOISE_SCALE, z * NOISE_SCALE);
  return Math.floor(BASE_HEIGHT + AMPLITUDE * noiseValue);
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
  
  // Create noise generator with seed
  const noise2D = createNoise2D(() => seed);
  
  // Create voxel array
  const totalVoxels = CHUNK_SIZE.x * CHUNK_SIZE.y * CHUNK_SIZE.z;
  const voxels = new Uint8Array(totalVoxels);
  
  // Generate terrain for this chunk
  generateTerrain(voxels, cx, cy, cz, noise2D);
  
  
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
  noise2D: (x: number, z: number) => number
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
      
      // Generate terrain height using noise
      const height = getHeightAtPosition(worldX, worldZ, noise2D);
      
      // Fill column from bottom up
      for (let ly = 0; ly < CHUNK_SIZE.y; ly++) {
        const worldY = cy * CHUNK_SIZE.y + ly;
        const index = localToIndex(lx, ly, lz);
        
        // Natural layering rules
        // 1) Ground: stone deep, then 2 layers of dirt (or sand if near water), then grass/sand surface
        // 2) Water: flat, 1-block surface at WATER_LEVEL wherever the ground height is below water level
        if (worldY <= height) {
          // Solid ground
          if (worldY < BEDROCK_LEVEL) {
            voxels[index] = STONE;
          } else if (worldY === height) {
            // Surface block
            voxels[index] = (height <= WATER_LEVEL + 1) ? SAND : GRASS;
          } else if (worldY > height - 3) {
            // Sub-surface layer (two blocks)
            voxels[index] = (height <= WATER_LEVEL + 1) ? SAND : DIRT;
          } else {
            voxels[index] = STONE;
          }
        } else if (worldY === WATER_LEVEL && height < WATER_LEVEL) {
          // Flat water surface at global water level (no depth fill)
          voxels[index] = WATER;
        } else {
          voxels[index] = AIR;
        }
      }
    }
  }
}