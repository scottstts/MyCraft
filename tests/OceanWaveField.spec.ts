import { describe, expect, it } from 'vitest';
import {
  OCEAN_WAVES,
  OCEAN_WATER_CENTER_OFFSET,
  OCEAN_WAVE_HALF_RANGE,
  OCEAN_WAVE_HEIGHT_SCALE,
  getOceanMaxAmplitude,
  oceanWaveDeclarations,
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

  it('uses a normalized multi-directional spectrum instead of one repeating wave train', () => {
    expect(OCEAN_WAVES.length).toBeGreaterThanOrEqual(40);

    const theoreticalHalfRange = OCEAN_WAVES.reduce(
      (sum, wave) => sum + Math.abs(wave.amplitude * OCEAN_WAVE_HEIGHT_SCALE),
      0,
    );
    const primary = OCEAN_WAVES[0];
    const leastAligned = Math.min(...OCEAN_WAVES.map((wave) =>
      primary.directionX * wave.directionX + primary.directionZ * wave.directionZ,
    ));
    const wavelengths = new Set(OCEAN_WAVES.map((wave) => wave.wavelength));
    const phases = new Set(OCEAN_WAVES.map((wave) => wave.phase));
    const largestEnergyShare = Math.max(...OCEAN_WAVES.map((wave) => Math.abs(wave.amplitude))) /
      OCEAN_WAVES.reduce((sum, wave) => sum + Math.abs(wave.amplitude), 0);
    const longWaveDirections = new Set(OCEAN_WAVES
      .filter((wave) => wave.wavelength >= 30)
      .map((wave) => `${wave.directionX},${wave.directionZ}`));

    expect(theoreticalHalfRange).toBeCloseTo(OCEAN_WAVE_HALF_RANGE, 10);
    expect(leastAligned).toBeLessThan(-0.5);
    expect(wavelengths.size).toBe(OCEAN_WAVES.length);
    expect(phases.size).toBe(OCEAN_WAVES.length);
    expect(largestEnergyShare).toBeLessThan(0.11);
    expect(longWaveDirections.size).toBeGreaterThanOrEqual(12);
    for (const wave of OCEAN_WAVES) {
      expect(Math.hypot(wave.directionX, wave.directionZ)).toBeCloseTo(1, 5);
    }
    expect(oceanWaveDeclarations()).toContain('float oceanWaveLod(float footprint, float wavelength)');
  });
});
