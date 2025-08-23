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

  dispose(): void {
    this.renderer.dispose();
  }
}