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
      const shadowMap = new THREE.WebGLRenderTarget(
        this.settings.resolution,
        this.settings.resolution,
        {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.DepthFormat,
          type: THREE.UnsignedIntType,
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
    const viewMatrix = new THREE.Matrix4().copy(viewCamera.matrixWorldInverse);
    const projMatrix = new THREE.Matrix4().copy(viewCamera.projectionMatrix);
    
    for (let i = 0; i < this.settings.cascades; i++) {
      const camera = this.shadowCameras[i];
      const nearDist = i === 0 ? (viewCamera as any).near : this.cascadeDistances[i - 1];
      const farDist = this.cascadeDistances[i];

      // Calculate frustum bounds for this cascade
      const frustumBounds = this.calculateCascadeBounds(
        viewCamera, 
        nearDist, 
        farDist, 
        viewMatrix, 
        projMatrix
      );

      // Position shadow camera to encompass the frustum
      this.positionShadowCamera(camera, frustumBounds);
    }
  }

  private calculateCascadeBounds(
    viewCamera: THREE.Camera,
    near: number,
    far: number,
    viewMatrix: THREE.Matrix4,
    _projMatrix: THREE.Matrix4
  ): { min: THREE.Vector3; max: THREE.Vector3 } {
    // Calculate frustum corners in world space
    const corners = [];
    const aspect = (viewCamera as any).aspect;
    const fov = (viewCamera as any).fov * Math.PI / 180;
    
    // Near plane corners
    const nearHeight = 2 * Math.tan(fov / 2) * near;
    const nearWidth = nearHeight * aspect;
    corners.push(new THREE.Vector3(-nearWidth/2, -nearHeight/2, -near));
    corners.push(new THREE.Vector3(nearWidth/2, -nearHeight/2, -near));
    corners.push(new THREE.Vector3(nearWidth/2, nearHeight/2, -near));
    corners.push(new THREE.Vector3(-nearWidth/2, nearHeight/2, -near));
    
    // Far plane corners
    const farHeight = 2 * Math.tan(fov / 2) * far;
    const farWidth = farHeight * aspect;
    corners.push(new THREE.Vector3(-farWidth/2, -farHeight/2, -far));
    corners.push(new THREE.Vector3(farWidth/2, -farWidth/2, -far));
    corners.push(new THREE.Vector3(farWidth/2, farHeight/2, -far));
    corners.push(new THREE.Vector3(-farWidth/2, farHeight/2, -far));

    // Transform to world space
    const invViewMatrix = new THREE.Matrix4().copy(viewMatrix).invert();
    corners.forEach(corner => corner.applyMatrix4(invViewMatrix));

    // Find bounding box in light space
    const lightView = new THREE.Matrix4().lookAt(
      this.shadowLight.position,
      this.shadowLight.target.position,
      new THREE.Vector3(0, 1, 0)
    );

    corners.forEach(corner => corner.applyMatrix4(lightView));

    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    
    corners.forEach(corner => {
      min.min(corner);
      max.max(corner);
    });

    return { min, max };
  }

  private positionShadowCamera(camera: THREE.OrthographicCamera, bounds: { min: THREE.Vector3; max: THREE.Vector3 }): void {
    camera.left = bounds.min.x;
    camera.right = bounds.max.x;
    camera.top = bounds.max.y;
    camera.bottom = bounds.min.y;
    camera.near = -bounds.max.z - 50; // Add padding
    camera.far = -bounds.min.z + 50;

    camera.position.copy(this.shadowLight.position);
    camera.lookAt(this.shadowLight.target.position);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  private renderShadowMaps(scene: THREE.Scene): void {
    const originalRenderTarget = this.renderer.getRenderTarget();
    
    for (let i = 0; i < this.settings.cascades; i++) {
      this.renderer.setRenderTarget(this.shadowMaps[i]);
      this.renderer.render(scene, this.shadowCameras[i]);
    }

    this.renderer.setRenderTarget(originalRenderTarget);
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