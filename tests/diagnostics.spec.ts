import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTIC_CAMERA_IDS,
  createDiagnosticCamera,
  getDiagnosticsRequest,
  isLocalDiagnosticsHost,
} from '../src/diagnostics/cameras';

const context = { seed: 12345, worldRadius: 72 };

describe('local diagnostics route', () => {
  it('accepts only localhost with a known camera id', () => {
    expect(getDiagnosticsRequest({ hostname: 'localhost', search: '?debug=1&view=overview' })).toEqual({ view: 'overview' });
    expect(getDiagnosticsRequest({ hostname: '127.0.0.1', search: '?debug=1&view=player-ridge' })).toEqual({ view: 'player-ridge' });
    expect(getDiagnosticsRequest({ hostname: 'mycraft.scottsun.io', search: '?debug=1&view=overview' })).toBeNull();
    expect(getDiagnosticsRequest({ hostname: 'localhost', search: '?debug=0&view=overview' })).toBeNull();
    expect(getDiagnosticsRequest({ hostname: 'localhost', search: '?debug=1&view=unknown' })).toBeNull();
    expect(getDiagnosticsRequest({ hostname: 'localhost', search: '?debug=1&view=overview&time=noon' })).toEqual({ view: 'overview', time: 0.25 });
    expect(getDiagnosticsRequest({ hostname: 'localhost', search: '?debug=1&view=overview&time=1.25' })).toEqual({ view: 'overview', time: 0.25 });
  });

  it('recognizes loopback hosts but not deployed hosts', () => {
    expect(isLocalDiagnosticsHost('localhost')).toBe(true);
    expect(isLocalDiagnosticsHost('127.0.0.1')).toBe(true);
    expect(isLocalDiagnosticsHost('::1')).toBe(true);
    expect(isLocalDiagnosticsHost('[::1]')).toBe(true);
    expect(isLocalDiagnosticsHost('example.com')).toBe(false);
  });
});

describe('diagnostic player cameras', () => {
    it('creates independent cameras with the gameplay projection', () => {
    const cameras = DIAGNOSTIC_CAMERA_IDS.map((id) => createDiagnosticCamera(16 / 9, id, context));
    expect(new Set(cameras).size).toBe(DIAGNOSTIC_CAMERA_IDS.length);
    for (const camera of cameras) {
      expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);
      expect(camera.fov).toBe(70);
      expect(camera.near).toBe(0.01);
      expect(camera.far).toBe(1024);
      expect(camera.rotation.order).toBe('YXZ');
      expect(Number.isFinite(camera.position.x)).toBe(true);
      expect(Number.isFinite(camera.position.y)).toBe(true);
      expect(Number.isFinite(camera.position.z)).toBe(true);
    }
  });
});
