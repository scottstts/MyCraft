/**
 * Simplified post-processing pipeline with custom SSAO and tone mapping
 * Built with basic Three.js components for maximum compatibility
 */

import * as THREE from 'three';

export interface PostProcessorSettings {
  ssaoEnabled: boolean;
  ssaoIntensity: number;
  ssaoRadius: number;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  exposure: number;
  contrast: number;
  saturation: number;
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
    ssaoRadius: 0.01,
    bloomEnabled: true,
    bloomStrength: 0.4,
    bloomThreshold: 0.3,
    exposure: 0.9,
    contrast: 1.05,
    saturation: 1.0
  };

  private renderer: THREE.WebGLRenderer;
  private mainScene: THREE.Scene;
  private camera: THREE.Camera;

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
    this.renderTarget1 = new THREE.WebGLRenderTarget(safeWidth, safeHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthTexture: new THREE.DepthTexture(safeWidth, safeHeight, THREE.UnsignedShortType)
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
        ssaoEnabled: { value: this.settings.ssaoEnabled },
        ssaoIntensity: { value: this.settings.ssaoIntensity },
        ssaoRadius: { value: this.settings.ssaoRadius },
        bloomEnabled: { value: this.settings.bloomEnabled },
        bloomStrength: { value: this.settings.bloomStrength },
        bloomThreshold: { value: this.settings.bloomThreshold },
        exposure: { value: this.settings.exposure },
        contrast: { value: this.settings.contrast },
        saturation: { value: this.settings.saturation }
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
        uniform sampler2D tDepth;
        uniform vec2 resolution;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform bool ssaoEnabled;
        uniform float ssaoIntensity;
        uniform float ssaoRadius;
        uniform bool bloomEnabled;
        uniform float bloomStrength;
        uniform float bloomThreshold;
        uniform float exposure;
        uniform float contrast;
        uniform float saturation;
        
        varying vec2 vUv;

        float readDepth(vec2 coord) {
          float fragCoordZ = texture2D(tDepth, coord).r;
          if (fragCoordZ == 1.0) return cameraFar; // Handle background
          float viewZ = (cameraNear * cameraFar) / ((cameraFar - cameraNear) * fragCoordZ - cameraFar);
          return -viewZ; // Return positive depth
        }

        // Conservative SSAO implementation
        float ssao(vec2 uv, vec3 position, vec3 normal) {
          if (!ssaoEnabled) return 1.0;
          
          float occlusion = 0.0;
          float radius = ssaoRadius * 200.0; // Reasonable screen space scaling
          int samples = 8; // Fewer samples to reduce artifacts
          float currentDepth = readDepth(uv);
          
          // Skip SSAO if depth is at far plane (background)
          if (currentDepth >= cameraFar * 0.99) return 1.0;
          
          for (int i = 0; i < samples; i++) {
            float angle = float(i) / float(samples) * 6.28318;
            vec2 offset = vec2(cos(angle), sin(angle)) * radius;
            
            vec2 sampleUV = uv + offset / resolution;
            // Clamp to texture bounds instead of skipping
            sampleUV = clamp(sampleUV, vec2(0.0), vec2(1.0));
            
            float sampleDepth = readDepth(sampleUV);
            float depthDiff = sampleDepth - currentDepth;
            
            // Only consider samples that are closer (in front)
            if (depthDiff > 0.1 && depthDiff < 5.0) {
              occlusion += 1.0;
            }
          }
          
          occlusion = (occlusion / float(samples)) * ssaoIntensity;
          return clamp(1.0 - occlusion * 0.5, 0.3, 1.0); // Limit darkening
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

        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          
          // Apply bloom (always process, function handles enable/disable)
          color = bloom(tDiffuse, vUv);
          
          // Apply SSAO with safety checks
          if (ssaoEnabled) {
            float depth = readDepth(vUv);
            // Only apply SSAO to valid depth values
            if (depth > cameraNear && depth < cameraFar * 0.99) {
              vec3 position = vec3(vUv * 2.0 - 1.0, depth);
              vec3 normal = vec3(0.0, 0.0, 1.0); // Simplified normal
              float ao = ssao(vUv, position, normal);
              color *= ao;
            }
          }
          
          // Apply exposure
          color *= exposure;
          
          // ACES tone mapping
          color = ACESFilm(color);
          
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
    const oldSettings = { ...this.settings };
    this.settings = { ...this.settings, ...newSettings };
    
    console.log('[PostProcessor] Updating settings:', {
      old: oldSettings,
      new: this.settings,
      changes: newSettings
    });

    if (this.quadMaterial) {
      const uniforms = this.quadMaterial.uniforms as Record<string, { value: unknown }>;
      
      if (newSettings.ssaoEnabled !== undefined) {
        uniforms.ssaoEnabled.value = newSettings.ssaoEnabled;
        console.log('[PostProcessor] SSAO enabled:', newSettings.ssaoEnabled);
      }
      if (newSettings.ssaoIntensity !== undefined) uniforms.ssaoIntensity.value = newSettings.ssaoIntensity;
      if (newSettings.ssaoRadius !== undefined) uniforms.ssaoRadius.value = newSettings.ssaoRadius;
      if (newSettings.bloomEnabled !== undefined) {
        uniforms.bloomEnabled.value = newSettings.bloomEnabled;
        console.log('[PostProcessor] Bloom enabled:', newSettings.bloomEnabled);
      }
      if (newSettings.bloomStrength !== undefined) {
        uniforms.bloomStrength.value = newSettings.bloomStrength;
        console.log('[PostProcessor] Bloom strength:', newSettings.bloomStrength);
      }
      if (newSettings.bloomThreshold !== undefined) {
        uniforms.bloomThreshold.value = newSettings.bloomThreshold;
        console.log('[PostProcessor] Bloom threshold:', newSettings.bloomThreshold);
      }
      if (newSettings.exposure !== undefined) uniforms.exposure.value = newSettings.exposure;
      if (newSettings.contrast !== undefined) uniforms.contrast.value = newSettings.contrast;
      if (newSettings.saturation !== undefined) uniforms.saturation.value = newSettings.saturation;
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
