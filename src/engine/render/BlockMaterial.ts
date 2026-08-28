/**
 * Custom block material with advanced shaders
 * Replaces basic MeshStandardMaterial with enhanced lighting and effects
 */

import * as THREE from 'three';

export class BlockMaterial extends THREE.ShaderMaterial {
  constructor(
    albedoTexture: THREE.Texture,
    envMap: THREE.CubeTexture | null,
    normalMap?: THREE.Texture,
    atlasInfo?: { tileSize: number; atlasSize: number }
  ) {
    const vertexShader = `
      // Block vertex shader using per-vertex tint and ambient occlusion
      #include <common>
      #include <shadowmap_pars_vertex>
      attribute vec3 color;
      attribute float ao;
      varying vec3 vColor;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying vec3 vViewPosition;
      varying float vAmbientOcclusion;

      void main() {
          vUv = uv;
          // Lighting uniforms and world position are world-space. Chunk and
          // seabed meshes only use rigid transforms, so modelMatrix is the
          // correct normal transform here; normalMatrix would be view-space.
          // Three's shadow chunk expects transformedNormal in view space,
          // while the custom lighting path below uses a world-space normal.
          vec3 transformedNormal = normalMatrix * normal;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vColor = color;
          vAmbientOcclusion = clamp(ao, 0.0, 1.0);
          
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          
          vec4 viewPosition = viewMatrix * worldPosition;
          vViewPosition = viewPosition.xyz;

          // Feed the renderer-managed directional shadow coordinates. The
          // custom fragment lighting below consumes getShadowMask() only for
          // direct sun diffuse, preserving the existing AO/environment path.
          #include <shadowmap_vertex>
          
          gl_Position = projectionMatrix * viewPosition;
      }
    `;

    const fragmentShader = `
      #include <common>
      #include <packing>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying vec3 vViewPosition;
      varying vec3 vColor;
      varying float vAmbientOcclusion;

      uniform sampler2D map;
      uniform sampler2D normalMap;
      uniform samplerCube envMap;
      uniform float roughness;
      uniform float metalness;
      uniform float envMapIntensity;
      uniform float alphaScale;
      uniform float lightingMix;

      // Anti-aliasing controls
      uniform bool aaEnabled;
      uniform float aaStrength;   // 0..1
      uniform bool aaLodBiasEnabled; // use explicit LOD bias for non-atlas textures
      uniform float aaLodBias;    // 0..2 typically
      uniform float atlasSize;    // tiles across (U). 1.0 if not using atlas
      uniform float tileSize;     // texels per tile (square)
      uniform float ditherAmount; // 0..1 strength in sRGB LDR (approx 1 LSB at 1.0)
      
      // Sun uniforms (directional light driven by SunController)
      uniform vec3 sunDirection;
      uniform vec3 sunColor;

      // Day/night factor (0=night, 1=day)
      uniform float dayLight;
      // Star light factor (0..1) tiny ambient boost at night
      uniform float starLight;

      // Specular anti-aliasing: broaden roughness near high normal gradients
      float specularAARoughness(float r, vec3 N) {
          // Variance from normal derivatives; clamp to avoid NaNs
          vec3 dnx = dFdx(N);
          vec3 dny = dFdy(N);
          float variance = max(dot(dnx, dnx), dot(dny, dny));
          // Increase roughness based on variance (simple approximation)
          float rr = r*r + variance;
          return clamp(sqrt(rr), 0.0, 1.0);
      }

      // Clamp a sample to the tile selected by the center UV. The center must
      // remain the anchor: clamping from the offset sample itself can move a
      // wide AA tap into a neighboring atlas tile.
      vec2 clampUvToTile(vec2 sampleUv, vec2 centerUv) {
          if (atlasSize <= 1.0) return sampleUv; // not an atlas: no clamp needed
          float tileW = 1.0 / atlasSize;
          float tileIndex = clamp(floor(centerUv.x / tileW), 0.0, atlasSize - 1.0);
          float uMin = tileIndex * tileW;
          float uMax = uMin + tileW;
          // Match mesher epsilon: half-pixel in UV space
          float epsU = 0.5 / (atlasSize * tileSize);
          float epsV = 0.5 / max(tileSize, 1.0);
          sampleUv.x = clamp(sampleUv.x, uMin + epsU, uMax - epsU);
          sampleUv.y = clamp(sampleUv.y, 0.0 + epsV, 1.0 - epsV);
          return sampleUv;
      }

      // Derivative-aware texture sampling to reduce minification shimmer
      // Provide LOD function with graceful fallback if the extension is missing
      #ifdef TEXTURE_LOD_EXT
      vec4 texLod2D(sampler2D tex, vec2 uv, float lod) { return texture2DLodEXT(tex, uv, lod); }
      #else
      vec4 texLod2D(sampler2D tex, vec2 uv, float lod) { return texture2D(tex, uv); }
      #endif

      // Combines 4-tap RGSS with a directional anisotropic kernel when footprint is elongated
      vec4 texture2D_AA(sampler2D tex, vec2 uv) {
          vec4 base = texture2D(tex, clampUvToTile(uv, uv));
          // The atlas intentionally has no mip chain or padded tile borders.
          // Any multi-tap filter can therefore turn a tiny change in the
          // projected footprint into a different mixture of nearest texels.
          // Keep atlas samples single-tap and stable; retain the derivative
          // filter below for standalone textures such as the seabed.
          if (!aaEnabled || atlasSize > 1.0) return base;

          // Estimate pixel footprint in texel units
          vec2 texSize = vec2(max(1.0, atlasSize * tileSize), max(1.0, tileSize));
          vec2 dx_uvt = dFdx(uv) * texSize;
          vec2 dy_uvt = dFdy(uv) * texSize;
          float lenx = length(dx_uvt);
          float leny = length(dy_uvt);
          float maxLen = max(lenx, leny);
          float minLen = max(min(lenx, leny), 1e-5);
          float aniso = maxLen / minLen;

          // Mix factor vs minification
          float k = smoothstep(1.0, 3.0, maxLen) * clamp(aaStrength, 0.0, 1.0);
          if (k <= 0.001) return base;

          // If footprint is strongly elongated, sample along its major axis (screen-aligned stripes case)
          if (aniso > 2.0) {
            // Keep the derivative magnitude. A normalized direction with a
            // raw ±0.5 UV offset spans most of the atlas instead of one pixel.
            vec2 majorDerivative = (lenx > leny) ? dFdx(uv) : dFdy(uv);

            // 7- or 9-tap kernel depending on minification (clamped)
            int taps = (maxLen > 6.0) ? 9 : 7;
            float halfT = float(taps - 1) * 0.5;

            // Cover the pixel footprint width (±0.5 along major) with a Gaussian
            vec4 sum = vec4(0.0);
            float wsum = 0.0;
            for (int i = 0; i < 9; i++) {
              if (i >= taps) break;
              float fi = float(i) - halfT;       // [-halfT, halfT]
              float t = fi / max(halfT, 1.0);    // [-1, 1]
              float w = exp(-t*t * 3.0);         // Gaussian-ish weights
              vec2 o = majorDerivative * (t * 0.5); // ±0.5 pixel footprint
              // On non-atlas textures (single image with mipmaps), push a slight lod bias to avoid banding
              float lodBias = (atlasSize <= 1.0 && aaLodBiasEnabled) ? (aaLodBias * smoothstep(1.5, 8.0, maxLen)) : 0.0;
              vec4 c = texLod2D(tex, clampUvToTile(uv + o, uv), lodBias);
              sum += c * w; wsum += w;
            }
            vec4 anisoAvg = sum / max(wsum, 1e-5);
            return mix(base, anisoAvg, k);
          }

          // Otherwise use 4-tap rotated grid inside the pixel footprint (good isotropic prefilter)
          vec2 dx = dFdx(uv);
          vec2 dy = dFdy(uv);
          const float ofs = 0.35;
          vec2 o1 = ( dx + dy) * ofs;
          vec2 o2 = ( dx - dy) * ofs;
          vec2 o3 = (-dx + dy) * ofs;
          vec2 o4 = (-dx - dy) * ofs;

          float lodBiasIso = (atlasSize <= 1.0 && aaLodBiasEnabled) ? (aaLodBias * smoothstep(1.5, 8.0, maxLen)) : 0.0;
          vec4 c1 = texLod2D(tex, clampUvToTile(uv + o1, uv), lodBiasIso);
          vec4 c2 = texLod2D(tex, clampUvToTile(uv + o2, uv), lodBiasIso);
          vec4 c3 = texLod2D(tex, clampUvToTile(uv + o3, uv), lodBiasIso);
          vec4 c4 = texLod2D(tex, clampUvToTile(uv + o4, uv), lodBiasIso);
          vec4 avg4 = (c1 + c2 + c3 + c4) * 0.25;
          return mix(base, avg4, k);
      }

      vec4 calculateEnhancedLighting(vec3 albedo, vec3 normal, vec3 viewDir, float ambientOcclusion) {
          // Ambient visibility is kept separate from direct sun lighting.
          vec3 dayAmb = vec3(0.4, 0.5, 0.6) * 0.20;
          vec3 nightAmb = vec3(0.01, 0.015, 0.02) * 0.12;
          vec3 ambBase = mix(nightAmb, dayAmb, clamp(dayLight, 0.0, 1.0));
          vec3 starAmb = vec3(0.02, 0.025, 0.04) * 0.35 * clamp(starLight, 0.0, 1.0);
          float ao = clamp(ambientOcclusion, 0.0, 1.0);
          vec3 ambient = (ambBase + starAmb) * ao;
          
          // Main sun light (provided via uniforms)
          vec3 sunDir = normalize(sunDirection);
          float sunDot = max(dot(normal, sunDir), 0.0);
          
          // Use Three.js's native directional shadow mask. It is applied only
          // to direct sun diffuse; AO, environment reflection, and the
          // existing post-process passes remain independent of cast shadows.
          float shadowFactor = getShadowMask();
          
          // Apply shadow to diffuse lighting
          // Crisper sun diffuse for stronger, clearer shadows
          float wrappedDiffuse = sunDot;
          vec3 diffuse = sunColor * wrappedDiffuse * shadowFactor * clamp(dayLight, 0.0, 1.0);
          
          // Fresnel rim lighting
          float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
          vec3 fresnelColor = vec3(0.8, 0.9, 1.0) * fresnel * 0.2 * clamp(dayLight, 0.0, 1.0) * ao;
          
          // Environment reflection (only if envMap is available)
          vec3 reflection = vec3(0.0);
          #ifdef USE_ENVMAP
            vec3 reflectDir = reflect(-viewDir, normal);
            vec3 envColor = textureCube(envMap, reflectDir).rgb;
            float roughAA = specularAARoughness(roughness, normal);
            reflection = envColor * envMapIntensity * (1.0 - roughAA) * fresnel * clamp(dayLight, 0.0, 1.0) * ao;
          #endif
          
          // Subsurface scattering
          float backLight = max(dot(normal, -sunDir), 0.0);
          vec3 subsurface = sunColor * backLight * 0.1 * (1.0 - metalness) * clamp(dayLight, 0.0, 1.0);
          
          vec3 indirect = ambient + fresnelColor + reflection;
          vec3 total = indirect + diffuse + subsurface;
          float indirectLuma = dot(max(indirect, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
          float totalLuma = dot(max(total, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
          float indirectMask = clamp(indirectLuma / max(totalLuma, 1e-4), 0.0, 1.0);
          return vec4(total, indirectMask);
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
          vec4 texColor = texture2D_AA(map, vUv);
          vec3 albedo = texColor.rgb;
          vec3 tinted = albedo * vColor;
          
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          
          vec4 lighting = calculateEnhancedLighting(tinted, normal, viewDir, vAmbientOcclusion);
          vec3 lit = lighting.rgb * tinted;
          vec3 color = mix(tinted, lit, clamp(lightingMix, 0.0, 1.0));
          
          float distance = length(vViewPosition);
          color = applyAtmosphericFog(color, distance);
          
          // Tone mapping and gamma correction
          color = color / (color + vec3(1.0));
          color = pow(color, vec3(1.0/2.2));

          // Small blue-noise-ish dithering in sRGB to reduce visible banding downstream
          if (ditherAmount > 0.0) {
            float n1 = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);
            float n2 = fract(sin(dot(gl_FragCoord.yx, vec2(39.3467,11.135))) * 24634.6345);
            float tri = (n1 + n2) - 1.0; // triangular distribution in [-1,1]
            float amp = (ditherAmount / 255.0); // ~1 LSB at 1.0
            color += tri * amp;
          }

          // Opaque block pixels use alpha as an internal indirect-light mask
          // for the post-process SSAO pass. This material is never blended.
          float indirectMask = lighting.a * clamp(lightingMix, 0.0, 1.0);
          gl_FragColor = vec4(color, 1.0 - indirectMask);
      }
    `;

    super({
      vertexShader,
      fragmentShader,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.lights,
        {
          map: { value: albedoTexture },
          normalMap: { value: normalMap || null },
          envMap: { value: envMap },
          roughness: { value: 0.8 },
          metalness: { value: 0.0 },
          envMapIntensity: { value: 0.3 },
          alphaScale: { value: 1.0 },
          lightingMix: { value: 1.0 },

          // Sun uniforms (updated by Engine via SunController)
          sunDirection: { value: new THREE.Vector3(50, 120, 50).normalize() },
          sunColor: { value: new THREE.Color(1.0, 0.95, 0.8) },
          dayLight: { value: 1.0 },
          starLight: { value: 0.0 },
          materialFogEnabled: { value: false },
          // Anti-aliasing defaults
          aaEnabled: { value: true },
          aaStrength: { value: 1.0 },
          aaLodBiasEnabled: { value: true },
          aaLodBias: { value: 0.9 },
          atlasSize: { value: (atlasInfo?.atlasSize ?? 1) },
          tileSize: { value: (atlasInfo?.tileSize ?? 16) },
          ditherAmount: { value: 0.75 }
        }
      ]),
      defines: envMap ? { USE_ENVMAP: true } : {},
      side: THREE.FrontSide,
      transparent: false,
      lights: true,
    });
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

  setAlphaScale(a: number): void {
    const uniforms = this.uniforms as Record<string, { value: unknown }>;
    uniforms.alphaScale.value = THREE.MathUtils.clamp(a, 0, 1);
  }

  setLightingMix(t: number): void {
    const uniforms = this.uniforms as Record<string, { value: unknown }>;
    uniforms.lightingMix.value = THREE.MathUtils.clamp(t, 0, 1);
  }

  /** Configure in-shader anti-aliasing strength (0..1) and toggle */
  setAntialiasing(enabled: boolean, strength = 1.0): void {
    const u = this.uniforms as Record<string, { value: unknown }>;
    u.aaEnabled.value = !!enabled;
    u.aaStrength.value = THREE.MathUtils.clamp(strength, 0, 1);
  }

  /** Configure LOD bias AA (for non-atlas textures with mipmaps such as seabed sand) */
  setAALodBias(enabled: boolean, bias = 0.9): void {
    const u = this.uniforms as Record<string, { value: unknown }>;
    u.aaLodBiasEnabled.value = !!enabled;
    u.aaLodBias.value = THREE.MathUtils.clamp(bias, 0, 2);
  }

  /** Update atlas info (tile size/atlas size) to keep AA sampling stable */
  setAtlasInfo(info: { tileSize: number; atlasSize: number }): void {
    const u = this.uniforms as Record<string, { value: unknown }>;
    u.tileSize.value = Math.max(1, info.tileSize | 0);
    u.atlasSize.value = Math.max(1, info.atlasSize | 0);
  }

  /**
   * Update sun lighting uniforms (direction + color)
   */
  setSunUniforms(direction: THREE.Vector3, color: THREE.Color): void {
    const uniforms = this.uniforms as Record<string, { value: unknown }>;
    (uniforms.sunDirection.value as THREE.Vector3).copy(direction);
    (uniforms.sunColor.value as THREE.Color).copy(color);
  }

  /** Day/night factor (0=night, 1=day) */
  setDayLight(level: number): void {
    const uniforms = this.uniforms as Record<string, { value: unknown }>;
    uniforms.dayLight.value = THREE.MathUtils.clamp(level, 0, 1);
  }

  /** Star light factor (0..1) */
  setStarLight(level: number): void {
    const uniforms = this.uniforms as Record<string, { value: unknown }>;
    uniforms.starLight.value = THREE.MathUtils.clamp(level, 0, 1);
  }

}
