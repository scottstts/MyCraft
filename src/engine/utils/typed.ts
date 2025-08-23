/**
 * Typed array utilities and buffer management
 * Inputs: Array sizes, growth requirements
 * Outputs: Efficiently allocated typed arrays with capacity management
 * Invariants: Arrays are properly sized and can be transferred to workers
 */

/**
 * Allocate a typed array with specified capacity
 */
export function allocateUint8Array(size: number): Uint8Array {
  return new Uint8Array(size);
}

export function allocateUint16Array(size: number): Uint16Array {
  return new Uint16Array(size);
}

export function allocateFloat32Array(size: number): Float32Array {
  return new Float32Array(size);
}

/**
 * Resize a typed array, copying existing data
 */
export function resizeUint8Array(array: Uint8Array, newSize: number): Uint8Array {
  if (array.length === newSize) return array;
  
  const newArray = new Uint8Array(newSize);
  const copyLength = Math.min(array.length, newSize);
  newArray.set(array.subarray(0, copyLength));
  return newArray;
}

export function resizeFloat32Array(array: Float32Array, newSize: number): Float32Array {
  if (array.length === newSize) return array;
  
  const newArray = new Float32Array(newSize);
  const copyLength = Math.min(array.length, newSize);
  newArray.set(array.subarray(0, copyLength));
  return newArray;
}

export function resizeUint16Array(array: Uint16Array, newSize: number): Uint16Array {
  if (array.length === newSize) return array;
  
  const newArray = new Uint16Array(newSize);
  const copyLength = Math.min(array.length, newSize);
  newArray.set(array.subarray(0, copyLength));
  return newArray;
}

/**
 * Simple buffer pool for reusing typed arrays
 * Helps reduce GC pressure during chunk processing
 */
class BufferPool<T extends TypedArray> {
  private pool: T[] = [];
  private allocator: (size: number) => T;

  constructor(allocator: (size: number) => T) {
    this.allocator = allocator;
  }

  acquire(size: number): T {
    // Look for a buffer of adequate size
    for (let i = 0; i < this.pool.length; i++) {
      const buffer = this.pool[i];
      if (buffer.length >= size) {
        this.pool.splice(i, 1);
        return buffer.length > size * 2 ? 
          this.allocator(size) : // Too big, allocate new one
          buffer;
      }
    }
    
    return this.allocator(size);
  }

  release(buffer: T): void {
    // Don't pool extremely large buffers
    if (buffer.length > 100000) return;
    
    this.pool.push(buffer);
    
    // Keep pool size reasonable
    if (this.pool.length > 10) {
      this.pool.splice(0, this.pool.length - 10);
    }
  }

  clear(): void {
    this.pool.length = 0;
  }
}

// Global buffer pools for common array types
export const uint8Pool = new BufferPool<Uint8Array>((size) => new Uint8Array(size));
export const float32Pool = new BufferPool<Float32Array>((size) => new Float32Array(size));
export const uint16Pool = new BufferPool<Uint16Array>((size) => new Uint16Array(size));

/**
 * Helper to create transferable array buffer for worker communication
 */
export function createTransferableBuffer<T extends TypedArray>(array: T): { 
  array: T; 
  transferList: ArrayBuffer[] 
} {
  return {
    array,
    transferList: [array.buffer]
  };
}

// Type helper
type TypedArray = Uint8Array | Uint16Array | Uint32Array | Float32Array | Float64Array;