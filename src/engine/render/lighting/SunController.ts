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
  enableShadows?: boolean;
}

export interface ShadowSettings {
  enabled: boolean;
  resolution: number;
  shadowDistance: number;
  softness: number;
  bias: number;
  normalBias: number;
  intensity: number;
}

export interface ShadowBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
}

const DEFAULT_SHADOW_SETTINGS: ShadowSettings = {
  enabled: true,
  resolution: 2048,
  shadowDistance: 300,
  softness: 1.0,
  // Native WebGL shadow comparison adds this value to receiver depth. A
  // positive value pushes receivers farther from the light and worsens acne.
  bias: -0.0001,
  normalBias: 0.02,
  intensity: 1.0,
};

const TWO_PI = Math.PI * 2;

export class SunController {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;

  private t: number = 0; // [0,1)
  private paused: boolean = false;
  private cycleSeconds: number = 180;
  private sunDir: THREE.Vector3 = new THREE.Vector3(1, 1, 1).normalize();
  private sunColor: THREE.Color = new THREE.Color(0xffffff);
  private readonly shadowsSupported: boolean;
  private shadowSettings: ShadowSettings = { ...DEFAULT_SHADOW_SETTINGS };
  private shadowBounds: Required<ShadowBounds> = {
    minX: -48,
    maxX: 48,
    minY: 0,
    maxY: 96,
    minZ: -48,
    maxZ: 48,
  };
  private shadowFocus = new THREE.Vector3(0, 48, 0);
  private shadowDirty = true;
  // Keep authored lighting smooth, but do not rebuild the native map for
  // sub-texel angular motion. This is the angular equivalent of snapping a
  // camera-following shadow projection to its texel grid.
  private shadowSunDirection = new THREE.Vector3(1, 1, 1).normalize();
  private shadowTheta = Number.NaN;
  private readonly east = new THREE.Vector3(Math.cos(Math.PI * 0.25), 0, Math.sin(Math.PI * 0.25));
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly shadowDirectionCandidate = new THREE.Vector3();

  constructor(scene: THREE.Scene, opts: SunControllerOptions = {}) {
    this.cycleSeconds = opts.cycleSeconds ?? 180;
    this.paused = !!opts.paused;
    this.t = (opts.initialTime ?? 0.25) % 1; // default morning
    this.shadowsSupported = opts.enableShadows ?? true;

    // Directional sun light
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sun.castShadow = this.shadowsSupported && this.shadowSettings.enabled;
    this.sun.shadow.autoUpdate = false;
    this.sun.shadow.mapSize.set(this.shadowSettings.resolution, this.shadowSettings.resolution);
    this.sun.shadow.radius = this.shadowSettings.softness;
    this.sun.shadow.bias = this.shadowSettings.bias;
    this.sun.shadow.normalBias = this.shadowSettings.normalBias;
    this.sun.shadow.intensity = this.shadowSettings.intensity;
    scene.add(this.sun);
    // DirectionalLight uses this object when computing both illumination and
    // its shadow camera. It must be in the scene graph for non-default targets.
    scene.add(this.sun.target);

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
    // A direct user edit should update the shadow immediately. The running
    // cycle uses the quantized path below and therefore remains stable.
    this.recomputeLighting(true);
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

  /**
   * Set a fixed receiver/caster region for the native directional shadow.
   * The world is finite, so keeping this projection fixed avoids the
   * fractional-texel motion and shadow crawling caused by camera-following
   * shadow boxes.
   */
  setShadowBounds(bounds: ShadowBounds): void {
    this.shadowBounds = {
      minX: Math.min(bounds.minX, bounds.maxX),
      maxX: Math.max(bounds.minX, bounds.maxX),
      minY: Math.min(bounds.minY ?? 0, bounds.maxY ?? 96),
      maxY: Math.max(bounds.minY ?? 0, bounds.maxY ?? 96),
      minZ: Math.min(bounds.minZ, bounds.maxZ),
      maxZ: Math.max(bounds.minZ, bounds.maxZ),
    };
    this.shadowFocus.set(
      (this.shadowBounds.minX + this.shadowBounds.maxX) * 0.5,
      (this.shadowBounds.minY + this.shadowBounds.maxY) * 0.5,
      (this.shadowBounds.minZ + this.shadowBounds.maxZ) * 0.5,
    );
    this.updateShadowTransform();
    this.markShadowNeedsUpdate();
  }

  setShadowSettings(settings: Partial<ShadowSettings>): void {
    const previous = { ...this.shadowSettings };
    if (settings.enabled !== undefined) this.shadowSettings.enabled = !!settings.enabled;
    if (settings.resolution !== undefined) this.shadowSettings.resolution = normalizeShadowResolution(settings.resolution);
    if (settings.shadowDistance !== undefined) this.shadowSettings.shadowDistance = THREE.MathUtils.clamp(settings.shadowDistance, 50, 2000);
    if (settings.softness !== undefined) this.shadowSettings.softness = THREE.MathUtils.clamp(settings.softness, 0, 8);
    if (settings.bias !== undefined) this.shadowSettings.bias = THREE.MathUtils.clamp(settings.bias, -0.01, 0.01);
    if (settings.normalBias !== undefined) this.shadowSettings.normalBias = THREE.MathUtils.clamp(settings.normalBias, 0, 1);
    if (settings.intensity !== undefined) this.shadowSettings.intensity = THREE.MathUtils.clamp(settings.intensity, 0, 1);

    this.sun.castShadow = this.shadowsSupported && this.shadowSettings.enabled;
    this.sun.shadow.mapSize.set(this.shadowSettings.resolution, this.shadowSettings.resolution);
    this.sun.shadow.radius = this.shadowSettings.softness;
    this.sun.shadow.bias = this.shadowSettings.bias;
    this.sun.shadow.normalBias = this.shadowSettings.normalBias;
    this.sun.shadow.intensity = this.shadowSettings.intensity;

    // Three creates the native target lazily and does not recreate an
    // existing target just because mapSize changed. Dispose that target so a
    // runtime resolution change is applied on the next shadow render.
    if (previous.resolution !== this.shadowSettings.resolution && this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }

    const changed =
      previous.enabled !== this.shadowSettings.enabled ||
      previous.resolution !== this.shadowSettings.resolution ||
      previous.shadowDistance !== this.shadowSettings.shadowDistance ||
      previous.softness !== this.shadowSettings.softness ||
      previous.bias !== this.shadowSettings.bias ||
      previous.normalBias !== this.shadowSettings.normalBias ||
      previous.intensity !== this.shadowSettings.intensity;
    if (changed) {
      this.updateShadowTransform();
      this.markShadowNeedsUpdate();
    }
  }

  getShadowSettings(): ShadowSettings {
    return { ...this.shadowSettings };
  }

  markShadowNeedsUpdate(): void {
    this.shadowDirty = true;
  }

  consumeShadowDirty(): boolean {
    const dirty = this.shadowDirty;
    this.shadowDirty = false;
    return dirty;
  }

  dispose(): void {
    this.sun.dispose();
    this.hemi.dispose();
    this.sun.parent?.remove(this.sun);
    this.sun.target.parent?.remove(this.sun.target);
    this.hemi.parent?.remove(this.hemi);
  }

  private recomputeLighting(forceShadowUpdate = false): void {
    // Parametric sun path: rotate in the plane spanned by world up and an east vector
    // t in [0,1) -> theta in [0, 2π); theta=π/2 ≈ zenith (default initialTime=0.25)
    const theta = this.t * TWO_PI;

    // Sun direction on the unit circle in the east-up plane
    this.sunDir.copy(this.east).multiplyScalar(Math.cos(theta)).addScaledVector(this.up, Math.sin(theta)).normalize();

    // Advance the native shadow projection only when the authored sun has
    // moved by roughly two shadow texels at the edge of the map. An
    // orthographic map's texel width is 2 * extent / resolution; rotating a
    // point at radius extent by 4 / resolution moves it by roughly two of
    // those texels. Re-rendering a PCF depth map at every simulation frame
    // causes its hard comparisons to crawl/flicker even when the camera is
    // stationary.
    const shadowStep = 4 / Math.max(256, this.shadowSettings.resolution);
    const quantizedTheta = Math.round(theta / shadowStep) * shadowStep;
    this.shadowDirectionCandidate
      .copy(this.east)
      .multiplyScalar(Math.cos(quantizedTheta))
      .addScaledVector(this.up, Math.sin(quantizedTheta))
      .normalize();

    const directionChanged =
      forceShadowUpdate ||
      !Number.isFinite(this.shadowTheta) ||
      this.shadowSunDirection.dot(this.shadowDirectionCandidate) < 1 - 1e-10;
    if (directionChanged) {
      this.shadowTheta = quantizedTheta;
      this.shadowSunDirection.copy(this.shadowDirectionCandidate);
      this.updateShadowTransform(this.shadowSunDirection);
      this.markShadowNeedsUpdate();
    }

    // Keep the target's world matrix current even on frames where the
    // quantized shadow projection is intentionally held.
    this.sun.target.updateMatrixWorld();

    // Elevation for color/intensity control (clamped to [0,1] for day metrics)
    const y = Math.sin(theta);
    const yDay = THREE.MathUtils.clamp(y, 0, 1);

    // Compute a plausible sun color by elevation
    this.sunColor.copy(elevationToSunColor(yDay));

    // Intensity: brighter mid-day, near-zero at night
    const intensity = THREE.MathUtils.lerp(0.0, 1.1, smoothStep(0.0, 0.7, yDay));
    this.sun.intensity = intensity;
    this.sun.color.copy(this.sunColor);

    // Night ambient via hemi (stronger when below horizon)
    const nightAmt = 1.0 - smoothStep(0.05, 0.2, yDay);
    this.hemi.intensity = THREE.MathUtils.lerp(0.05, 0.15, nightAmt);
    this.hemi.color.setRGB(0.16, 0.20, 0.26);
    this.hemi.groundColor.setRGB(0.05, 0.05, 0.06);
  }

  private updateShadowTransform(direction: THREE.Vector3 = this.shadowSunDirection): void {
    this.sun.target.position.copy(this.shadowFocus);

    const spanX = this.shadowBounds.maxX - this.shadowBounds.minX;
    const spanY = this.shadowBounds.maxY - this.shadowBounds.minY;
    const spanZ = this.shadowBounds.maxZ - this.shadowBounds.minZ;
    // A bounding sphere projected onto the light's two orthographic axes is
    // conservative for every sun azimuth/elevation, including low sun.
    const extent = Math.max(8, 0.5 * Math.sqrt(spanX * spanX + spanY * spanY + spanZ * spanZ) + 8);
    const lightDistance = Math.max(200, this.shadowSettings.shadowDistance, extent + 32);

    this.sun.position.copy(this.shadowFocus).addScaledVector(direction, lightDistance);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();

    if (!this.shadowsSupported) return;

    const shadowCamera = this.sun.shadow.camera;
    // Use one continuous up axis for this authored sun path. World-Z is never
    // parallel to the path's light direction, including at zenith, so the
    // shadow camera cannot roll-jump when the sun crosses the overhead band.
    shadowCamera.up.set(0, 0, 1);
    shadowCamera.left = -extent;
    shadowCamera.right = extent;
    shadowCamera.top = extent;
    shadowCamera.bottom = -extent;
    shadowCamera.near = Math.max(0.1, lightDistance - extent - 8);
    shadowCamera.far = lightDistance + extent + 8;
    shadowCamera.updateProjectionMatrix();
  }
}

function normalizeShadowResolution(value: number): number {
  const clamped = THREE.MathUtils.clamp(Math.round(value), 256, 4096);
  return 2 ** Math.round(Math.log2(clamped));
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
