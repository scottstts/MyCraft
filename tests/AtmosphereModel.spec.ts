import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AtmosphereModel } from '../src/engine/render/atmosphere/AtmosphereModel';

describe('shared atmosphere model', () => {
  it('keeps sky and lighting state finite across the complete cycle', () => {
    const model = new AtmosphereModel();
    for (let i = 0; i < 64; i += 1) {
      const t = i / 64;
      const direction = new THREE.Vector3(Math.cos(t * Math.PI * 2), Math.sin(t * Math.PI * 2), 0).normalize();
      const state = model.evaluate(direction);
      for (const value of [
        state.sunElevation,
        state.daylight,
        state.twilight,
        state.night,
        state.sunIntensity,
        state.moonIntensity,
        state.starVisibility,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      for (const color of [state.sunColor, state.sunTransmittance, state.skyZenith, state.skyHorizon, state.skyAerosol, state.skyIrradiance]) {
        expect(color.r).toBeGreaterThanOrEqual(0);
        expect(color.g).toBeGreaterThanOrEqual(0);
        expect(color.b).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(color.r)).toBe(true);
        expect(Number.isFinite(color.g)).toBe(true);
        expect(Number.isFinite(color.b)).toBe(true);
      }
      expect(state.moonDirection.dot(state.sunDirection)).toBeCloseTo(-1, 5);
    }
  });

  it('transitions from a bright blue noon to a dark, star-visible midnight', () => {
    const model = new AtmosphereModel();
    const noon = model.evaluate(new THREE.Vector3(0, 1, 0));
    expect(noon.daylight).toBeCloseTo(1);
    expect(noon.starVisibility).toBeCloseTo(0);
      expect(noon.skyZenith.b).toBeGreaterThan(noon.skyZenith.r);
      expect(noon.skyAerosolStrength).toBeGreaterThan(0);
      const noonZenithR = noon.skyZenith.r;
      const noonAerosolStrength = noon.skyAerosolStrength;

    const midnight = model.evaluate(new THREE.Vector3(0, -1, 0));
    expect(midnight.night).toBeCloseTo(1);
    expect(midnight.starVisibility).toBeCloseTo(1);
      expect(midnight.skyZenith.r).toBeLessThan(noonZenithR);
      expect(midnight.skyAerosolStrength).toBeLessThan(noonAerosolStrength);
  });
});
