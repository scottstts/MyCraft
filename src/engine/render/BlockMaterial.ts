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

      // Enhanced lighting calculation
      vec3 calculateEnhancedLighting(vec3 albedo, vec3 normal, vec3 viewDir) {
          vec3 color = vec3(0.0);
          
          // Enhanced ambient with AO
          vec3 ambient = vec3(0.4, 0.5, 0.6) * 0.4 * vAmbientOcclusion;
          
          // Main sun light
          vec3 sunDir = normalize(vec3(0.5, 1.0, 0.3));
          vec3 sunColor = vec3(1.0, 0.95, 0.8) * 1.2;
          float sunDot = max(dot(normal, sunDir), 0.0);
          
          // Wrapped lighting for softer shadows
          float wrappedDiffuse = (sunDot + 0.3) / 1.3;
          vec3 diffuse = sunColor * wrappedDiffuse;
          
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
        time: { value: 0.0 }
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
}