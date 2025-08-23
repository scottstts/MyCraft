/**
 * Unit tests for World class
 * Validates chunk management, world-coordinate block operations, and events
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { World } from '../src/engine/world/World';
import { Chunk } from '../src/engine/world/chunk/Chunk';

describe('World', () => {
  let world: World;

  beforeEach(() => {
    world = new World();
  });

  describe('Chunk management', () => {
    it('should create chunks on demand with ensureChunk', () => {
      const chunk = world.ensureChunk(0, 0, 0);
      expect(chunk).toBeInstanceOf(Chunk);
      expect(chunk.isEmpty()).toBe(true);
    });

    it('should return same chunk for repeated ensureChunk calls', () => {
      const chunk1 = world.ensureChunk(1, 2, 3);
      const chunk2 = world.ensureChunk(1, 2, 3);
      expect(chunk1).toBe(chunk2);
    });

    it('should return undefined for non-existent chunks with getChunk', () => {
      const chunk = world.getChunk(5, 5, 5);
      expect(chunk).toBeUndefined();
    });

    it('should return existing chunk with getChunk', () => {
      const originalChunk = world.ensureChunk(1, 1, 1);
      const retrievedChunk = world.getChunk(1, 1, 1);
      expect(retrievedChunk).toBe(originalChunk);
    });

    it('should set and get chunks correctly', () => {
      const chunk = new Chunk();
      chunk.set(5, 10, 7, 3); // Set a block to stone
      
      world.setChunk(2, 3, 4, chunk);
      const retrievedChunk = world.getChunk(2, 3, 4);
      
      expect(retrievedChunk).toBe(chunk);
      expect(retrievedChunk!.get(5, 10, 7)).toBe(3);
    });

    it('should remove chunks correctly', () => {
      world.ensureChunk(1, 1, 1);
      expect(world.isChunkLoaded(1, 1, 1)).toBe(true);
      
      const removed = world.removeChunk(1, 1, 1);
      expect(removed).toBe(true);
      expect(world.isChunkLoaded(1, 1, 1)).toBe(false);
      
      const removedAgain = world.removeChunk(1, 1, 1);
      expect(removedAgain).toBe(false);
    });

    it('should track loaded chunk count', () => {
      expect(world.getLoadedChunkCount()).toBe(0);
      
      world.ensureChunk(0, 0, 0);
      expect(world.getLoadedChunkCount()).toBe(1);
      
      world.ensureChunk(1, 0, 0);
      world.ensureChunk(0, 1, 0);
      expect(world.getLoadedChunkCount()).toBe(3);
      
      world.removeChunk(0, 0, 0);
      expect(world.getLoadedChunkCount()).toBe(2);
    });
  });

  describe('World-coordinate block operations', () => {
    it('should set and get blocks across chunk boundaries', () => {
      // Test setting blocks in different chunks
      world.setBlock(0, 10, 0, 1);   // Origin chunk
      world.setBlock(16, 20, 16, 2); // Different chunk
      world.setBlock(-1, 30, -1, 3); // Negative coordinates
      
      expect(world.getBlock(0, 10, 0)).toBe(1);
      expect(world.getBlock(16, 20, 16)).toBe(2);
      expect(world.getBlock(-1, 30, -1)).toBe(3);
    });

    it('should return AIR for blocks in non-existent chunks', () => {
      expect(world.getBlock(1000, 1000, 1000)).toBe(0); // AIR
    });

    it('should handle negative world coordinates correctly', () => {
      world.setBlock(-5, 10, -7, 2);
      expect(world.getBlock(-5, 10, -7)).toBe(2);
      
      world.setBlock(-16, 20, -16, 3);
      expect(world.getBlock(-16, 20, -16)).toBe(3);
    });

    it('should check block solidity correctly', () => {
      world.setBlock(0, 0, 0, 0); // AIR (not solid)
      world.setBlock(1, 0, 0, 1); // Grass (solid)
      world.setBlock(2, 0, 0, 2); // Dirt (solid)
      world.setBlock(3, 0, 0, 3); // Stone (solid)
      
      expect(world.isBlockSolid(0, 0, 0)).toBe(false);
      expect(world.isBlockSolid(1, 0, 0)).toBe(true);
      expect(world.isBlockSolid(2, 0, 0)).toBe(true);
      expect(world.isBlockSolid(3, 0, 0)).toBe(true);
      
      // Non-existent chunk should return false
      expect(world.isBlockSolid(1000, 1000, 1000)).toBe(false);
    });

    it('should check block opacity correctly', () => {
      world.setBlock(0, 0, 0, 0); // AIR (not opaque)
      world.setBlock(1, 0, 0, 1); // Grass (opaque)
      
      expect(world.isBlockOpaque(0, 0, 0)).toBe(false);
      expect(world.isBlockOpaque(1, 0, 0)).toBe(true);
    });
  });

  describe('Events', () => {
    it('should emit CHUNK_ADDED when chunk is created', () => {
      const listener = vi.fn();
      world.on('CHUNK_ADDED', listener);
      
      const chunk = world.ensureChunk(5, 6, 7);
      
      expect(listener).toHaveBeenCalledWith({
        key: '5,6,7',
        chunk,
        coords: { cx: 5, cy: 6, cz: 7 }
      });
    });

    it('should not emit CHUNK_ADDED for existing chunks', () => {
      world.ensureChunk(1, 1, 1);
      
      const listener = vi.fn();
      world.on('CHUNK_ADDED', listener);
      
      world.ensureChunk(1, 1, 1); // Same chunk
      
      expect(listener).not.toHaveBeenCalled();
    });

    it('should emit CHUNK_REMOVED when chunk is removed', () => {
      world.ensureChunk(2, 3, 4);
      
      const listener = vi.fn();
      world.on('CHUNK_REMOVED', listener);
      
      world.removeChunk(2, 3, 4);
      
      expect(listener).toHaveBeenCalledWith({
        key: '2,3,4',
        coords: { cx: 2, cy: 3, cz: 4 }
      });
    });

    it('should emit BLOCK_CHANGED when block is set', () => {
      const listener = vi.fn();
      world.on('BLOCK_CHANGED', listener);
      
      world.setBlock(5, 10, 7, 2);
      
      expect(listener).toHaveBeenCalledWith({
        worldX: 5,
        worldY: 10,
        worldZ: 7,
        oldBlockId: 0, // Was AIR
        newBlockId: 2, // Now dirt
        chunkKey: '0,0,0',
        localX: 5,
        localY: 10,
        localZ: 7
      });
    });

    it('should emit BLOCK_CHANGED with correct old block ID', () => {
      world.setBlock(0, 0, 0, 1); // Set to grass first
      
      const listener = vi.fn();
      world.on('BLOCK_CHANGED', listener);
      
      world.setBlock(0, 0, 0, 3); // Change to stone
      
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        worldX: 0,
        worldY: 0,
        worldZ: 0,
        oldBlockId: 1, // Was grass
        newBlockId: 3  // Now stone
      }));
    });
  });

  describe('Utility methods', () => {
    it('should get loaded chunk keys', () => {
      world.ensureChunk(0, 0, 0);
      world.ensureChunk(1, 2, 3);
      
      const keys = world.getLoadedChunkKeys().sort();
      expect(keys).toEqual(['0,0,0', '1,2,3']);
    });

    it('should get loaded chunks', () => {
      const chunk1 = world.ensureChunk(0, 0, 0);
      const chunk2 = world.ensureChunk(1, 1, 1);
      
      const chunks = world.getLoadedChunks();
      expect(chunks).toHaveLength(2);
      expect(chunks).toContain(chunk1);
      expect(chunks).toContain(chunk2);
    });

    it('should get chunks in radius', () => {
      // Create a 3x3 grid of chunks around origin
      for (let cx = -1; cx <= 1; cx++) {
        for (let cz = -1; cz <= 1; cz++) {
          world.ensureChunk(cx, 0, cz);
        }
      }
      
      const nearbyChunks = world.getChunksInRadius(0, 0, 0, 1);
      expect(nearbyChunks.size).toBe(9); // 3x3 grid
      
      const farChunks = world.getChunksInRadius(10, 0, 10, 1);
      expect(farChunks.size).toBe(0); // No chunks loaded there
    });

    it('should clear all chunks', () => {
      world.ensureChunk(0, 0, 0);
      world.ensureChunk(1, 1, 1);
      world.ensureChunk(-1, -1, -1);
      
      expect(world.getLoadedChunkCount()).toBe(3);
      
      const removeListener = vi.fn();
      world.on('CHUNK_REMOVED', removeListener);
      
      world.clear();
      
      expect(world.getLoadedChunkCount()).toBe(0);
      expect(removeListener).toHaveBeenCalledTimes(3);
    });
  });

  describe('Chunk by key operations', () => {
    it('should get chunk by key string', () => {
      const chunk = world.ensureChunk(1, 2, 3);
      const retrieved = world.getChunkByKey('1,2,3');
      expect(retrieved).toBe(chunk);
    });

    it('should return undefined for non-existent chunk key', () => {
      const chunk = world.getChunkByKey('999,999,999');
      expect(chunk).toBeUndefined();
    });
  });
});