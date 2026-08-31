/**
 * Module: config/constants
 * Purpose: Centralized tunable constants for world, player, and rendering.
 * Callers: Engine systems, math helpers, and tests import these values.
 * Invariants: Values are read-only at runtime.
 */

// Large chunk dimensions are fixed in the build; players choose only the
// number of chunks in the world footprint.
export const CHUNK_SIZE = { x: 64, y: 128, z: 64 } as const;

export const PLAYER = {
  height: 1.8,
  width: 0.6,
  // The default entry view looks away from the original wall-facing spawn.
  // Keep the camera and character body on the same heading at startup.
  initialYaw: Math.PI,
  // Matches the eye anchor in ref/character.html. The visual character's
  // feet sit at the physics base while the eye sits at 1.7 blocks.
  eyeHeight: 1.7,
  speed: {
    walk: 4,
    sprint: 6,
  },
  jump: 8,
  gravity: -24,
  // Water/swimming physics tuning. Units in blocks and seconds.
  swim: {
    // Base acceleration in water (blocks/s^2)
    accel: 14,
    // Extra vertical acceleration when holding space (blocks/s^2)
    verticalAccel: 12,
    // Drag coefficient in water (higher = stronger slowdown per second)
    drag: 3.2,
    // Max cruise speed (blocks/s)
    maxSpeed: 3.6,
    // Sprint multiplier for both acceleration and max speed
    sprintMultiplier: 1.5,
    // Gravity scale in water (fraction of normal gravity)
    gravityScale: 0.18,
    // Upward soft spring towards the surface when near it (for floating feel)
    floatBand: 1.25,          // meters below surface where spring applies
    floatStrength: 4.0,       // spring strength (accel per meter), only slows sinking
    // Attraction to surface while holding space (to “surface”)
    surfaceSnapStrength: 10.0, // accel per meter below surface when space held
    // Small constant sink bias when idle to prevent hovering
    sinkBias: 0.6,
    // Max step height when climbing out at shoreline (on land)
    maxStepOut: 1.25,
    // Max vertical emerge height from water when stepping onto shore
    // Needs to exceed eyeHeight + 1 block (~2.6 for 1.8m tall) to allow
    // getting feet onto the last stair from surface. Keep conservative.
    maxEmergeStepOut: 2.8,
    // Additional headroom above water surface to clear final stair lip when emerging
    // 1.01 = 101% of one block to guarantee >1 block clearance
    stepOutHeadroom: 1.01,
    // Smooth emerge from water: vertical lift speed (blocks/s)
    emergeLiftSpeed: 6.0,
    // Smooth emerge from water: small forward nudge speed (blocks/s)
    emergeNudgeSpeed: 2.4
  }
} as const;

export const RENDER = {
  clearColor: 0x0b0d10,
} as const;

export const INTERACTION = {
  // Maximum distance (in blocks) for block selection and interaction
  reach: 5,
} as const;

// Shared pacing for left/right click actions and arm swing animation.
// Single source of truth so interaction rate and animation sound feel synced.
// Shortened by 1/3 from 0.40s → ~0.2667s
export const SWING_CYCLE_SECONDS = (0.22 + 0.18) * (2 / 3); // ≈ 0.2667s (down + return)

export type ChunkSize = typeof CHUNK_SIZE;
