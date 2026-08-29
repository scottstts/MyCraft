/**
 * Unit tests for Chunk class and chunk indexing utilities
 * Validates voxel storage, coordinate validation, and edge cases
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Chunk } from '../src/engine/world/chunk/Chunk';
import { flattenIndex, unflattenIndex, getChunkVoxelCount, isValidLocalCoords } from '../src/engine/world/chunk/index';
import { CHUNK_SIZE } from '../src/config/constants';

describe('Chunk indexing utilities', () => {
  describe('flattenIndex', () => {
    it('should convert 3D coordinates to flat index correctly', () => {
      // Test corner cases
      expect(flattenIndex(0, 0, 0)).toBe(0);
      expect(flattenIndex(CHUNK_SIZE.x - 1, 0, 0)).toBe(CHUNK_SIZE.x - 1);
      expect(flattenIndex(0, 0, CHUNK_SIZE.z - 1)).toBe((CHUNK_SIZE.z - 1) * CHUNK_SIZE.x);
      expect(flattenIndex(0, 1, 0)).toBe(CHUNK_SIZE.x * CHUNK_SIZE.z);

      // Test specific coordinate
      expect(flattenIndex(5, 10, 7)).toBe(10 * (CHUNK_SIZE.x * CHUNK_SIZE.z) + 7 * CHUNK_SIZE.x + 5);
    });

    it('should throw for invalid coordinates', () => {
      expect(() => flattenIndex(-1, 0, 0)).toThrow();
      expect(() => flattenIndex(CHUNK_SIZE.x, 0, 0)).toThrow();
      expect(() => flattenIndex(0, CHUNK_SIZE.y, 0)).toThrow();
      expect(() => flattenIndex(0, 0, CHUNK_SIZE.z)).toThrow();
    });
  });

  describe('unflattenIndex', () => {
    it('should convert flat index back to 3D coordinates', () => {
      const testCases = [
        { lx: 0, ly: 0, lz: 0 },
        { lx: CHUNK_SIZE.x - 1, ly: 0, lz: 0 },
        { lx: 0, ly: 0, lz: CHUNK_SIZE.z - 1 },
        { lx: 0, ly: 1, lz: 0 },
        { lx: 5, ly: 10, lz: 7 },
        { lx: CHUNK_SIZE.x - 1, ly: CHUNK_SIZE.y - 1, lz: CHUNK_SIZE.z - 1 }
      ];

      for (const { lx, ly, lz } of testCases) {
        const index = flattenIndex(lx, ly, lz);
        const result = unflattenIndex(index);
        expect(result).toEqual({ lx, ly, lz });
      }
    });

    it('should throw for invalid index', () => {
      const totalSize = getChunkVoxelCount();
      expect(() => unflattenIndex(-1)).toThrow();
      expect(() => unflattenIndex(totalSize)).toThrow();
    });
  });

  describe('utility functions', () => {
    it('should return correct chunk voxel count', () => {
      expect(getChunkVoxelCount()).toBe(CHUNK_SIZE.x * CHUNK_SIZE.y * CHUNK_SIZE.z);
    });

    it('should validate local coordinates correctly', () => {
      expect(isValidLocalCoords(0, 0, 0)).toBe(true);
      expect(isValidLocalCoords(CHUNK_SIZE.x - 1, CHUNK_SIZE.y - 1, CHUNK_SIZE.z - 1)).toBe(true);
      expect(isValidLocalCoords(
        Math.floor(CHUNK_SIZE.x / 2),
        Math.floor(CHUNK_SIZE.y / 2),
        Math.floor(CHUNK_SIZE.z / 2),
      )).toBe(true);

      expect(isValidLocalCoords(-1, 0, 0)).toBe(false);
      expect(isValidLocalCoords(CHUNK_SIZE.x, 0, 0)).toBe(false);
      expect(isValidLocalCoords(0, CHUNK_SIZE.y, 0)).toBe(false);
      expect(isValidLocalCoords(0, 0, CHUNK_SIZE.z)).toBe(false);
    });
  });
});

describe('Chunk class', () => {
  let chunk: Chunk;

  beforeEach(() => {
    chunk = new Chunk();
  });

  describe('Constructor and initialization', () => {
    it('should create empty chunk filled with AIR', () => {
      expect(chunk.isEmpty()).toBe(true);
      expect(chunk.get(0, 0, 0)).toBe(0);
      expect(chunk.get(CHUNK_SIZE.x - 1, CHUNK_SIZE.y - 1, CHUNK_SIZE.z - 1)).toBe(0);
    });

    it('should create chunk from existing data', () => {
      const voxels = new Uint8Array(getChunkVoxelCount());
      voxels.fill(1); // Fill with grass
      const data = {
        size: { ...CHUNK_SIZE },
        voxels
      };

      const newChunk = new Chunk(data);
      expect(newChunk.isEmpty()).toBe(false);
      expect(newChunk.get(0, 0, 0)).toBe(1);
      expect(newChunk.get(8, 32, 8)).toBe(1);
    });

    it('should throw for invalid chunk data', () => {
      const invalidData = {
        size: { ...CHUNK_SIZE },
        voxels: new Uint8Array(100) // Wrong size
      };

      expect(() => new Chunk(invalidData)).toThrow();
    });

    it('should throw for invalid size in chunk data', () => {
      const invalidData = {
        size: { x: 8, y: 8, z: 8 }, // Wrong size
        voxels: new Uint8Array(getChunkVoxelCount())
      };

      expect(() => new Chunk(invalidData)).toThrow();
    });
  });

  describe('Get and set operations', () => {
    it('should get and set blocks correctly', () => {
      expect(chunk.get(5, 10, 7)).toBe(0);
      
      chunk.set(5, 10, 7, 2); // Set to dirt
      expect(chunk.get(5, 10, 7)).toBe(2);
      
      chunk.set(5, 10, 7, 0); // Set back to air
      expect(chunk.get(5, 10, 7)).toBe(0);
    });

    it('should handle edge coordinates', () => {
      // Test all corners
      const corners = [
        [0, 0, 0],
        [CHUNK_SIZE.x - 1, 0, 0],
        [0, CHUNK_SIZE.y - 1, 0],
        [0, 0, CHUNK_SIZE.z - 1],
        [CHUNK_SIZE.x - 1, CHUNK_SIZE.y - 1, CHUNK_SIZE.z - 1]
      ];

      for (const [lx, ly, lz] of corners) {
        chunk.set(lx, ly, lz, 3); // Stone
        expect(chunk.get(lx, ly, lz)).toBe(3);
      }
    });

    it('should throw for invalid coordinates', () => {
      expect(() => chunk.get(-1, 0, 0)).toThrow();
      expect(() => chunk.get(CHUNK_SIZE.x, 0, 0)).toThrow();
      expect(() => chunk.get(0, CHUNK_SIZE.y, 0)).toThrow();
      expect(() => chunk.get(0, 0, CHUNK_SIZE.z)).toThrow();

      expect(() => chunk.set(-1, 0, 0, 1)).toThrow();
      expect(() => chunk.set(CHUNK_SIZE.x, 0, 0, 1)).toThrow();
      expect(() => chunk.set(0, CHUNK_SIZE.y, 0, 1)).toThrow();
      expect(() => chunk.set(0, 0, CHUNK_SIZE.z, 1)).toThrow();
    });

    it('should throw for invalid block IDs', () => {
      expect(() => chunk.set(0, 0, 0, -1)).toThrow();
      expect(() => chunk.set(0, 0, 0, 256)).toThrow();
    });
  });

  describe('Utility methods', () => {
    it('should fill chunk with block type', () => {
      chunk.fill(1); // Fill with grass
      expect(chunk.isEmpty()).toBe(false);
      expect(chunk.get(0, 0, 0)).toBe(1);
      expect(chunk.get(CHUNK_SIZE.x - 1, CHUNK_SIZE.y - 1, CHUNK_SIZE.z - 1)).toBe(1);
    });

    it('should clear chunk', () => {
      chunk.fill(2); // Fill with dirt
      expect(chunk.isEmpty()).toBe(false);
      
      chunk.clear();
      expect(chunk.isEmpty()).toBe(true);
    });

    it('should count blocks correctly', () => {
      chunk.fill(0); // All AIR
      expect(chunk.countBlocks(0)).toBe(getChunkVoxelCount());
      expect(chunk.countBlocks(1)).toBe(0);

      chunk.set(0, 0, 0, 1);
      chunk.set(1, 1, 1, 1);
      expect(chunk.countBlocks(0)).toBe(getChunkVoxelCount() - 2);
      expect(chunk.countBlocks(1)).toBe(2);
    });

    it('should generate block statistics', () => {
      chunk.fill(1); // Fill with grass
      chunk.set(0, 0, 0, 2); // One dirt block
      chunk.set(1, 1, 1, 2); // Another dirt block

      const stats = chunk.getBlockStats();
      expect(stats.get(1)).toBe(getChunkVoxelCount() - 2); // Grass blocks
      expect(stats.get(2)).toBe(2); // Dirt blocks
    });

    it('should return chunk data copy', () => {
      chunk.set(5, 10, 7, 3);
      const data = chunk.getData();
      
      expect(data.size).toEqual(CHUNK_SIZE);
      expect(data.voxels).toBeInstanceOf(Uint8Array);
      expect(data.voxels.length).toBe(getChunkVoxelCount());
      
      // Verify it's a copy by modifying original
      chunk.set(5, 10, 7, 1);
      expect(data.voxels[flattenIndex(5, 10, 7)]).toBe(3); // Should still be 3
    });

    it('should return size copy', () => {
      const size = chunk.getSize();
      expect(size).toEqual(CHUNK_SIZE);
      
      // Verify it's a copy
      size.x = 999;
      expect(chunk.getSize().x).toBe(CHUNK_SIZE.x);
    });
  });
});
