/**
 * Module: config/constants
 * Purpose: Centralized tunable constants for world, player, and rendering.
 * Callers: Engine systems, math helpers, and tests import these values.
 * Invariants: Values are read-only at runtime.
 */

// Larger chunk dimensions to make each chunk span a much bigger area
export const CHUNK_SIZE = { x: 48, y: 96, z: 48 } as const;

export const PLAYER = {
  height: 1.8,
  width: 0.6,
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
    // Max step height when climbing out at shoreline
    maxStepOut: 1.25,
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

export type ChunkSize = typeof CHUNK_SIZE;
