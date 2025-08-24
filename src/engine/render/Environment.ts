/**
 * Environment mapping for realistic material reflections
 * Creates procedural skybox and environment maps
 */

import * as THREE from 'three';

export class Environment {
  private envMap: THREE.CubeTexture | null = null;
  private pmremGenerator: THREE.PMREMGenerator | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
  }

  /**
   * Create a simple procedural environment map
   */
  createEnvironmentMap(): THREE.CubeTexture {
    if (this.envMap) {
      return this.envMap;
    }

    // Create a simple gradient sky environment
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Create sky gradient (top to bottom: sky blue to horizon)
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, '#87CEEB'); // Sky blue
    gradient.addColorStop(0.7, '#B0E0E6'); // Powder blue
    gradient.addColorStop(1, '#F0F8FF'); // Alice blue (horizon)

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // Create cube faces (same gradient for all faces for simplicity)
    const images = [];
    for (let i = 0; i < 6; i++) {
      const faceCanvas = document.createElement('canvas');
      faceCanvas.width = size;
      faceCanvas.height = size;
      const faceCtx = faceCanvas.getContext('2d')!;
      faceCtx.drawImage(canvas, 0, 0);
      images.push(faceCanvas);
    }

    this.envMap = new THREE.CubeTexture(images);
    this.envMap.needsUpdate = true;
    this.envMap.format = THREE.RGBAFormat;
    this.envMap.type = THREE.UnsignedByteType;
    this.envMap.generateMipmaps = false; // Disable mipmaps to avoid the WebGL error
    this.envMap.minFilter = THREE.LinearFilter;
    this.envMap.magFilter = THREE.LinearFilter;
    this.envMap.wrapS = THREE.ClampToEdgeWrapping;
    this.envMap.wrapT = THREE.ClampToEdgeWrapping;

    return this.envMap;
  }

  /**
   * Get processed environment map for materials
   */
  getEnvironmentMap(): THREE.CubeTexture | null {
    return this.envMap;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.envMap) {
      this.envMap.dispose();
      this.envMap = null;
    }
    if (this.pmremGenerator) {
      this.pmremGenerator.dispose();
      this.pmremGenerator = null;
    }
  }
}