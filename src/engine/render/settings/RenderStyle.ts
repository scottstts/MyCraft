/**
 * Baked rendering style.  These values are intentionally not part of the
 * player-facing settings surface; they describe one coherent image pipeline.
 */
export const RENDER_STYLE = {
  dayNightCycleSeconds: 1200,
  ssao: {
    enabled: true,
    intensity: 0.35,
    radius: 1.25,
  },
  shadows: {
    enabled: true,
    distance: 300,
    intensity: 1,
  },
  bloom: {
    enabled: true,
    strength: 0.08,
    radius: 0.28,
    threshold: 1.05,
  },
  lens: {
    enabled: true,
    intensity: 0.10,
  },
  exposure: {
    minimum: 0.45,
    maximum: 1.45,
    middleGray: 0.18,
    // A slightly negative bias keeps a small sky-only view from opening the
    // iris and washing the voxel palette. The meter still adapts normally.
    compensation: -0.25,
    speedUp: 3.2,
    speedDown: 1.1,
    meterWidth: 64,
    meterHeight: 36,
    cadenceFrames: 12,
  },
  atmosphere: {
    rayleighScaleHeight: 8.0,
    mieScaleHeight: 1.2,
    rayleighCoefficient: 0.055,
    mieCoefficient: 0.018,
    mieDirectionalG: 0.76,
    absorptionCoefficient: 0.004,
    // Shared sky/ground/water calibration. These are authored scene-linear
    // values, not player-facing controls.
    skyRadianceScale: 1.25,
    aerosolStrength: 0.14,
    aerialPerspectiveStart: 36,
    aerialPerspectiveExtinction: 0.0028,
    aerialPerspectiveMax: 0.72,
  },
} as const;

export type RenderStyle = typeof RENDER_STYLE;
