/**
 * Module: config/flags
 * Purpose: Feature flags toggling optional and WIP behaviors.
 * Callers: Engine bootstrap, systems, and workers read these once at boot.
 * Invariants: Flags are immutable at runtime; adjust here and rebuild.
 */

export const USE_WORKERS = true;
export const USE_GREEDY_MESH = false;
export const SHOW_CHUNK_BOUNDS = false;
export const ENABLE_NOCLIP = false;
export const CHUNK_RADIUS = 6;
export const USE_OCEAN_HORIZON = true;
