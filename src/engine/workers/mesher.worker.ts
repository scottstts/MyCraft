/**
 * Mesher Worker - Creates mesh data from chunk voxels using naive face culling
 * Input: ChunkData + block registry
 * Output: Mesh buffers (positions, normals, uvs, indices)
 */

import type { 
  WorkerRequest, 
  MeshChunkRequest,
  ChunkMeshResponse
} from '../../types/workers.js';
import type { BlockDef, BlockId } from '../../types/index.js';
import type { AtlasConfig } from '../render/Atlas.js';
import { isMeshChunkRequest } from '../../types/workers.js';
import { CHUNK_SIZE } from '../../config/constants.js';
import { localToIndex } from '../utils/coords.js';

// Block registry snapshot (passed from main thread)
let blockRegistry = new Map<BlockId, BlockDef>();
let atlasConfig: AtlasConfig | null = null;

// Face directions (normal vectors)
const FACES = [
  { name: 'front',  dir: [ 0,  0,  1], normal: [ 0,  0,  1] }, // +Z
  { name: 'back',   dir: [ 0,  0, -1], normal: [ 0,  0, -1] }, // -Z
  { name: 'right',  dir: [ 1,  0,  0], normal: [ 1,  0,  0] }, // +X
  { name: 'left',   dir: [-1,  0,  0], normal: [-1,  0,  0] }, // -X
  { name: 'top',    dir: [ 0,  1,  0], normal: [ 0,  1,  0] }, // +Y
  { name: 'bottom', dir: [ 0, -1,  0], normal: [ 0, -1,  0] }, // -Y
];

// Handle messages from main thread
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  
  if (isMeshChunkRequest(request)) {
    handleMeshChunk(request);
  } else {
    console.warn('[MesherWorker] Unknown request type:', request);
  }
};

function handleMeshChunk(request: MeshChunkRequest): void {
  const { key, chunkData, atlasConfig: receivedAtlasConfig, blockRegistry: receivedBlockRegistry, neighbors } = request.payload;
  
  // Update atlas config from main thread
  atlasConfig = receivedAtlasConfig;
  
  // Update block registry from main thread
  blockRegistry = new Map();
  for (const block of receivedBlockRegistry) {
    blockRegistry.set(block.id, block);
  }
  
  // Assert atlas config is available and valid
  if (!atlasConfig) {
    throw new Error('[MesherWorker] Atlas config is required but not provided');
  }
  if (!atlasConfig.atlasSize || !atlasConfig.tileSize || !atlasConfig.tiles) {
    throw new Error('[MesherWorker] Invalid atlas config - missing required properties');
  }
  
  // Build mesh from chunk data
  const mesh = buildChunkMesh(chunkData, neighbors, key);
  
  const response: ChunkMeshResponse = {
    type: 'CHUNK_MESH',
    key: key,
    payload: mesh
  };
  
  // Transfer the buffers for performance
  self.postMessage(response, { 
    transfer: [
      mesh.opaque.positions.buffer,
      mesh.opaque.normals.buffer,
      mesh.opaque.uvs.buffer,
      mesh.opaque.ao.buffer,
      mesh.opaque.indices.buffer,
      mesh.opaque.colors.buffer,
      mesh.transparent.positions.buffer,
      mesh.transparent.normals.buffer,
      mesh.transparent.uvs.buffer,
      mesh.transparent.ao.buffer,
      mesh.transparent.indices.buffer,
      mesh.transparent.colors.buffer,
    ] 
  });
}

// Block registry is now provided from main thread, no hardcoded initialization needed

function buildChunkMesh(chunkData: { voxels: Uint8Array }, neighbors: {
  posX?: { voxels: Uint8Array };
  negX?: { voxels: Uint8Array };
  posY?: { voxels: Uint8Array };
  negY?: { voxels: Uint8Array };
  posZ?: { voxels: Uint8Array };
  negZ?: { voxels: Uint8Array };
} | undefined, key: string) {
  // Parse chunk coordinates from key for world-space hashing
  const [cxStr, cyStr, czStr] = key.split(',');
  const cx = parseInt(cxStr, 10) || 0;
  const cy = parseInt(cyStr, 10) || 0;
  const cz = parseInt(czStr, 10) || 0;

  // Opaque and transparent buffers are built separately so we can render
  // them with different materials and blending order on the main thread.
  const positionsO: number[] = [];
  const normalsO: number[] = [];
  const uvsO: number[] = [];
  const aoO: number[] = [];
  const colorsO: number[] = [];
  const indicesO: number[] = [];
  let vertexCountO = 0;

  const positionsT: number[] = [];
  const normalsT: number[] = [];
  const uvsT: number[] = [];
  const aoT: number[] = [];
  const colorsT: number[] = [];
  const indicesT: number[] = [];
  let vertexCountT = 0;
  
  // Iterate through all voxels in the chunk
  for (let ly = 0; ly < CHUNK_SIZE.y; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE.z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE.x; lx++) {
        const voxelIndex = localToIndex(lx, ly, lz);
        const blockId = chunkData.voxels[voxelIndex];
        
        // Skip air blocks
        if (blockId === 0) continue;
        
        const block = blockRegistry.get(blockId);
        if (!block) continue;
        // Skip decorative billboards (e.g., grass tufts). They are rendered by a separate system.
        if (block.name === 'grass_tuft') continue;
        
        // Compute world coords of this voxel for per-block hashing
        const gx = cx * CHUNK_SIZE.x + lx;
        const gy = cy * CHUNK_SIZE.y + ly;
        const gz = cz * CHUNK_SIZE.z + lz;

        // Per-block UV rotation and tiny tint jitter to kill tiling (solid blocks only)
        // Do NOT rotate grass or wood — their textures have a required orientation
        const rot = (block.name === 'grass' || block.name === 'wood') ? 0 : getUVRotation(gx, gy, gz);
        const tint = getTintJitter(gx, gy, gz);

        // Check each face
        for (const face of FACES) {
          // Special-case: only render the top face for water blocks
          if (block.name === 'water' && face.name !== 'top') {
            continue;
          }
          const neighborX = lx + face.dir[0];
          const neighborY = ly + face.dir[1];
          const neighborZ = lz + face.dir[2];
          
          // Check if neighbor is outside chunk or is non-opaque
          let shouldRenderFace = false;
          
          if (neighborX < 0 || neighborX >= CHUNK_SIZE.x ||
              neighborY < 0 || neighborY >= CHUNK_SIZE.y ||
              neighborZ < 0 || neighborZ >= CHUNK_SIZE.z) {
            // Outside chunk - consult neighbor data if provided
            let neighborOpaque = false;
            if (neighbors) {
              if (neighborX === -1 && neighbors.negX) {
                const nLx = CHUNK_SIZE.x - 1;
                const nIndex = localToIndex(nLx, ly, lz);
                const nId = neighbors.negX.voxels[nIndex];
                const nDef = blockRegistry.get(nId);
                neighborOpaque = !!(nDef && nDef.opaque);
              } else if (neighborX === CHUNK_SIZE.x && neighbors.posX) {
                const nLx = 0;
                const nIndex = localToIndex(nLx, ly, lz);
                const nId = neighbors.posX.voxels[nIndex];
                const nDef = blockRegistry.get(nId);
                neighborOpaque = !!(nDef && nDef.opaque);
              } else if (neighborZ === -1 && neighbors.negZ) {
                const nLz = CHUNK_SIZE.z - 1;
                const nIndex = localToIndex(lx, ly, nLz);
                const nId = neighbors.negZ.voxels[nIndex];
                const nDef = blockRegistry.get(nId);
                neighborOpaque = !!(nDef && nDef.opaque);
              } else if (neighborZ === CHUNK_SIZE.z && neighbors.posZ) {
                const nLz = 0;
                const nIndex = localToIndex(lx, ly, nLz);
                const nId = neighbors.posZ.voxels[nIndex];
                const nDef = blockRegistry.get(nId);
                neighborOpaque = !!(nDef && nDef.opaque);
              } else if (neighborY === -1 && neighbors.negY) {
                const nLy = CHUNK_SIZE.y - 1;
                const nIndex = localToIndex(lx, nLy, lz);
                const nId = neighbors.negY.voxels[nIndex];
                const nDef = blockRegistry.get(nId);
                neighborOpaque = !!(nDef && nDef.opaque);
              } else if (neighborY === CHUNK_SIZE.y && neighbors.posY) {
                const nLy = 0;
                const nIndex = localToIndex(lx, nLy, lz);
                const nId = neighbors.posY.voxels[nIndex];
                const nDef = blockRegistry.get(nId);
                neighborOpaque = !!(nDef && nDef.opaque);
              }
            }
            // Render face only if no opaque neighbor present
            shouldRenderFace = !neighborOpaque;
          } else {
            // Check neighbor block
            const neighborIndex = localToIndex(neighborX, neighborY, neighborZ);
            const neighborBlockId = chunkData.voxels[neighborIndex];
            const neighborBlock = blockRegistry.get(neighborBlockId);
            
            // Render face if neighbor is not opaque
            shouldRenderFace = !neighborBlock || !neighborBlock.opaque;
          }
          
          if (shouldRenderFace) {
            // Add face quad
            const isOpaque = !!block.opaque;
            if (isOpaque) {
              addFaceQuad(
                lx, ly, lz, face, block,
                positionsO, normalsO, uvsO, aoO, colorsO, indicesO, vertexCountO,
                chunkData, // for in-chunk AO sampling
                neighbors, // for AO sampling across chunk borders
                rot, tint, // per-block
                
              );
              vertexCountO += 4;
            } else {
              addFaceQuad(
                lx, ly, lz, face, block,
                positionsT, normalsT, uvsT, aoT, colorsT, indicesT, vertexCountT,
                chunkData,
                neighbors,
                0, 1.0, // no tint/rotation for water; safe defaults
                
              );
              vertexCountT += 4;
            }
          }
        }
      }
    }
  }
  
  return {
    opaque: {
      positions: new Float32Array(positionsO),
      normals: new Float32Array(normalsO),
      uvs: new Float32Array(uvsO),
      ao: new Float32Array(aoO),
      colors: new Float32Array(colorsO),
      indices: new Uint32Array(indicesO)
    },
    transparent: {
      positions: new Float32Array(positionsT),
      normals: new Float32Array(normalsT),
      uvs: new Float32Array(uvsT),
      ao: new Float32Array(aoT),
      colors: new Float32Array(colorsT),
      indices: new Uint32Array(indicesT)
    }
  };
}

interface Face {
  name: string;
  dir: number[];
  normal: number[];
}

function addFaceQuad(
  lx: number, ly: number, lz: number,
  face: Face,
  block: BlockDef,
  positions: number[], normals: number[], uvs: number[], ao: number[], colors: number[], indices: number[],
  vertexOffset: number,
  chunkData: { voxels: Uint8Array },
  neighbors: {
    posX?: { voxels: Uint8Array };
    negX?: { voxels: Uint8Array };
    posY?: { voxels: Uint8Array };
    negY?: { voxels: Uint8Array };
    posZ?: { voxels: Uint8Array };
    negZ?: { voxels: Uint8Array };
  } | undefined,
  uvRotation: number,
  tintJitter: number
): void {
  const [nx, ny, nz] = face.normal;
  
  // Get UV coordinates for this face
  const [tileU, tileV] = getFaceUV(block, face.name);
  
  // Define quad vertices based on face direction
  let quad: number[][];
  
  switch (face.name) {
    case 'front': // +Z
      quad = [
        [lx,     ly,     lz + 1],
        [lx + 1, ly,     lz + 1],
        [lx + 1, ly + 1, lz + 1],
        [lx,     ly + 1, lz + 1]
      ];
      break;
    case 'back': // -Z
      quad = [
        [lx + 1, ly,     lz],
        [lx,     ly,     lz],
        [lx,     ly + 1, lz],
        [lx + 1, ly + 1, lz]
      ];
      break;
    case 'right': // +X
      quad = [
        // Reordered for correct CCW winding when viewed from +X
        [lx + 1, ly,     lz + 1],
        [lx + 1, ly,     lz],
        [lx + 1, ly + 1, lz],
        [lx + 1, ly + 1, lz + 1]
      ];
      break;
    case 'left': // -X
      quad = [
        // Reordered for correct CCW winding when viewed from -X
        [lx, ly,     lz],
        [lx, ly,     lz + 1],
        [lx, ly + 1, lz + 1],
        [lx, ly + 1, lz]
      ];
      break;
    case 'top': // +Y
      quad = [
        [lx,     ly + 1, lz + 1],
        [lx + 1, ly + 1, lz + 1],
        [lx + 1, ly + 1, lz],
        [lx,     ly + 1, lz]
      ];
      break;
    case 'bottom': // -Y
      quad = [
        [lx,     ly, lz],
        [lx + 1, ly, lz],
        [lx + 1, ly, lz + 1],
        [lx,     ly, lz + 1]
      ];
      break;
    default:
      return;
  }
  
  // Add positions
  for (const [x, y, z] of quad) {
    positions.push(x, y, z);
  }
  
  // Add normals (same for all 4 vertices)
  for (let i = 0; i < 4; i++) {
    normals.push(nx, ny, nz);
  }
  
  // Add UVs using atlas config
  if (!atlasConfig) {
    throw new Error('[MesherWorker] Atlas config required for UV calculation');
  }
  
  // Our atlas is laid out as atlasSize tiles horizontally and 1 tile vertically
  const tileSizeU = 1 / atlasConfig.atlasSize;
  const tileSizeV = 1; // single row atlas
  const epsilonU = 0.5 / (atlasConfig.atlasSize * atlasConfig.tileSize); // half pixel in U
  const epsilonV = 0.5 / (1 * atlasConfig.tileSize); // half pixel in V
  const u0 = tileU * tileSizeU + epsilonU;
  const v0 = tileV * tileSizeV + epsilonV;
  const u1 = u0 + tileSizeU - 2 * epsilonU;
  const v1 = v0 + tileSizeV - 2 * epsilonV;
  
  // UV coordinates for quad (counter-clockwise), with optional 0/90/180/270 rotation per block
  // Base corners
  const uvBL: [number, number] = [u0, v1];
  const uvBR: [number, number] = [u1, v1];
  const uvTR: [number, number] = [u1, v0];
  const uvTL: [number, number] = [u0, v0];
  let uvOrder: Array<[number, number]> = [uvBL, uvBR, uvTR, uvTL];
  const rot = uvRotation & 3;
  if (rot === 1) {
    // 90 deg: BL->TL, BR->BL, TR->BR, TL->TR
    uvOrder = [uvTL, uvBL, uvBR, uvTR];
  } else if (rot === 2) {
    // 180 deg
    uvOrder = [uvTR, uvTL, uvBL, uvBR];
  } else if (rot === 3) {
    // 270 deg
    uvOrder = [uvBR, uvTR, uvTL, uvBL];
  }
  for (const uv of uvOrder) {
    uvs.push(uv[0], uv[1]);
  }

  // Per-vertex ambient occlusion for solid blocks only (skip water)
  const isSolid = !!block.solid && block.name !== 'water';
  const aoTable = [1.0, 0.8, 0.6, 0.45];

  // Neighbor 'air' block position just outside this face
  const bnX = lx + face.dir[0];
  const bnY = ly + face.dir[1];
  const bnZ = lz + face.dir[2];

  // Tangent axes for this face (indices into [x=0,y=1,z=2])
  const t1Axis = (face.name === 'front' || face.name === 'back' || face.name === 'top' || face.name === 'bottom')
    ? (face.name === 'top' || face.name === 'bottom' ? 0 : 0) // X for Z faces; X for Y faces
    : 2; // for left/right faces, t1 is Z
  const t2Axis = (face.name === 'top' || face.name === 'bottom') ? 2
    : (face.name === 'front' || face.name === 'back' ? 1 : 1);

  // Helper to read component by axis
  const comp = (arr: number[], axis: number) => arr[axis];

  // Precompute bn vector
  const bn = [bnX, bnY, bnZ];

  // For each vertex, compute AO count from 3 samples (two sides + corner), map to factor
  for (let i = 0; i < 4; i++) {
    // Vertex world-ish coordinates (local to chunk)
    const vx = quad[i][0];
    const vy = quad[i][1];
    const vz = quad[i][2];
    const v = [vx, vy, vz];

    // Decide signs based on which side of the bn this vertex lies along the tangent axes
    const uSign = comp(v, t1Axis) > comp(bn, t1Axis) ? 1 : -1;
    const vSign = comp(v, t2Axis) > comp(bn, t2Axis) ? 1 : -1;

    // Sample positions around bn (the outside cell) in voxel space
    const s1 = [...bn] as number[]; s1[t1Axis] += uSign;
    const s2 = [...bn] as number[]; s2[t2Axis] += vSign;
    const sc = [...bn] as number[]; sc[t1Axis] += uSign; sc[t2Axis] += vSign;

    let aoFactor = 1.0;
    if (isSolid) {
    const oc1 = isOccluding(s1[0], s1[1], s1[2], chunkData, neighbors);
    const oc2 = isOccluding(s2[0], s2[1], s2[2], chunkData, neighbors);
    const ocC = isOccluding(sc[0], sc[1], sc[2], chunkData, neighbors);
      let occ = 0;
      if (oc1) occ++;
      if (oc2) occ++;
      if (ocC && !(oc1 && oc2)) occ++;
      aoFactor = aoTable[occ];
    }

    // Keep tint separate from ambient visibility so direct sun lighting is
    // not darkened by the baked term. The legacy mesher applied a 0.7
    // skylight factor to every opaque voxel; retain that ambient contribution
    // without letting it multiply the direct light.
    const c = isSolid ? tintJitter : 1.0;
    colors.push(c, c, c);
    ao.push(aoFactor * (isSolid ? 0.7 : 1.0));
  }
  
  // Add indices for two triangles
  indices.push(
    vertexOffset,     vertexOffset + 1, vertexOffset + 2,  // Triangle 1
    vertexOffset,     vertexOffset + 2, vertexOffset + 3   // Triangle 2
  );
}

function getFaceUV(block: BlockDef, faceName: string): [number, number] {
  if (!atlasConfig) {
    throw new Error('[MesherWorker] Atlas config required for UV lookup');
  }

  // Determine which tile key to use for this face
  let tileKey: string;
  switch (faceName) {
    case 'top':
      tileKey = block.faces.top || block.faces.all || 'air';
      break;
    case 'bottom':
      tileKey = block.faces.bottom || block.faces.all || 'air';
      break;
    case 'front':
    case 'back':
    case 'left':
    case 'right':
      tileKey = block.faces.side || block.faces.all || 'air';
      break;
    default:
      tileKey = block.faces.all || 'air';
      break;
  }

  // Look up tile coordinates from atlas config
  const tileCoords = atlasConfig.tiles[tileKey];
  if (!tileCoords) {
    console.warn(`[MesherWorker] Tile key '${tileKey}' not found in atlas config, using fallback`);
    return [0, 0];
  }

  return tileCoords;
}

// --- Helpers for ambient visibility/variation ---

function localInside(x: number, y: number, z: number): boolean {
  return x >= 0 && x < CHUNK_SIZE.x && y >= 0 && y < CHUNK_SIZE.y && z >= 0 && z < CHUNK_SIZE.z;
}

// (helpers removed if unused)

// Lookup occupancy across current chunk and the 6 axis-adjacent neighbors. If the coordinate lies
// in a diagonal neighbor (i.e., needs more than one axis outside), we return false (non-occluding).
function isOccluding(x: number, y: number, z: number, chunkData: { voxels: Uint8Array }, neighbors: {
  posX?: { voxels: Uint8Array };
  negX?: { voxels: Uint8Array };
  posY?: { voxels: Uint8Array };
  negY?: { voxels: Uint8Array };
  posZ?: { voxels: Uint8Array };
  negZ?: { voxels: Uint8Array };
} | undefined): boolean {
  // First, try current chunk if inside; else determine which single-axis neighbor contains it
  let id = -1;
  if (localInside(x, y, z)) {
    id = chunkData.voxels[localToIndex(x, y, z)];
  } else {
    // Determine which axis is out of bounds
    const outX = x < 0 ? -1 : (x >= CHUNK_SIZE.x ? 1 : 0);
    const outY = y < 0 ? -1 : (y >= CHUNK_SIZE.y ? 1 : 0);
    const outZ = z < 0 ? -1 : (z >= CHUNK_SIZE.z ? 1 : 0);
    const outs = Math.abs(outX) + Math.abs(outY) + Math.abs(outZ);
    if (outs > 1) return false; // diagonal neighbor not available
    if (outX === -1 && neighbors?.negX) {
      const lx = CHUNK_SIZE.x - 1;
      const idx = localToIndex(lx, Math.max(0, Math.min(CHUNK_SIZE.y - 1, y)), Math.max(0, Math.min(CHUNK_SIZE.z - 1, z)));
      id = neighbors.negX.voxels[idx];
    } else if (outX === 1 && neighbors?.posX) {
      const lx = 0;
      const idx = localToIndex(lx, Math.max(0, Math.min(CHUNK_SIZE.y - 1, y)), Math.max(0, Math.min(CHUNK_SIZE.z - 1, z)));
      id = neighbors.posX.voxels[idx];
    } else if (outZ === -1 && neighbors?.negZ) {
      const lz = CHUNK_SIZE.z - 1;
      const idx = localToIndex(Math.max(0, Math.min(CHUNK_SIZE.x - 1, x)), Math.max(0, Math.min(CHUNK_SIZE.y - 1, y)), lz);
      id = neighbors.negZ.voxels[idx];
    } else if (outZ === 1 && neighbors?.posZ) {
      const lz = 0;
      const idx = localToIndex(Math.max(0, Math.min(CHUNK_SIZE.x - 1, x)), Math.max(0, Math.min(CHUNK_SIZE.y - 1, y)), lz);
      id = neighbors.posZ.voxels[idx];
    } else if (outY === -1 && neighbors?.negY) {
      const ly = CHUNK_SIZE.y - 1;
      const idx = localToIndex(Math.max(0, Math.min(CHUNK_SIZE.x - 1, x)), ly, Math.max(0, Math.min(CHUNK_SIZE.z - 1, z)));
      id = neighbors.negY.voxels[idx];
    } else if (outY === 1 && neighbors?.posY) {
      const ly = 0;
      const idx = localToIndex(Math.max(0, Math.min(CHUNK_SIZE.x - 1, x)), ly, Math.max(0, Math.min(CHUNK_SIZE.z - 1, z)));
      id = neighbors.posY.voxels[idx];
    } else {
      return false;
    }
  }
  const def = id >= 0 ? blockRegistry.get(id) : undefined;
  return !!(def && def.opaque);
}

function hash32(x: number, y: number, z: number): number {
  // 32-bit mix (xorshift-like)
  let h = (x * 374761393) ^ (y * 668265263) ^ (z * 2147483647);
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

function getUVRotation(gx: number, gy: number, gz: number): number {
  const h = hash32(gx, gy, gz);
  return h & 3; // 0..3
}

function getTintJitter(gx: number, gy: number, gz: number): number {
  const h = hash32(gx + 11, gy + 121, gz + 211);
  const r = (h & 0xffff) / 0xffff; // 0..1
  // ±3% brightness jitter around 1.0
  return 1.0 + (r * 0.06 - 0.03);
}
