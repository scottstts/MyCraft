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
  const mesh = buildChunkMesh(chunkData, neighbors);
  
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
      mesh.opaque.indices.buffer,
      mesh.transparent.positions.buffer,
      mesh.transparent.normals.buffer,
      mesh.transparent.uvs.buffer,
      mesh.transparent.indices.buffer,
    ] 
  });
}

// Block registry is now provided from main thread, no hardcoded initialization needed

function buildChunkMesh(chunkData: { voxels: Uint8Array }, neighbors?: {
  posX?: { voxels: Uint8Array };
  negX?: { voxels: Uint8Array };
  posY?: { voxels: Uint8Array };
  negY?: { voxels: Uint8Array };
  posZ?: { voxels: Uint8Array };
  negZ?: { voxels: Uint8Array };
}) {
  // Opaque and transparent buffers are built separately so we can render
  // them with different materials and blending order on the main thread.
  const positionsO: number[] = [];
  const normalsO: number[] = [];
  const uvsO: number[] = [];
  const indicesO: number[] = [];
  let vertexCountO = 0;

  const positionsT: number[] = [];
  const normalsT: number[] = [];
  const uvsT: number[] = [];
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
        
        // Check each face
        for (const face of FACES) {
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
                positionsO, normalsO, uvsO, indicesO, vertexCountO
              );
              vertexCountO += 4;
            } else {
              addFaceQuad(
                lx, ly, lz, face, block,
                positionsT, normalsT, uvsT, indicesT, vertexCountT
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
      indices: new Uint32Array(indicesO)
    },
    transparent: {
      positions: new Float32Array(positionsT),
      normals: new Float32Array(normalsT),
      uvs: new Float32Array(uvsT),
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
  positions: number[], normals: number[], uvs: number[], indices: number[],
  vertexOffset: number
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
  
  // UV coordinates for quad (counter-clockwise)
  uvs.push(u0, v1); // bottom-left
  uvs.push(u1, v1); // bottom-right
  uvs.push(u1, v0); // top-right
  uvs.push(u0, v0); // top-left
  
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
