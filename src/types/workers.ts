/**
 * Worker message types for chunk generation and meshing.
 * Shared between main thread and web workers.
 */

import type { ChunkData, BlockDef, BlockId } from './index.js';
import type { AtlasConfig } from '../engine/render/Atlas.js';

// Re-export types needed by workers
export type { BlockDef, BlockId };

// Basic types
export type ChunkKey = string; // `${cx},${cy},${cz}`

// Worker request types
export interface GenerateChunkRequest {
  type: 'GEN_CHUNK';
  payload: {
    key: ChunkKey;
    cx: number;
    cy: number;
    cz: number;
    seed: number;
  };
}

export interface MeshChunkRequest {
  type: 'MESH_CHUNK';
  payload: {
    key: ChunkKey;
    chunkData: ChunkData;
    atlasConfig: AtlasConfig;
    blockRegistry: BlockDef[];
    // Optional neighbor chunk data for border face culling
    neighbors?: {
      posX?: ChunkData;
      negX?: ChunkData;
      posY?: ChunkData;
      negY?: ChunkData;
      posZ?: ChunkData;
      negZ?: ChunkData;
    };
  };
}

export type WorkerRequest = GenerateChunkRequest | MeshChunkRequest;

// Worker response types
export interface ChunkDataResponse {
  type: 'CHUNK_DATA';
  key: ChunkKey;
  payload: ChunkData;
}

export interface ChunkMeshResponse {
  type: 'CHUNK_MESH';
  key: ChunkKey;
  payload: {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    indices: Uint16Array | Uint32Array;
  };
}

export type WorkerResponse = ChunkDataResponse | ChunkMeshResponse;

// Type guards
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isGenerateChunkRequest(msg: any): msg is GenerateChunkRequest {
  return msg && msg.type === 'GEN_CHUNK' && msg.payload && 
         typeof msg.payload.key === 'string' &&
         typeof msg.payload.cx === 'number' &&
         typeof msg.payload.cy === 'number' &&
         typeof msg.payload.cz === 'number' &&
         typeof msg.payload.seed === 'number';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isMeshChunkRequest(msg: any): msg is MeshChunkRequest {
  return msg && msg.type === 'MESH_CHUNK' && msg.payload &&
         typeof msg.payload.key === 'string' &&
         msg.payload.chunkData &&
         msg.payload.atlasConfig &&
         Array.isArray(msg.payload.blockRegistry);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isChunkDataResponse(msg: any): msg is ChunkDataResponse {
  return msg && msg.type === 'CHUNK_DATA' &&
         typeof msg.key === 'string' &&
         msg.payload;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isChunkMeshResponse(msg: any): msg is ChunkMeshResponse {
  return msg && msg.type === 'CHUNK_MESH' &&
         typeof msg.key === 'string' &&
         msg.payload &&
         msg.payload.positions instanceof Float32Array &&
         msg.payload.normals instanceof Float32Array &&
         msg.payload.uvs instanceof Float32Array &&
         (msg.payload.indices instanceof Uint16Array || msg.payload.indices instanceof Uint32Array);
}
