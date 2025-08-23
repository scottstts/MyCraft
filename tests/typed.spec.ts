/**
 * Unit tests for typed array utilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  allocateUint8Array,
  allocateFloat32Array,
  resizeUint8Array,
  resizeFloat32Array,
  uint8Pool,
  float32Pool,
  createTransferableBuffer
} from '../src/engine/utils/typed';

describe('Typed Array Utilities', () => {
  beforeEach(() => {
    // Clear pools before each test
    uint8Pool.clear();
    float32Pool.clear();
  });

  describe('Array allocation', () => {
    it('allocates Uint8Array with correct size', () => {
      const array = allocateUint8Array(100);
      expect(array).toBeInstanceOf(Uint8Array);
      expect(array.length).toBe(100);
      expect(array.every(x => x === 0)).toBe(true); // Should be zero-initialized
    });

    it('allocates Float32Array with correct size', () => {
      const array = allocateFloat32Array(50);
      expect(array).toBeInstanceOf(Float32Array);
      expect(array.length).toBe(50);
      expect(array.every(x => x === 0)).toBe(true); // Should be zero-initialized
    });
  });

  describe('Array resizing', () => {
    it('resizes Uint8Array while preserving data', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      
      // Expand
      const expanded = resizeUint8Array(original, 8);
      expect(expanded.length).toBe(8);
      expect(Array.from(expanded.subarray(0, 5))).toEqual([1, 2, 3, 4, 5]);
      expect(Array.from(expanded.subarray(5))).toEqual([0, 0, 0]);
    });

    it('resizes Uint8Array down while preserving partial data', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      
      // Shrink
      const shrunk = resizeUint8Array(original, 3);
      expect(shrunk.length).toBe(3);
      expect(Array.from(shrunk)).toEqual([1, 2, 3]);
    });

    it('returns same array when size unchanged', () => {
      const original = new Uint8Array([1, 2, 3]);
      const result = resizeUint8Array(original, 3);
      expect(result).toBe(original); // Same reference
    });

    it('resizes Float32Array correctly', () => {
      const original = new Float32Array([1.5, 2.5, 3.5]);
      const expanded = resizeFloat32Array(original, 5);
      
      expect(expanded.length).toBe(5);
      expect(Array.from(expanded.subarray(0, 3))).toEqual([1.5, 2.5, 3.5]);
      expect(Array.from(expanded.subarray(3))).toEqual([0, 0]);
    });
  });

  describe('Buffer pools', () => {
    it('acquires buffer from pool', () => {
      const buffer = uint8Pool.acquire(100);
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThanOrEqual(100);
    });

    it('reuses released buffers', () => {
      const buffer1 = uint8Pool.acquire(100);
      buffer1[0] = 42; // Mark it
      
      uint8Pool.release(buffer1);
      const buffer2 = uint8Pool.acquire(100);
      
      // Should be the same buffer (reused)
      expect(buffer2).toBe(buffer1);
      expect(buffer2[0]).toBe(42);
    });

    it('allocates new buffer when pool is empty', () => {
      const buffer1 = uint8Pool.acquire(100);
      const buffer2 = uint8Pool.acquire(100);
      
      expect(buffer1).not.toBe(buffer2);
      expect(buffer1.length).toBe(100);
      expect(buffer2.length).toBe(100);
    });

    it('does not pool extremely large buffers', () => {
      const largeBuffer = uint8Pool.acquire(200000);
      uint8Pool.release(largeBuffer);
      
      const newBuffer = uint8Pool.acquire(100);
      expect(newBuffer).not.toBe(largeBuffer);
    });

    it('limits pool size', () => {
      // Release many buffers
      for (let i = 0; i < 15; i++) {
        const buffer = uint8Pool.acquire(100);
        uint8Pool.release(buffer);
      }
      
      // Pool should not grow indefinitely
      expect(uint8Pool['pool'].length).toBeLessThanOrEqual(10);
    });
  });

  describe('Transferable buffers', () => {
    it('creates transferable buffer with transfer list', () => {
      const array = new Uint8Array([1, 2, 3, 4]);
      const { array: resultArray, transferList } = createTransferableBuffer(array);
      
      expect(resultArray).toBe(array);
      expect(transferList).toEqual([array.buffer]);
      expect(transferList[0]).toBeInstanceOf(ArrayBuffer);
    });

    it('works with different typed array types', () => {
      const float32Array = new Float32Array([1.5, 2.5]);
      const result = createTransferableBuffer(float32Array);
      
      expect(result.array).toBe(float32Array);
      expect(result.transferList[0]).toBe(float32Array.buffer);
    });
  });

  describe('Performance characteristics', () => {
    it('handles large array operations efficiently', () => {
      const start = performance.now();
      
      // Allocate and resize large arrays
      for (let i = 0; i < 100; i++) {
        const array = allocateUint8Array(10000);
        const resized = resizeUint8Array(array, 15000);
        expect(resized.length).toBe(15000);
      }
      
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100); // Should complete in reasonable time
    });
  });
});