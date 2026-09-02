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
  size: V3i;               // fixed build-time chunk dimensions
  voxels: Uint8Array;      // length = size.x * size.y * size.z
  /** Optional generator-owned local positions for decorative grass tufts. */
  grassTuftPositions?: Uint16Array; // [lx, ly, lz, ...]
  // Optional later: light: Uint8Array;
}

// Block registry entry
export interface BlockDef {
  id: BlockId;
  name: string;
  opaque: boolean;         // true → face is hidden by same block adjacent
  solid: boolean;          // true → collides with player
  faces: {
    // atlas tile keys (string) per face; or single "all" tile
    top?: string;
    bottom?: string;
    side?: string;
    all?: string;
  };
}

// Worker messaging
export interface WorkerReq {
  type: 'GEN_CHUNK' | 'INIT_MESHER' | 'STORE_CHUNK' | 'MESH_CHUNK' | 'REMOVE_CHUNK';
  payload: unknown;
}

export interface WorkerRes {
  type: 'CHUNK_DATA' | 'CHUNK_MESH';
  key: ChunkKey;
  payload: unknown;
}
