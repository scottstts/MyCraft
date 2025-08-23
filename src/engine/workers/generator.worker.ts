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
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(response, { transfer: [voxels.buffer] });
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
  
  // Process each column in the chunk
  for (let lx = 0; lx < CHUNK_SIZE.x; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE.z; lz++) {
      // Convert to world coordinates
      const worldX = cx * CHUNK_SIZE.x + lx;
      const worldZ = cz * CHUNK_SIZE.z + lz;
      
      // Generate height using noise
      const noiseValue = noise2D(worldX * NOISE_SCALE, worldZ * NOISE_SCALE);
      const height = Math.floor(BASE_HEIGHT + AMPLITUDE * noiseValue);
      
      // Fill column from bottom up
      for (let ly = 0; ly < CHUNK_SIZE.y; ly++) {
        const worldY = cy * CHUNK_SIZE.y + ly;
        const index = localToIndex(lx, ly, lz);
        
        if (worldY <= height) {
          // Below surface - determine block type
          if (worldY < BEDROCK_LEVEL) {
            voxels[index] = STONE; // Bedrock area
          } else if (worldY === height) {
            voxels[index] = GRASS; // Surface
          } else if (worldY > height - 3) {
            voxels[index] = DIRT; // 3 layers of dirt below surface
          } else {
            voxels[index] = STONE; // Deep stone
          }
        } else {
          voxels[index] = AIR; // Above surface
        }
      }
    }
  }
}