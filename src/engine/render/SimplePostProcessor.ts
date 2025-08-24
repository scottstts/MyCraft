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
  exposure: number;
  contrast: number;
  saturation: number;
}

export class SimplePostProcessor {
  private renderTarget1: THREE.WebGLRenderTarget;
  private renderTarget2: THREE.WebGLRenderTarget;
  private depthTarget: THREE.WebGLRenderTarget;
  private quadGeometry: THREE.PlaneGeometry;
  private quadMaterial: THREE.ShaderMaterial | null = null;
  private quadMesh: THREE.Mesh;
  private orthoCamera: THREE.OrthographicCamera;
  private scene: THREE.Scene;

  private settings: PostProcessorSettings = {
    ssaoEnabled: true,
    ssaoIntensity: 0.4,
    ssaoRadius: 0.15,
    bloomEnabled: true,
    bloomStrength: 0.2,
    exposure: 1.1,
    contrast: 1.15,
    saturation: 1.1
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
    // Create render targets
    this.renderTarget1 = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat
    });

    this.renderTarget2 = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat
    });

    this.depthTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.DepthFormat,
      type: THREE.UnsignedShortType
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
        uniform float exposure;
        uniform float contrast;
        uniform float saturation;
        
        varying vec2 vUv;

        float readDepth(vec2 coord) {
          float fragCoordZ = texture2D(tDepth, coord).x;
          float viewZ = (cameraNear * cameraFar) / ((cameraFar - cameraNear) * fragCoordZ - cameraFar);
          return viewZ;
        }

        // Simple SSAO implementation
        float ssao(vec2 uv, vec3 position, vec3 normal) {
          if (!ssaoEnabled) return 1.0;
          
          float occlusion = 0.0;
          float radius = ssaoRadius;
          int samples = 8;
          
          for (int i = 0; i < samples; i++) {
            float angle = float(i) / float(samples) * 6.28318;
            vec2 offset = vec2(cos(angle), sin(angle)) * radius;
            
            vec2 sampleUV = uv + offset / resolution;
            if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) continue;
            
            float sampleDepth = readDepth(sampleUV);
            float currentDepth = readDepth(uv);
            
            if (sampleDepth > currentDepth + 0.1) {
              occlusion += 1.0;
            }
          }
          
          occlusion = 1.0 - (occlusion / float(samples)) * ssaoIntensity;
          return clamp(occlusion, 0.0, 1.0);
        }

        // Simple bloom effect
        vec3 bloom(sampler2D tex, vec2 uv) {
          if (!bloomEnabled) return texture2D(tex, uv).rgb;
          
          vec3 color = texture2D(tex, uv).rgb;
          vec3 bloom = vec3(0.0);
          
          // Simple blur for bloom
          float blur = 2.0 / min(resolution.x, resolution.y);
          bloom += texture2D(tex, uv + vec2(blur, 0.0)).rgb;
          bloom += texture2D(tex, uv + vec2(-blur, 0.0)).rgb;
          bloom += texture2D(tex, uv + vec2(0.0, blur)).rgb;
          bloom += texture2D(tex, uv + vec2(0.0, -blur)).rgb;
          bloom /= 4.0;
          
          // Only bloom bright areas
          float brightness = dot(bloom, vec3(0.299, 0.587, 0.114));
          if (brightness > 0.8) {
            return color + bloom * bloomStrength;
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
          vec3 color = bloom(tDiffuse, vUv);
          
          // Apply SSAO
          if (ssaoEnabled) {
            float depth = readDepth(vUv);
            vec3 position = vec3(vUv * 2.0 - 1.0, depth);
            vec3 normal = vec3(0.0, 0.0, 1.0); // Simplified normal
            float ao = ssao(vUv, position, normal);
            color *= ao;
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
    this.settings = { ...this.settings, ...newSettings };

    if (this.quadMaterial) {
      const uniforms = (this.quadMaterial.uniforms as any);
      
      if (newSettings.ssaoEnabled !== undefined) uniforms.ssaoEnabled.value = newSettings.ssaoEnabled;
      if (newSettings.ssaoIntensity !== undefined) uniforms.ssaoIntensity.value = newSettings.ssaoIntensity;
      if (newSettings.ssaoRadius !== undefined) uniforms.ssaoRadius.value = newSettings.ssaoRadius;
      if (newSettings.bloomEnabled !== undefined) uniforms.bloomEnabled.value = newSettings.bloomEnabled;
      if (newSettings.bloomStrength !== undefined) uniforms.bloomStrength.value = newSettings.bloomStrength;
      if (newSettings.exposure !== undefined) uniforms.exposure.value = newSettings.exposure;
      if (newSettings.contrast !== undefined) uniforms.contrast.value = newSettings.contrast;
      if (newSettings.saturation !== undefined) uniforms.saturation.value = newSettings.saturation;
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
      (this.quadMaterial.uniforms as any).tDiffuse.value = this.renderTarget1.texture;
      (this.quadMaterial.uniforms as any).tDepth.value = this.renderTarget1.depthTexture;
      (this.quadMaterial.uniforms as any).resolution.value.set(
        this.renderTarget1.width, 
        this.renderTarget1.height
      );
      (this.quadMaterial.uniforms as any).cameraNear.value = (this.camera as any).near || 0.1;
      (this.quadMaterial.uniforms as any).cameraFar.value = (this.camera as any).far || 1000;
    }
    
    // Render post-process pass to screen
    this.renderer.setRenderTarget(currentRenderTarget);
    this.renderer.render(this.scene, this.orthoCamera);
  }

  /**
   * Handle window resize
   */
  setSize(width: number, height: number): void {
    this.renderTarget1.setSize(width, height);
    this.renderTarget2.setSize(width, height);
    this.depthTarget.setSize(width, height);
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
    this.depthTarget.dispose();
    this.quadGeometry.dispose();
    if (this.quadMaterial) {
      this.quadMaterial.dispose();
    }
  }
}