/**
 * Custom block material with advanced shaders
 * Replaces basic MeshStandardMaterial with enhanced lighting and effects
 */

import * as THREE from 'three';

export class BlockMaterial extends THREE.ShaderMaterial {
  private startTime: number;

  constructor(
    albedoTexture: THREE.Texture,
    envMap: THREE.CubeTexture | null,
    normalMap?: THREE.Texture
  ) {
    const vertexShader = `
      // Block vertex shader with enhanced lighting and ambient occlusion
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying vec3 vViewPosition;
      varying float vAmbientOcclusion;

      // Ambient occlusion calculation based on vertex position
      float calculateVertexAO(vec3 worldPos, vec3 normal) {
          vec3 blockPos = floor(worldPos);
          vec3 localPos = worldPos - blockPos;
          
          // Calculate occlusion based on proximity to block corners/edges
          vec3 edgeDistance = min(localPos, 1.0 - localPos);
          float minEdgeDistance = min(min(edgeDistance.x, edgeDistance.y), edgeDistance.z);
          
          // Apply stronger occlusion at edges and corners
          float edgeOcclusion = 1.0 - smoothstep(0.0, 0.2, minEdgeDistance);
          
          // Face-specific occlusion
          float faceOcclusion = 0.0;
          if (abs(normal.y) > 0.5) {
              faceOcclusion = edgeOcclusion * 0.3; // Top/bottom faces
          } else {
              faceOcclusion = edgeOcclusion * 0.6; // Side faces
          }
          
          return 1.0 - faceOcclusion;
      }

      void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          
          vec4 viewPosition = viewMatrix * worldPosition;
          vViewPosition = viewPosition.xyz;
          
          vAmbientOcclusion = calculateVertexAO(vWorldPosition, vNormal);
          
          gl_Position = projectionMatrix * viewPosition;
      }
    `;

    const fragmentShader = `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying vec3 vViewPosition;
      varying float vAmbientOcclusion;

      uniform sampler2D map;
      uniform sampler2D normalMap;
      uniform samplerCube envMap;
      uniform float roughness;
      uniform float metalness;
      uniform float envMapIntensity;
      uniform float time;
      
      // Sun uniforms (directional light driven by SunController)
      uniform vec3 sunDirection;
      uniform vec3 sunColor;

      // Shadow uniforms
      uniform sampler2D shadowMap0;
      uniform sampler2D shadowMap1;
      uniform sampler2D shadowMap2;
      uniform mat4 shadowMatrix0;
      uniform mat4 shadowMatrix1;
      uniform mat4 shadowMatrix2;
      uniform int shadowCascades;
      uniform float shadowDistances[3];
      uniform float shadowSoftness;
      uniform float shadowBias;
      uniform float shadowNormalBias;
      uniform float shadowIntensity;
      uniform float shadowResolution;

      // Hash-based noise for kernel rotation
      float hash12(vec2 p) {
          // Simple but decent hash
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
      }

      // Poisson disk offsets (8 samples)
      const int POISSON_COUNT = 8;
      vec2 poisson[POISSON_COUNT];

      // Compute a rotated, Poisson-disk PCF for softer, less banded shadows
      float sampleShadow(vec3 worldPos, vec3 normal, vec3 sunDir) {
          // Return 1.0 (no shadow) if shadow system is disabled
          if (shadowIntensity <= 0.0) return 1.0;
          
          // Transform world position to shadow map space using first shadow map
          vec4 shadowCoord = shadowMatrix0 * vec4(worldPos, 1.0);
          // For orthographic light cameras w==1, but keep perspective divide for correctness/safety
          shadowCoord.xyz /= shadowCoord.w;
          shadowCoord = shadowCoord * 0.5 + 0.5; // Convert to [0,1] range
          
          if (shadowCoord.x < 0.0 || shadowCoord.x > 1.0 || 
              shadowCoord.y < 0.0 || shadowCoord.y > 1.0 || 
              shadowCoord.z < 0.0 || shadowCoord.z > 1.0) {
              return 1.0; // Outside shadow map
          }
          
          // Apply bias to prevent shadow acne
          float bias = shadowBias + shadowNormalBias * (1.0 - max(dot(normal, sunDir), 0.0));
          float shadowDepth = shadowCoord.z - bias;
          
          // Prepare Poisson disk
          poisson[0] = vec2(-0.613392, 0.617481);
          poisson[1] = vec2(0.170019, -0.040254);
          poisson[2] = vec2(-0.299417, 0.791925);
          poisson[3] = vec2(0.645680, 0.493210);
          poisson[4] = vec2(-0.651784, 0.717887);
          poisson[5] = vec2(0.421003, 0.027070);
          poisson[6] = vec2(0.161360, -0.914412);
          poisson[7] = vec2(-0.725000, -0.045000);

          // Kernel scale in texels, stable across resolutions
          float texelSize = max(1.0 / shadowResolution, 0.0004);
          float radius = max(shadowSoftness, 1.0) * texelSize * 2.5;

          // Random rotation per-fragment to break banding
          float angle = hash12(shadowCoord.xy * 1024.0) * 6.2831853; // 2*pi
          float s = sin(angle), c = cos(angle);
          mat2 rot = mat2(c, -s, s, c);

          float shadow = 0.0;
          for (int i = 0; i < POISSON_COUNT; i++) {
              vec2 offset = rot * poisson[i] * radius;
              float sampleDepth = texture2D(shadowMap0, shadowCoord.xy + offset).r;
              shadow += shadowDepth <= sampleDepth ? 1.0 : 0.0;
          }
          shadow /= float(POISSON_COUNT);
          return mix(1.0 - shadowIntensity, 1.0, shadow);
      }

      // Enhanced lighting calculation with shadows
      vec3 calculateEnhancedLighting(vec3 albedo, vec3 normal, vec3 viewDir) {
          vec3 color = vec3(0.0);
          
          // Enhanced ambient with AO
          vec3 ambient = vec3(0.4, 0.5, 0.6) * 0.4 * vAmbientOcclusion;
          
      // Main sun light (provided via uniforms)
      vec3 sunDir = normalize(sunDirection);
      float sunDot = max(dot(normal, sunDir), 0.0);
          
          // Sample shadow
          float shadowFactor = sampleShadow(vWorldPosition, normal, sunDir);
          
          // Apply shadow to diffuse lighting
          float wrappedDiffuse = (sunDot + 0.3) / 1.3;
          vec3 diffuse = sunColor * wrappedDiffuse * shadowFactor;
          
          // Fresnel rim lighting
          float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
          vec3 fresnelColor = vec3(0.8, 0.9, 1.0) * fresnel * 0.2;
          
          // Environment reflection (only if envMap is available)
          vec3 reflection = vec3(0.0);
          #ifdef USE_ENVMAP
            vec3 reflectDir = reflect(-viewDir, normal);
          vec3 envColor = textureCube(envMap, reflectDir).rgb;
          reflection = envColor * envMapIntensity * (1.0 - roughness) * fresnel;
          #endif
          
          // Subsurface scattering
          float backLight = max(dot(normal, -sunDir), 0.0);
          vec3 subsurface = sunColor * backLight * 0.1 * (1.0 - metalness);
          
          return ambient + diffuse + fresnelColor + reflection + subsurface;
      }

      // Atmospheric fog (legacy per-material; disabled by default in favor of post-process fog)
      uniform bool materialFogEnabled;
      vec3 applyAtmosphericFog(vec3 color, float distance) {
          if (!materialFogEnabled) return color;
          float fogDensity = 0.0002;
          float fogFactor = 1.0 - exp(-distance * fogDensity);
          vec3 fogColor = vec3(0.7, 0.8, 0.9);
          return mix(color, fogColor, clamp(fogFactor, 0.0, 0.6));
      }

      void main() {
          vec4 texColor = texture2D(map, vUv);
          vec3 albedo = texColor.rgb;
          
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          
          vec3 color = calculateEnhancedLighting(albedo, normal, viewDir) * albedo;
          
          float distance = length(vViewPosition);
          color = applyAtmosphericFog(color, distance);
          
          // Tone mapping and gamma correction
          color = color / (color + vec3(1.0));
          color = pow(color, vec3(1.0/2.2));
          
          gl_FragColor = vec4(color, texColor.a);
      }
    `;

    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        map: { value: albedoTexture },
        normalMap: { value: normalMap || null },
        envMap: { value: envMap },
        roughness: { value: 0.8 },
        metalness: { value: 0.0 },
        envMapIntensity: { value: 0.3 },
        time: { value: 0.0 },
        
        // Sun uniforms (updated by Engine via SunController)
        sunDirection: { value: new THREE.Vector3(50, 120, 50).normalize() },
        sunColor: { value: new THREE.Color(1.0, 0.95, 0.8) },
        
        // Shadow uniforms (will be updated by ShadowSystem) - start disabled
        shadowMap0: { value: null },
        shadowMap1: { value: null },
        shadowMap2: { value: null },
        shadowMatrix0: { value: new THREE.Matrix4() },
        shadowMatrix1: { value: new THREE.Matrix4() },
        shadowMatrix2: { value: new THREE.Matrix4() },
        shadowCascades: { value: 3 },
        shadowDistances: { value: [25, 50, 100] },
        shadowSoftness: { value: 2.0 },
        shadowBias: { value: 0.0005 },
        shadowNormalBias: { value: 0.02 },
        shadowIntensity: { value: 0.0 }, // Start with shadows disabled
        shadowResolution: { value: 1024 }, // Default shadow resolution
        materialFogEnabled: { value: false }
      },
      defines: envMap ? { USE_ENVMAP: true } : {},
      side: THREE.FrontSide,
      transparent: false
    });

    this.startTime = Date.now();
  }

  /**
   * Update uniforms that change over time
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateUniforms(_camera: THREE.Camera): void {
    (this.uniforms as Record<string, { value: unknown }>).time.value = (Date.now() - this.startTime);
  }

  /**
   * Set material properties
   */
  setMaterialProperties(roughness: number, metalness: number, envMapIntensity: number): void {
    const uniforms = this.uniforms as Record<string, { value: unknown }>;
    uniforms.roughness.value = roughness;
    uniforms.metalness.value = metalness;
    uniforms.envMapIntensity.value = envMapIntensity;
  }

  /**
   * Update sun lighting uniforms (direction + color)
   */
  setSunUniforms(direction: THREE.Vector3, color: THREE.Color): void {
    const uniforms = this.uniforms as Record<string, { value: unknown }>;
    (uniforms.sunDirection.value as THREE.Vector3).copy(direction);
    (uniforms.sunColor.value as THREE.Color).copy(color);
  }

  /**
   * Update shadow uniforms from ShadowSystem
   */
  updateShadowUniforms(shadowUniforms: Record<string, { value: unknown }>): void {
    const uniforms = this.uniforms as Record<string, { value: unknown }>;
    Object.keys(shadowUniforms).forEach(key => {
      if (uniforms[key]) {
        uniforms[key].value = shadowUniforms[key].value;
      }
    });
  }
}
