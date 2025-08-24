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

      // PCF Shadow sampling with cascade selection
      float sampleShadow(vec3 worldPos, vec3 normal, vec3 sunDir) {
          // Return 1.0 (no shadow) if shadow system is disabled
          if (shadowIntensity <= 0.0) return 1.0;
          
          float viewDistance = length(vViewPosition);
          int cascadeIndex = 0;
          
          // Select appropriate cascade
          for (int i = 0; i < shadowCascades - 1; i++) {
              if (viewDistance > shadowDistances[i]) {
                  cascadeIndex = i + 1;
              }
          }
          
          // Transform world position to shadow map space
          vec4 shadowCoord;
          if (cascadeIndex == 0) {
              shadowCoord = shadowMatrix0 * vec4(worldPos, 1.0);
          } else if (cascadeIndex == 1) {
              shadowCoord = shadowMatrix1 * vec4(worldPos, 1.0);
          } else {
              shadowCoord = shadowMatrix2 * vec4(worldPos, 1.0);
          }
          
          shadowCoord = shadowCoord * 0.5 + 0.5; // Convert to [0,1] range
          
          if (shadowCoord.x < 0.0 || shadowCoord.x > 1.0 || 
              shadowCoord.y < 0.0 || shadowCoord.y > 1.0) {
              return 1.0; // Outside shadow map
          }
          
          // Apply bias to prevent shadow acne
          float bias = shadowBias + shadowNormalBias * (1.0 - max(dot(normal, sunDir), 0.0));
          float shadowDepth = shadowCoord.z - bias;
          
          // PCF sampling for soft shadows
          float shadow = 0.0;
          float texelSize = shadowSoftness / 1024.0;
          int samples = 0;
          
          for (int x = -1; x <= 1; x++) {
              for (int y = -1; y <= 1; y++) {
                  vec2 offset = vec2(float(x), float(y)) * texelSize;
                  float sampleDepth;
                  
                  if (cascadeIndex == 0) {
                      sampleDepth = texture2D(shadowMap0, shadowCoord.xy + offset).r;
                  } else if (cascadeIndex == 1) {
                      sampleDepth = texture2D(shadowMap1, shadowCoord.xy + offset).r;
                  } else {
                      sampleDepth = texture2D(shadowMap2, shadowCoord.xy + offset).r;
                  }
                  
                  shadow += shadowDepth <= sampleDepth ? 1.0 : 0.0;
                  samples++;
              }
          }
          
          shadow /= float(samples);
          return mix(1.0 - shadowIntensity, 1.0, shadow);
      }

      // Enhanced lighting calculation with shadows
      vec3 calculateEnhancedLighting(vec3 albedo, vec3 normal, vec3 viewDir) {
          vec3 color = vec3(0.0);
          
          // Enhanced ambient with AO
          vec3 ambient = vec3(0.4, 0.5, 0.6) * 0.4 * vAmbientOcclusion;
          
          // Main sun light
          vec3 sunDir = normalize(vec3(0.5, 1.0, 0.3));
          vec3 sunColor = vec3(1.0, 0.95, 0.8) * 1.2;
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

      // Atmospheric fog
      vec3 applyAtmosphericFog(vec3 color, float distance) {
          float fogDensity = 0.0003;
          float fogFactor = 1.0 - exp(-distance * fogDensity);
          vec3 fogColor = vec3(0.7, 0.8, 0.9);
          
          return mix(color, fogColor, clamp(fogFactor, 0.0, 0.8));
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
        shadowBias: { value: -0.0005 },
        shadowNormalBias: { value: 0.02 },
        shadowIntensity: { value: 0.0 } // Start with shadows disabled
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
  updateUniforms(_camera: THREE.Camera): void {
    (this.uniforms as any).time.value = (Date.now() - this.startTime) * 0.001;
  }

  /**
   * Set material properties
   */
  setMaterialProperties(roughness: number, metalness: number, envMapIntensity: number): void {
    (this.uniforms as any).roughness.value = roughness;
    (this.uniforms as any).metalness.value = metalness;
    (this.uniforms as any).envMapIntensity.value = envMapIntensity;
  }

  /**
   * Update shadow uniforms from ShadowSystem
   */
  updateShadowUniforms(shadowUniforms: { [key: string]: { value: any } }): void {
    const uniforms = this.uniforms as any;
    Object.keys(shadowUniforms).forEach(key => {
      if (uniforms[key]) {
        uniforms[key].value = shadowUniforms[key].value;
      }
    });
  }
}