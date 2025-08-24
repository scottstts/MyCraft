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
import { isMeshChunkRequest } from '../../types/workers.js';
import { CHUNK_SIZE } from '../../config/constants.js';
import { localToIndex } from '../utils/coords.js';

// Block registry snapshot (passed from main thread)
const blockRegistry = new Map<BlockId, BlockDef>();

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
  const { key, chunkData } = request.payload;
  
  // Initialize block registry if not already done
  if (blockRegistry.size === 0) {
    initializeBlockRegistry();
  }
  
  // Build mesh from chunk data
  const mesh = buildChunkMesh(chunkData);
  
  const response: ChunkMeshResponse = {
    type: 'CHUNK_MESH',
    key: key,
    payload: mesh
  };
  
  // Transfer the buffers for performance
  self.postMessage(response, { 
    transfer: [
      mesh.positions.buffer, 
      mesh.normals.buffer, 
      mesh.uvs.buffer, 
      mesh.indices.buffer
    ] 
  });
}

function initializeBlockRegistry(): void {
  // Hardcoded block definitions matching the main thread registry
  const blocks: BlockDef[] = [
    {
      id: 0,
      name: 'air',
      opaque: false,
      solid: false,
      faces: { all: [0, 0] }
    },
    {
      id: 1,
      name: 'grass',
      opaque: true,
      solid: true,
      faces: {
        top: [0, 0],
        bottom: [1, 0],
        side: [2, 0]
      }
    },
    {
      id: 2,
      name: 'dirt',
      opaque: true,
      solid: true,
      faces: { all: [1, 0] }
    },
    {
      id: 3,
      name: 'stone',
      opaque: true,
      solid: true,
      faces: { all: [3, 0] }
    }
  ];
  
  for (const block of blocks) {
    blockRegistry.set(block.id, block);
  }
}

function buildChunkMesh(chunkData: { voxels: Uint8Array }) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  
  let vertexCount = 0;
  
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
            // Outside chunk - treat as air for now (V1 behavior)
            shouldRenderFace = true;
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
            addFaceQuad(
              lx, ly, lz, face, block, 
              positions, normals, uvs, indices, vertexCount
            );
            vertexCount += 4; // Each face adds 4 vertices
          }
        }
      }
    }
  }
  
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices)
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
        [lx + 1, ly,     lz],
        [lx + 1, ly,     lz + 1],
        [lx + 1, ly + 1, lz + 1],
        [lx + 1, ly + 1, lz]
      ];
      break;
    case 'left': // -X
      quad = [
        [lx, ly,     lz + 1],
        [lx, ly,     lz],
        [lx, ly + 1, lz],
        [lx, ly + 1, lz + 1]
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
  
  // Add UVs - assume 4x4 atlas with 16px tiles
  const atlasSize = 4; // tiles across
  const tileSize = 1 / atlasSize;
  const epsilon = 0.5 / (atlasSize * 16); // Half-pixel inset to avoid seams
  const u0 = tileU * tileSize + epsilon;
  const v0 = tileV * tileSize + epsilon;
  const u1 = u0 + tileSize - 2 * epsilon;
  const v1 = v0 + tileSize - 2 * epsilon;
  
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
  // Determine which texture to use for this face
  switch (faceName) {
    case 'top':
      return block.faces.top || block.faces.all || [0, 0];
    case 'bottom':
      return block.faces.bottom || block.faces.all || [0, 0];
    case 'front':
    case 'back':
    case 'left':
    case 'right':
      return block.faces.side || block.faces.all || [0, 0];
    default:
      return block.faces.all || [0, 0];
  }
}