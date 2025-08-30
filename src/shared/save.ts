/**
 * Shared save/load helpers for signing and encoding.
 * Note: For simplicity and because strong security is not required,
 * we use an HMAC-SHA256 signature with a fixed secret embedded in code.
 * We expose a publicKeyId constant so loaders can verify origin.
 */

import type { WorldSavePayload } from '../types/save.js';

// Signature constants
export const SAVE_SIGNATURE_ALG = 'MC-HMAC-SHA256-v1';
export const SAVE_PUBLIC_KEY_ID = 'MyCraft-Local-Signing-Key-v1';
// Extremely insecure fixed secret – acceptable per requirements (not for security)
const SAVE_HMAC_SECRET = 'mycraft.local.secret.v1.very-insecure';

// Encryption constants (tamper-evident only; key is embedded)
export const SAVE_ENC_ALG = 'MC-AES-GCM-256-v1';
// 32-byte key in hex (256-bit). Do not change after shipping, or old saves break.
const SAVE_AES_KEY_HEX = 'a1c3f5b7d9e2c4a6b8d0f2e4c6a8b0d2a4c6e8f0b2d4f6a8c0e2f4a6c8e0f2a4';

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

// buildSaveFile removed in v2-only format

// --- AES-GCM helpers ---
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.substr(i, 2), 16);
  }
  return out;
}

async function getEncKey(): Promise<CryptoKey> {
  const raw = hexToBytes(SAVE_AES_KEY_HEX);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptPayload(payload: WorldSavePayload): Promise<{ ivB64: string; cipherB64: string }> {
  const key = await getEncKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = bytesFromString(stringifyStable(payload));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return {
    ivB64: base64FromBytes(iv),
    cipherB64: base64FromBytes(new Uint8Array(ct)),
  };
}

export async function decryptPayload(ivB64: string, cipherB64: string): Promise<WorldSavePayload> {
  const key = await getEncKey();
  const iv = bytesFromBase64(ivB64);
  const ct = bytesFromBase64(cipherB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  const json = new TextDecoder().decode(pt);
  return JSON.parse(json) as WorldSavePayload;
}
