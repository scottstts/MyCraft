/**
 * Three.js WebGL renderer wrapper
 * Inputs: HTMLCanvasElement from CanvasHost
 * Outputs: WebGLRenderer with the shared drawing-buffer policy
 */

import * as THREE from 'three';
import { calculateRendererViewport, type RendererViewport } from './rendererSizing';

type CanvasSyncState = RendererViewport;

// Renderer wrapper for the single supported WebGL backend.
export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });

    // Set the logical size and drawing buffer ratio in one renderer call.
    this.syncCanvasSize(canvas, true);

    // Shared visual settings
    // Keep the fallback clear dark and atmospheric; the analytic dome covers
    // all camera rays in the active WebGL path, but this prevents a bright
    // legacy-sky flash while it is being initialized or if a ray misses it.
    this.renderer.setClearColor(0x101a2d);
    // OutputPass owns the single scene-linear -> display transform. AgX
    // preserves sky gradients and sun highlights more gracefully than the
    // previous ACES + per-material Reinhard/gamma stack.
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // three r179 uses useLegacyLights (false = physically correct)
    // @ts-expect-error - property exists in r179 types
    if ((this.renderer as THREE.WebGLRenderer).useLegacyLights !== undefined) {
      // @ts-expect-error - only WebGLRenderer exposes this
      (this.renderer as THREE.WebGLRenderer).useLegacyLights = false;
    }

    // Terrain and player sun visibility are resolved by the screen-space voxel
    // DDA pass. Native shadow maps remain disabled so there is no second,
    // unsynchronised scene-wide raster grid.
    this.renderer.shadowMap.enabled = false;
  }

  private syncCanvasSize(canvas: HTMLCanvasElement, initial = false): CanvasSyncState | null {
    const viewportWidth = typeof window === 'undefined' ? canvas.clientWidth : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? canvas.clientHeight : window.innerHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      if (!initial) return null;
      const fallbackWidth = Math.max(1, viewportWidth || canvas.clientWidth || 1);
      const fallbackHeight = Math.max(1, viewportHeight || canvas.clientHeight || 1);
      return this.applyCanvasSize(fallbackWidth, fallbackHeight, 1);
    }

    const deviceRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
    const size = calculateRendererViewport(viewportWidth, viewportHeight, deviceRatio);
    return this.applyCanvasSize(size.width, size.height, size.dpr);
  }

  private applyCanvasSize(width: number, height: number, dpr: number): CanvasSyncState {
    const size = calculateRendererViewport(width, height, dpr);
    this.renderer.setDrawingBufferSize(size.width, size.height, size.dpr);
    return size;
  }

  getCanvasSize(): { width: number; height: number } {
    const size = this.renderer.getSize(new THREE.Vector2());
    return { width: size.x, height: size.y };
  }

  getPixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  onResize(): CanvasSyncState | null {
    const canvas = this.renderer.domElement;
    return this.syncCanvasSize(canvas);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
