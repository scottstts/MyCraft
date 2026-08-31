import { CAUSTIC_TILE_SIZE } from './WaterOptics'

/**
 * Shared deterministic directional spectrum for the WebGL ocean.
 *
 * The same constants are consumed by the CPU camera/diagnostic helpers and
 * emitted into the water vertex/fragment shaders. This is a discrete spectral
 * cascade rather than a full FFT simulation: the game renderer is a WebGL path
 * and the water feature must stay bounded and inspectable.
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

export interface CausticOceanWave extends OceanWave {
  /** Integer tile cycles keep the bounded optical field C1-periodic. */
  tileCyclesX: number;
  tileCyclesZ: number;
}

export const OCEAN_WAVES: readonly OceanWave[] = [
  // A deterministic quadrature of a broad directional spectrum. No single
  // component owns enough energy to draw a ruler-straight crest train. Close
  // wavelengths in each lobe beat into long, slowly evolving wave groups,
  // while the crossing lobe keeps those groups from spanning the whole sea.
  { directionX: 0.978148, directionZ: 0.207912, amplitude: 0.135, wavelength: 86.0, steepness: 0.34, speed: 1.00, phase: 0.37 },
  { directionX: 0.913545, directionZ: 0.406737, amplitude: 0.115, wavelength: 72.5, steepness: 0.33, speed: 1.01, phase: 4.81 },
  { directionX: 0.996195, directionZ: 0.087156, amplitude: 0.100, wavelength: 63.0, steepness: 0.32, speed: 0.99, phase: 2.16 },
  { directionX: 0.777146, directionZ: 0.629320, amplitude: 0.086, wavelength: 54.0, steepness: 0.31, speed: 1.02, phase: 5.62 },
  { directionX: 0.970296, directionZ: -0.241922, amplitude: 0.073, wavelength: 47.5, steepness: 0.30, speed: 0.98, phase: 1.28 },
  { directionX: 0.615661, directionZ: 0.788011, amplitude: 0.063, wavelength: 41.0, steepness: 0.29, speed: 1.01, phase: 3.43 },
  { directionX: 0.951057, directionZ: 0.309017, amplitude: 0.054, wavelength: 35.5, steepness: 0.28, speed: 1.03, phase: 0.91 },
  { directionX: 0.390731, directionZ: 0.920505, amplitude: 0.046, wavelength: 30.5, steepness: 0.27, speed: 0.99, phase: 5.07 },
  // A lower-energy crossing swell spans a second broad lobe rather than one
  // clean diagonal. Several wavelengths overlap the primary band so their
  // interference survives the same distance LOD.
  { directionX: -0.104528, directionZ: 0.994522, amplitude: 0.085, wavelength: 76.0, steepness: 0.31, speed: 1.00, phase: 2.74 },
  { directionX: -0.469472, directionZ: 0.882948, amplitude: 0.071, wavelength: 61.0, steepness: 0.30, speed: 1.02, phase: 4.12 },
  { directionX: 0.139173, directionZ: 0.990268, amplitude: 0.060, wavelength: 50.5, steepness: 0.29, speed: 0.98, phase: 1.67 },
  { directionX: -0.731354, directionZ: 0.681998, amplitude: 0.050, wavelength: 43.5, steepness: 0.28, speed: 1.01, phase: 5.91 },
  { directionX: -0.309017, directionZ: 0.951057, amplitude: 0.042, wavelength: 37.0, steepness: 0.27, speed: 1.03, phase: 2.35 },
  { directionX: -0.898794, directionZ: 0.438371, amplitude: 0.035, wavelength: 32.0, steepness: 0.26, speed: 0.99, phase: 0.18 },
  // Long-period secondary swell. These oblique modes carry modest energy but
  // survive into the far cascade, so the horizon is not a single primary
  // direction with a short repeating beat layered over it.
  { directionX: -0.707107, directionZ: 0.707107, amplitude: 0.062, wavelength: 118.0, steepness: 0.30, speed: 0.96, phase: 3.06 },
  { directionX: -0.342020, directionZ: 0.939693, amplitude: 0.055, wavelength: 101.0, steepness: 0.29, speed: 1.04, phase: 5.44 },
  { directionX: 0.275637, directionZ: 0.961262, amplitude: 0.049, wavelength: 91.0, steepness: 0.28, speed: 0.97, phase: 1.02 },
  { directionX: -0.970296, directionZ: 0.241922, amplitude: 0.043, wavelength: 82.0, steepness: 0.27, speed: 1.05, phase: 4.26 },
  { directionX: 0.642788, directionZ: -0.766044, amplitude: 0.037, wavelength: 68.0, steepness: 0.26, speed: 0.95, phase: 2.71 },
  { directionX: -0.866025, directionZ: -0.500000, amplitude: 0.031, wavelength: 56.0, steepness: 0.25, speed: 1.02, phase: 0.53 },
  { directionX: 0.500000, directionZ: 0.866025, amplitude: 0.026, wavelength: 45.0, steepness: 0.24, speed: 1.06, phase: 5.09 },
  { directionX: -0.173648, directionZ: -0.984808, amplitude: 0.021, wavelength: 39.5, steepness: 0.23, speed: 0.98, phase: 3.88 },
  // Wind sea: progressively broader directions and lower energy. These bands
  // keep mid-distance normals stochastic after sub-pixel waves have faded.
  { directionX: 0.848048, directionZ: -0.529919, amplitude: 0.040, wavelength: 27.4, steepness: 0.25, speed: 1.01, phase: 3.79 },
  { directionX: 0.829038, directionZ: 0.559193, amplitude: 0.036, wavelength: 24.8, steepness: 0.24, speed: 0.98, phase: 1.11 },
  { directionX: 0.573576, directionZ: -0.819152, amplitude: 0.033, wavelength: 22.6, steepness: 0.23, speed: 1.03, phase: 4.54 },
  { directionX: 0.453990, directionZ: 0.891007, amplitude: 0.030, wavelength: 20.7, steepness: 0.22, speed: 1.00, phase: 2.02 },
  { directionX: 0.990268, directionZ: -0.139173, amplitude: 0.027, wavelength: 19.1, steepness: 0.21, speed: 0.97, phase: 5.36 },
  { directionX: 0.190809, directionZ: 0.981627, amplitude: 0.024, wavelength: 17.8, steepness: 0.20, speed: 1.02, phase: 0.66 },
  { directionX: 0.241922, directionZ: -0.970296, amplitude: 0.022, wavelength: 16.5, steepness: 0.19, speed: 1.04, phase: 3.08 },
  { directionX: -0.819152, directionZ: 0.573576, amplitude: 0.020, wavelength: 15.4, steepness: 0.19, speed: 0.99, phase: 1.49 },
  { directionX: 0.956305, directionZ: 0.292372, amplitude: 0.018, wavelength: 14.4, steepness: 0.18, speed: 1.01, phase: 4.97 },
  { directionX: -0.374607, directionZ: -0.927184, amplitude: 0.016, wavelength: 13.5, steepness: 0.17, speed: 1.03, phase: 2.58 },
  { directionX: -0.559193, directionZ: 0.829038, amplitude: 0.014, wavelength: 12.7, steepness: 0.16, speed: 0.98, phase: 0.43 },
  { directionX: 0.731354, directionZ: -0.681998, amplitude: 0.013, wavelength: 11.9, steepness: 0.16, speed: 1.02, phase: 5.18 },
  { directionX: -0.987688, directionZ: 0.156434, amplitude: 0.012, wavelength: 11.2, steepness: 0.15, speed: 1.00, phase: 2.89 },
  { directionX: 0.529919, directionZ: 0.848048, amplitude: 0.011, wavelength: 10.5, steepness: 0.14, speed: 1.04, phase: 0.97 },
  { directionX: -0.838671, directionZ: -0.544639, amplitude: 0.010, wavelength: 9.9, steepness: 0.14, speed: 0.97, phase: 4.38 },
  { directionX: -0.190809, directionZ: 0.981627, amplitude: 0.009, wavelength: 9.3, steepness: 0.13, speed: 1.01, phase: 1.92 },
  { directionX: -0.017452, directionZ: -0.999848, amplitude: 0.008, wavelength: 8.8, steepness: 0.12, speed: 1.03, phase: 5.77 },
  { directionX: -0.999391, directionZ: -0.034899, amplitude: 0.007, wavelength: 8.3, steepness: 0.11, speed: 0.99, phase: 3.31 },
];

/**
 * Short optical wave bands used by the bounded caustic projection.
 *
 * These components are intentionally not added to the visible ocean mesh:
 * their role is to represent the sub-grid surface slope spectrum that bends
 * sunlight into caustic filaments. Keeping them in the same deterministic
 * wave family gives the optical pass a finite, inspectable source of slope
 * energy instead of a decorative screen-space line mask.
 */
function periodicCausticWave(
  tileCyclesX: number,
  tileCyclesZ: number,
  amplitude: number,
  steepness: number,
  speed: number,
  phase: number,
): CausticOceanWave {
  const cycleLength = Math.hypot(tileCyclesX, tileCyclesZ)
  return {
    directionX: tileCyclesX / cycleLength,
    directionZ: tileCyclesZ / cycleLength,
    amplitude,
    wavelength: CAUSTIC_TILE_SIZE / cycleLength,
    steepness,
    speed,
    phase,
    tileCyclesX,
    tileCyclesZ,
  }
}

export const OCEAN_CAUSTIC_WAVES: readonly CausticOceanWave[] = [
  // A broad, deterministic optical spectrum. Integer wave vectors preserve a
  // seamless C1 field over the 53 m domain, while the co-prime directions and
  // distributed phases prevent one high-energy interference packet from
  // occupying only a small square part of that domain. These are still real
  // surface slopes consumed by Snell projection and the area Jacobian below;
  // no receiver-side line mask is introduced.
  periodicCausticWave(3, 1, 0.0350, 0.20, 0.94, 0.73),
  periodicCausticWave(-3, 4, 0.0280, 0.19, 1.02, 3.18),
  periodicCausticWave(5, -3, 0.0220, 0.18, 1.08, 5.27),
  periodicCausticWave(4, 7, 0.0160, 0.16, 0.88, 1.42),
  periodicCausticWave(-8, 5, 0.0120, 0.15, 1.12, 4.44),
  periodicCausticWave(7, -10, 0.0090, 0.14, 0.96, 2.05),
  periodicCausticWave(-12, 9, 0.0065, 0.12, 1.05, 6.01),
  periodicCausticWave(13, 14, 0.0045, 0.11, 0.91, 3.89),
  periodicCausticWave(-18, 11, 0.0032, 0.10, 1.09, 0.24),
  periodicCausticWave(21, -16, 0.0022, 0.09, 0.98, 4.91),
  periodicCausticWave(-24, -13, 0.0016, 0.08, 1.14, 2.77),
  periodicCausticWave(27, 23, 0.0010, 0.07, 1.01, 5.68),
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
/** Scales the directional spectrum so even the theoretical in-phase sum fits. */
export const OCEAN_WAVE_HEIGHT_SCALE = OCEAN_WAVE_HALF_RANGE / RAW_MAX_AMPLITUDE;

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
  for (const wave of OCEAN_WAVES) {
    const k = (Math.PI * 2) / wave.wavelength;
    const omega = waveAngularFrequency(wave);
    const phase = k * (wave.directionX * x + wave.directionZ * z) - omega * timeSeconds + wave.phase;
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
    const omega = waveAngularFrequency(wave);
    const phase = k * (wave.directionX * x + wave.directionZ * z) - omega * timeSeconds + wave.phase;
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

/** Physical GLSL constants shared by visible and optical wave programs. */
export function oceanPhysicalDeclarations(): string {
  return `
    const float OCEAN_WATER_DEPTH = ${OCEAN_WATER_DEPTH.toFixed(6)};
    const float OCEAN_SURFACE_TENSION_OVER_DENSITY = ${OCEAN_SURFACE_TENSION_OVER_DENSITY.toFixed(9)};
    const float OCEAN_WAVE_HALF_RANGE = ${OCEAN_WAVE_HALF_RANGE.toFixed(6)};
  `
}

/** GLSL declarations shared by the visible water vertex and fragment programs. */
export function oceanWaveDeclarations(): string {
  return `${OCEAN_WAVES.map((wave, index) => `
    const vec2 OCEAN_WAVE_DIRECTION_${index} = vec2(${wave.directionX.toFixed(6)}, ${wave.directionZ.toFixed(6)});
    const float OCEAN_WAVE_AMPLITUDE_${index} = ${(wave.amplitude * OCEAN_WAVE_HEIGHT_SCALE).toFixed(6)};
    const float OCEAN_WAVE_LENGTH_${index} = ${wave.wavelength.toFixed(6)};
    const float OCEAN_WAVE_STEEPNESS_${index} = ${wave.steepness.toFixed(6)};
    const float OCEAN_WAVE_SPEED_${index} = ${wave.speed.toFixed(6)};
    const float OCEAN_WAVE_PHASE_${index} = ${wave.phase.toFixed(6)};
  `).join('\n')}
    ${oceanPhysicalDeclarations()}

    // The resolved grid and the unresolved slope field use the same smooth
    // spectral cutoff. The lower floor transfers a fading band into the
    // material response instead of making it disappear at one screen-space
    // distance, which would turn a bright sun lobe into a horizontal seam.
    float oceanWaveLod(float footprint, float wavelength) {
      float cyclesPerPixel = footprint / max(wavelength, 0.001);
      float fadeStart = wavelength >= 28.0 ? 0.52 : wavelength >= 12.0 ? 0.34 : 0.22;
      float fadeEnd = wavelength >= 28.0 ? 1.25 : wavelength >= 12.0 ? 0.92 : 0.68;
      float resolved = 1.0 - smoothstep(fadeStart, fadeEnd, cyclesPerPixel);
      return mix(0.10, 1.0, resolved);
    }

    // Shared parametric displacement for both rasterization and optical
    // shading. The fragment path supplies the interpolated base-plane
    // position, so view/refraction inputs do not inherit the mesh's triangle
    // interpolation at an inner/outer ocean transition.
    vec3 oceanWaveDisplacement(vec3 worldPosition, float time, float footprint) {
      vec3 displaced = vec3(0.0);
      vec2 xz = worldPosition.xz;
      ${OCEAN_WAVES.map((_, index) => `
        {
          float k = 6.28318530718 / OCEAN_WAVE_LENGTH_${index};
          float depthK = min(k * OCEAN_WATER_DEPTH, 20.0);
          float depthExp = exp(min(2.0 * depthK, 20.0));
          float depthTanh = (depthExp - 1.0) / (depthExp + 1.0);
          float omega = sqrt(max(
            9.81 * k * depthTanh +
            OCEAN_SURFACE_TENSION_OVER_DENSITY * k * k * k,
            0.0
          )) * OCEAN_WAVE_SPEED_${index} * uWaveSpeed;
          float phase = k * dot(OCEAN_WAVE_DIRECTION_${index}, xz) - omega * time + OCEAN_WAVE_PHASE_${index};
          float amplitude = OCEAN_WAVE_AMPLITUDE_${index} * min(uWaveAmp, 1.0) *
            oceanWaveLod(footprint, OCEAN_WAVE_LENGTH_${index});
          float c = cos(phase);
          displaced.xz += OCEAN_WAVE_DIRECTION_${index} * OCEAN_WAVE_STEEPNESS_${index} * amplitude * uWaveChop * c;
          displaced.y += amplitude * sin(phase);
        }
      `).join('\n')}
      displaced.y = clamp(displaced.y, -OCEAN_WAVE_HALF_RANGE, OCEAN_WAVE_HALF_RANGE);
      return displaced;
    }

    // Detail-only domain warp. Macro displacement remains a stationary sum of
    // physical wave components so its analytic derivatives and CPU height
    // query agree exactly. This warp is reserved for sub-grid normal detail
    // and broken shoreline foam.
    vec2 oceanDetailWarp(vec2 xz, float time) {
      float phaseA = dot(xz, vec2(0.027, 0.019)) - time * 0.18;
      float phaseB = dot(xz, vec2(-0.021, 0.031)) + time * 0.13;
      float phaseC = dot(xz, vec2(0.011, -0.037)) - time * 0.09;
      float a = sin(phaseA);
      float b = cos(phaseB);
      float c = sin(phaseC);
      return vec2(1.65 * (a + 0.62 * b), 1.35 * (b - 0.70 * c));
    }
  `;
}

/** GLSL constants for the unresolved optical wave bands. */
export function oceanCausticWaveDeclarations(): string {
  return OCEAN_CAUSTIC_WAVES.map((wave, index) => `
    const vec2 CAUSTIC_WAVE_DIRECTION_${index} = vec2(${wave.directionX.toFixed(6)}, ${wave.directionZ.toFixed(6)});
    const float CAUSTIC_WAVE_AMPLITUDE_${index} = ${wave.amplitude.toFixed(6)};
    const float CAUSTIC_WAVE_LENGTH_${index} = ${wave.wavelength.toFixed(6)};
    const float CAUSTIC_WAVE_STEEPNESS_${index} = ${wave.steepness.toFixed(6)};
    const float CAUSTIC_WAVE_SPEED_${index} = ${wave.speed.toFixed(6)};
    const float CAUSTIC_WAVE_PHASE_${index} = ${wave.phase.toFixed(6)};
  `).join('\n');
}
