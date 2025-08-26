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
      uniform sampler2D shadowMap3;
      uniform mat4 shadowMatrix0;
      uniform mat4 shadowMatrix1;
      uniform mat4 shadowMatrix2;
      uniform mat4 shadowMatrix3;
      uniform int shadowCascades;
      uniform float shadowDistances[4];
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

      // Helpers to select cascade-specific matrix and sampler without non-uniform sampler variables
      vec4 getShadowCoord(int ci, vec3 worldPos) {
          if (ci == 0) return shadowMatrix0 * vec4(worldPos, 1.0);
          if (ci == 1) return shadowMatrix1 * vec4(worldPos, 1.0);
          if (ci == 2) return shadowMatrix2 * vec4(worldPos, 1.0);
          return shadowMatrix3 * vec4(worldPos, 1.0);
      }
      float sampleShadowMap(int ci, vec2 uv) {
          if (ci == 0) return texture2D(shadowMap0, uv).r;
          if (ci == 1) return texture2D(shadowMap1, uv).r;
          if (ci == 2) return texture2D(shadowMap2, uv).r;
          return texture2D(shadowMap3, uv).r;
      }

      // Compute PCSS-style soft shadow with cascade selection
      float sampleShadowCascade(int ci, vec3 worldPos, vec3 normal, float bias) {
          vec4 sc = getShadowCoord(ci, worldPos);
          sc.xyz /= sc.w;
          sc = sc * 0.5 + 0.5;
          if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z < 0.0 || sc.z > 1.0) return 1.0;

          float texelSize = max(1.0 / shadowResolution, 0.0004);
          float receiver = sc.z - bias;

          // Poisson disk
          poisson[0] = vec2(-0.613392, 0.617481);
          poisson[1] = vec2(0.170019, -0.040254);
          poisson[2] = vec2(-0.299417, 0.791925);
          poisson[3] = vec2(0.645680, 0.493210);
          poisson[4] = vec2(-0.651784, 0.717887);
          poisson[5] = vec2(0.421003, 0.027070);
          poisson[6] = vec2(0.161360, -0.914412);
          poisson[7] = vec2(-0.725000, -0.045000);

          // Blocker search (PCSS)
          float searchRadius = shadowSoftness * 4.0 * texelSize;
          float angle = hash12(sc.xy * 1024.0) * 6.2831853;
          float s = sin(angle), c = cos(angle);
          mat2 rot = mat2(c, -s, s, c);
          float blockerSum = 0.0;
          float blockerCount = 0.0;
          for (int i = 0; i < POISSON_COUNT; i++) {
            vec2 o = rot * poisson[i] * searchRadius;
            float d = sampleShadowMap(ci, sc.xy + o);
            if (d < receiver) { blockerSum += d; blockerCount += 1.0; }
          }
          float avgBlocker = blockerCount > 0.0 ? (blockerSum / blockerCount) : receiver;
          float penumbra = blockerCount > 0.0 ? clamp((receiver - avgBlocker) / max(avgBlocker, 1e-3), 0.0, 1.0) : 0.0;

          float radius = texelSize * (2.5 + 12.0 * penumbra);
          float shadow = 0.0;
          for (int i = 0; i < POISSON_COUNT; i++) {
            vec2 o = rot * poisson[i] * radius;
            float sd = sampleShadowMap(ci, sc.xy + o);
            shadow += receiver <= sd ? 1.0 : 0.0;
          }
          shadow /= float(POISSON_COUNT);
          return shadow;
      }

      float sampleShadow(vec3 worldPos, vec3 normal, vec3 sunDir) {
          // Return 1.0 (no shadow) if shadow system is disabled
          if (shadowIntensity <= 0.0) return 1.0;
          // Normal-bias adjustment
          float nb = shadowNormalBias * (1.0 - max(dot(normal, sunDir), 0.0));

          // Determine cascade by view depth
          float viewDepth = -vViewPosition.z; // perspective-friendly metric
          int ci = 0;
          if (shadowCascades > 1 && viewDepth > shadowDistances[0]) ci = 1;
          if (shadowCascades > 2 && viewDepth > shadowDistances[1]) ci = 2;
          if (shadowCascades > 3 && viewDepth > shadowDistances[2]) ci = 3;

          float bias = shadowBias + nb;
          float s0 = sampleShadowCascade(ci, worldPos + normal * nb, normal, bias);
          return mix(1.0 - shadowIntensity, 1.0, s0);
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
        shadowMap3: { value: null },
        shadowMatrix0: { value: new THREE.Matrix4() },
        shadowMatrix1: { value: new THREE.Matrix4() },
        shadowMatrix2: { value: new THREE.Matrix4() },
        shadowMatrix3: { value: new THREE.Matrix4() },
        shadowCascades: { value: 3 },
        shadowDistances: { value: [25, 50, 100, 200] },
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
