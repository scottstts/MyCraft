/**
 * Coordinate system math helpers
 * Inputs: World coordinates, chunk sizes
 * Outputs: Chunk coordinates, local coordinates, and chunk keys
 * Invariants: Always uses euclidean division for negative coordinate handling
 */

import { CHUNK_SIZE } from '../../config/constants';

/**
 * Euclidean division - always floors toward negative infinity
 * Critical for negative coordinates to map correctly to chunks
 */
export function floorDiv(n: number, d: number): number {
  return Math.floor(n / d);
}

/**
 * Euclidean modulo - always returns positive remainder
 * Ensures local coordinates are always in range [0, d-1]
 */
export function euclidMod(n: number, d: number): number {
  return ((n % d) + d) % d;
}

/**
 * Convert world coordinates to chunk coordinates and local coordinates
 */
export interface WorldToChunkResult {
  // Chunk coordinates
  cx: number;
  cy: number;
  cz: number;
  // Local coordinates within chunk [0, size-1]
  lx: number;
  ly: number;
  lz: number;
}

export function worldToChunk(x: number, y: number, z: number): WorldToChunkResult {
  const cx = floorDiv(x, CHUNK_SIZE.x);
  const cy = floorDiv(y, CHUNK_SIZE.y);
  const cz = floorDiv(z, CHUNK_SIZE.z);
  
  const lx = euclidMod(x, CHUNK_SIZE.x);
  const ly = euclidMod(y, CHUNK_SIZE.y);
  const lz = euclidMod(z, CHUNK_SIZE.z);
  
  return { cx, cy, cz, lx, ly, lz };
}

/**
 * Convert chunk coordinates to a string key for Map storage
 */
export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

/**
 * Convert local coordinates to flat array index within chunk
 */
export function localToIndex(lx: number, ly: number, lz: number): number {
  return ly * (CHUNK_SIZE.x * CHUNK_SIZE.z) + lz * CHUNK_SIZE.x + lx;
}

/**
 * Convert flat array index back to local coordinates
 */
export function indexToLocal(index: number): { lx: number; ly: number; lz: number } {
  const lx = index % CHUNK_SIZE.x;
  const lz = Math.floor((index % (CHUNK_SIZE.x * CHUNK_SIZE.z)) / CHUNK_SIZE.x);
  const ly = Math.floor(index / (CHUNK_SIZE.x * CHUNK_SIZE.z));
  
  return { lx, ly, lz };
}