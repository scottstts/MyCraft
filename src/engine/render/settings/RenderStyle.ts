/**
 * Baked rendering style.  These values are intentionally not part of the
 * player-facing settings surface; they describe one coherent image pipeline.
 */
export const RENDER_STYLE = {
  dayNightCycleSeconds: 1200,
  ssao: {
    // Screen-space AO is intentionally disabled. The depth-only pass caused
    // camera-dependent dark regions; voxel/per-vertex AO remains active.
    enabled: false,
    intensity: 0.35,
    radius: 1.25,
  },
  shadows: {
    enabled: true,
    distance: 300,
    intensity: 1,
    character: {
      // Character visibility is evaluated analytically by the screen-space
      // voxel pass. Keep its world reach separate from terrain traversal.
      maxDistance: 32,
    },
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
    // Kept as authored tuning data for compatibility/diagnostics. The active
    // pipeline uses the renderer's fixed toneMappingExposure instead.
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
    aerialPerspectiveStart: 96,
    aerialPerspectiveExtinction: 0.0022,
    aerialPerspectiveMax: 0.72,
    // A view-ray envelope, applied to both sky and finite-depth surfaces, so
    // the ocean/sky boundary shares one 360-degree marine airlight shoulder.
    horizonHazeWidth: 0.26,
    horizonHazeStrength: 1.0,
    // Keep the geometric-horizon blend subtle on nearby receivers; distance
    // haze and the full airlight shoulder still converge farther out.
    horizonHazeNearSurfaceFloor: 0.04,
  },
} as const;

export type RenderStyle = typeof RENDER_STYLE;
