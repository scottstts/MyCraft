/**
 * Module: config/constants
 * Purpose: Centralized tunable constants for world, player, and rendering.
 * Callers: Engine systems, math helpers, and tests import these values.
 * Invariants: Values are read-only at runtime.
 */

export const CHUNK_SIZE = { x: 16, y: 64, z: 16 } as const;

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

export type ChunkSize = typeof CHUNK_SIZE;

