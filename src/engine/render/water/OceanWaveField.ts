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
  /** Deterministic phase offset prevents every band cresting at the origin. */
  phase: number;
}

export const OCEAN_WAVES: readonly OceanWave[] = [
  // A directional spectrum is deliberately spread over several headings.
  // The old field put almost all of its energy in one lobe, which read as
  // parallel scan-lines from the playable camera.  These four long swells
  // cross at broad angles before the shorter wind-sea bands are added.
  { directionX: 0.940, directionZ: 0.342, amplitude: 0.230, wavelength: 42.0, steepness: 0.38, speed: 0.82, phase: 0.45 },
  { directionX: 0.719, directionZ: 0.695, amplitude: 0.185, wavelength: 34.0, steepness: 0.35, speed: 0.87, phase: 3.10 },
  { directionX: -0.259, directionZ: 0.966, amplitude: 0.145, wavelength: 29.0, steepness: 0.32, speed: 0.93, phase: 5.30 },
  { directionX: -0.819, directionZ: 0.574, amplitude: 0.120, wavelength: 24.0, steepness: 0.30, speed: 0.98, phase: 1.72 },
  // Wind sea: a broad, lower-energy directional lobe fills the gaps between
  // the swells and gives the surface irregular intersections at mid range.
  { directionX: 0.423, directionZ: 0.906, amplitude: 0.100, wavelength: 20.0, steepness: 0.28, speed: 1.03, phase: 4.42 },
  { directionX: -0.574, directionZ: 0.819, amplitude: 0.078, wavelength: 16.5, steepness: 0.26, speed: 1.08, phase: 0.83 },
  { directionX: 0.906, directionZ: -0.423, amplitude: 0.062, wavelength: 13.5, steepness: 0.24, speed: 1.12, phase: 2.67 },
  { directionX: -0.906, directionZ: -0.423, amplitude: 0.050, wavelength: 11.5, steepness: 0.22, speed: 1.16, phase: 5.75 },
  // Short chop is intentionally multi-directional rather than a single
  // scrolling normal stripe.  Its total energy is still bounded below.
  { directionX: 0.966, directionZ: 0.259, amplitude: 0.044, wavelength: 10.0, steepness: 0.21, speed: 1.18, phase: 1.14 },
  { directionX: 0.259, directionZ: -0.966, amplitude: 0.038, wavelength: 8.5, steepness: 0.19, speed: 1.21, phase: 3.84 },
  { directionX: -0.707, directionZ: -0.707, amplitude: 0.034, wavelength: 7.2, steepness: 0.17, speed: 1.25, phase: 0.26 },
  { directionX: 0.707, directionZ: -0.707, amplitude: 0.029, wavelength: 6.1, steepness: 0.15, speed: 1.28, phase: 4.91 },
  { directionX: -0.966, directionZ: 0.259, amplitude: 0.024, wavelength: 5.2, steepness: 0.14, speed: 1.32, phase: 2.15 },
  { directionX: 0.500, directionZ: 0.866, amplitude: 0.021, wavelength: 4.5, steepness: 0.12, speed: 1.36, phase: 5.28 },
  { directionX: -0.342, directionZ: -0.940, amplitude: 0.017, wavelength: 3.8, steepness: 0.10, speed: 1.40, phase: 0.62 },
  { directionX: 0.866, directionZ: 0.500, amplitude: 0.014, wavelength: 3.3, steepness: 0.08, speed: 1.43, phase: 3.47 },
];

const GRAVITY = 9.81;
/** Effective shelf depth used by the finite-depth dispersion relation. */
export const OCEAN_WATER_DEPTH = 64.0;
/** Surface-tension / density term; only the capillary tail sees it. */
export const OCEAN_SURFACE_TENSION_OVER_DENSITY = 7.4e-5;
/** One voxel contains the complete visual wave envelope. */
export const OCEAN_WATER_CENTER_OFFSET = 0.5;
export const OCEAN_WAVE_HALF_RANGE = 0.5;
const RAW_MAX_AMPLITUDE = OCEAN_WAVES.reduce((sum, wave) => sum + Math.abs(wave.amplitude), 0);
/** Scales the authored spectrum so even the theoretical in-phase sum fits. */
export const OCEAN_WAVE_HEIGHT_SCALE = OCEAN_WAVE_HALF_RANGE / RAW_MAX_AMPLITUDE;

/**
 * Low-frequency domain warp shared by CPU helpers and every water shader.
 * It bends the phase domain (rather than adding a detached colour/noise
 * overlay), so displacement, normals and caustic projection remain one
 * coherent moving surface while the wave trains lose their grid regularity.
 */
export function sampleOceanDomainWarp(x: number, z: number, timeSeconds: number): {
  x: number
  z: number
  dWarpXdx: number
  dWarpZdx: number
  dWarpXdz: number
  dWarpZdz: number
} {
  const phaseA = x * 0.027 + z * 0.019 - timeSeconds * 0.18;
  const phaseB = x * -0.021 + z * 0.031 + timeSeconds * 0.13;
  const phaseC = x * 0.011 + z * -0.037 - timeSeconds * 0.09;
  const a = Math.sin(phaseA);
  const b = Math.cos(phaseB);
  const c = Math.sin(phaseC);
  const dA = Math.cos(phaseA);
  const dB = -Math.sin(phaseB);
  const dC = Math.cos(phaseC);
  return {
    x: 1.65 * (a + 0.62 * b),
    z: 1.35 * (b - 0.70 * c),
    dWarpXdx: 1.65 * (dA * 0.027 + 0.62 * dB * -0.021),
    dWarpZdx: 1.35 * (dB * -0.021 - 0.70 * dC * 0.011),
    dWarpXdz: 1.65 * (dA * 0.019 + 0.62 * dB * 0.031),
    dWarpZdz: 1.35 * (dB * 0.031 - 0.70 * dC * -0.037),
  };
}

/** Smooth, low-frequency wave grouping used as an energy envelope per band. */
function waveGroupEnvelope(x: number, z: number, timeSeconds: number, band: number): number {
  const b = band + 1;
  const a = Math.sin(x * (0.041 + b * 0.0017) + z * (0.027 - b * 0.0011) + timeSeconds * (0.08 + b * 0.006) + b * 1.73);
  const c = Math.sin(x * (-0.023 + b * 0.0013) + z * (0.038 + b * 0.0015) - timeSeconds * (0.055 + b * 0.004) - b * 2.11);
  const d = Math.cos(x * (0.017 - b * 0.0008) - z * (0.031 + b * 0.0012) + timeSeconds * (0.043 + b * 0.003) + b * 0.91);
  const group = Math.max(-1, Math.min(1, a * 0.52 + c * 0.33 + d * 0.15));
  return 0.58 + 0.42 * (0.5 + 0.5 * group);
}

function waveAngularFrequency(wave: OceanWave): number {
  const k = (Math.PI * 2) / wave.wavelength;
  // Finite-depth gravity dispersion plus a small capillary term.  The latter
  // is negligible for swell and keeps the short chop from sharing one clock.
  const gravity = GRAVITY * k * Math.tanh(Math.min(k * OCEAN_WATER_DEPTH, 20));
  const capillary = OCEAN_SURFACE_TENSION_OVER_DENSITY * k * k * k;
  return Math.sqrt(gravity + capillary) * wave.speed;
}

export function sampleOceanHeight(x: number, z: number, timeSeconds: number): number {
  let height = 0;
  const warp = sampleOceanDomainWarp(x, z, timeSeconds);
  const warpedX = x + warp.x;
  const warpedZ = z + warp.z;
  for (let index = 0; index < OCEAN_WAVES.length; index += 1) {
    const wave = OCEAN_WAVES[index];
    const k = (Math.PI * 2) / wave.wavelength;
    const omega = waveAngularFrequency(wave);
    const phase = k * (wave.directionX * warpedX + wave.directionZ * warpedZ) - omega * timeSeconds + wave.phase;
    height += wave.amplitude * OCEAN_WAVE_HEIGHT_SCALE * waveGroupEnvelope(warpedX, warpedZ, timeSeconds, index) * Math.sin(phase);
  }
  return Math.max(-OCEAN_WAVE_HALF_RANGE, Math.min(OCEAN_WAVE_HALF_RANGE, height));
}

export function sampleOceanDisplacement(x: number, z: number, timeSeconds: number): { x: number; y: number; z: number } {
  let dx = 0;
  let dy = 0;
  let dz = 0;
  const warp = sampleOceanDomainWarp(x, z, timeSeconds);
  const warpedX = x + warp.x;
  const warpedZ = z + warp.z;
  for (let index = 0; index < OCEAN_WAVES.length; index += 1) {
    const wave = OCEAN_WAVES[index];
    const k = (Math.PI * 2) / wave.wavelength;
    const omega = waveAngularFrequency(wave);
    const phase = k * (wave.directionX * warpedX + wave.directionZ * warpedZ) - omega * timeSeconds + wave.phase;
    const c = Math.cos(phase);
    const amplitude = wave.amplitude * OCEAN_WAVE_HEIGHT_SCALE * waveGroupEnvelope(warpedX, warpedZ, timeSeconds, index);
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
    const float OCEAN_WAVE_PHASE_${index} = ${wave.phase.toFixed(6)};
  `).join('\n')}
    const float OCEAN_WATER_DEPTH = ${OCEAN_WATER_DEPTH.toFixed(6)};
    const float OCEAN_SURFACE_TENSION_OVER_DENSITY = ${OCEAN_SURFACE_TENSION_OVER_DENSITY.toFixed(9)};
    const float OCEAN_WAVE_HALF_RANGE = ${OCEAN_WAVE_HALF_RANGE.toFixed(6)};

    vec2 oceanDomainWarp(vec2 xz, float time) {
      float phaseA = dot(xz, vec2(0.027, 0.019)) - time * 0.18;
      float phaseB = dot(xz, vec2(-0.021, 0.031)) + time * 0.13;
      float phaseC = dot(xz, vec2(0.011, -0.037)) - time * 0.09;
      float a = sin(phaseA);
      float b = cos(phaseB);
      float c = sin(phaseC);
      return vec2(1.65 * (a + 0.62 * b), 1.35 * (b - 0.70 * c));
    }

    float oceanWaveGroupEnvelope(vec2 xz, float time, float band) {
      float b = band + 1.0;
      float a = sin(xz.x * (0.041 + b * 0.0017) + xz.y * (0.027 - b * 0.0011) + time * (0.08 + b * 0.006) + b * 1.73);
      float c = sin(xz.x * (-0.023 + b * 0.0013) + xz.y * (0.038 + b * 0.0015) - time * (0.055 + b * 0.004) - b * 2.11);
      float d = cos(xz.x * (0.017 - b * 0.0008) - xz.y * (0.031 + b * 0.0012) + time * (0.043 + b * 0.003) + b * 0.91);
      float group = clamp(a * 0.52 + c * 0.33 + d * 0.15, -1.0, 1.0);
      return 0.58 + 0.42 * (0.5 + 0.5 * group);
    }

    void oceanDomainWarpPartials(vec2 xz, float time, out vec2 dWarpDx, out vec2 dWarpDz) {
      vec2 dirA = vec2(0.027, 0.019);
      vec2 dirB = vec2(-0.021, 0.031);
      vec2 dirC = vec2(0.011, -0.037);
      float phaseA = dot(xz, dirA) - time * 0.18;
      float phaseB = dot(xz, dirB) + time * 0.13;
      float phaseC = dot(xz, dirC) - time * 0.09;
      float dA = cos(phaseA);
      float dB = -sin(phaseB);
      float dC = cos(phaseC);
      dWarpDx = vec2(
        1.65 * (dA * dirA.x + 0.62 * dB * dirB.x),
        1.35 * (dB * dirB.x - 0.70 * dC * dirC.x)
      );
      dWarpDz = vec2(
        1.65 * (dA * dirA.y + 0.62 * dB * dirB.y),
        1.35 * (dB * dirB.y - 0.70 * dC * dirC.y)
      );
    }
  `;
}
