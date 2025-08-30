/**
 * World save file types
 */

import type { V3i } from './index.js';

export interface SavedChunk {
  key: string;    // `${cx},${cy},${cz}`
  cx: number;
  cy: number;
  cz: number;
  size: V3i;      // for validation
  voxelsB64: string; // base64 encoded Uint8Array
}

export interface WorldSettings {
  seed: number;
  chunkCount: number; // total chunks (N*N)
  chunkSize: V3i;     // block dimensions (must match current build)
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  worldRadius: number;
}

export interface WorldSavePayload {
  kind: 'MyCraftWorld';
  version: 1;
  meta: { createdAt: string };
  settings: WorldSettings;
  chunks: SavedChunk[];
}

export interface WorldSaveFile extends WorldSavePayload {
  // Signing metadata
  signatureAlg: string;    // e.g., MC-HMAC-SHA256-v1
  signatureB64: string;    // signature over JSON.stringify(payload) bytes
  publicKeyId: string;     // static identifier to verify origin
}

