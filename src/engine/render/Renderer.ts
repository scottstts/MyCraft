/**
 * Three.js WebGL renderer wrapper
 * Inputs: HTMLCanvasElement from CanvasHost
 * Outputs: WebGLRenderer with proper setup for pixel art rendering
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

const MAX_RENDER_PIXELS = 1_650_000;
const MAX_PIXEL_RATIO = 1.5;
const MIN_PIXEL_RATIO = 1;

type CanvasSyncState = {
  width: number;
  height: number;
  dpr: number;
};

// Renderer wrapper that prefers WebGPU when available, falls back to WebGL.
export class Renderer {
  private renderer: THREE.WebGLRenderer | WebGPURenderer;
  private isWebGPU = false;

  constructor(canvas: HTMLCanvasElement) {
    let renderer: THREE.WebGLRenderer | WebGPURenderer | null = null;
    const preferWebGPU =
      typeof navigator !== 'undefined' &&
      'gpu' in navigator &&
      // opt-in flag to avoid running incompatible ShaderMaterials on WebGPU
      typeof import.meta !== 'undefined' &&
      import.meta.env?.VITE_USE_WEBGPU === 'true';
    if (preferWebGPU) {
      try {
        renderer = new WebGPURenderer({
          canvas,
          antialias: false, // keep pixel-art look; MSAA disabled for consistency
        });
        this.isWebGPU = true;
      } catch (err) {
        console.warn('WebGPU renderer init failed; falling back to WebGL.', err);
      }
    }

    if (!renderer) {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        powerPreference: 'high-performance',
      });
    }

    this.renderer = renderer;

    // Backing store size must be explicit for WebGPU; do it once and on resize.
    this.syncCanvasSize(canvas);

    // Shared visual settings
    this.renderer.setClearColor(0x87ceeb);
    if ('toneMapping' in this.renderer) {
      (this.renderer as THREE.WebGLRenderer).toneMapping = THREE.ACESFilmicToneMapping;
      (this.renderer as THREE.WebGLRenderer).toneMappingExposure = 0.8;
    }
    if ('outputColorSpace' in this.renderer) {
      (this.renderer as THREE.WebGLRenderer).outputColorSpace = THREE.SRGBColorSpace;
    }
    // three r179 uses useLegacyLights (false = physically correct)
    // @ts-expect-error - property exists in r179 types
    if ((this.renderer as THREE.WebGLRenderer).useLegacyLights !== undefined) {
      // @ts-expect-error - only WebGLRenderer exposes this
      (this.renderer as THREE.WebGLRenderer).useLegacyLights = false;
    }

    // Optional shadows (disabled for now)
    if (!this.isWebGPU) {
      const gl = this.renderer as THREE.WebGLRenderer;
      gl.shadowMap.enabled = false;
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
    }
  }

  private syncCanvasSize(canvas: HTMLCanvasElement): CanvasSyncState {
    const width = Math.max(1, canvas.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, canvas.clientHeight || window.innerHeight || 1);
    const cssPixels = Math.max(1, width * height);
    const budgetRatio = Math.sqrt(MAX_RENDER_PIXELS / cssPixels);
    const deviceRatio = window.devicePixelRatio || 1;
    const dpr = Math.max(
      MIN_PIXEL_RATIO,
      Math.min(deviceRatio, MAX_PIXEL_RATIO, budgetRatio)
    );

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);

    return { width, height, dpr };
  }

  setSize(width: number, height: number): void {
    this.syncCanvasSize(this.renderer.domElement);
    this.renderer.setSize(width, height, false);
  }

  getCanvasSize(): { width: number; height: number } {
    const size = this.renderer.getSize(new THREE.Vector2());
    return { width: size.x, height: size.y };
  }

  getPixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  onResize(): CanvasSyncState {
    const canvas = this.renderer.domElement;
    return this.syncCanvasSize(canvas);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  getRenderer(): THREE.WebGLRenderer | WebGPURenderer {
    return this.renderer;
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
