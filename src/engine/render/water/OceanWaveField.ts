/**
 * Shared authored wave field for the WebGL ocean.
 *
 * The same constants are consumed by the CPU camera/diagnostic helpers and
 * emitted into the water vertex/fragment shaders.  This is intentionally an
 * analytic wave field rather than an FFT simulation: the game renderer is a
 * WebGL path and the water feature must stay bounded and inspectable.
 */

export interface OceanWave {
  directionX: number;
  directionZ: number;
  amplitude: number;
  wavelength: number;
  steepness: number;
  speed: number;
}

export const OCEAN_WAVES: readonly OceanWave[] = [
  // Two aligned long swells establish the broad sea state.
  { directionX: 0.94, directionZ: 0.32, amplitude: 0.34, wavelength: 32.0, steepness: 0.46, speed: 0.96 },
  { directionX: 0.88, directionZ: 0.47, amplitude: 0.22, wavelength: 24.0, steepness: 0.44, speed: 0.94 },
  // A cross swell prevents the surface from reading as one repeating train.
  { directionX: -0.42, directionZ: 0.91, amplitude: 0.20, wavelength: 19.0, steepness: 0.42, speed: 1.03 },
  { directionX: -0.55, directionZ: 0.83, amplitude: 0.13, wavelength: 15.0, steepness: 0.36, speed: 1.08 },
  // Shorter chop breaks up the swell without leaving the one-voxel envelope.
  { directionX: 0.78, directionZ: -0.52, amplitude: 0.11, wavelength: 12.0, steepness: 0.38, speed: 1.10 },
  { directionX: 0.62, directionZ: -0.68, amplitude: 0.08, wavelength: 9.0, steepness: 0.31, speed: 1.14 },
  { directionX: -0.35, directionZ: -0.78, amplitude: 0.07, wavelength: 8.0, steepness: 0.28, speed: 0.92 },
  { directionX: 0.55, directionZ: 0.62, amplitude: 0.05, wavelength: 6.5, steepness: 0.24, speed: 0.86 },
];

const GRAVITY = 9.81;
/** One voxel contains the complete visual wave envelope. */
export const OCEAN_WATER_CENTER_OFFSET = 0.5;
export const OCEAN_WAVE_HALF_RANGE = 0.5;
const RAW_MAX_AMPLITUDE = OCEAN_WAVES.reduce((sum, wave) => sum + Math.abs(wave.amplitude), 0);
/** Scales the authored spectrum so even the theoretical in-phase sum fits. */
export const OCEAN_WAVE_HEIGHT_SCALE = OCEAN_WAVE_HALF_RANGE / RAW_MAX_AMPLITUDE;

export function sampleOceanHeight(x: number, z: number, timeSeconds: number): number {
  let height = 0;
  for (const wave of OCEAN_WAVES) {
    const k = (Math.PI * 2) / wave.wavelength;
    const omega = Math.sqrt(GRAVITY * k) * wave.speed;
    const phase = k * (wave.directionX * x + wave.directionZ * z) - omega * timeSeconds;
    height += wave.amplitude * OCEAN_WAVE_HEIGHT_SCALE * Math.sin(phase);
  }
  return Math.max(-OCEAN_WAVE_HALF_RANGE, Math.min(OCEAN_WAVE_HALF_RANGE, height));
}

export function sampleOceanDisplacement(x: number, z: number, timeSeconds: number): { x: number; y: number; z: number } {
  let dx = 0;
  let dy = 0;
  let dz = 0;
  for (const wave of OCEAN_WAVES) {
    const k = (Math.PI * 2) / wave.wavelength;
    const omega = Math.sqrt(GRAVITY * k) * wave.speed;
    const phase = k * (wave.directionX * x + wave.directionZ * z) - omega * timeSeconds;
    const c = Math.cos(phase);
    const amplitude = wave.amplitude * OCEAN_WAVE_HEIGHT_SCALE;
    dx += wave.directionX * wave.steepness * amplitude * c;
    dz += wave.directionZ * wave.steepness * amplitude * c;
    dy += amplitude * Math.sin(phase);
  }
  return { x: dx, y: Math.max(-OCEAN_WAVE_HALF_RANGE, Math.min(OCEAN_WAVE_HALF_RANGE, dy)), z: dz };
}

export function getOceanMaxAmplitude(): number {
  return OCEAN_WAVE_HALF_RANGE;
}

/** GLSL declarations shared by the water vertex and fragment programs. */
export function oceanWaveDeclarations(): string {
  return `${OCEAN_WAVES.map((wave, index) => `
    const vec2 OCEAN_WAVE_DIRECTION_${index} = vec2(${wave.directionX.toFixed(6)}, ${wave.directionZ.toFixed(6)});
    const float OCEAN_WAVE_AMPLITUDE_${index} = ${(wave.amplitude * OCEAN_WAVE_HEIGHT_SCALE).toFixed(6)};
    const float OCEAN_WAVE_LENGTH_${index} = ${wave.wavelength.toFixed(6)};
    const float OCEAN_WAVE_STEEPNESS_${index} = ${wave.steepness.toFixed(6)};
    const float OCEAN_WAVE_SPEED_${index} = ${wave.speed.toFixed(6)};
  `).join('\n')}
    const float OCEAN_WAVE_HALF_RANGE = ${OCEAN_WAVE_HALF_RANGE.toFixed(6)};
  `;
}
