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
  // Stabilization: when true, use fixed per-cascade ortho extents snapped to texels
  stableExtents?: boolean;
  // Scale applied to the computed stable extent to ensure coverage (1.0 - 1.2 typical)
  extentScale?: number;
}

export class ShadowSystem {
  private renderer: THREE.WebGLRenderer;
  private shadowLight: THREE.DirectionalLight;
  private shadowCameras: THREE.OrthographicCamera[] = [];
  private shadowMaps: THREE.WebGLRenderTarget[] = [];
  private cascadeDistances: number[] = [];
  private dummyTexture: THREE.DataTexture;
  private sunDir: THREE.Vector3 = new THREE.Vector3(50, 120, 50).normalize();
  
  private settings: ShadowSettings = {
    enabled: true,
    resolution: 1024,
    cascades: 3,
    shadowDistance: 100,
    softness: 2.5,
    bias: 0.0005,
    normalBias: 0.02,
    intensity: 0.6,
    stableExtents: false,
    extentScale: 1.05,
  };

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;

    // Create main shadow-casting light
    this.shadowLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.shadowLight.position.set(50, 120, 50);
    this.shadowLight.castShadow = this.settings.enabled;
    // Ensure the light's target participates in scene graph updates
    // (DirectionalLight uses target's world matrix for orientation.)
    scene.add(this.shadowLight.target);
    
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
    this.recomputeCascadeSplits();

    // Create shadow cameras and render targets for each cascade
    this.shadowCameras = [];
    this.shadowMaps = [];
    
    for (let i = 0; i < this.settings.cascades; i++) {
      // Create orthographic camera for this cascade
      const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, this.cascadeDistances[i]);
      this.shadowCameras.push(camera);

      // Create shadow map render target with a depth texture for proper shadow sampling
      const shadowMap = new THREE.WebGLRenderTarget(
        this.settings.resolution,
        this.settings.resolution,
        {
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
          format: THREE.RGBAFormat,
          depthBuffer: true,
          stencilBuffer: false
        }
      );

      // Attach a depth texture (WebGL depth texture extension handled internally by three.js)
      shadowMap.depthTexture = new THREE.DepthTexture(
        this.settings.resolution,
        this.settings.resolution,
        THREE.UnsignedShortType
      );
      // Ensure depth format is correct (defaults are fine, but explicit for clarity)
      shadowMap.depthTexture.format = THREE.DepthFormat;

      this.shadowMaps.push(shadowMap);
    }
  }

  private recomputeCascadeSplits(): void {
    // Practical split scheme between uniform and logarithmic
    const n = this.settings.cascades;
    const near = 0.1;
    const far = this.settings.shadowDistance;
    const lambda = 0.7;
    this.cascadeDistances = [];
    for (let i = 1; i <= n; i++) {
      const p = i / n;
      const log = near * Math.pow(far / near, p);
      const uni = near + (far - near) * p;
      const d = lambda * (log - uni) + uni;
      this.cascadeDistances.push(d);
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
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      this.updateCascadeCameras(camera as THREE.PerspectiveCamera);
    }

    // Render shadow maps
    this.renderShadowMaps(scene);
  }

  private updateShadowLightPosition(): void {
    // Position shadow light along current sun direction
    const dist = Math.max(50, this.settings.shadowDistance);
    const pos = this.sunDir.clone().multiplyScalar(dist);
    this.shadowLight.position.copy(pos);

    // Update shadow light target
    this.shadowLight.target.position.set(0, 0, 0);
    this.shadowLight.target.updateMatrixWorld();
  }

  private updateCascadeCameras(viewCamera: THREE.PerspectiveCamera): void {
    const cam = viewCamera as THREE.PerspectiveCamera;
    const lightDir = this.sunDir.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    // Recompute splits if needed
    this.recomputeCascadeSplits();

    let prevSplitDist = cam.near;
    for (let i = 0; i < this.settings.cascades; i++) {
      const splitDist = this.cascadeDistances[i];
      const camera = this.shadowCameras[i];

      // Compute frustum corners in world space for this slice [prevSplitDist, splitDist]
      // We still use corners to compute robust Z near/far bounds in light space
      const corners = this.getSliceCornersWorld(cam, prevSplitDist, splitDist);

      // Compute a reference center for this slice
      const forward = new THREE.Vector3(); cam.getWorldDirection(forward);
      const sliceMid = 0.5 * (prevSplitDist + splitDist);
      // For stability, decouple from pitch: project forward to XZ when using stable extents
      let forwardStable = forward.clone();
      if (this.settings.stableExtents) {
        forwardStable.y = 0;
        if (forwardStable.lengthSq() > 1e-6) forwardStable.normalize(); else forwardStable.copy(forward);
      }
      const centerWorld = new THREE.Vector3().copy(cam.position).addScaledVector(forwardStable, sliceMid);

      // Build light view from sun direction, targeting the stable center
      const lightPos = centerWorld.clone().sub(lightDir.clone().multiplyScalar(200));
      const lightView = new THREE.Matrix4().lookAt(lightPos, centerWorld, up);

      // Transform corners to light space and compute min/max for Z bounds
      const min = new THREE.Vector3(+Infinity, +Infinity, +Infinity);
      const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      for (const c of corners) {
        const ls = c.clone().applyMatrix4(lightView);
        min.min(ls);
        max.max(ls);
      }

      // Compute orthographic XY region
      let half: number;
      let centerLS = centerWorld.clone().applyMatrix4(lightView);
      if (this.settings.stableExtents) {
        // Stable extent from far plane circumscribed radius (world units)
        const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
        const farH = tanHalfFov * splitDist; // height at cascade far distance
        const farW = farH * cam.aspect;
        const radius = Math.sqrt(farW * farW + farH * farH) * (this.settings.extentScale ?? 1.05);
        const size = 2.0 * radius;
        half = radius;
        // Snap center to shadow texel grid
        const texelSize = size / this.settings.resolution;
        centerLS.x = Math.floor(centerLS.x / texelSize) * texelSize;
        centerLS.y = Math.floor(centerLS.y / texelSize) * texelSize;
      } else {
        // Fit to current slice bounds (legacy path)
        const extents = new THREE.Vector3().subVectors(max, min);
        const texelX = extents.x / this.settings.resolution;
        const texelY = extents.y / this.settings.resolution;
        min.x = Math.floor(min.x / texelX) * texelX;
        min.y = Math.floor(min.y / texelY) * texelY;
        max.x = Math.floor(max.x / texelX) * texelX;
        max.y = Math.floor(max.y / texelY) * texelY;
        const size = Math.max(max.x - min.x, max.y - min.y);
        half = 0.5 * size;
        centerLS.set(0.5 * (min.x + max.x), 0.5 * (min.y + max.y), 0.0);
        const texelSize = size / this.settings.resolution;
        centerLS.x = Math.floor(centerLS.x / texelSize) * texelSize;
        centerLS.y = Math.floor(centerLS.y / texelSize) * texelSize;
      }

      // Configure ortho camera in light space around the snapped center
      camera.left = centerLS.x - half;
      camera.right = centerLS.x + half;
      camera.bottom = centerLS.y - half;
      camera.top = centerLS.y + half;

      // Depth range in light view: objects in front have negative z
      // Use positive near/far distances; include a small margin only on far
      const zNear = Math.max(0.1, -max.z);
      const zFar = Math.max(zNear + 1.0, -min.z + 25.0);
      camera.near = zNear;
      camera.far = zFar;
      camera.updateProjectionMatrix();

      // Set camera world matrix from lightView inverse
      camera.matrixWorld.copy(new THREE.Matrix4().copy(lightView).invert());
      camera.matrixWorldInverse.copy(lightView);
      camera.updateMatrixWorld(true);

      prevSplitDist = splitDist;
    }
  }

  private getSliceCornersWorld(cam: THREE.PerspectiveCamera, near: number, far: number): THREE.Vector3[] {
    const corners: THREE.Vector3[] = [];
    const pos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const forward = new THREE.Vector3(); cam.getWorldDirection(forward);
    const up = new THREE.Vector3(0,1,0).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3().crossVectors(forward, up).normalize().multiplyScalar(-1);

    const nearCenter = pos.clone().addScaledVector(forward, near);
    const farCenter = pos.clone().addScaledVector(forward, far);
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
    const nearH = tan * near; const nearW = nearH * cam.aspect;
    const farH = tan * far; const farW = farH * cam.aspect;

    // Near plane corners
    corners.push(nearCenter.clone().addScaledVector(up,  nearH).addScaledVector(right, -nearW)); // left top
    corners.push(nearCenter.clone().addScaledVector(up, -nearH).addScaledVector(right, -nearW)); // left bottom
    corners.push(nearCenter.clone().addScaledVector(up, -nearH).addScaledVector(right,  nearW)); // right bottom
    corners.push(nearCenter.clone().addScaledVector(up,  nearH).addScaledVector(right,  nearW)); // right top
    // Far plane corners
    corners.push(farCenter.clone().addScaledVector(up,  farH).addScaledVector(right, -farW));
    corners.push(farCenter.clone().addScaledVector(up, -farH).addScaledVector(right, -farW));
    corners.push(farCenter.clone().addScaledVector(up, -farH).addScaledVector(right,  farW));
    corners.push(farCenter.clone().addScaledVector(up,  farH).addScaledVector(right,  farW));

    return corners;
  }


  private renderShadowMaps(scene: THREE.Scene): void {
    const originalRenderTarget = this.renderer.getRenderTarget();

    // Temporarily replace shadow map sampler uniforms to avoid framebuffer-texture feedback loop
    const overrides: Array<{ material: THREE.ShaderMaterial; values: Record<string, unknown> }> = [];
    scene.traverse(obj => {
      const matAny = (obj as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
      const materials: (THREE.Material | undefined)[] = Array.isArray(matAny) ? matAny : [matAny];
      materials.forEach((mat) => {
        if (mat && 'isShaderMaterial' in mat && mat.isShaderMaterial && 'uniforms' in mat) {
          const shaderMat = mat as THREE.ShaderMaterial;
          const u = shaderMat.uniforms as Record<string, { value: unknown }>;
          const touched: Record<string, unknown> = {};
          let hasTouch = false;
          ['shadowMap0', 'shadowMap1', 'shadowMap2', 'shadowMap3'].forEach((key) => {
            if (u[key]) {
              touched[key] = u[key].value;
              u[key].value = this.dummyTexture;
              hasTouch = true;
            }
          });
          if (hasTouch) overrides.push({ material: shaderMat, values: touched });
        }
      });
    });

    for (let i = 0; i < this.shadowMaps.length; i++) {
      this.renderer.setRenderTarget(this.shadowMaps[i]);
      this.renderer.clear(true, true, true);
      this.renderer.render(scene, this.shadowCameras[i]);
    }
    this.renderer.setRenderTarget(originalRenderTarget);

    // Restore original uniforms
    overrides.forEach(({ material, values }) => {
      const u = material.uniforms as Record<string, { value: unknown }>;
      Object.keys(values).forEach((key) => {
        if (u[key]) u[key].value = values[key];
      });
    });
  }

  /**
   * Get shadow uniforms for shaders
   */
  getShadowUniforms(): Record<string, { value: unknown }> {
    const uniforms: Record<string, { value: unknown }> = {};
    
    // Shadow maps
    for (let i = 0; i < this.settings.cascades; i++) {
      // Provide the depth texture (actual shadow map) to the shader
      const rt = this.shadowMaps[i];
      uniforms[`shadowMap${i}`] = { value: (rt.depthTexture ?? rt.texture) };
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

  /** Set the current sun direction for shadowing */
  setSunDirection(dir: THREE.Vector3): void {
    // Avoid allocation by copying into our vector
    this.sunDir.copy(dir).normalize();
  }

  /**
   * Update shadow settings
   */
  updateSettings(newSettings: Partial<ShadowSettings>): void {
    const oldResolution = this.settings.resolution;
    const oldCascades = this.settings.cascades;
    const oldSettings = { ...this.settings };
    
    this.settings = { ...this.settings, ...newSettings };
    
    // console.log('[ShadowSystem] Updating settings:', {
    //   old: oldSettings,
    //   new: this.settings,
    //   changes: newSettings
    // });

    // Reinitialize if resolution or cascade count changed
    if (oldResolution !== this.settings.resolution || oldCascades !== this.settings.cascades) {
      // console.log('[ShadowSystem] Reinitializing cascades due to resolution/cascade change');
      this.dispose();
      this.initializeCascades();
    }
    
    // Recalculate cascade distances if shadowDistance changed
    else if (oldSettings.shadowDistance !== this.settings.shadowDistance) {
      // console.log('[ShadowSystem] Recalculating cascade distances due to shadowDistance change');
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
    
    // console.log('[ShadowSystem] Shadow mapping enabled:', this.settings.enabled);
    // console.log('[ShadowSystem] Shadow light casting:', this.shadowLight.castShadow);
    // console.log('[ShadowSystem] Renderer shadow map enabled:', this.renderer.shadowMap.enabled);
    
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
