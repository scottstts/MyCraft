/**
 * Three.js WebGL renderer wrapper
 * Inputs: HTMLCanvasElement from CanvasHost
 * Outputs: WebGLRenderer with proper setup for pixel art rendering
 */

import * as THREE from 'three';

export class Renderer {
  private renderer: THREE.WebGLRenderer;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance'
    });

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x87CEEB); // Sky blue background
    
    // Enhanced rendering settings for better materials
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // three r179 uses useLegacyLights (false = physically correct)
    // @ts-expect-error - property exists in r179 types
    this.renderer.useLegacyLights = false;
    
    // Optional: Enable shadow mapping (will be used in Phase 4)
    this.renderer.shadowMap.enabled = false; // Will enable in Phase 4
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    this.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  getCanvasSize(): { width: number; height: number } {
    const size = this.renderer.getSize(new THREE.Vector2());
    return { width: size.x, height: size.y };
  }

  onResize(): void {
    const canvas = this.renderer.domElement;
    this.setSize(canvas.clientWidth, canvas.clientHeight);
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
