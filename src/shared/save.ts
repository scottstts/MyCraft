/**
 * Shared save/load helpers for signing and encoding.
 * Note: For simplicity and because strong security is not required,
 * we use an HMAC-SHA256 signature with a fixed secret embedded in code.
 * We expose a publicKeyId constant so loaders can verify origin.
 */

import type { WorldSavePayload, WorldSaveFile } from '../types/save.js';

// Signature constants
export const SAVE_SIGNATURE_ALG = 'MC-HMAC-SHA256-v1';
export const SAVE_PUBLIC_KEY_ID = 'MyCraft-Local-Signing-Key-v1';
// Extremely insecure fixed secret – acceptable per requirements (not for security)
const SAVE_HMAC_SECRET = 'mycraft.local.secret.v1.very-insecure';

// Small, deterministic JSON stringify for signing: preserve insertion order
export function stringifyStable(obj: unknown): string {
  // Our objects are constructed in stable property order; just JSON.stringify
  // Arrays remain ordered
  return JSON.stringify(obj);
}

export function bytesFromString(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function base64FromBytes(arr: Uint8Array): string {
  // Browser-safe base64 encoding
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

export function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getHmacKey(): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(SAVE_HMAC_SECRET);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signPayload(payload: WorldSavePayload): Promise<string> {
  const key = await getHmacKey();
  const data = bytesFromString(stringifyStable(payload));
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return base64FromBytes(new Uint8Array(sig));
}

export async function verifyPayload(payload: WorldSavePayload, signatureB64: string): Promise<boolean> {
  const key = await getHmacKey();
  const data = bytesFromString(stringifyStable(payload));
  const sig = bytesFromBase64(signatureB64);
  return crypto.subtle.verify('HMAC', key, sig, data);
}

export function buildSaveFile(payload: WorldSavePayload, signatureB64: string): WorldSaveFile {
  return {
    ...payload,
    signatureAlg: SAVE_SIGNATURE_ALG,
    signatureB64,
    publicKeyId: SAVE_PUBLIC_KEY_ID,
  };
}

