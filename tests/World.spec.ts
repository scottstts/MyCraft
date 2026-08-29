/**
 * Unit tests for World class
 * Validates chunk management, world-coordinate block operations, and events
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { World } from '../src/engine/world/World';
import { Chunk } from '../src/engine/world/chunk/Chunk';
import { CHUNK_SIZE } from '../src/config/constants';

class TestWorker {
  static instances: TestWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    TestWorker.instances.push(this);
  }
}

describe('World', () => {
  let world: World;

  beforeEach(() => {
    TestWorker.instances.length = 0;
    vi.stubGlobal('Worker', TestWorker);
    world = new World();
  });

  afterEach(() => {
    world.chunkPipeline.destroy();
    vi.unstubAllGlobals();
  });

  function loadChunk(cx: number, cy: number, cz: number): Chunk {
    const chunk = new Chunk();
    world.setChunk(cx, cy, cz, chunk);
    return chunk;
  }

  describe('Chunk management', () => {
    it('should request missing chunks with ensureChunk', () => {
      const chunk = world.ensureChunk(0, 0, 0);
      expect(chunk).toBeUndefined();
      expect(TestWorker.instances[0].postMessage).toHaveBeenCalledWith({
        type: 'GEN_CHUNK',
        payload: {
          key: '0,0,0',
          cx: 0,
          cy: 0,
          cz: 0,
          seed: 12345,
          worldRadius: undefined,
        },
      });
    });

    it('should deduplicate repeated generation requests', () => {
      expect(world.ensureChunk(1, 2, 3)).toBeUndefined();
      expect(world.ensureChunk(1, 2, 3)).toBeUndefined();
      expect(TestWorker.instances[0].postMessage).toHaveBeenCalledTimes(1);
    });

    it('should return undefined for non-existent chunks with getChunk', () => {
      const chunk = world.getChunk(5, 5, 5);
      expect(chunk).toBeUndefined();
    });

    it('should return existing chunk with getChunk', () => {
      const originalChunk = loadChunk(1, 1, 1);
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
      loadChunk(1, 1, 1);
      expect(world.isChunkLoaded(1, 1, 1)).toBe(true);
      
      const removed = world.removeChunk(1, 1, 1);
      expect(removed).toBe(true);
      expect(world.isChunkLoaded(1, 1, 1)).toBe(false);
      
      const removedAgain = world.removeChunk(1, 1, 1);
      expect(removedAgain).toBe(false);
    });

    it('should track loaded chunk count', () => {
      expect(world.getLoadedChunkCount()).toBe(0);
      
      loadChunk(0, 0, 0);
      expect(world.getLoadedChunkCount()).toBe(1);
      
      loadChunk(1, 0, 0);
      loadChunk(0, 1, 0);
      expect(world.getLoadedChunkCount()).toBe(3);
      
      world.removeChunk(0, 0, 0);
      expect(world.getLoadedChunkCount()).toBe(2);
    });
  });

  describe('World-coordinate block operations', () => {
    it('should set and get blocks across chunk boundaries', () => {
      loadChunk(0, 0, 0);
      loadChunk(1, 0, 1);
      loadChunk(-1, 0, -1);

      world.setBlock(0, 10, 0, 1);   // Origin chunk
      world.setBlock(CHUNK_SIZE.x, 20, CHUNK_SIZE.z, 2); // Positive neighbor chunk
      world.setBlock(-1, 30, -1, 3); // Negative coordinates
      
      expect(world.getBlock(0, 10, 0)).toBe(1);
      expect(world.getBlock(CHUNK_SIZE.x, 20, CHUNK_SIZE.z)).toBe(2);
      expect(world.getBlock(-1, 30, -1)).toBe(3);
    });

    it('should return AIR for blocks in non-existent chunks', () => {
      expect(world.getBlock(1000, 1000, 1000)).toBe(0); // AIR
    });

    it('should handle negative world coordinates correctly', () => {
      loadChunk(-1, 0, -1);

      world.setBlock(-5, 10, -7, 2);
      expect(world.getBlock(-5, 10, -7)).toBe(2);
      
      world.setBlock(-CHUNK_SIZE.x, 20, -CHUNK_SIZE.z, 3);
      expect(world.getBlock(-CHUNK_SIZE.x, 20, -CHUNK_SIZE.z)).toBe(3);
    });

    it('should check block solidity correctly', () => {
      loadChunk(0, 0, 0);

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
      loadChunk(0, 0, 0);

      world.setBlock(0, 0, 0, 0); // AIR (not opaque)
      world.setBlock(1, 0, 0, 1); // Grass (opaque)
      
      expect(world.isBlockOpaque(0, 0, 0)).toBe(false);
      expect(world.isBlockOpaque(1, 0, 0)).toBe(true);
    });
  });

  describe('Events', () => {
    it('should emit CHUNK_ADDED when a chunk is loaded', () => {
      const listener = vi.fn();
      world.on('CHUNK_ADDED', listener);
      
      const chunk = new Chunk();
      world.setChunk(5, 6, 7, chunk);
      
      expect(listener).toHaveBeenCalledWith({
        key: '5,6,7',
        chunk,
        coords: { cx: 5, cy: 6, cz: 7 }
      });
    });

    it('should not emit CHUNK_ADDED for existing chunks', () => {
      loadChunk(1, 1, 1);
      
      const listener = vi.fn();
      world.on('CHUNK_ADDED', listener);
      
      world.setChunk(1, 1, 1, new Chunk());
      
      expect(listener).not.toHaveBeenCalled();
    });

    it('should emit CHUNK_REMOVED when chunk is removed', () => {
      loadChunk(2, 3, 4);
      
      const listener = vi.fn();
      world.on('CHUNK_REMOVED', listener);
      
      world.removeChunk(2, 3, 4);
      
      expect(listener).toHaveBeenCalledWith({
        key: '2,3,4',
        coords: { cx: 2, cy: 3, cz: 4 }
      });
    });

    it('should emit BLOCK_CHANGED when block is set', () => {
      loadChunk(0, 0, 0);

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
      loadChunk(0, 0, 0);

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
      loadChunk(0, 0, 0);
      loadChunk(1, 2, 3);
      
      const keys = world.getLoadedChunkKeys().sort();
      expect(keys).toEqual(['0,0,0', '1,2,3']);
    });

    it('should get loaded chunks', () => {
      const chunk1 = loadChunk(0, 0, 0);
      const chunk2 = loadChunk(1, 1, 1);
      
      const chunks = world.getLoadedChunks();
      expect(chunks).toHaveLength(2);
      expect(chunks).toContain(chunk1);
      expect(chunks).toContain(chunk2);
    });

    it('should get chunks in radius', () => {
      // Create a 3x3 grid of chunks around origin
      for (let cx = -1; cx <= 1; cx++) {
        for (let cz = -1; cz <= 1; cz++) {
          loadChunk(cx, 0, cz);
        }
      }
      
      const nearbyChunks = world.getChunksInRadius(0, 0, 0, 1);
      expect(nearbyChunks.size).toBe(9); // 3x3 grid
      
      const farChunks = world.getChunksInRadius(10, 0, 10, 1);
      expect(farChunks.size).toBe(0); // No chunks loaded there
    });

    it('should clear all chunks', () => {
      loadChunk(0, 0, 0);
      loadChunk(1, 1, 1);
      loadChunk(-1, -1, -1);
      
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
      const chunk = loadChunk(1, 2, 3);
      const retrieved = world.getChunkByKey('1,2,3');
      expect(retrieved).toBe(chunk);
    });

    it('should return undefined for non-existent chunk key', () => {
      const chunk = world.getChunkByKey('999,999,999');
      expect(chunk).toBeUndefined();
    });
  });
});
