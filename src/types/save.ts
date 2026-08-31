/**
 * World save file types
 */

import type { V3i } from './index.js';

export interface SavedSlot {
  blockId: number | null;
  count: number;
}

export interface SavedInventory {
  slots: SavedSlot[]; // length 9
  selectedSlot: number; // 0..8
}

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
  chunkSize: V3i;     // fixed build dimensions (must match current build)
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  worldRadius: number;
}

export interface WorldSavePayload {
  kind: 'MyCraftWorld';
  version: 2; // encrypted format
  meta: { createdAt: string };
  settings: WorldSettings;
  chunks: SavedChunk[];
  inventory?: SavedInventory; // optional for forward/backward flexibility
}

export interface WorldSaveFile {
  kind: 'MyCraftWorld';
  version: 2;
  // Encrypted payload
  encAlg: string;          // e.g., MC-AES-GCM-256-v1
  ivB64: string;           // base64 12-byte IV
  cipherB64: string;       // base64 ciphertext of JSON.stringify(payload)
  // Signing metadata (signature over plaintext payload)
  signatureAlg: string;
  signatureB64: string;
  publicKeyId: string;
}
