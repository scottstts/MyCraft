/**
 * Chunk - Container for voxel data in a 16x64x16 block region
 * Purpose: Manages block storage and provides efficient get/set operations
 * Callers: World manager, chunk generators, and mesh builders
 * Invariants: 
 * - Voxel array length always equals CHUNK_SIZE.x * CHUNK_SIZE.y * CHUNK_SIZE.z
 * - All block IDs are valid (0-255)
 * - Coordinates are validated before array access
 */

import type { BlockId, ChunkData, V3i } from '../../../types/index.js';
import { CHUNK_SIZE } from '../../../config/constants.js';
import { flattenIndex, getChunkVoxelCount, isValidLocalCoords } from './index.js';

export class Chunk {
  private voxels: Uint8Array;
  private readonly size: V3i;

  /**
   * Create a new chunk
   * @param data Optional initial chunk data. If not provided, creates empty chunk filled with AIR (0)
   */
  constructor(data?: ChunkData) {
    this.size = { ...CHUNK_SIZE };
    const voxelCount = getChunkVoxelCount();

    if (data) {
      // Validate provided data
      if (data.voxels.length !== voxelCount) {
        throw new Error(`Invalid chunk data: expected ${voxelCount} voxels, got ${data.voxels.length}`);
      }
      if (data.size.x !== CHUNK_SIZE.x || data.size.y !== CHUNK_SIZE.y || data.size.z !== CHUNK_SIZE.z) {
        throw new Error(`Invalid chunk data: size mismatch. Expected ${CHUNK_SIZE.x}x${CHUNK_SIZE.y}x${CHUNK_SIZE.z}, got ${data.size.x}x${data.size.y}x${data.size.z}`);
      }
      this.voxels = new Uint8Array(data.voxels);
    } else {
      // Create empty chunk filled with AIR (id = 0)
      this.voxels = new Uint8Array(voxelCount);
      this.voxels.fill(0);
    }
  }

  /**
   * Get block ID at local chunk coordinates
   * @param lx Local X coordinate (0 to 15)
   * @param ly Local Y coordinate (0 to 63)
   * @param lz Local Z coordinate (0 to 15)
   * @returns Block ID at the specified coordinates
   */
  get(lx: number, ly: number, lz: number): BlockId {
    if (!isValidLocalCoords(lx, ly, lz)) {
      throw new Error(`Invalid local coordinates: (${lx}, ${ly}, ${lz})`);
    }

    const index = flattenIndex(lx, ly, lz);
    return this.voxels[index];
  }

  /**
   * Set block ID at local chunk coordinates
   * @param lx Local X coordinate (0 to 15)
   * @param ly Local Y coordinate (0 to 63) 
   * @param lz Local Z coordinate (0 to 15)
   * @param id Block ID to set (0-255)
   */
  set(lx: number, ly: number, lz: number, id: BlockId): void {
    if (!isValidLocalCoords(lx, ly, lz)) {
      throw new Error(`Invalid local coordinates: (${lx}, ${ly}, ${lz})`);
    }

    if (id < 0 || id > 255) {
      throw new Error(`Invalid block ID: ${id}. Must be 0-255.`);
    }

    const index = flattenIndex(lx, ly, lz);
    this.voxels[index] = id;
  }

  /**
   * Get a copy of the chunk data for serialization or worker transfer
   * @returns ChunkData object with size and voxel data
   */
  getData(): ChunkData {
    return {
      size: { ...this.size },
      voxels: new Uint8Array(this.voxels) // Create a copy
    };
  }

  /**
   * Replace chunk data with new data
   * @param data ChunkData to replace current chunk data with
   */
  setFromData(data: ChunkData): void {
    const voxelCount = getChunkVoxelCount();
    
    // Validate provided data
    if (data.voxels.length !== voxelCount) {
      throw new Error(`Invalid chunk data: expected ${voxelCount} voxels, got ${data.voxels.length}`);
    }
    if (data.size.x !== CHUNK_SIZE.x || data.size.y !== CHUNK_SIZE.y || data.size.z !== CHUNK_SIZE.z) {
      throw new Error(`Invalid chunk data: size mismatch. Expected ${CHUNK_SIZE.x}x${CHUNK_SIZE.y}x${CHUNK_SIZE.z}, got ${data.size.x}x${data.size.y}x${data.size.z}`);
    }
    
    // Replace voxels array
    this.voxels = new Uint8Array(data.voxels);
  }

  /**
   * Get direct reference to voxels array (use with caution)
   * @returns Reference to internal voxels array
   */
  getVoxelsArray(): Uint8Array {
    return this.voxels;
  }

  /**
   * Get chunk dimensions
   * @returns Chunk size as V3i
   */
  getSize(): V3i {
    return { ...this.size };
  }

  /**
   * Fill entire chunk with a single block type
   * @param id Block ID to fill with
   */
  fill(id: BlockId): void {
    if (id < 0 || id > 255) {
      throw new Error(`Invalid block ID: ${id}. Must be 0-255.`);
    }
    this.voxels.fill(id);
  }

  /**
   * Clear chunk (fill with AIR)
   */
  clear(): void {
    this.voxels.fill(0);
  }

  /**
   * Check if chunk is completely empty (all AIR blocks)
   * @returns True if all blocks are AIR
   */
  isEmpty(): boolean {
    return this.voxels.every(voxel => voxel === 0);
  }

  /**
   * Count occurrences of a specific block type
   * @param id Block ID to count
   * @returns Number of blocks with the specified ID
   */
  countBlocks(id: BlockId): number {
    let count = 0;
    for (let i = 0; i < this.voxels.length; i++) {
      if (this.voxels[i] === id) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get statistics about block types in this chunk
   * @returns Map of block ID to count
   */
  getBlockStats(): Map<BlockId, number> {
    const stats = new Map<BlockId, number>();
    
    for (let i = 0; i < this.voxels.length; i++) {
      const id = this.voxels[i];
      stats.set(id, (stats.get(id) || 0) + 1);
    }
    
    return stats;
  }
}