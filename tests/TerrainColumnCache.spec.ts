import { describe, expect, it, vi } from 'vitest';
import { createTerrainColumnCache } from '../src/engine/world/TerrainColumnCache';
import { createTerrainSampler, getHeightAtPosition } from '../src/engine/world/TerrainGenerator';

describe('TerrainColumnCache', () => {
  it('samples each column once and derives forward slope from cached neighbours', () => {
    const sample = vi.fn((x: number, z: number) => ({
      height: x * 10 + z,
      isLand: (x + z) % 2 === 0,
    }));
    const cache = createTerrainColumnCache(sample, {
      minX: -1,
      maxX: 2,
      minZ: 3,
      maxZ: 5,
    });

    expect(sample).toHaveBeenCalledTimes(4 * 3);
    expect(cache(0, 4)).toEqual({ height: 4, isLand: true, slope: 10 });
    expect(cache(-1, 3)).toEqual({ height: -7, isLand: true, slope: 10 });
    expect(sample).toHaveBeenCalledTimes(4 * 3);
    expect(cache(0, 4)).toBe(cache(0, 4));
  });

  it('rejects non-integral and out-of-range column requests', () => {
    const cache = createTerrainColumnCache(() => ({ height: 1, isLand: true }), {
      minX: 0,
      maxX: 1,
      minZ: 0,
      maxZ: 1,
    });

    expect(() => cache(0.5, 0)).toThrow(RangeError);
    expect(() => cache(2, 0)).toThrow(RangeError);
    expect(() => cache(0, -1)).toThrow(RangeError);
  });

  it('keeps the cached terrain sampler bit-for-bit compatible with height queries', () => {
    const seed = 1234;
    const radius = 96;
    const sampler = createTerrainSampler(seed, radius);
    for (const [x, z] of [[-64, -32], [-1, 0], [0, 0], [17, 23], [96, -41]]) {
      expect(sampler(x, z).height).toBe(getHeightAtPosition(x, z, seed, radius));
    }
  });
});
