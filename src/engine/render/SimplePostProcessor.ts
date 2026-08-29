/**
 * Simplified post-processing pipeline with custom SSAO and tone mapping
 * Built with basic Three.js components for maximum compatibility
 */

import * as THREE from 'three';
import { SSAO_FRAGMENT_GLSL } from './postprocessing/ssaoShader';

export interface PostProcessorSettings {
  ssaoEnabled: boolean;
  ssaoIntensity: number;
  ssaoRadius: number;
  waterLevel?: number;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  exposure: number;
  contrast: number;
  saturation: number;
  // Fog
  fogEnabled?: boolean;
  fogBaseDensity?: number;
  fogMaxDistance?: number;
  // Volumetrics
  volumetricsEnabled?: boolean;
  volumetricsIntensity?: number;
  volumetricsSteps?: number; // 16..64
}

export class SimplePostProcessor {
  private renderTarget1: THREE.WebGLRenderTarget;
  private renderTarget2: THREE.WebGLRenderTarget;
  private quadGeometry: THREE.PlaneGeometry;
  private quadMaterial: THREE.ShaderMaterial | null = null;
  private quadMesh: THREE.Mesh;
  private orthoCamera: THREE.OrthographicCamera;
  private scene: THREE.Scene;

  private settings: PostProcessorSettings = {
    ssaoEnabled: true,
    ssaoIntensity: 0.3,
    // Radius is expressed in world units (blocks/meters), not pixels.
    ssaoRadius: 1.25,
    bloomEnabled: true,
    bloomStrength: 0.30,
    bloomThreshold: 0.05,
    exposure: 0.9,
    contrast: 1.15,
    saturation: 1.1,
    fogEnabled: true,
    fogBaseDensity: 0.002,
    fogMaxDistance: 600,
    volumetricsEnabled: false,
    volumetricsIntensity: 0.5,
    volumetricsSteps: 32,
  };

  private renderer: THREE.WebGLRenderer;
  private mainScene: THREE.Scene;
  private camera: THREE.Camera;
  private sunDirView: THREE.Vector3 = new THREE.Vector3(0.6, 0.8, 0.1).normalize();

  constructor(
    renderer: THREE.WebGLRenderer,
    mainScene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number
  ) {
    this.renderer = renderer;
    this.mainScene = mainScene;
    this.camera = camera;
    // Guard against zero-size targets (can happen briefly during layout)
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));

    // Create render targets with depth texture for SSAO
    // Use higher-precision depth to reduce banding in fog (24-bit depth + 8-bit stencil)
    const depthTex = new THREE.DepthTexture(safeWidth, safeHeight, THREE.UnsignedInt248Type);
    depthTex.format = THREE.DepthStencilFormat;
    this.renderTarget1 = new THREE.WebGLRenderTarget(safeWidth, safeHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthTexture: depthTex,
      depthBuffer: true,
      stencilBuffer: true,
    });

    this.renderTarget2 = new THREE.WebGLRenderTarget(safeWidth, safeHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat
    });

    // Create quad for full-screen passes
    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.quadMesh = new THREE.Mesh(this.quadGeometry);
    
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.scene.add(this.quadMesh);

    this.createPostProcessMaterial();
  }

  private createPostProcessMaterial(): void {
    const postProcessShader = {
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2() },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        invProjectionMatrix: { value: new THREE.Matrix4() },
        invView: { value: new THREE.Matrix4() },
        cameraMatrixWorld: { value: new THREE.Matrix4() },
        projectionScale: { value: new THREE.Vector2(1, 1) },
        sunDirView: { value: new THREE.Vector3(0.6, 0.8, 0.1).normalize() },
        ssaoEnabled: { value: this.settings.ssaoEnabled },
        ssaoIntensity: { value: this.settings.ssaoIntensity },
        ssaoRadius: { value: this.settings.ssaoRadius },
        waterLevel: { value: this.settings.waterLevel ?? 42.0 },
        bloomEnabled: { value: this.settings.bloomEnabled },
        bloomStrength: { value: this.settings.bloomStrength },
        bloomThreshold: { value: this.settings.bloomThreshold },
        exposure: { value: this.settings.exposure },
        contrast: { value: this.settings.contrast },
        saturation: { value: this.settings.saturation },
        fogEnabled: { value: this.settings.fogEnabled },
        fogBaseDensity: { value: this.settings.fogBaseDensity },
        fogMaxDistance: { value: this.settings.fogMaxDistance },
        volumetricsEnabled: { value: this.settings.volumetricsEnabled },
        volumetricsIntensity: { value: this.settings.volumetricsIntensity },
        volumetricsSteps: { value: this.settings.volumetricsSteps },
        // Small fog dither to mask any residual depth quantization
        fogDitherAmount: { value: 0.75 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform bool bloomEnabled;
        uniform float bloomStrength;
        uniform float bloomThreshold;
        uniform float exposure;
        uniform float contrast;
        uniform float saturation;
        uniform bool fogEnabled;
        uniform float fogBaseDensity;
        uniform float fogMaxDistance;
        uniform float fogDitherAmount;
        uniform bool volumetricsEnabled;
        uniform float volumetricsIntensity;
        uniform int volumetricsSteps;
        uniform mat4 invView;
        uniform vec3 sunDirView;
        
        varying vec2 vUv;
        ${SSAO_FRAGMENT_GLSL}

        // Hash for per-pixel random rotation
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        float readDepth(vec2 coord) {
          float rawDepth = texture2D(tDepth, clamp(coord, vec2(0.0), vec2(1.0))).r;
          if (rawDepth >= 0.999999) return cameraFar;
          float viewZ = (cameraNear * cameraFar) / ((cameraFar - cameraNear) * rawDepth - cameraFar);
          return -viewZ;
        }

        // Working bloom effect
        vec3 bloom(sampler2D tex, vec2 uv) {
          vec3 color = texture2D(tex, uv).rgb;
          if (!bloomEnabled) return color;
          
          vec3 bloomColor = vec3(0.0);
          float blur = 2.0 / min(resolution.x, resolution.y);
          
          // Gather neighboring pixels for blur
          bloomColor += texture2D(tex, uv + vec2(blur, 0.0)).rgb;
          bloomColor += texture2D(tex, uv + vec2(-blur, 0.0)).rgb;
          bloomColor += texture2D(tex, uv + vec2(0.0, blur)).rgb;
          bloomColor += texture2D(tex, uv + vec2(0.0, -blur)).rgb;
          bloomColor += texture2D(tex, uv + vec2(blur, blur)).rgb;
          bloomColor += texture2D(tex, uv + vec2(-blur, blur)).rgb;
          bloomColor += texture2D(tex, uv + vec2(blur, -blur)).rgb;
          bloomColor += texture2D(tex, uv + vec2(-blur, -blur)).rgb;
          bloomColor /= 8.0;
          
          // Apply bloom to bright areas
          float brightness = dot(color, vec3(0.299, 0.587, 0.114));
          if (brightness > bloomThreshold) {
            float bloomFactor = (brightness - bloomThreshold) / (1.0 - bloomThreshold); // Smooth ramp from threshold to 1.0
            return color + bloomColor * bloomStrength * bloomFactor * 2.0;
          }
          
          return color;
        }

        // ACES tone mapping
        vec3 ACESFilm(vec3 x) {
          float a = 2.51;
          float b = 0.03;
          float c = 2.43;
          float d = 0.59;
          float e = 0.14;
          return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
        }

        // Color adjustment
        vec3 adjustColor(vec3 color, float contrast, float saturation) {
          // Contrast
          color = (color - 0.5) * contrast + 0.5;
          
          // Saturation
          float grey = dot(color, vec3(0.299, 0.587, 0.114));
          color = mix(vec3(grey), color, saturation);
          
          return color;
        }

        // Exponential fog based on view-space depth
        vec3 applyFog(vec3 color, float viewDepth) {
          if (!fogEnabled) return color;
          float d = min(viewDepth, fogMaxDistance);
          float fogFactor = 1.0 - exp(-d * fogBaseDensity);
          vec3 fogColor = vec3(0.72, 0.82, 0.92);
          // Dither the fog factor a tiny amount in sRGB to break visible bands
          if (fogDitherAmount > 0.0) {
            float n1 = hash12(gl_FragCoord.xy);
            float n2 = hash12(gl_FragCoord.yx);
            float tri = (n1 + n2) - 1.0; // ~triangular in [-1,1]
            fogFactor = clamp(fogFactor + tri * (fogDitherAmount / 255.0), 0.0, 1.0);
          }
          return mix(color, fogColor, clamp(fogFactor, 0.0, 0.9));
        }

        // Simplified screen-space volumetric light accumulation
        vec3 volumetrics(vec2 uv, float viewDepth) {
          if (!volumetricsEnabled) return vec3(0.0);
          // March in view space along -sunDirView (from pixel toward light)
          int steps = max(1, volumetricsSteps);
          float stepLen = max(1.0, viewDepth) / float(steps);
          vec3 accum = vec3(0.0);
          float transmittance = 1.0;
          vec2 dirSS = normalize((sunDirView.xy) + vec2(1e-5));
          vec2 stepUV = dirSS * 1.5 / min(resolution.x, resolution.y);
          vec2 sUv = uv;
          float z = viewDepth;
          for (int i = 0; i < 128; i++) {
            if (i >= steps) break;
            sUv -= stepUV; // move toward the sun
            z -= stepLen;
            if (z <= 0.0) break;
            float sd = readDepth(sUv);
            // Occlusion: if geometry in front of our sample depth
            if (sd < z - 0.5) {
              transmittance *= 0.96; // attenuate when encountering occluders
            }
            accum += vec3(1.0) * transmittance * 0.02;
            transmittance *= 0.99;
          }
          return accum * volumetricsIntensity;
        }

        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          
          // Apply bloom (always process, function handles enable/disable)
          color = bloom(tDiffuse, vUv);
          
          // Apply SSAO only to the shadow-independent indirect component
          // encoded by BlockMaterial's opaque alpha channel. This keeps
          // direct sun contrast and voxel shadow coverage from being
          // mistaken for ambient visibility.
          vec4 source = texture2D(tDiffuse, vUv);
          float indirectMask = clamp(1.0 - source.a, 0.0, 1.0);
          float ao = mix(1.0, ssaoFactor(vUv), indirectMask);
          color *= ao;
          
          // Volumetrics (additive)
          float viewDepth = readDepth(vUv);
          color += volumetrics(vUv, viewDepth);
          
          // Apply exposure
          color *= exposure;
          
          // ACES tone mapping
          color = ACESFilm(color);
          
          // Fog after tone mapping for stable appearance
          color = applyFog(color, viewDepth);
          
          // Color adjustments
          color = adjustColor(color, contrast, saturation);
          
          gl_FragColor = vec4(color, 1.0);
        }
      `
    };

    this.quadMaterial = new THREE.ShaderMaterial(postProcessShader);
    this.quadMesh.material = this.quadMaterial;
  }

  /**
   * Update post-processing settings
   */
  updateSettings(newSettings: Partial<PostProcessorSettings>): void {
    // const oldSettings = { ...this.settings };
    this.settings = { ...this.settings, ...newSettings };
    
    // console.log('[PostProcessor] Updating settings:', {
    //   old: oldSettings,
    //   new: this.settings,
    //   changes: newSettings
    // });

    if (this.quadMaterial) {
      const uniforms = this.quadMaterial.uniforms as Record<string, { value: unknown }>;
      if (newSettings.ssaoEnabled !== undefined) {
        uniforms.ssaoEnabled.value = newSettings.ssaoEnabled;
        // console.log('[PostProcessor] SSAO enabled:', newSettings.ssaoEnabled);
      }
      if (newSettings.ssaoIntensity !== undefined) {
        uniforms.ssaoIntensity.value = THREE.MathUtils.clamp(newSettings.ssaoIntensity, 0, 1);
      }
      if (newSettings.ssaoRadius !== undefined) {
        uniforms.ssaoRadius.value = Math.max(0.05, newSettings.ssaoRadius);
      }
      if (newSettings.waterLevel !== undefined) uniforms.waterLevel.value = newSettings.waterLevel;
      if (newSettings.bloomEnabled !== undefined) {
        uniforms.bloomEnabled.value = newSettings.bloomEnabled;
        // console.log('[PostProcessor] Bloom enabled:', newSettings.bloomEnabled);
      }
      if (newSettings.bloomStrength !== undefined) {
        uniforms.bloomStrength.value = newSettings.bloomStrength;
        // console.log('[PostProcessor] Bloom strength:', newSettings.bloomStrength);
      }
      if (newSettings.bloomThreshold !== undefined) {
        uniforms.bloomThreshold.value = newSettings.bloomThreshold;
        // console.log('[PostProcessor] Bloom threshold:', newSettings.bloomThreshold);
      }
      if (newSettings.exposure !== undefined) uniforms.exposure.value = newSettings.exposure;
      if (newSettings.contrast !== undefined) uniforms.contrast.value = newSettings.contrast;
      if (newSettings.saturation !== undefined) uniforms.saturation.value = newSettings.saturation;
      if (newSettings.fogEnabled !== undefined) uniforms.fogEnabled.value = newSettings.fogEnabled;
      if (newSettings.fogBaseDensity !== undefined) uniforms.fogBaseDensity.value = newSettings.fogBaseDensity;
      if (newSettings.fogMaxDistance !== undefined) uniforms.fogMaxDistance.value = newSettings.fogMaxDistance;
      if (newSettings.volumetricsEnabled !== undefined) uniforms.volumetricsEnabled.value = newSettings.volumetricsEnabled;
      if (newSettings.volumetricsIntensity !== undefined) uniforms.volumetricsIntensity.value = newSettings.volumetricsIntensity;
      if (newSettings.volumetricsSteps !== undefined) uniforms.volumetricsSteps.value = newSettings.volumetricsSteps;
    } else {
      console.error('[PostProcessor] Quad material not available for uniform updates!');
    }
  }

  /**
   * Render the post-processed scene
   */
  render(): void {
    const currentRenderTarget = this.renderer.getRenderTarget();
    
    // Render main scene to texture
    this.renderer.setRenderTarget(this.renderTarget1);
    this.renderer.render(this.mainScene, this.camera);
    
    // Set up post-process material
    if (this.quadMaterial) {
      const uniforms = this.quadMaterial.uniforms as Record<string, { value: unknown }>;
      uniforms.tDiffuse.value = this.renderTarget1.texture;
      uniforms.tDepth.value = this.renderTarget1.depthTexture;
      (uniforms.resolution.value as THREE.Vector2).set(
        this.renderTarget1.width, 
        this.renderTarget1.height
      );
      uniforms.cameraNear.value = (this.camera as THREE.PerspectiveCamera).near || 0.1;
      uniforms.cameraFar.value = (this.camera as THREE.PerspectiveCamera).far || 1000;
      // Update matrices for reconstruction and sun dir in view space
      const cam = this.camera as THREE.PerspectiveCamera;
      (uniforms.invProjectionMatrix.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
      (uniforms.invView.value as THREE.Matrix4).copy(cam.matrixWorldInverse);
      (uniforms.cameraMatrixWorld.value as THREE.Matrix4).copy(cam.matrixWorld);
      (uniforms.projectionScale.value as THREE.Vector2).set(
        cam.projectionMatrix.elements[0],
        cam.projectionMatrix.elements[5],
      );
      (uniforms.sunDirView.value as THREE.Vector3).copy(this.sunDirView);
    }
    
    // Render post-process pass to screen
    this.renderer.setRenderTarget(currentRenderTarget);
    this.renderer.render(this.scene, this.orthoCamera);
  }

  /**
   * Handle window resize
   */
  setSize(width: number, height: number): void {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    this.renderTarget1.setSize(safeWidth, safeHeight);
    this.renderTarget2.setSize(safeWidth, safeHeight);
    
    // Ensure depth texture is properly resized
    if (this.renderTarget1.depthTexture) {
      this.renderTarget1.depthTexture.image.width = safeWidth;
      this.renderTarget1.depthTexture.image.height = safeHeight;
      this.renderTarget1.depthTexture.needsUpdate = true;
    }
  }

  /**
   * Get current settings
   */
  getSettings(): PostProcessorSettings {
    return { ...this.settings };
  }

  /**
   * Inject sun lighting for volumetric effects
   */
  setSunLighting(sunDirWorld: THREE.Vector3, camera: THREE.Camera): void {
    // Convert world direction to view space using inverse view (matrixWorldInverse)
    const view = (camera as THREE.PerspectiveCamera).matrixWorldInverse;
    const m3 = new THREE.Matrix3().setFromMatrix4(view);
    this.sunDirView.copy(sunDirWorld).applyMatrix3(m3).normalize();
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.renderTarget1.dispose();
    this.renderTarget2.dispose();
    this.quadGeometry.dispose();
    if (this.quadMaterial) {
      this.quadMaterial.dispose();
    }
  }
}
