/**
 * SunController: continuous time-of-day lighting.
 *
 * Cast visibility is intentionally not owned here. The old implementation
 * coupled this controller to a native directional-light shadow camera and
 * quantized its transform. The terrain/player voxel pass consumes the
 * continuous direction directly, so this class only owns illumination and
 * the small compatibility settings surface used by the debug panel.
 */
import * as THREE from 'three';
import { RENDER_STYLE } from '../settings/RenderStyle';

export interface SunControllerOptions {
  cycleSeconds?: number;
  paused?: boolean;
  initialTime?: number;
  enableShadows?: boolean;
}

/**
 * Compatibility shape for the existing debug panel. Resolution, softness,
 * bias, and normalBias no longer affect a shadow map; voxel visibility has no
 * raster map or depth-bias term. `shadowDistance` and `intensity` remain
 * meaningful to VoxelSunShadowPass/material integration.
 */
export interface ShadowSettings {
  enabled: boolean;
  resolution: number;
  shadowDistance: number;
  softness: number;
  bias: number;
  normalBias: number;
  intensity: number;
}

const DEFAULT_SHADOW_SETTINGS: ShadowSettings = {
  enabled: true,
  resolution: 2048,
  shadowDistance: 300,
  softness: 0,
  bias: 0,
  normalBias: 0,
  intensity: 1,
};

const TWO_PI = Math.PI * 2;

export class SunController {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;

  private t = 0;
  private paused = false;
  private cycleSeconds: number = RENDER_STYLE.dayNightCycleSeconds;
  private sunDir = new THREE.Vector3(1, 1, 1).normalize();
  private sunColor = new THREE.Color(0xffffff);
  private readonly shadowsSupported: boolean;
  private shadowSettings: ShadowSettings = { ...DEFAULT_SHADOW_SETTINGS };
  private readonly east = new THREE.Vector3(Math.cos(Math.PI * 0.25), 0, Math.sin(Math.PI * 0.25));
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, opts: SunControllerOptions = {}) {
    this.cycleSeconds = opts.cycleSeconds ?? RENDER_STYLE.dayNightCycleSeconds;
    this.paused = !!opts.paused;
    this.t = (opts.initialTime ?? 0.25) % 1;
    this.shadowsSupported = opts.enableShadows ?? true;

    // Keep one directional light for authored illumination and compatibility
    // with any non-voxel scene elements, but never ask Three.js to rasterize a
    // native shadow map. The custom voxel pass owns direct-sun visibility.
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sun.castShadow = false;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x223344, 0x101010, 0.05);
    this.hemi.position.set(0, 1, 0);
    scene.add(this.hemi);

    this.recomputeLighting();
  }

  update(dtSeconds: number): void {
    if (this.paused) return;
    this.t = (this.t + dtSeconds / Math.max(1e-3, this.cycleSeconds)) % 1;
    this.recomputeLighting();
  }

  setTime(t: number): void {
    this.t = ((t % 1) + 1) % 1;
    this.recomputeLighting();
  }

  pause(value: boolean): void { this.paused = value; }
  setCycleSeconds(seconds: number): void { this.cycleSeconds = Math.max(1, seconds | 0); }
  getTime(): number { return this.t; }
  isPaused(): boolean { return this.paused; }
  getSunDirection(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 { return target.copy(this.sunDir); }
  getSunColor(target: THREE.Color = new THREE.Color()): THREE.Color { return target.copy(this.sunColor); }
  getElevationRadians(): number { return Math.asin(Math.sin(this.t * TWO_PI)); }

  /** Keep auxiliary directional-light consumers on the shared atmosphere state. */
  setAtmosphereLighting(color: THREE.Color, intensity: number): void {
    this.sunColor.copy(color);
    this.sun.color.copy(color);
    this.sun.intensity = this.shadowsSupported ? Math.max(0, intensity) : 0;
  }

  /** Compatibility no-op retained for callers that used to fit a shadow map. */
  setShadowBounds(bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY?: number; maxY?: number }): void {
    // Voxel visibility is bounded by VoxelOccupancyVolume, not a light frustum.
    void bounds;
  }

  setShadowSettings(settings: Partial<ShadowSettings>): void {
    if (settings.enabled !== undefined) this.shadowSettings.enabled = !!settings.enabled;
    if (settings.resolution !== undefined) this.shadowSettings.resolution = normalizeShadowResolution(settings.resolution);
    if (settings.shadowDistance !== undefined) this.shadowSettings.shadowDistance = THREE.MathUtils.clamp(settings.shadowDistance, 1, 2000);
    if (settings.softness !== undefined) this.shadowSettings.softness = THREE.MathUtils.clamp(settings.softness, 0, 8);
    if (settings.bias !== undefined) this.shadowSettings.bias = THREE.MathUtils.clamp(settings.bias, -0.01, 0.01);
    if (settings.normalBias !== undefined) this.shadowSettings.normalBias = THREE.MathUtils.clamp(settings.normalBias, 0, 1);
    if (settings.intensity !== undefined) this.shadowSettings.intensity = THREE.MathUtils.clamp(settings.intensity, 0, 1);
  }

  getShadowSettings(): ShadowSettings { return { ...this.shadowSettings }; }

  dispose(): void {
    this.sun.dispose();
    this.hemi.dispose();
    this.sun.parent?.remove(this.sun);
    this.sun.target.parent?.remove(this.sun.target);
    this.hemi.parent?.remove(this.hemi);
  }

  private recomputeLighting(): void {
    const theta = this.t * TWO_PI;
    this.sunDir.copy(this.east)
      .multiplyScalar(Math.cos(theta))
      .addScaledVector(this.up, Math.sin(theta))
      .normalize();

    // Keep the light's conventional direction valid for auxiliary materials;
    // castShadow remains false and no shadow camera is ever updated.
    this.sun.target.position.set(0, 0, 0);
    this.sun.position.copy(this.sunDir).multiplyScalar(100);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();

    const y = Math.sin(theta);
    const yDay = THREE.MathUtils.clamp(y, 0, 1);
    this.sunColor.copy(elevationToSunColor(yDay));
    this.sun.intensity = this.shadowsSupported
      ? THREE.MathUtils.lerp(0.0, 1.1, smoothStep(0.0, 0.7, yDay))
      : 0;
    this.sun.color.copy(this.sunColor);

    const nightAmt = 1.0 - smoothStep(0.05, 0.2, yDay);
    this.hemi.intensity = THREE.MathUtils.lerp(0.05, 0.15, nightAmt);
    this.hemi.color.setRGB(0.16, 0.20, 0.26);
    this.hemi.groundColor.setRGB(0.05, 0.05, 0.06);
  }
}

function normalizeShadowResolution(value: number): number {
  const clamped = THREE.MathUtils.clamp(Math.round(value), 256, 4096);
  return 2 ** Math.round(Math.log2(clamped));
}

function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / Math.max(1e-5, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function elevationToSunColor(y: number): THREE.Color {
  const warm = new THREE.Color(1.0, 0.58, 0.25);
  const mid = new THREE.Color(1.0, 0.95, 0.90);
  const cool = new THREE.Color(1.0, 1.0, 0.98);
  const tWarm = smoothStep(0.0, 0.25, y);
  const tCool = smoothStep(0.25, 0.8, y);
  const c1 = warm.clone().lerp(mid, tWarm);
  const c2 = mid.clone().lerp(cool, tCool);
  return c1.lerp(c2, tCool);
}
