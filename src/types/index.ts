/**
 * Shared TypeScript types for the Minecraft clone engine.
 * Used across workers, UI, and engine components.
 */

// Basic ID types
export type BlockId = number; // 0..255; 0 = AIR
export type ChunkKey = string; // `${cx},${cy},${cz}`

// World integer positions (blocks)
export interface V3i { 
  x: number; 
  y: number; 
  z: number; 
}

// World float positions (entities/camera)
export interface V3f { 
  x: number; 
  y: number; 
  z: number; 
}

// Chunk coordinates (integers)
export interface C3 { 
  cx: number; 
  cy: number; 
  cz: number; 
}

// Chunk data payload
export interface ChunkData {
  size: V3i;               // {16,64,16}
  voxels: Uint8Array;      // length = size.x * size.y * size.z
  // Optional later: light: Uint8Array;
}

// Block registry entry
export interface BlockDef {
  id: BlockId;
  name: string;
  opaque: boolean;         // true → face is hidden by same block adjacent
  solid: boolean;          // true → collides with player
  faces: {
    // atlas tile indices (u, v) per face; or single "all" tile
    top?: [number, number];
    bottom?: [number, number];
    side?: [number, number];
    all?: [number, number];
  };
}

// Worker messaging
export interface WorkerReq {
  type: 'GEN_CHUNK' | 'MESH_CHUNK';
  payload: unknown;
}

export interface WorkerRes {
  type: 'CHUNK_DATA' | 'CHUNK_MESH';
  key: ChunkKey;
  payload: unknown;
}