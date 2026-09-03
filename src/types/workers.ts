/**
 * Worker message types for chunk generation and meshing.
 * Shared between main thread and web workers.
 */

import type { ChunkData, BlockDef, BlockId } from './index.js';
import type { AtlasConfig } from '../engine/render/Atlas.js';
import type { ForwardRefractionIndexBucket } from '../engine/world/ForwardRefractionMeshing.js';

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
    worldRadius?: number; // For island generation sizing
  };
}

export interface MesherInitRequest {
  type: 'INIT_MESHER';
  payload: {
    atlasConfig: AtlasConfig;
    blockRegistry: BlockDef[];
  };
}

export interface StoreChunkRequest {
  type: 'STORE_CHUNK';
  payload: {
    key: ChunkKey;
    voxels: Uint8Array;
  };
}

export interface MeshChunkRequest {
  type: 'MESH_CHUNK';
  payload: {
    key: ChunkKey;
  };
}

export interface RemoveChunkRequest {
  type: 'REMOVE_CHUNK';
  payload: {
    key: ChunkKey;
  };
}

export type WorkerRequest = GenerateChunkRequest | MesherInitRequest | StoreChunkRequest | MeshChunkRequest | RemoveChunkRequest;

// Worker response types
export interface ChunkDataResponse {
  type: 'CHUNK_DATA';
  key: ChunkKey;
  payload: ChunkData;
}

export interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  ao: Float32Array;
  colors: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Optional static-terrain index ranges for the forward-refraction pass. */
  forwardIndices?: Partial<Record<ForwardRefractionIndexBucket, Uint32Array>>;
}

export interface ChunkMeshResponse {
  type: 'CHUNK_MESH';
  key: ChunkKey;
  payload: {
    opaque: MeshBuffers;
    cutout: MeshBuffers;
    transparent: MeshBuffers;
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
         typeof msg.payload.key === 'string';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isMesherInitRequest(msg: any): msg is MesherInitRequest {
  return msg && msg.type === 'INIT_MESHER' && msg.payload &&
         msg.payload.atlasConfig && Array.isArray(msg.payload.blockRegistry);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isStoreChunkRequest(msg: any): msg is StoreChunkRequest {
  return msg && msg.type === 'STORE_CHUNK' && msg.payload &&
         typeof msg.payload.key === 'string' && msg.payload.voxels instanceof Uint8Array;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isRemoveChunkRequest(msg: any): msg is RemoveChunkRequest {
  return msg && msg.type === 'REMOVE_CHUNK' && msg.payload &&
         typeof msg.payload.key === 'string';
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
         isMeshBuffers(msg.payload.opaque) &&
         isMeshBuffers(msg.payload.cutout) &&
         isMeshBuffers(msg.payload.transparent);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isMeshBuffers(value: any): value is MeshBuffers {
  return value &&
    value.positions instanceof Float32Array &&
    value.normals instanceof Float32Array &&
    value.uvs instanceof Float32Array &&
    value.ao instanceof Float32Array &&
    value.colors instanceof Float32Array &&
    (value.indices instanceof Uint16Array || value.indices instanceof Uint32Array) &&
    (!value.forwardIndices ||
      Object.values(value.forwardIndices).every((indices: unknown) => indices instanceof Uint32Array));
}
