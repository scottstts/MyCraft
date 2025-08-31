/**
 * World - Main world manager that coordinates chunks and block operations
 * Purpose: Manages chunk storage, provides world-coordinate block access, and emits events
 * Callers: Engine systems, player controllers, and block interaction systems
 * Invariants:
 * - All chunk operations use consistent coordinate mapping
 * - Events are emitted for all chunk and block changes
 * - Thread-safe for read operations
 */

import type { BlockId, ChunkKey, C3 } from '../../types/index.js';
import { Chunk } from './chunk/Chunk.js';
import { worldToChunk, chunkKey } from '../utils/coords.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { getBlock } from './blocks/BlockRegistry.js';
import { ChunkPipeline } from './ChunkPipeline.js';

// Type for individual block overrides within a chunk
export interface BlockOverride {
  lx: number;  // Local X coordinate [0, CHUNK_SIZE.x-1]
  ly: number;  // Local Y coordinate [0, CHUNK_SIZE.y-1]
  lz: number;  // Local Z coordinate [0, CHUNK_SIZE.z-1]
  id: BlockId; // Block ID to set
}

// Interface for providing chunk overrides
export interface ChunkOverrideProvider {
  getOverrides(chunkKey: ChunkKey): BlockOverride[] | Promise<BlockOverride[]>;
}

// Define world event types
export interface WorldEvents extends Record<string, unknown> {
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
  public chunkPipeline: ChunkPipeline;
  private seed: number = 12345; // Default seed
  private overrideProvider: ChunkOverrideProvider | null = null;
  // Track dynamic flooded-air volumes (air cells that are considered underwater due to connectivity to a water body)
  private floodedAir: Set<string> = new Set();

  constructor() {
    super();
    
    this.chunkPipeline = new ChunkPipeline();
    
    // Listen for chunks from the pipeline
    this.chunkPipeline.on('CHUNK_READY', ({ key, chunkData }) => {
      this.handleChunkReady(key, chunkData);
    });
  }

  /**
   * Handle chunk data received from the pipeline
   */
  private async handleChunkReady(key: ChunkKey, chunkData: import('../../types/index.js').ChunkData): Promise<void> {
    // Create chunk from data
    const chunk = new Chunk();
    chunk.setFromData(chunkData);
    
    // Apply overrides if provider is available
    if (this.overrideProvider) {
      try {
        const overrides = await this.overrideProvider.getOverrides(key);
        this.applyOverrides(chunk, overrides);
      } catch (error) {
        console.warn(`[World] Failed to load overrides for chunk ${key}:`, error);
      }
    }
    
    // Parse chunk coordinates from key
    const [cxStr, cyStr, czStr] = key.split(',');
    const cx = parseInt(cxStr, 10);
    const cy = parseInt(cyStr, 10);
    const cz = parseInt(czStr, 10);
    
    // Store the chunk
    this.chunks.set(key, chunk);
    
    // Emit chunk added event
    this.emit('CHUNK_ADDED', { 
      key, 
      chunk, 
      coords: { cx, cy, cz } 
    });
    
    // console.log(`[World] Chunk ready: ${key}`);
  }

  /**
   * Ensure a chunk exists at the given chunk coordinates
   * Requests generation if it doesn't exist and returns undefined until ready
   * @param cx Chunk X coordinate
   * @param cy Chunk Y coordinate  
   * @param cz Chunk Z coordinate
   * @returns The chunk at the specified coordinates, or undefined if still generating
   */
  ensureChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    const key = chunkKey(cx, cy, cz);
    
    const chunk = this.chunks.get(key);
    if (!chunk) {
      // Request chunk generation
      this.chunkPipeline.requestChunk(cx, cy, cz, this.seed);
      return undefined; // Chunk not ready yet
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
    
    // If chunk is not ready yet, ignore the set operation
    if (!chunk) {
      console.warn(`[World] Cannot set block at (${x}, ${y}, ${z}): chunk not ready yet`);
      return;
    }
    
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
    // Convert world coordinates to chunk coordinates
    const { cx, cy, cz } = worldToChunk(x, y, z);
    
    // If chunk isn't loaded yet, treat as solid to prevent falling through
    const chunk = this.getChunk(cx, cy, cz);
    if (!chunk) {
      // For unloaded chunks, only treat as solid if below a reasonable height
      // This prevents getting stuck on unloaded sky chunks while still preventing fall-through
      return y <= 80; // Above this height, unloaded chunks are passable (sky)
    }
    
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

  /** Mark a collection of air cells as flooded (underwater) */
  addFloodedAir(cells: Array<{ x: number; y: number; z: number }>): void {
    for (const c of cells) {
      this.floodedAir.add(`${c.x},${c.y},${c.z}`);
    }
  }

  /** Remove a collection of flooded air marks (no-op if not present) */
  removeFloodedAir(cells: Array<{ x: number; y: number; z: number }>): void {
    for (const c of cells) {
      this.floodedAir.delete(`${c.x},${c.y},${c.z}`);
    }
  }

  /** Check if a cell is currently marked as flooded (underwater in air) */
  isAirFlooded(x: number, y: number, z: number): boolean {
    return this.floodedAir.has(`${x},${y},${z}`);
  }

  /** Clear all flooded-air marks (e.g., on world reset) */
  clearFloodedAir(): void { this.floodedAir.clear(); }

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

  /**
   * Set the world seed for generation
   */
  setSeed(seed: number): void {
    this.seed = seed;
  }

  /**
   * Get the current world seed
   */
  getSeed(): number {
    return this.seed;
  }

  /**
   * Set the chunk override provider
   * @param provider Provider for chunk block overrides
   */
  setOverrideProvider(provider: ChunkOverrideProvider | null): void {
    this.overrideProvider = provider;
  }

  /**
   * Get the current chunk override provider
   * @returns Current override provider or null
   */
  getOverrideProvider(): ChunkOverrideProvider | null {
    return this.overrideProvider;
  }

  /**
   * Apply block overrides to a chunk
   * @param chunk Chunk to apply overrides to
   * @param overrides Array of block overrides
   */
  private applyOverrides(chunk: Chunk, overrides: BlockOverride[]): void {
    for (const override of overrides) {
      try {
        chunk.set(override.lx, override.ly, override.lz, override.id);
      } catch (error) {
        console.warn(`[World] Failed to apply override at (${override.lx}, ${override.ly}, ${override.lz}):`, error);
      }
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.chunkPipeline.destroy();
    this.clear();
  }
}
