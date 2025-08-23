/**
 * World - Main world manager that coordinates chunks and block operations
 * Purpose: Manages chunk storage, provides world-coordinate block access, and emits events
 * Callers: Engine systems, player controllers, and block interaction systems
 * Invariants:
 * - All chunk operations use consistent coordinate mapping
 * - Events are emitted for all chunk and block changes
 * - Thread-safe for read operations
 */

import { BlockId, ChunkKey, C3 } from '../../types/index.js';
import { Chunk } from './chunk/Chunk.js';
import { worldToChunk, chunkKey } from '../utils/coords.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { getBlock } from './blocks/BlockRegistry.js';

// Define world event types
export interface WorldEvents {
  CHUNK_ADDED: { key: ChunkKey; chunk: Chunk; coords: C3 };
  CHUNK_REMOVED: { key: ChunkKey; coords: C3 };
  BLOCK_CHANGED: { 
    worldX: number; 
    worldY: number; 
    worldZ: number; 
    oldBlockId: BlockId; 
    newBlockId: BlockId;
    chunkKey: ChunkKey;
    localX: number;
    localY: number;
    localZ: number;
  };
}

export class World extends EventEmitter<WorldEvents> {
  private chunks: Map<ChunkKey, Chunk> = new Map();

  constructor() {
    super();
  }

  /**
   * Ensure a chunk exists at the given chunk coordinates
   * Creates an empty chunk if it doesn't exist
   * @param cx Chunk X coordinate
   * @param cy Chunk Y coordinate  
   * @param cz Chunk Z coordinate
   * @returns The chunk at the specified coordinates
   */
  ensureChunk(cx: number, cy: number, cz: number): Chunk {
    const key = chunkKey(cx, cy, cz);
    
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(); // Create empty chunk filled with AIR
      this.chunks.set(key, chunk);
      
      // Emit chunk added event
      this.emit('CHUNK_ADDED', { 
        key, 
        chunk, 
        coords: { cx, cy, cz } 
      });
    }
    
    return chunk;
  }

  /**
   * Get chunk at the given chunk coordinates
   * @param cx Chunk X coordinate
   * @param cy Chunk Y coordinate
   * @param cz Chunk Z coordinate
   * @returns The chunk if it exists, undefined otherwise
   */
  getChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    const key = chunkKey(cx, cy, cz);
    return this.chunks.get(key);
  }

  /**
   * Get chunk by chunk key string
   * @param key Chunk key string
   * @returns The chunk if it exists, undefined otherwise
   */
  getChunkByKey(key: ChunkKey): Chunk | undefined {
    return this.chunks.get(key);
  }

  /**
   * Add or replace a chunk at the given coordinates
   * @param cx Chunk X coordinate
   * @param cy Chunk Y coordinate
   * @param cz Chunk Z coordinate
   * @param chunk The chunk to add
   */
  setChunk(cx: number, cy: number, cz: number, chunk: Chunk): void {
    const key = chunkKey(cx, cy, cz);
    const wasExisting = this.chunks.has(key);
    
    this.chunks.set(key, chunk);
    
    if (!wasExisting) {
      this.emit('CHUNK_ADDED', { 
        key, 
        chunk, 
        coords: { cx, cy, cz } 
      });
    }
  }

  /**
   * Remove a chunk at the given coordinates
   * @param cx Chunk X coordinate
   * @param cy Chunk Y coordinate
   * @param cz Chunk Z coordinate
   * @returns True if chunk was removed, false if it didn't exist
   */
  removeChunk(cx: number, cy: number, cz: number): boolean {
    const key = chunkKey(cx, cy, cz);
    const existed = this.chunks.delete(key);
    
    if (existed) {
      this.emit('CHUNK_REMOVED', { 
        key, 
        coords: { cx, cy, cz } 
      });
    }
    
    return existed;
  }

  /**
   * Set block at world coordinates
   * @param x World X coordinate
   * @param y World Y coordinate
   * @param z World Z coordinate
   * @param id Block ID to set
   */
  setBlock(x: number, y: number, z: number, id: BlockId): void {
    // Convert world coordinates to chunk coordinates and local coordinates
    const { cx, cy, cz, lx, ly, lz } = worldToChunk(x, y, z);
    
    // Get or create the chunk
    const chunk = this.ensureChunk(cx, cy, cz);
    
    // Get the old block ID for the event
    const oldBlockId = chunk.get(lx, ly, lz);
    
    // Set the new block
    chunk.set(lx, ly, lz, id);
    
    // Emit block changed event
    this.emit('BLOCK_CHANGED', {
      worldX: x,
      worldY: y,
      worldZ: z,
      oldBlockId,
      newBlockId: id,
      chunkKey: chunkKey(cx, cy, cz),
      localX: lx,
      localY: ly,
      localZ: lz
    });
  }

  /**
   * Get block at world coordinates
   * @param x World X coordinate
   * @param y World Y coordinate
   * @param z World Z coordinate
   * @returns Block ID at the specified coordinates, or 0 (AIR) if chunk doesn't exist
   */
  getBlock(x: number, y: number, z: number): BlockId {
    // Convert world coordinates to chunk coordinates and local coordinates
    const { cx, cy, cz, lx, ly, lz } = worldToChunk(x, y, z);
    
    // Get the chunk
    const chunk = this.getChunk(cx, cy, cz);
    
    // If chunk doesn't exist, return AIR
    if (!chunk) {
      return 0; // AIR
    }
    
    return chunk.get(lx, ly, lz);
  }

  /**
   * Check if a block is solid (for collision detection)
   * @param x World X coordinate
   * @param y World Y coordinate
   * @param z World Z coordinate
   * @returns True if the block is solid, false otherwise
   */
  isBlockSolid(x: number, y: number, z: number): boolean {
    const blockId = this.getBlock(x, y, z);
    const blockDef = getBlock(blockId);
    return blockDef ? blockDef.solid : false;
  }

  /**
   * Check if a block is opaque (for rendering/culling)
   * @param x World X coordinate
   * @param y World Y coordinate
   * @param z World Z coordinate
   * @returns True if the block is opaque, false otherwise
   */
  isBlockOpaque(x: number, y: number, z: number): boolean {
    const blockId = this.getBlock(x, y, z);
    const blockDef = getBlock(blockId);
    return blockDef ? blockDef.opaque : false;
  }

  /**
   * Get all loaded chunk keys
   * @returns Array of chunk key strings
   */
  getLoadedChunkKeys(): ChunkKey[] {
    return Array.from(this.chunks.keys());
  }

  /**
   * Get all loaded chunks
   * @returns Array of chunk objects
   */
  getLoadedChunks(): Chunk[] {
    return Array.from(this.chunks.values());
  }

  /**
   * Get loaded chunk count
   * @returns Number of loaded chunks
   */
  getLoadedChunkCount(): number {
    return this.chunks.size;
  }

  /**
   * Check if a chunk is loaded
   * @param cx Chunk X coordinate
   * @param cy Chunk Y coordinate
   * @param cz Chunk Z coordinate
   * @returns True if chunk is loaded
   */
  isChunkLoaded(cx: number, cy: number, cz: number): boolean {
    const key = chunkKey(cx, cy, cz);
    return this.chunks.has(key);
  }

  /**
   * Get chunks within a radius around a center point
   * @param centerCx Center chunk X coordinate
   * @param centerCy Center chunk Y coordinate
   * @param centerCz Center chunk Z coordinate
   * @param radius Radius in chunks
   * @returns Map of chunk keys to chunks within the radius
   */
  getChunksInRadius(centerCx: number, centerCy: number, centerCz: number, radius: number): Map<ChunkKey, Chunk> {
    const result = new Map<ChunkKey, Chunk>();
    
    for (let cx = centerCx - radius; cx <= centerCx + radius; cx++) {
      for (let cy = centerCy - radius; cy <= centerCy + radius; cy++) {
        for (let cz = centerCz - radius; cz <= centerCz + radius; cz++) {
          const chunk = this.getChunk(cx, cy, cz);
          if (chunk) {
            const key = chunkKey(cx, cy, cz);
            result.set(key, chunk);
          }
        }
      }
    }
    
    return result;
  }

  /**
   * Clear all chunks and reset the world
   */
  clear(): void {
    const chunkKeys = this.getLoadedChunkKeys();
    
    // Remove all chunks (this will emit CHUNK_REMOVED events)
    for (const key of chunkKeys) {
      const [cxStr, cyStr, czStr] = key.split(',');
      const cx = parseInt(cxStr, 10);
      const cy = parseInt(cyStr, 10);
      const cz = parseInt(czStr, 10);
      this.removeChunk(cx, cy, cz);
    }
  }
}