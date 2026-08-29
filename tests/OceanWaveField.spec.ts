import { describe, expect, it } from 'vitest';
import {
  OCEAN_WATER_CENTER_OFFSET,
  OCEAN_WAVE_HALF_RANGE,
  getOceanMaxAmplitude,
  sampleOceanHeight,
} from '../src/engine/render/water/OceanWaveField';

describe('bounded ocean wave field', () => {
  it('keeps every sampled surface inside one voxel around its half-block center', () => {
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (let time = 0; time < 32; time += 1) {
      for (let x = -160; x <= 160; x += 8) {
        for (let z = -160; z <= 160; z += 8) {
          const height = sampleOceanHeight(x, z, time * 0.37);
          minimum = Math.min(minimum, height);
          maximum = Math.max(maximum, height);
        }
      }
    }

    expect(getOceanMaxAmplitude()).toBe(OCEAN_WAVE_HALF_RANGE);
    expect(OCEAN_WATER_CENTER_OFFSET).toBe(0.5);
    expect(minimum).toBeGreaterThanOrEqual(-OCEAN_WAVE_HALF_RANGE);
    expect(maximum).toBeLessThanOrEqual(OCEAN_WAVE_HALF_RANGE);
    expect(maximum - minimum).toBeLessThanOrEqual(1.0);
  });
});
