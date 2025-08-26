/**
 * SunController: Time-of-day driven sun + minimal night ambient
 * - Owns a DirectionalLight (sun) and a HemisphereLight (night fallback)
 * - Advances time with a configurable cycle length (default 180s)
 * - Exposes sun direction/color and elevation
 */
import * as THREE from 'three';

export interface SunControllerOptions {
  cycleSeconds?: number; // default 180
  paused?: boolean;
  initialTime?: number; // [0,1)
}

export class SunController {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;

  private t: number = 0; // [0,1)
  private paused: boolean = false;
  private cycleSeconds: number = 180;
  private sunDir: THREE.Vector3 = new THREE.Vector3(1, 1, 1).normalize();
  private sunColor: THREE.Color = new THREE.Color(0xffffff);

  constructor(scene: THREE.Scene, opts: SunControllerOptions = {}) {
    this.cycleSeconds = opts.cycleSeconds ?? 180;
    this.paused = !!opts.paused;
    this.t = (opts.initialTime ?? 0.25) % 1; // default morning

    // Directional sun light
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sun.castShadow = false; // Shadow maps handled by ShadowSystem
    scene.add(this.sun);

    // Minimal hemisphere for night readability
    this.hemi = new THREE.HemisphereLight(0x223344, 0x101010, 0.05);
    this.hemi.position.set(0, 1, 0);
    scene.add(this.hemi);

    // Initialize
    this.recomputeLighting();
  }

  update(dtSeconds: number): void {
    if (!this.paused) {
      const deltaT = dtSeconds / Math.max(1e-3, this.cycleSeconds);
      this.t = (this.t + deltaT) % 1;
      this.recomputeLighting();
    }
  }

  setTime(t: number): void {
    // clamp-wrap
    this.t = ((t % 1) + 1) % 1;
    this.recomputeLighting();
  }

  pause(p: boolean): void {
    this.paused = p;
  }

  setCycleSeconds(sec: number): void {
    this.cycleSeconds = Math.max(1, sec | 0);
  }

  getTime(): number { return this.t; }
  isPaused(): boolean { return this.paused; }

  getSunDirection(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.sunDir);
  }

  getSunColor(target: THREE.Color = new THREE.Color()): THREE.Color {
    return target.copy(this.sunColor);
  }

  getElevationRadians(): number {
    // Map t ∈ [0,1) to elevation via sin(2πt)
    return Math.asin(Math.sin(this.t * Math.PI * 2));
  }

  private recomputeLighting(): void {
    // Fixed azimuth (east->west along +X), elevation by sin
    const theta = this.t * Math.PI * 2; // 0..2pi
    const elevation = Math.sin(theta); // -1..1, where >0 is above horizon

    // Sun direction in world space (unit)
    // Choose azimuth so the sun travels roughly along +X with some Z offset
    const azimuth = Math.PI * 0.25; // 45°
    const y = Math.max(0, elevation); // clamp below horizon
    const horiz = Math.sqrt(Math.max(0, 1 - y * y));
    this.sunDir.set(
      Math.cos(azimuth) * horiz,
      y,
      Math.sin(azimuth) * horiz,
    ).normalize();

    // Update sun light position far along its direction and target to origin
    const dist = 500; // far enough for consistent lighting
    this.sun.position.copy(this.sunDir).multiplyScalar(dist);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();

    // Compute a plausible sun color by elevation
    this.sunColor.copy(elevationToSunColor(y));

    // Intensity: brighter mid-day, near-zero at night
    const intensity = THREE.MathUtils.lerp(0.0, 1.1, smoothStep(0.0, 0.7, y));
    this.sun.intensity = intensity;
    this.sun.color.copy(this.sunColor);

    // Night ambient via hemi
    const nightAmt = 1.0 - smoothStep(0.05, 0.2, y);
    this.hemi.intensity = THREE.MathUtils.lerp(0.05, 0.15, nightAmt);
    this.hemi.color.setRGB(0.16, 0.20, 0.26);
    this.hemi.groundColor.setRGB(0.05, 0.05, 0.06);
  }
}

function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / Math.max(1e-5, (edge1 - edge0)), 0, 1);
  return t * t * (3 - 2 * t);
}

function elevationToSunColor(y: number): THREE.Color {
  // y ∈ [0,1]; low elevation -> warmer
  // Simple gradient between warm horizon and neutral white
  const warm = new THREE.Color(1.0, 0.58, 0.25); // deep orange
  const mid = new THREE.Color(1.0, 0.95, 0.90); // warm white
  const cool = new THREE.Color(1.0, 1.0, 0.98); // nearly neutral

  // Two-stage blend for a smoother transition
  const tWarm = smoothStep(0.0, 0.25, y); // 0 near horizon
  const tCool = smoothStep(0.25, 0.8, y); // 0 at low, 1 near mid-high

  const c1 = warm.clone().lerp(mid, tWarm);
  const c2 = mid.clone().lerp(cool, tCool);
  return c1.lerp(c2, tCool);
}

