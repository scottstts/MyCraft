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
    normalMap?: THREE.Texture,
    atlasInfo?: { tileSize: number; atlasSize: number }
  ) {
    const vertexShader = `
      // Block vertex shader using per-vertex colors for AO/skylight/tint
      attribute vec3 color;
      varying vec3 vColor;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying vec3 vViewPosition;

      void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vColor = color;
          
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          
          vec4 viewPosition = viewMatrix * worldPosition;
          vViewPosition = viewPosition.xyz;
          
          gl_Position = projectionMatrix * viewPosition;
      }
    `;

    const fragmentShader = `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying vec3 vViewPosition;
      varying vec3 vColor;

      uniform sampler2D map;
      uniform sampler2D normalMap;
      uniform samplerCube envMap;
      uniform float roughness;
      uniform float metalness;
      uniform float envMapIntensity;
      uniform float time;
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
      uniform float shadowBlendFraction;
      uniform float shadowBlendMin;
      uniform float shadowCascadeSize[4];
      uniform float shadowCamNear[4];
      uniform float shadowCamFar[4];

      // Cloud shadow uniforms (projected procedural clouds)
      uniform bool cloudShadowEnabled;
      uniform float cloudShadowIntensity; // 0..1
      uniform float cloudShadowAltitude;  // world Y of cloud plane
      uniform float cloudShadowScale;     // world units per cloud tile (default ~100)
      uniform float cloudCoverage;        // match CloudsLayer
      uniform float cloudDensity;         // match CloudsLayer
      uniform vec2 cloudWind;             // world-directional speed proxy

      // Day/night factor (0=night, 1=day)
      uniform float dayLight;
      // Star light factor (0..1) tiny ambient boost at night
      uniform float starLight;

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
      float sampleShadowCascade(int ci, vec3 worldPos, vec3 normal, vec3 sunDir, float biasNorm) {
          // Stable world-space bias based on world-units-per-texel for this cascade
          float worldTexel = shadowCascadeSize[ci] / max(1.0, shadowResolution);
          float biasWorld = biasNorm * worldTexel;
          
          // Apply slope-scaled bias: surfaces facing away from light need more bias
          float slopeFactor = 1.0 - max(dot(normal, sunDir), 0.0);
          float slopeBias = biasWorld * (1.0 + slopeFactor * 2.0);
          
          // Push receiver position towards light to avoid self-shadowing
          vec3 receiverPos = worldPos + sunDir * slopeBias + normal * (biasWorld * 0.5);
          vec4 sc = getShadowCoord(ci, receiverPos);
          sc.xyz /= sc.w;
          sc = sc * 0.5 + 0.5;
          if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z < 0.0 || sc.z > 1.0) return 1.0;

          // Convert desired world-space kernel width to UV units using cascade size
          float uvPerWorld = 1.0 / max(shadowCascadeSize[ci], 1e-3);
          float base = shadowSoftness; // interpret softness as world units
          float texelSize = max(base * uvPerWorld, 1.0 / shadowResolution);
          
          // Add small constant bias to receiver depth to prevent z-fighting
          float depthBias = 0.001 + 0.002 * slopeFactor;
          float receiver = sc.z - depthBias;

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
          float searchRadius = 4.0 * texelSize;
          // Anchor rotation to shadow texel grid for temporal stability
          vec2 scTexel = floor(sc.xy * shadowResolution);
          float angle = hash12(scTexel) * 6.2831853;
          float s = sin(angle), c = cos(angle);
          mat2 rot = mat2(c, -s, s, c);
          float blockerSum = 0.0;
          float blockerCount = 0.0;
          for (int i = 0; i < POISSON_COUNT; i++) {
            vec2 o = rot * poisson[i] * searchRadius;
            float d = sampleShadowMap(ci, sc.xy + o);
            // Blocker is anything closer to the light than receiver
            if (d < receiver - depthBias) { blockerSum += d; blockerCount += 1.0; }
          }
          float avgBlocker = blockerCount > 0.0 ? (blockerSum / blockerCount) : receiver;
          float penumbra = blockerCount > 0.0 ? clamp((receiver - avgBlocker) / max(avgBlocker, 0.01), 0.0, 1.0) : 0.0;

          float radius = texelSize * (2.5 + 12.0 * penumbra);
          float shadow = 0.0;
          for (int i = 0; i < POISSON_COUNT; i++) {
            vec2 o = rot * poisson[i] * radius;
            float sd = sampleShadowMap(ci, sc.xy + o);
            // Fragment is lit if its depth is less than or equal to shadow map depth
            shadow += (receiver <= sd + depthBias) ? 1.0 : 0.0;
          }
          shadow /= float(POISSON_COUNT);
          return shadow;
      }

      float sampleShadow(vec3 worldPos, vec3 normal, vec3 sunDir) {
          // Return 1.0 (no shadow) if shadow system is disabled
          if (shadowIntensity <= 0.0) return 1.0;
          // Normal-bias adjustment
          float nb = shadowNormalBias * (1.0 - max(dot(normal, sunDir), 0.0));

          // Frustum-based cascade selection using camera-space Z depth
          float viewDepth = -vViewPosition.z;

          // Determine base cascade index
          int ci = 0;
          if (shadowCascades > 1 && viewDepth > shadowDistances[0]) ci = 1;
          if (shadowCascades > 2 && viewDepth > shadowDistances[1]) ci = 2;
          if (shadowCascades > 3 && viewDepth > shadowDistances[2]) ci = 3;

          vec3 sunDirN = normalize(sunDir);
          float sBase = sampleShadowCascade(ci, worldPos + normal * nb, normal, sunDirN, shadowBias);

          // Symmetric blending near the closest cascade boundary to avoid seams
          // Find nearest boundary index b (0..shadowCascades-2)
          float d0 = (shadowCascades > 1) ? abs(viewDepth - shadowDistances[0]) : 1e9;
          float d1 = (shadowCascades > 2) ? abs(viewDepth - shadowDistances[1]) : 1e9;
          float d2 = (shadowCascades > 3) ? abs(viewDepth - shadowDistances[2]) : 1e9;
          float minD = d0;
          int b = 0;
          if (d1 < minD) { minD = d1; b = 1; }
          if (d2 < minD) { minD = d2; b = 2; }

          // Only blend if a boundary exists (i.e., at least 2 cascades)
          if (shadowCascades > 1) {
            // Determine half-width of the blend zone around boundary b
            float segPrev = (b == 0) ? shadowDistances[0] : (shadowDistances[b] - shadowDistances[b - 1]);
            float segNext = (shadowCascades > b + 1) ? (shadowDistances[b + 1] - shadowDistances[b]) : segPrev;
            float halfWidth = 0.5 * shadowBlendFraction * min(segPrev, segNext);
            // Enforce an absolute minimum blend half-width in world units for stability
            halfWidth = max(shadowBlendMin, halfWidth);

            float boundary = shadowDistances[b];
            if (abs(viewDepth - boundary) < halfWidth) {
              int leftCascade = b;
              int rightCascade = min(b + 1, shadowCascades - 1);

              float sL = sampleShadowCascade(leftCascade, worldPos + normal * nb, normal, sunDirN, shadowBias);
              float sR = sampleShadowCascade(rightCascade, worldPos + normal * nb, normal, sunDirN, shadowBias);
              // Smooth symmetric blend around boundary using smoothstep
              float t = smoothstep(-halfWidth, halfWidth, viewDepth - boundary);
              float sBlend = mix(sL, sR, t);
              return mix(1.0 - shadowIntensity, 1.0, sBlend);
            }
          }

          // Not near a boundary: use base cascade only
          return mix(1.0 - shadowIntensity, 1.0, sBase);
      }

      // Enhanced lighting calculation with shadows
      
      // --- Procedural cloud utilities (match CloudsLayer) ---
      float chash(vec2 p){ return fract(sin(dot(p, vec2(41.0,289.0))) * 45758.5453); }
      float cnoise(vec2 p){
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = chash(i);
          float b = chash(i + vec2(1.0, 0.0));
          float c = chash(i + vec2(0.0, 1.0));
          float d = chash(i + vec2(1.0, 1.0));
          vec2 u = f*f*(3.0-2.0*f);
          return mix(a, b, u.x) + (c - a)*u.y*(1.0 - u.x) + (d - b)*u.x*u.y;
      }
      float cfbm(vec2 p){
          float v = 0.0; float a = 0.5;
          for(int i=0;i<5;i++){ v += a * cnoise(p); p *= 2.02; a *= 0.5; }
          return v;
      }
      // Project world point to cloud plane along sun direction and return 0..1 cloud amount
      float cloudAmountAt(vec3 worldPos, vec3 sunDir){
          // Avoid extreme projection when sun at horizon
          if (sunDir.y <= 0.05) return 0.0;
          float t = (cloudShadowAltitude - worldPos.y) / sunDir.y;
          if (t <= 0.0) return 0.0;
          vec3 hit = worldPos + sunDir * t;
          // Convert to tiled space; follow CloudsLayer: 4000/40 = 100 world units per tile
          vec2 uv = hit.xz / max(1e-3, cloudShadowScale);
          // Match cloud movement: CloudsLayer uses + uWind * (uTime * 0.01)
          float tSec = time * 0.001; // time in seconds
          uv += cloudWind * (tSec * 0.01);
          float base = cfbm(uv * 0.5) * 0.9 + cfbm(uv * 1.7) * 0.1;
          float clouds = smoothstep(cloudCoverage, cloudCoverage + 0.25*(1.0-cloudDensity), base);
          clouds = pow(clouds, 1.5);
          return clamp(clouds, 0.0, 1.0);
      }

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

      // Clamp UV to current atlas tile interior to avoid cross-tile bleed when supersampling
      vec2 clampUvToTile(vec2 uv) {
          if (atlasSize <= 1.0) return uv; // not an atlas: no clamp needed
          float tileW = 1.0 / atlasSize;
          float tileIndex = floor(uv.x / tileW);
          float uMin = tileIndex * tileW;
          float uMax = uMin + tileW;
          // Match mesher epsilon: half-pixel in UV space
          float epsU = 0.5 / (atlasSize * tileSize);
          float epsV = 0.5 / max(tileSize, 1.0);
          uv.x = clamp(uv.x, uMin + epsU, uMax - epsU);
          uv.y = clamp(uv.y, 0.0 + epsV, 1.0 - epsV);
          return uv;
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
          vec4 base = texture2D(tex, uv);
          if (!aaEnabled) return base;

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
            // Major axis in UV space
            vec2 major = (lenx > leny) ? dFdx(uv) : dFdy(uv);
            float mlen = length(major);
            if (mlen > 1e-5) major /= mlen; else major = vec2(1.0, 0.0);

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
              vec2 o = major * (t * 0.5);        // ±0.5 pixel along major axis
              // On non-atlas textures (single image with mipmaps), push a slight lod bias to avoid banding
              float lodBias = (atlasSize <= 1.0 && aaLodBiasEnabled) ? (aaLodBias * smoothstep(1.5, 8.0, maxLen)) : 0.0;
              vec4 c = texLod2D(tex, clampUvToTile(uv + o), lodBias);
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
          vec4 c1 = texLod2D(tex, clampUvToTile(uv + o1), lodBiasIso);
          vec4 c2 = texLod2D(tex, clampUvToTile(uv + o2), lodBiasIso);
          vec4 c3 = texLod2D(tex, clampUvToTile(uv + o3), lodBiasIso);
          vec4 c4 = texLod2D(tex, clampUvToTile(uv + o4), lodBiasIso);
          vec4 avg4 = (c1 + c2 + c3 + c4) * 0.25;
          return mix(base, avg4, k);
      }

      vec3 calculateEnhancedLighting(vec3 albedo, vec3 normal, vec3 viewDir) {
          vec3 color = vec3(0.0);
          
          // Enhanced ambient with AO, modulated by day/night
          vec3 dayAmb = vec3(0.4, 0.5, 0.6) * 0.20;
          vec3 nightAmb = vec3(0.01, 0.015, 0.02) * 0.12;
          vec3 ambBase = mix(nightAmb, dayAmb, clamp(dayLight, 0.0, 1.0));
          vec3 starAmb = vec3(0.02, 0.025, 0.04) * 0.35 * clamp(starLight, 0.0, 1.0);
          vec3 ambient = (ambBase + starAmb);
          
      // Main sun light (provided via uniforms)
      vec3 sunDir = normalize(sunDirection);
      float sunDot = max(dot(normal, sunDir), 0.0);
          
          // Sample shadow
          float shadowFactor = sampleShadow(vWorldPosition, normal, sunDir);

          // Multiply by procedural cloud shadow (stable world-projection)
          if (cloudShadowEnabled && cloudShadowIntensity > 0.0) {
            float camt = cloudAmountAt(vWorldPosition, sunDir);
            float cloudShade = 1.0 - cloudShadowIntensity * camt;
            shadowFactor *= cloudShade;
          }
          
          // Apply shadow to diffuse lighting
          // Crisper sun diffuse for stronger, clearer shadows
          float wrappedDiffuse = sunDot;
          vec3 diffuse = sunColor * wrappedDiffuse * shadowFactor * clamp(dayLight, 0.0, 1.0);
          
          // Fresnel rim lighting
          float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
          vec3 fresnelColor = vec3(0.8, 0.9, 1.0) * fresnel * 0.2 * clamp(dayLight, 0.0, 1.0);
          
          // Environment reflection (only if envMap is available)
          vec3 reflection = vec3(0.0);
          #ifdef USE_ENVMAP
            vec3 reflectDir = reflect(-viewDir, normal);
            vec3 envColor = textureCube(envMap, reflectDir).rgb;
            float roughAA = specularAARoughness(roughness, normal);
            reflection = envColor * envMapIntensity * (1.0 - roughAA) * fresnel * clamp(dayLight, 0.0, 1.0);
          #endif
          
          // Subsurface scattering
          float backLight = max(dot(normal, -sunDir), 0.0);
          vec3 subsurface = sunColor * backLight * 0.1 * (1.0 - metalness) * clamp(dayLight, 0.0, 1.0);
          
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
          vec4 texColor = texture2D_AA(map, vUv);
          vec3 albedo = texColor.rgb;
          vec3 tinted = albedo * vColor;
          
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          
          vec3 lit = calculateEnhancedLighting(tinted, normal, viewDir) * tinted;
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

          gl_FragColor = vec4(color, texColor.a * alphaScale);
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
        alphaScale: { value: 1.0 },
        lightingMix: { value: 1.0 },
        
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
        shadowBlendFraction: { value: 0.2 },
        shadowBlendMin: { value: 3.0 },
        shadowCascadeSize: { value: [100, 200, 400, 800] },
        shadowCamNear: { value: [0.1, 0.1, 0.1, 0.1] },
        shadowCamFar: { value: [100, 200, 400, 800] },
        
        // Cloud shadows (enabled by engine when clouds are present)
        cloudShadowEnabled: { value: true },
        cloudShadowIntensity: { value: 0.35 },
        cloudShadowAltitude: { value: 200.0 },
        cloudShadowScale: { value: 100.0 },
        cloudCoverage: { value: 0.45 },
        cloudDensity: { value: 0.65 },
        cloudWind: { value: new THREE.Vector2(Math.cos(Math.PI*0.25)*5.0, Math.sin(Math.PI*0.25)*5.0) },
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

  /** Configure cloud shadow uniforms */
  setCloudShadowUniforms(params: {
    enabled?: boolean;
    intensity?: number;
    altitude?: number;
    scale?: number;
    coverage?: number;
    density?: number;
    wind?: THREE.Vector2;
  }): void {
    const u = this.uniforms as Record<string, { value: unknown }>;
    if (params.enabled !== undefined) u.cloudShadowEnabled.value = !!params.enabled;
    if (params.intensity !== undefined) u.cloudShadowIntensity.value = THREE.MathUtils.clamp(params.intensity, 0, 1);
    if (params.altitude !== undefined) u.cloudShadowAltitude.value = params.altitude;
    if (params.scale !== undefined) u.cloudShadowScale.value = Math.max(1e-3, params.scale);
    if (params.coverage !== undefined) u.cloudCoverage.value = THREE.MathUtils.clamp(params.coverage, 0, 1);
    if (params.density !== undefined) u.cloudDensity.value = THREE.MathUtils.clamp(params.density, 0, 1);
    if (params.wind) (u.cloudWind.value as THREE.Vector2).copy(params.wind);
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
