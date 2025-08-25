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
} as const;

export const RENDER = {
  clearColor: 0x0b0d10,
} as const;

export const INTERACTION = {
  // Maximum distance (in blocks) for block selection and interaction
  reach: 5,
} as const;

export type ChunkSize = typeof CHUNK_SIZE;
