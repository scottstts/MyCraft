/**
 * Advanced shadow system with cascade shadow mapping
 * Provides high-quality dynamic shadows with performance optimization
 */

import * as THREE from 'three';

export interface ShadowSettings {
  enabled: boolean;
  resolution: number; // 512, 1024, 2048, 4096
  cascades: number; // Number of cascade levels (1-4)
  shadowDistance: number; // Maximum shadow distance
  softness: number; // PCF filtering radius
  bias: number; // Shadow bias to prevent acne
  normalBias: number; // Normal-based bias
  intensity: number; // Shadow intensity (0-1)
}

export class ShadowSystem {
  private renderer: THREE.WebGLRenderer;
  private shadowLight: THREE.DirectionalLight;
  private shadowCameras: THREE.OrthographicCamera[] = [];
  private shadowMaps: THREE.WebGLRenderTarget[] = [];
  private cascadeDistances: number[] = [];
  private dummyTexture: THREE.DataTexture;
  
  private settings: ShadowSettings = {
    enabled: true,
    resolution: 1024,
    cascades: 3,
    shadowDistance: 100,
    softness: 2.5,
    bias: -0.0005,
    normalBias: 0.02,
    intensity: 0.6
  };

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;

    // Create main shadow-casting light
    this.shadowLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.shadowLight.position.set(50, 120, 50);
    this.shadowLight.castShadow = this.settings.enabled;
    
    // Configure shadow properties
    this.shadowLight.shadow.mapSize.width = this.settings.resolution;
    this.shadowLight.shadow.mapSize.height = this.settings.resolution;
    this.shadowLight.shadow.camera.near = 0.5;
    this.shadowLight.shadow.camera.far = this.settings.shadowDistance;
    
    scene.add(this.shadowLight);

    this.initializeCascades();
    this.enableShadowMapping();

    // Create a 1x1 dummy texture to break feedback loops during shadow pass
    this.dummyTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    this.dummyTexture.needsUpdate = true;
  }

  private initializeCascades(): void {
    // Calculate cascade distances (logarithmic distribution)
    this.cascadeDistances = [];
    for (let i = 0; i < this.settings.cascades; i++) {
      const ratio = (i + 1) / this.settings.cascades;
      const distance = this.settings.shadowDistance * Math.pow(ratio, 1.5);
      this.cascadeDistances.push(distance);
    }

    // Create shadow cameras and render targets for each cascade
    this.shadowCameras = [];
    this.shadowMaps = [];
    
    for (let i = 0; i < this.settings.cascades; i++) {
      // Create orthographic camera for this cascade
      const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.5, this.cascadeDistances[i]);
      this.shadowCameras.push(camera);

      // Create shadow map render target
      // Create a valid color render target. We do not attach a depth-only
      // texture here to preserve current sampling behavior (sampler2D of .texture).
      const shadowMap = new THREE.WebGLRenderTarget(
        this.settings.resolution,
        this.settings.resolution,
        {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          stencilBuffer: false
        }
      );
      this.shadowMaps.push(shadowMap);
    }
  }

  private enableShadowMapping(): void {
    // Enable shadow mapping on renderer
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
  }

  /**
   * Update shadow system (call each frame)
   */
  update(camera: THREE.Camera, scene: THREE.Scene): void {
    if (!this.settings.enabled) {
      // Ensure shadows are disabled
      this.shadowLight.castShadow = false;
      this.renderer.shadowMap.enabled = false;
      return;
    }

    // Ensure shadows are enabled
    this.shadowLight.castShadow = true;
    this.renderer.shadowMap.enabled = true;

    // Update main shadow light direction based on sun position
    this.updateShadowLightPosition();

    // Update cascade cameras based on main camera
    this.updateCascadeCameras(camera);

    // Render shadow maps
    this.renderShadowMaps(scene);
  }

  private updateShadowLightPosition(): void {
    // Static sun position for consistent shadows
    this.shadowLight.position.set(50, 120, 50);

    // Update shadow light target
    this.shadowLight.target.position.set(0, 0, 0);
    this.shadowLight.target.updateMatrixWorld();
  }

  private updateCascadeCameras(viewCamera: THREE.Camera): void {
    // Use only the first shadow camera for simplicity and stability
    const camera = this.shadowCameras[0];
    const playerPos = viewCamera.position.clone();
    
    // Fixed shadow camera size based on shadowDistance
    const shadowSize = this.settings.shadowDistance * 0.5;
    camera.left = -shadowSize;
    camera.right = shadowSize;
    camera.top = shadowSize;
    camera.bottom = -shadowSize;
    camera.near = 0.5;
    camera.far = this.settings.shadowDistance * 2; // Generous far plane
    
    // Position shadow camera to look at player from sun direction
    const sunOffset = new THREE.Vector3(50, 120, 50).normalize().multiplyScalar(this.settings.shadowDistance);
    camera.position.copy(playerPos).add(sunOffset);
    camera.lookAt(playerPos);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }


  private renderShadowMaps(scene: THREE.Scene): void {
    const originalRenderTarget = this.renderer.getRenderTarget();

    // Temporarily replace shadow map sampler uniforms to avoid framebuffer-texture feedback loop
    const overrides: Array<{ material: THREE.ShaderMaterial; values: Record<string, any> }> = [];
    scene.traverse(obj => {
      const matAny: any = (obj as any).material;
      const materials: any[] = Array.isArray(matAny) ? matAny : [matAny];
      materials.forEach((mat) => {
        if (mat && mat.isShaderMaterial && mat.uniforms) {
          const u = mat.uniforms as Record<string, { value: any }>;
          const touched: Record<string, any> = {};
          let hasTouch = false;
          ['shadowMap0', 'shadowMap1', 'shadowMap2'].forEach((key) => {
            if (u[key]) {
              touched[key] = u[key].value;
              u[key].value = this.dummyTexture;
              hasTouch = true;
            }
          });
          if (hasTouch) overrides.push({ material: mat, values: touched });
        }
      });
    });

    // Only render the first shadow map for stability
    this.renderer.setRenderTarget(this.shadowMaps[0]);
    this.renderer.render(scene, this.shadowCameras[0]);
    this.renderer.setRenderTarget(originalRenderTarget);

    // Restore original uniforms
    overrides.forEach(({ material, values }) => {
      const u = material.uniforms as Record<string, { value: any }>;
      Object.keys(values).forEach((key) => {
        if (u[key]) u[key].value = values[key];
      });
    });
  }

  /**
   * Get shadow uniforms for shaders
   */
  getShadowUniforms(): { [key: string]: { value: any } } {
    const uniforms: { [key: string]: { value: any } } = {};
    
    // Shadow maps
    for (let i = 0; i < this.settings.cascades; i++) {
      uniforms[`shadowMap${i}`] = { value: this.shadowMaps[i].texture };
      uniforms[`shadowMatrix${i}`] = { 
        value: new THREE.Matrix4()
          .multiply(this.shadowCameras[i].projectionMatrix)
          .multiply(this.shadowCameras[i].matrixWorldInverse)
      };
    }

    // Shadow settings
    uniforms.shadowCascades = { value: this.settings.cascades };
    uniforms.shadowDistances = { value: this.cascadeDistances };
    uniforms.shadowSoftness = { value: this.settings.softness };
    uniforms.shadowBias = { value: this.settings.bias };
    uniforms.shadowNormalBias = { value: this.settings.normalBias };
    uniforms.shadowIntensity = { value: this.settings.enabled ? this.settings.intensity : 0.0 };
    uniforms.shadowResolution = { value: this.settings.resolution };

    return uniforms;
  }

  /**
   * Update shadow settings
   */
  updateSettings(newSettings: Partial<ShadowSettings>): void {
    const oldResolution = this.settings.resolution;
    const oldCascades = this.settings.cascades;
    const oldSettings = { ...this.settings };
    
    this.settings = { ...this.settings, ...newSettings };
    
    console.log('[ShadowSystem] Updating settings:', {
      old: oldSettings,
      new: this.settings,
      changes: newSettings
    });

    // Reinitialize if resolution or cascade count changed
    if (oldResolution !== this.settings.resolution || oldCascades !== this.settings.cascades) {
      console.log('[ShadowSystem] Reinitializing cascades due to resolution/cascade change');
      this.dispose();
      this.initializeCascades();
    }
    
    // Recalculate cascade distances if shadowDistance changed
    else if (oldSettings.shadowDistance !== this.settings.shadowDistance) {
      console.log('[ShadowSystem] Recalculating cascade distances due to shadowDistance change');
      this.cascadeDistances = [];
      for (let i = 0; i < this.settings.cascades; i++) {
        const ratio = (i + 1) / this.settings.cascades;
        const distance = this.settings.shadowDistance * Math.pow(ratio, 1.5);
        this.cascadeDistances.push(distance);
      }
    }

    // Update shadow light properties
    this.shadowLight.shadow.mapSize.setScalar(this.settings.resolution);
    this.shadowLight.shadow.camera.far = this.settings.shadowDistance;
    
    // Enable/disable shadow casting and mapping
    this.shadowLight.castShadow = this.settings.enabled;
    this.renderer.shadowMap.enabled = this.settings.enabled;
    
    // Force update shadow maps if enabling
    if (this.settings.enabled) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    
    console.log('[ShadowSystem] Shadow mapping enabled:', this.settings.enabled);
    console.log('[ShadowSystem] Shadow light casting:', this.shadowLight.castShadow);
    console.log('[ShadowSystem] Renderer shadow map enabled:', this.renderer.shadowMap.enabled);
    
    // Update shadow camera properties
    for (let i = 0; i < this.shadowCameras.length; i++) {
      this.shadowCameras[i].far = this.settings.shadowDistance;
      this.shadowCameras[i].updateProjectionMatrix();
    }
  }

  /**
   * Get current settings
   */
  getSettings(): ShadowSettings {
    return { ...this.settings };
  }

  /**
   * Enable/disable shadows
   */
  setEnabled(enabled: boolean): void {
    this.settings.enabled = enabled;
    this.renderer.shadowMap.enabled = enabled;
    this.shadowLight.castShadow = enabled;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.shadowMaps.forEach(shadowMap => shadowMap.dispose());
    this.shadowMaps = [];
    this.shadowCameras = [];
  }
}
