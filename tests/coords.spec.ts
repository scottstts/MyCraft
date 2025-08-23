/**
 * Unit tests for coordinate system math
 * Critical for ensuring negative coordinate handling works correctly
 */

import { describe, it, expect } from 'vitest';
import { 
  floorDiv, 
  euclidMod, 
  worldToChunk, 
  chunkKey, 
  localToIndex, 
  indexToLocal 
} from '../src/engine/utils/coords';

describe('Coordinate Math', () => {
  describe('floorDiv', () => {
    it('handles positive numbers correctly', () => {
      expect(floorDiv(7, 3)).toBe(2);
      expect(floorDiv(9, 3)).toBe(3);
      expect(floorDiv(15, 16)).toBe(0);
      expect(floorDiv(16, 16)).toBe(1);
    });

    it('handles negative numbers correctly (floors toward negative infinity)', () => {
      expect(floorDiv(-1, 16)).toBe(-1);
      expect(floorDiv(-16, 16)).toBe(-1);
      expect(floorDiv(-17, 16)).toBe(-2);
      expect(floorDiv(-32, 16)).toBe(-2);
    });

    it('handles edge cases', () => {
      expect(floorDiv(0, 16)).toBe(0);
    });
  });

  describe('euclidMod', () => {
    it('handles positive numbers correctly', () => {
      expect(euclidMod(7, 16)).toBe(7);
      expect(euclidMod(16, 16)).toBe(0);
      expect(euclidMod(17, 16)).toBe(1);
      expect(euclidMod(32, 16)).toBe(0);
    });

    it('handles negative numbers correctly (always positive result)', () => {
      expect(euclidMod(-1, 16)).toBe(15);
      expect(euclidMod(-16, 16)).toBe(0);
      expect(euclidMod(-17, 16)).toBe(15);
      expect(euclidMod(-32, 16)).toBe(0);
    });

    it('handles edge cases', () => {
      expect(euclidMod(0, 16)).toBe(0);
    });
  });

  describe('worldToChunk', () => {
    it('maps positive coordinates correctly', () => {
      const result = worldToChunk(15, 63, 15);
      expect(result).toEqual({ cx: 0, cy: 0, cz: 0, lx: 15, ly: 63, lz: 15 });
    });

    it('maps coordinates at chunk boundaries', () => {
      const result = worldToChunk(16, 64, 16);
      expect(result).toEqual({ cx: 1, cy: 1, cz: 1, lx: 0, ly: 0, lz: 0 });
    });

    it('maps negative coordinates correctly', () => {
      // -1 should be in chunk (-1, -1, -1) at local position (15, 63, 15)
      const result = worldToChunk(-1, -1, -1);
      expect(result).toEqual({ cx: -1, cy: -1, cz: -1, lx: 15, ly: 63, lz: 15 });
    });

    it('maps negative chunk boundaries correctly', () => {
      // -16 should be in chunk (-1, -1, -1) at local position (0, 0, 0)
      const result = worldToChunk(-16, -64, -16);
      expect(result).toEqual({ cx: -1, cy: -1, cz: -1, lx: 0, ly: 0, lz: 0 });
    });

    it('maps origin correctly', () => {
      const result = worldToChunk(0, 0, 0);
      expect(result).toEqual({ cx: 0, cy: 0, cz: 0, lx: 0, ly: 0, lz: 0 });
    });
  });

  describe('chunkKey', () => {
    it('creates unique keys for different chunks', () => {
      expect(chunkKey(0, 0, 0)).toBe('0,0,0');
      expect(chunkKey(1, 2, 3)).toBe('1,2,3');
      expect(chunkKey(-1, -2, -3)).toBe('-1,-2,-3');
    });

    it('creates consistent keys', () => {
      const key1 = chunkKey(5, 10, -2);
      const key2 = chunkKey(5, 10, -2);
      expect(key1).toBe(key2);
    });
  });

  describe('localToIndex and indexToLocal', () => {
    it('converts between local coords and flat index correctly', () => {
      // Test some key positions
      expect(localToIndex(0, 0, 0)).toBe(0);
      expect(localToIndex(15, 0, 0)).toBe(15);
      expect(localToIndex(0, 0, 1)).toBe(16);
      expect(localToIndex(0, 1, 0)).toBe(16 * 16);
      
      // Test max position
      expect(localToIndex(15, 63, 15)).toBe(16 * 64 * 16 - 1);
    });

    it('converts index back to local coords correctly', () => {
      expect(indexToLocal(0)).toEqual({ lx: 0, ly: 0, lz: 0 });
      expect(indexToLocal(15)).toEqual({ lx: 15, ly: 0, lz: 0 });
      expect(indexToLocal(16)).toEqual({ lx: 0, ly: 0, lz: 1 });
      expect(indexToLocal(16 * 16)).toEqual({ lx: 0, ly: 1, lz: 0 });
    });

    it('has correct round-trip conversion', () => {
      const testCoords = [
        [0, 0, 0],
        [15, 63, 15],
        [8, 32, 8],
        [1, 1, 1]
      ];

      for (const [lx, ly, lz] of testCoords) {
        const index = localToIndex(lx, ly, lz);
        const converted = indexToLocal(index);
        expect(converted).toEqual({ lx, ly, lz });
      }
    });
  });

  describe('Integration tests', () => {
    it('correctly maps world coordinates across chunk boundaries', () => {
      // Test a sequence of world coordinates that cross chunk boundaries
      const coords = [-17, -16, -1, 0, 1, 15, 16, 17];
      
      for (const x of coords) {
        const result = worldToChunk(x, 0, 0);
        
        // Verify invariants
        expect(result.lx).toBeGreaterThanOrEqual(0);
        expect(result.lx).toBeLessThan(16);
        
        // Verify reconstruction
        const reconstructed = result.cx * 16 + result.lx;
        expect(reconstructed).toBe(x);
      }
    });
  });
});