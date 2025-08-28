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
const OCEAN_FLOOR_SCALE = 0.012;        // Ocean floor variation frequency
 
// Tree generation parameters
const TREE_BASE_DENSITY = 0.01;         // ~1% of surface grass blocks
const TREE_CLUSTER_SCALE = 0.006;       // Larger clusters (more natural patches)
const TREE_MIN_HEIGHT = 3;              // Minimum trunk height (smaller trees)
const TREE_MAX_HEIGHT = 5;              // Maximum trunk height (smaller trees)

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
      // Ocean floor with gradient drop based on distance from island
      const oceanFloorNoise = fbm((a, b) => nOceanFloor(a * OCEAN_FLOOR_SCALE, b * OCEAN_FLOOR_SCALE), x, z, 3, 2.0, 0.5);
      
      // Calculate gradient depth based on distance from island edge
      const islandEdgeDistance = Math.max(0, normalizedDistance - islandRadius);
      const maxDistanceFromIsland = 1.0 - islandRadius; // Maximum possible distance from island edge
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
  // Create tree cluster noise with same seed for deterministic placement
  const nTreeCluster = createNoise2D(mulberry32(seed ^ 0x7f4a7c15));
  
  // Create voxel array
  const totalVoxels = CHUNK_SIZE.x * CHUNK_SIZE.y * CHUNK_SIZE.z;
  const voxels = new Uint8Array(totalVoxels);
  
  // Generate terrain for this chunk
  generateTerrain(voxels, cx, cy, cz, heightAt, nTreeCluster, seed);
  
  
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
  heightAt: (x: number, z: number) => { height: number; isLand: boolean },
  nTreeCluster: (x: number, z: number) => number,
  seed: number
): void {
  // Block IDs
  const AIR = 0;
  const GRASS = 1;
  const DIRT = 2;
  const STONE = 3;
  const SAND = 4;
  const WATER = 5;
  const WOOD = 6;
  const LEAVES = 7;
  
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

  // Second pass: spawn trees by world anchors, placing leaves across chunk borders (clipped)
  const wx0 = cx * CHUNK_SIZE.x;
  const wz0 = cz * CHUNK_SIZE.z;
  const wx1 = wx0 + CHUNK_SIZE.x - 1;
  const wz1 = wz0 + CHUNK_SIZE.z - 1;
  const RMAX = 3; // maximum leaf radius to include neighbor anchors

  for (let ax = wx0 - RMAX; ax <= wx1 + RMAX; ax++) {
    for (let az = wz0 - RMAX; az <= wz1 + RMAX; az++) {
      const { height: baseY, isLand } = heightAt(ax, az);
      const slope = Math.max(
        Math.abs(heightAt(ax + 1, az).height - baseY),
        Math.abs(heightAt(ax, az + 1).height - baseY)
      );
      const distanceFromWater = baseY - WATER_LEVEL;

      // Only on gentle inland grass surfaces (mirrors surface grass conditions)
      if (!isLand || distanceFromWater <= 3 || slope >= 3) continue;

      // Clustered distribution via low-frequency noise
      const clusterNoise = (nTreeCluster(ax * TREE_CLUSTER_SCALE, az * TREE_CLUSTER_SCALE) + 1) * 0.5;
      const clusterMask = smoothstep(0.6, 0.86, clusterNoise); // stronger clustering
      const inlandFactor = smoothstep(2, 14, distanceFromWater); // rarer near coasts
      const spawnProb = TREE_BASE_DENSITY * (0.05 + 6.0 * clusterMask) * inlandFactor;

      const r = hash2d(ax, az, 1337 ^ seed);
      if (r >= spawnProb) continue;

      // Tree parameters (smaller trees)
      const trunkHeight = TREE_MIN_HEIGHT + Math.floor(hash2d(ax, az, 4242 ^ seed) * (TREE_MAX_HEIGHT - TREE_MIN_HEIGHT + 1));
      const maxRadius = Math.max(1, Math.min(3, Math.floor(trunkHeight * 0.5)));

      // Place trunk (only within this chunk)
      const lxTrunk = ax - wx0;
      const lzTrunk = az - wz0;
      if (lxTrunk >= 0 && lxTrunk < CHUNK_SIZE.x && lzTrunk >= 0 && lzTrunk < CHUNK_SIZE.z) {
        for (let dy = 1; dy <= trunkHeight; dy++) {
          const wy = baseY + dy;
          const lyTrunk = wy - cy * CHUNK_SIZE.y;
          if (lyTrunk < 0 || lyTrunk >= CHUNK_SIZE.y) continue;
          const idx = localToIndex(lxTrunk, lyTrunk, lzTrunk);
          voxels[idx] = WOOD;
        }
      }

      // Place leaves (clipped to this chunk), start above trunk top
      const topY = baseY + trunkHeight;
      const layers = maxRadius + 1;
      for (let layer = 0; layer < layers; layer++) {
        const radius = maxRadius - layer;
        const wy = topY + 1 + layer;
        const lyLeaves = wy - cy * CHUNK_SIZE.y;
        if (lyLeaves < 0 || lyLeaves >= CHUNK_SIZE.y) continue;

        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            const cheb = Math.max(Math.abs(dx), Math.abs(dz));
            if (cheb > radius) continue;
            const wxLeaf = ax + dx;
            const wzLeaf = az + dz;
            const lxLeaf = wxLeaf - wx0;
            const lzLeaf = wzLeaf - wz0;
            if (lxLeaf < 0 || lxLeaf >= CHUNK_SIZE.x || lzLeaf < 0 || lzLeaf >= CHUNK_SIZE.z) continue;
            // Mild edge jitter for natural look
            if (radius > 0 && cheb === radius) {
              const jitterSeed = (seed ^ (wy << 1)) | 0;
              const rEdge = hash2d(wxLeaf, wzLeaf, jitterSeed);
              const isCorner = Math.abs(dx) === radius && Math.abs(dz) === radius;
              const skipProb = isCorner ? 0.15 : 0.06;
              if (rEdge < skipProb) continue;
            }
            const idx = localToIndex(lxLeaf, lyLeaves, lzLeaf);
            if (voxels[idx] === AIR) voxels[idx] = LEAVES;
          }
        }
      }
    }
  }
}

// Fast 2D integer hash -> [0,1)
function hash2d(x: number, z: number, seed: number): number {
  // 32-bit integer hash, avoiding precision loss
  let h = 0;
  h = (Math.imul((x | 0), 374761393) ^ Math.imul((z | 0), 668265263) ^ Math.imul((seed | 0), 2654435761)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
