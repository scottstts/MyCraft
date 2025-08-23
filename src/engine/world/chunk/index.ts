/**
 * Chunk indexing helpers
 * Purpose: Provides flat index calculation for 3D chunk coordinates
 * Callers: Chunk class and other voxel data structures
 * Invariants: Uses consistent flattening order (y * (sx * sz) + z * sx + x)
 */

import { CHUNK_SIZE } from '../../../config/constants.js';

/**
 * Convert local 3D coordinates to flat array index
 * Uses row-major order: y-major, then z, then x
 * 
 * @param lx Local X coordinate (0 to CHUNK_SIZE.x - 1)
 * @param ly Local Y coordinate (0 to CHUNK_SIZE.y - 1) 
 * @param lz Local Z coordinate (0 to CHUNK_SIZE.z - 1)
 * @returns Flat array index
 */
export function flattenIndex(lx: number, ly: number, lz: number): number {
  if (lx < 0 || lx >= CHUNK_SIZE.x || 
      ly < 0 || ly >= CHUNK_SIZE.y || 
      lz < 0 || lz >= CHUNK_SIZE.z) {
    throw new Error(`Invalid chunk coordinates: (${lx}, ${ly}, ${lz}). Must be within (0,0,0) to (${CHUNK_SIZE.x-1}, ${CHUNK_SIZE.y-1}, ${CHUNK_SIZE.z-1})`);
  }
  
  return ly * (CHUNK_SIZE.x * CHUNK_SIZE.z) + lz * CHUNK_SIZE.x + lx;
}

/**
 * Convert flat array index back to 3D coordinates
 * Inverse of flattenIndex()
 * 
 * @param index Flat array index
 * @returns Object with lx, ly, lz coordinates
 */
export function unflattenIndex(index: number): { lx: number; ly: number; lz: number } {
  const totalSize = CHUNK_SIZE.x * CHUNK_SIZE.y * CHUNK_SIZE.z;
  if (index < 0 || index >= totalSize) {
    throw new Error(`Invalid index: ${index}. Must be 0 to ${totalSize - 1}`);
  }

  const ly = Math.floor(index / (CHUNK_SIZE.x * CHUNK_SIZE.z));
  const remainder = index % (CHUNK_SIZE.x * CHUNK_SIZE.z);
  const lz = Math.floor(remainder / CHUNK_SIZE.x);
  const lx = remainder % CHUNK_SIZE.x;

  return { lx, ly, lz };
}

/**
 * Get the total number of voxels in a chunk
 */
export function getChunkVoxelCount(): number {
  return CHUNK_SIZE.x * CHUNK_SIZE.y * CHUNK_SIZE.z;
}

/**
 * Check if local coordinates are within chunk bounds
 */
export function isValidLocalCoords(lx: number, ly: number, lz: number): boolean {
  return lx >= 0 && lx < CHUNK_SIZE.x &&
         ly >= 0 && ly < CHUNK_SIZE.y &&
         lz >= 0 && lz < CHUNK_SIZE.z;
}