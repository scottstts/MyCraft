/**
 * Generator Worker - Creates chunk terrain data
 * Input: chunk coordinates + seed
 * Output: ChunkData with voxels filled with terrain using heightmap
 */

import { createNoise2D } from 'simplex-noise';
import { CHUNK_SIZE } from '../../config/constants.js';
import { localToIndex } from '../utils/coords.js';
import { createTerrainColumnCache, type TerrainColumnSampler } from '../world/TerrainColumnCache.js';
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
// Make trunks a bit taller overall (+1..+2 blocks)
const TREE_MIN_HEIGHT = 4;              // Minimum trunk height
const TREE_MAX_HEIGHT = 7;              // Maximum trunk height
const TREE_MIN_SPACING = 5;             // Enforce safe horizontal spacing between trunks (in blocks)
const TREE_ANCHOR_RADIUS = 3;            // Leaf radius used when evaluating cross-chunk anchors

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

  // Use the provided world radius or a medium-footprint fallback with the
  // fixed large chunk dimensions.
  const effectiveRadius = worldRadius || (7 * CHUNK_SIZE.x / 2);

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
  const grassTuftPositions: number[] = [];

  // Terrain columns are shared by terrain filling, grass placement, and the
  // tree candidate/spacing search. Include the complete tree evaluation halo
  // plus one extra column in each positive direction for slope reads.
  const wx0 = cx * CHUNK_SIZE.x;
  const wz0 = cz * CHUNK_SIZE.z;
  const wx1 = wx0 + CHUNK_SIZE.x - 1;
  const wz1 = wz0 + CHUNK_SIZE.z - 1;
  const terrainColumns = createTerrainColumnCache(heightAt, {
    minX: wx0 - TREE_ANCHOR_RADIUS - TREE_MIN_SPACING,
    maxX: wx1 + TREE_ANCHOR_RADIUS + TREE_MIN_SPACING + 1,
    minZ: wz0 - TREE_ANCHOR_RADIUS - TREE_MIN_SPACING,
    maxZ: wz1 + TREE_ANCHOR_RADIUS + TREE_MIN_SPACING + 1,
  });
  
  // Generate terrain for this chunk
  generateTerrain(voxels, cx, cy, cz, terrainColumns, nTreeCluster, seed, grassTuftPositions);
  
  
  const chunkData: ChunkData = {
    size: CHUNK_SIZE,
    voxels,
    grassTuftPositions: new Uint16Array(grassTuftPositions),
  };
  
  const response: ChunkDataResponse = {
    type: 'CHUNK_DATA',
    key: key,
    payload: chunkData
  };
  
  // Transfer the generated arrays for performance.
  self.postMessage(response, {
    transfer: [voxels.buffer, chunkData.grassTuftPositions!.buffer],
  });
}

function generateTerrain(
  voxels: Uint8Array,
  cx: number,
  cy: number,
  cz: number,
  heightAt: TerrainColumnSampler,
  nTreeCluster: (x: number, z: number) => number,
  seed: number,
  grassTuftPositions: number[],
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
  const LEAVES_CHERRY = 8; // legacy alternate-leaves id; rendered as cherry blossom
  const GRASS_TUFT = 9; // decorative grass billboard
  
  // Process each column in the chunk
  for (let lx = 0; lx < CHUNK_SIZE.x; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE.z; lz++) {
      // Convert to world coordinates
      const worldX = cx * CHUNK_SIZE.x + lx;
      const worldZ = cz * CHUNK_SIZE.z + lz;
      
      // Generate terrain data
      const terrainData = heightAt(worldX, worldZ);
      const { height, isLand, slope } = terrainData;
      
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

  // Pass: spawn decorative grass tufts on grass blocks (local-only; no cross-chunk placement needed)
  for (let lx = 0; lx < CHUNK_SIZE.x; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE.z; lz++) {
      const worldX = cx * CHUNK_SIZE.x + lx;
      const worldZ = cz * CHUNK_SIZE.z + lz;
      const { height: surfaceY, isLand } = heightAt(worldX, worldZ);
      if (!isLand) continue;
      const lySurface = surfaceY - cy * CHUNK_SIZE.y;
      const lyAbove = lySurface + 1;
      if (lySurface < 0 || lySurface >= CHUNK_SIZE.y) continue; // surface not in this chunk
      if (lyAbove < 0 || lyAbove >= CHUNK_SIZE.y) continue;     // above cell not in this chunk
      const idxSurface = localToIndex(lx, lySurface, lz);
      if (voxels[idxSurface] !== GRASS) continue; // only on grass blocks
      const idxAbove = localToIndex(lx, lyAbove, lz);
      if (voxels[idxAbove] !== AIR) continue; // must be empty above

      // Clustered distribution similar to trees but denser
      const clusterNoise = (nTreeCluster(worldX * TREE_CLUSTER_SCALE, worldZ * TREE_CLUSTER_SCALE) + 1) * 0.5; // 0..1
      const clusterMask = smoothstep(0.55, 0.95, clusterNoise); // favor patches
      const baseDensity = 0.40; // ~40% average coverage
      // Keep mean ~0.4: factor ranges ~[0.3..1.3] → average ≈ 0.8 → base*0.8 ≈ 0.32; bump base a bit
      const spawnProb = baseDensity * (0.3 + 1.4 * clusterMask);
      const r = hash2d(worldX, worldZ, 911 ^ seed);
      if (r < spawnProb) {
        voxels[idxAbove] = GRASS_TUFT;
        grassTuftPositions.push(lx, lyAbove, lz);
      }
    }
  }

  // Second pass: spawn trees by world anchors, placing leaves across chunk borders (clipped)
  const wx0 = cx * CHUNK_SIZE.x;
  const wz0 = cz * CHUNK_SIZE.z;
  const wx1 = wx0 + CHUNK_SIZE.x - 1;
  const wz1 = wz0 + CHUNK_SIZE.z - 1;
  const RMAX = TREE_ANCHOR_RADIUS;

  for (let ax = wx0 - RMAX; ax <= wx1 + RMAX; ax++) {
    for (let az = wz0 - RMAX; az <= wz1 + RMAX; az++) {
      const { height: baseY, isLand, slope } = heightAt(ax, az);
      const distanceFromWater = baseY - WATER_LEVEL;

      // Only on gentle inland grass surfaces (mirrors surface grass conditions)
      if (!isLand || distanceFromWater <= 3 || slope >= 3) continue;

      // Clustered distribution via low-frequency noise
      const clusterNoise = (nTreeCluster(ax * TREE_CLUSTER_SCALE, az * TREE_CLUSTER_SCALE) + 1) * 0.5;
      const clusterMask = smoothstep(0.6, 0.86, clusterNoise); // stronger clustering
      const inlandFactor = smoothstep(2, 14, distanceFromWater); // rarer near coasts
      const spawnProb = TREE_BASE_DENSITY * (0.05 + 6.0 * clusterMask) * inlandFactor;

      const r = hash2d(ax, az, 1337 ^ seed);
      if (r >= spawnProb) continue; // not a candidate for spawning

      // Enforce minimum spacing deterministically across chunks.
      // A candidate only spawns if it has the best (lowest) priority
      // among other spawn-candidates within TREE_MIN_SPACING.
      const myPriority = hash2d(ax, az, (0xd00df00d ^ seed) | 0);
      const r2 = TREE_MIN_SPACING * TREE_MIN_SPACING;
      let blocked = false;
      for (let bx = ax - TREE_MIN_SPACING; !blocked && bx <= ax + TREE_MIN_SPACING; bx++) {
        for (let bz = az - TREE_MIN_SPACING; bz <= az + TREE_MIN_SPACING; bz++) {
          if (bx === ax && bz === az) continue;
          const ddx = bx - ax; const ddz = bz - az;
          if ((ddx * ddx + ddz * ddz) > r2) continue;

          // Neighbor must also qualify as a spawn-candidate on similar terrain
          const nData = heightAt(bx, bz);
          if (!nData.isLand) continue;
          const nSlope = nData.slope;
          const nDistWater = nData.height - WATER_LEVEL;
          if (nDistWater <= 3 || nSlope >= 3) continue;

          const nClusterNoise = (nTreeCluster(bx * TREE_CLUSTER_SCALE, bz * TREE_CLUSTER_SCALE) + 1) * 0.5;
          const nClusterMask = smoothstep(0.6, 0.86, nClusterNoise);
          const nInlandFactor = smoothstep(2, 14, nDistWater);
          const nSpawnProb = TREE_BASE_DENSITY * (0.05 + 6.0 * nClusterMask) * nInlandFactor;
          const nR = hash2d(bx, bz, 1337 ^ seed);
          if (nR >= nSpawnProb) continue; // neighbor wouldn't spawn anyway

          const nPriority = hash2d(bx, bz, (0xd00df00d ^ seed) | 0);
          if (nPriority < myPriority || (nPriority === myPriority && (bx < ax || (bx === ax && bz < az)))) {
            blocked = true; break;
          }
        }
      }
      if (blocked) continue; // too close to a better candidate

      // Tree parameters (slightly taller trees)
      const trunkHeight = TREE_MIN_HEIGHT + Math.floor(hash2d(ax, az, 4242 ^ seed) * (TREE_MAX_HEIGHT - TREE_MIN_HEIGHT + 1));
      const maxRadius = Math.max(1, Math.min(3, Math.floor(trunkHeight * 0.5)));

      // Choose leaf palette per-tree (80% default green, 20% cherry blossom)
      const leafTypeRand = hash2d(ax, az, (0x1efc0ffe ^ seed) | 0);
      const LEAF_BLOCK = leafTypeRand < 0.8 ? LEAVES : LEAVES_CHERRY;

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

      // Place leaves (clipped to this chunk) with a rounded canopy
      // resembling the reference oak-like shape.
      const topY = baseY + trunkHeight;
      // Start slightly below trunk top to create a fuller canopy.
      type LayerDef = { dy: number; r: number };
      const layersDef: LayerDef[] = [];
      if (maxRadius <= 1) {
        // Compact canopy
        layersDef.push({ dy: -1, r: 1 }, { dy: 0, r: 1 }, { dy: 1, r: 0 });
      } else if (maxRadius === 2) {
        // Classic small oak silhouette: 5x5, 5x5, 3x3, 1
        layersDef.push(
          { dy: -1, r: 2 },
          { dy: 0, r: 2 },
          { dy: 1, r: 1 },
          { dy: 2, r: 0 }
        );
      } else {
        // Slightly larger rounded blob
        layersDef.push(
          { dy: -2, r: 2 },
          { dy: -1, r: 3 },
          { dy: 0, r: 3 },
          { dy: 1, r: 2 },
          { dy: 2, r: 1 }
        );
      }

      // Ensure at least 4 blocks of exposed trunk before any leaves
      const minDy = layersDef.reduce((m, l) => Math.min(m, l.dy), 0);
      const canopyStartY = topY + minDy;
      const lift = Math.max(0, (baseY + 4) - canopyStartY);

      for (const ld of layersDef) {
        const wy = topY + ld.dy + lift;
        const lyLeaves = wy - cy * CHUNK_SIZE.y;
        if (lyLeaves < 0 || lyLeaves >= CHUNK_SIZE.y) continue;

        const radius = ld.r;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            const axdx = Math.abs(dx), azdz = Math.abs(dz);
            const cheb = Math.max(axdx, azdz);
            if (cheb > radius) continue;
            // Clip hard corners to round the cube silhouette
            const isCorner = axdx === radius && azdz === radius && radius > 0;
            if (isCorner) continue;

            const wxLeaf = ax + dx;
            const wzLeaf = az + dz;
            const lxLeaf = wxLeaf - wx0;
            const lzLeaf = wzLeaf - wz0;
            if (lxLeaf < 0 || lxLeaf >= CHUNK_SIZE.x || lzLeaf < 0 || lzLeaf >= CHUNK_SIZE.z) continue;

            // Slight edge jitter for natural look
            if (radius > 0 && cheb === radius - 0) {
              const jitterSeed = (seed ^ (wy << 1)) | 0;
              const rEdge = hash2d(wxLeaf, wzLeaf, jitterSeed);
              const skipProb = 0.05; // subtle
              if (rEdge < skipProb) continue;
            }

            const idx = localToIndex(lxLeaf, lyLeaves, lzLeaf);
            if (voxels[idx] === AIR) voxels[idx] = LEAF_BLOCK;
          }
        }
      }
    }
  }

  // Tree trunks are authored after the grass pass and can replace a tuft at
  // the same cell. Keep the compact response metadata aligned with the final
  // voxel array so billboard instancing cannot resurrect an overwritten tuft.
  let validGrassPositionCount = 0;
  for (let index = 0; index + 2 < grassTuftPositions.length; index += 3) {
    const lx = grassTuftPositions[index];
    const ly = grassTuftPositions[index + 1];
    const lz = grassTuftPositions[index + 2];
    if (voxels[localToIndex(lx, ly, lz)] !== GRASS_TUFT) continue;
    grassTuftPositions[validGrassPositionCount++] = lx;
    grassTuftPositions[validGrassPositionCount++] = ly;
    grassTuftPositions[validGrassPositionCount++] = lz;
  }
  grassTuftPositions.length = validGrassPositionCount;
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
