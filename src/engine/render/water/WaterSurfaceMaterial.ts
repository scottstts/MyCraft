import * as THREE from 'three'
import { OCEAN_WAVES, oceanWaveDeclarations } from './OceanWaveField'
import { OCEAN_SURFACE_DEPTH_ALPHA_SCALE } from './WaterOptics'

export interface WaterSurfaceParams {
  map: THREE.Texture | null
  /** Optional terrain top-height field used to locate the real shoreline. */
  terrainHeightMap?: THREE.Texture | null
  terrainHeightScale?: number
  color?: THREE.Color | number | string
  tileScale?: number
  useWorldUV?: boolean
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Ocean meshes are opaque composited surfaces; block water stays blended. */
  ocean?: boolean
}

const terrainHeightFallback = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 255]),
  1,
  1,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
)
terrainHeightFallback.colorSpace = THREE.NoColorSpace
terrainHeightFallback.needsUpdate = true

/**
 * Shared water shader for natural ocean geometry and the legacy off-level
 * block-water fallback.  The ocean path owns displacement, normals, Fresnel,
 * reflection, refraction, and absorption.  The block path keeps the same
 * optics but leaves geometry flat so player-created water does not change its
 * interaction or collision semantics.
 */
export class WaterSurfaceMaterial extends THREE.ShaderMaterial {
  private readonly ocean: boolean

  constructor(params: WaterSurfaceParams) {
    const color = new THREE.Color(params.color ?? 0x1a2744)
    const ocean = params.ocean === true
    const tileScale = Math.max(1e-3, params.tileScale ?? 1.0)
    const useWorldUV = params.useWorldUV !== false
    const b = params.bounds ?? { minX: -1e9, maxX: 1e9, minZ: -1e9, maxZ: 1e9 }
    const terrainHeightMap = params.terrainHeightMap ?? terrainHeightFallback
    const terrainHeightScale = Math.max(1, params.terrainHeightScale ?? 128)
    const waveDeclarations = oceanWaveDeclarations()

    super({
      name: ocean ? 'MyCraftOceanSurface' : 'MyCraftBlockWaterSurface',
      transparent: !ocean,
      toneMapped: false,
      depthWrite: ocean,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: color },
        uTime: { value: 0 },
        uMap: { value: params.map ?? null },
        uUseMap: { value: false },
        uTileScale: { value: tileScale },
        uUseWorldUV: { value: useWorldUV },
        uOceanMode: { value: ocean },
        uWaterLevel: { value: 43.0 },
        uInnerMinX: { value: b.minX },
        uInnerMaxX: { value: b.maxX },
        uInnerMinZ: { value: b.minZ },
        uInnerMaxZ: { value: b.maxZ },
        uTerrainHeightMap: { value: terrainHeightMap },
        uTerrainHeightMapEnabled: { value: !!params.terrainHeightMap },
        uTerrainHeightScale: { value: terrainHeightScale },
        uAlpha: { value: ocean ? 1.0 : 0.7 },
        // The ocean uses the exact dielectric Fresnel result.  A small bias is
        // retained only for the legacy block-water path, whose old alpha
        // tuning expected a slightly brighter grazing rim.
        uFresnelBias: { value: ocean ? 0.0 : 0.02 },
        uEtaAirWater: { value: 1.0 / 1.333 },
        uRefractAmount: { value: 0.18 },
        uAbsorption: { value: new THREE.Vector3(0.20, 0.06, 0.02) },
        uDepthApprox: { value: 4.0 },
        uSpecular: { value: 1.2 },
        uRoughness: { value: 0.35 },
        uSunDir: { value: new THREE.Vector3(0.35, 0.9, 0.2).normalize() },
        uSunColor: { value: new THREE.Color(1.0, 0.98, 0.90) },
        uAmbientIntensity: { value: 1.0 },
        uNightTint: { value: new THREE.Color(0.1, 0.15, 0.25) },
        uWaveAmp: { value: 1.0 },
        uWaveChop: { value: 1.0 },
        uWaveSpeed: { value: 1.0 },
        uFoamIntensity: { value: 0.55 },
        uFoamThreshold: { value: 0.30 },
        uFoamNoise: { value: 1.0 },
        uFoamDrift: { value: 0.15 },
        uSkyTop: { value: new THREE.Color(0.32, 0.50, 0.80) },
        uSkyHorizon: { value: new THREE.Color(0.68, 0.78, 0.92) },
        uSkyAerosol: { value: new THREE.Color(0.36, 0.43, 0.52) },
        uSkyAerosolStrength: { value: 0.14 },
        uSkyRadianceScale: { value: 1.25 },
        uFogColor: { value: new THREE.Color(0.20, 0.52, 0.72) },
        uWaterClarity: { value: 120.0 },
        uUnderwaterFogStrength: { value: 0.72 },
        tSceneColor: { value: null },
        tSceneDepth: { value: null },
        tSunVisibility: { value: null },
        uHasSceneColor: { value: 0 },
        uHasSceneDepth: { value: 0 },
        uForwardProjection: { value: false },
        uHasSunVisibility: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 1024.0 },
        uProjectionMatrix: { value: new THREE.Matrix4() },
        uProjectionMatrixInverse: { value: new THREE.Matrix4() },
        uViewMatrixInverse: { value: new THREE.Matrix4() },
        uCameraUnderwater: { value: false },
        uDebugMode: { value: 0 },
      },
      vertexShader: `
        precision highp float;
        uniform float uTime;
        uniform bool uOceanMode;
        uniform float uWaveAmp;
        uniform float uWaveChop;
        uniform float uWaveSpeed;
        uniform vec2 uResolution;
        uniform bool uUseWorldUV;
        uniform float uTileScale;
        ${waveDeclarations}

        varying vec3 vWorld;
        varying vec3 vBaseWorld;
        varying vec3 vNormalVary;
        varying vec2 vOceanXZ;
        varying float vHeight;
        varying float vViewDepth;

        float oceanTanh(float x) {
          float e = exp(min(2.0 * x, 20.0));
          return (e - 1.0) / (e + 1.0);
        }

        float oceanOmega(float k, float speed) {
          float depthTerm = oceanTanh(min(k * OCEAN_WATER_DEPTH, 20.0));
          float gravityTerm = 9.81 * k * depthTerm;
          float capillaryTerm = OCEAN_SURFACE_TENSION_OVER_DENSITY * k * k * k;
          return sqrt(max(gravityTerm + capillaryTerm, 0.0)) * speed * uWaveSpeed;
        }

        // Estimate the world-space footprint of one pixel on the undeformed
        // water plane. It is independent of the current mesh tessellation,
        // so inner/outer grid transitions cannot switch a spectral band in a
        // visible strip through a bright reflection.
        float oceanPixelFootprint(vec3 surfacePosition) {
          vec3 toCamera = cameraPosition - surfacePosition;
          float distanceToSurface = length(toCamera);
          float surfaceCos = abs(toCamera.y) / max(distanceToSurface, 0.001);
          float pixelAngle = 2.0 / max(abs(projectionMatrix[1][1]) * uResolution.y, 1.0);
          return distanceToSurface * pixelAngle / max(surfaceCos, 0.08);
        }

        vec3 oceanDisplacement(vec3 worldPosition, float time) {
          float vertexFootprint = oceanPixelFootprint(worldPosition);
          return oceanWaveDisplacement(worldPosition, time, vertexFootprint);
        }

        void main() {
          vec4 baseWorld = modelMatrix * vec4(position, 1.0);
          vec3 displacedWorld = baseWorld.xyz;
          vec2 baseXZ = uUseWorldUV ? baseWorld.xz : baseWorld.xz * uTileScale;
          if (uOceanMode) displacedWorld += oceanDisplacement(baseWorld.xyz, uTime);

          vBaseWorld = baseWorld.xyz;
          vWorld = displacedWorld;
          vOceanXZ = baseXZ;
          vHeight = displacedWorld.y;
          vNormalVary = normalize(mat3(modelMatrix) * normal);
          vViewDepth = -(viewMatrix * vec4(displacedWorld, 1.0)).z;
          gl_Position = projectionMatrix * viewMatrix * vec4(displacedWorld, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform vec3 uColor;
        uniform float uTime;
        uniform bool uOceanMode;
        uniform float uWaterLevel;
        uniform float uInnerMinX;
        uniform float uInnerMaxX;
        uniform float uInnerMinZ;
        uniform float uInnerMaxZ;
        uniform sampler2D uTerrainHeightMap;
        uniform bool uTerrainHeightMapEnabled;
        uniform float uTerrainHeightScale;
        uniform float uAlpha;
        uniform float uFresnelBias;
        uniform float uEtaAirWater;
        uniform float uRefractAmount;
        uniform vec3 uAbsorption;
        uniform float uDepthApprox;
        uniform float uSpecular;
        uniform float uRoughness;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uAmbientIntensity;
        uniform vec3 uNightTint;
        uniform float uWaveAmp;
        uniform float uWaveChop;
        uniform float uWaveSpeed;
        uniform float uFoamIntensity;
        uniform float uFoamThreshold;
        uniform float uFoamNoise;
        uniform float uFoamDrift;
        uniform vec3 uSkyTop;
        uniform vec3 uSkyHorizon;
        uniform vec3 uSkyAerosol;
        uniform float uSkyAerosolStrength;
        uniform float uSkyRadianceScale;
        uniform vec3 uFogColor;
        uniform float uWaterClarity;
        uniform float uUnderwaterFogStrength;
        uniform sampler2D tSceneColor;
        uniform sampler2D tSceneDepth;
        uniform sampler2D tSunVisibility;
        uniform int uHasSceneColor;
        uniform int uHasSceneDepth;
        uniform bool uForwardProjection;
        uniform int uHasSunVisibility;
        uniform vec2 uResolution;
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform mat4 uProjectionMatrix;
        uniform mat4 uProjectionMatrixInverse;
        uniform mat4 uViewMatrixInverse;
        uniform bool uCameraUnderwater;
        uniform int uDebugMode;

        varying vec3 vWorld;
        varying vec3 vBaseWorld;
        varying vec3 vNormalVary;
        varying vec2 vOceanXZ;
        varying float vHeight;
        varying float vViewDepth;
        ${waveDeclarations}

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        // The shoreline is the actual terrain/water column, not the outer
        // rectangular ocean mesh. The CPU WaterSystem bakes this same
        // generator into a small height field, giving the foam a stable
        // coastline around bays and irregular island edges.
        float sampleTerrainTop(vec2 xz) {
          if (!uOceanMode || !uTerrainHeightMapEnabled) return -1000.0;
          vec2 span = vec2(max(uInnerMaxX - uInnerMinX, 1.0), max(uInnerMaxZ - uInnerMinZ, 1.0));
          vec2 uv = (xz - vec2(uInnerMinX, uInnerMinZ)) / span;
          float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
          float encoded = texture2D(uTerrainHeightMap, clamp(uv, vec2(0.0), vec2(1.0))).r;
          return mix(-1000.0, encoded * uTerrainHeightScale + 1.0, inside);
        }

        float oceanTanh(float x) {
          float e = exp(min(2.0 * x, 20.0));
          return (e - 1.0) / (e + 1.0);
        }

        float oceanOmega(float k, float speed) {
          float depthTerm = oceanTanh(min(k * OCEAN_WATER_DEPTH, 20.0));
          float gravityTerm = 9.81 * k * depthTerm;
          float capillaryTerm = OCEAN_SURFACE_TENSION_OVER_DENSITY * k * k * k;
          return sqrt(max(gravityTerm + capillaryTerm, 0.0)) * speed * uWaveSpeed;
        }

        float oceanPixelFootprint(vec3 surfacePosition) {
          vec3 toCamera = cameraPosition - surfacePosition;
          float distanceToSurface = length(toCamera);
          float surfaceCos = abs(toCamera.y) / max(distanceToSurface, 0.001);
          float pixelAngle = 2.0 / max(abs(uProjectionMatrix[1][1]) * uResolution.y, 1.0);
          return distanceToSurface * pixelAngle / max(surfaceCos, 0.08);
        }

        vec3 waveNormal(
          vec2 xz,
          float time,
          float footprint,
          out float crest,
          out float jacobian,
          out float slopeVariance,
          out float normalVariation,
          out vec3 transportNormal
        ) {
          vec3 tangentX = vec3(1.0, 0.0, 0.0);
          vec3 tangentZ = vec3(0.0, 0.0, 1.0);
          float jxx = 1.0;
          float jxz = 0.0;
          float jzx = 0.0;
          float jzz = 1.0;
          float phaseEnergy = 0.0;
          float totalAmplitude = 0.0;
          float curvatureEnergy = 0.0;
          ${Array.from({ length: OCEAN_WAVES.length }, (_, index) => `
            {
              float k = 6.28318530718 / OCEAN_WAVE_LENGTH_${index};
              float omega = oceanOmega(k, OCEAN_WAVE_SPEED_${index});
              float phase = k * dot(OCEAN_WAVE_DIRECTION_${index}, xz) - omega * time + OCEAN_WAVE_PHASE_${index};
              float waveLod = oceanWaveLod(footprint, OCEAN_WAVE_LENGTH_${index});
              float amplitude = OCEAN_WAVE_AMPLITUDE_${index} * min(uWaveAmp, 1.0) * waveLod;
              float q = OCEAN_WAVE_STEEPNESS_${index} * uWaveChop;
              curvatureEnergy += amplitude * k * k * (1.0 + q);
              float s = sin(phase);
              float c = cos(phase);
              float dx = OCEAN_WAVE_DIRECTION_${index}.x;
              float dz = OCEAN_WAVE_DIRECTION_${index}.y;
              float phaseDx = k * dx;
              float phaseDz = k * dz;
              tangentX += vec3(-q * amplitude * dx * phaseDx * s, amplitude * phaseDx * c, -q * amplitude * dz * phaseDx * s);
              tangentZ += vec3(-q * amplitude * dx * phaseDz * s, amplitude * phaseDz * c, -q * amplitude * dz * phaseDz * s);
              // Gerstner horizontal displacement Jacobian.  Its determinant
              // is a fold/crest signal: compressions concentrate light and
              // are the stable source for foam instead of a scrolling tint.
              jxx += -q * amplitude * dx * phaseDx * s;
              jxz += -q * amplitude * dx * phaseDz * s;
              jzx += -q * amplitude * dz * phaseDx * s;
              jzz += -q * amplitude * dz * phaseDz * s;
              phaseEnergy += abs(s) * amplitude;
              totalAmplitude += amplitude;
            }
          `).join('\n')}
          vec3 macro = normalize(cross(tangentZ, tangentX));
          transportNormal = macro;
          jacobian = jxx * jzz - jxz * jzx;

          vec2 wind = normalize(vec2(0.80, 0.40));
          vec2 crossWind = vec2(-wind.y, wind.x);
          float k0 = 6.28318530718 / 6.80;
          float k1 = 6.28318530718 / 4.70;
          float k2 = 6.28318530718 / 3.35;
          float k3 = 6.28318530718 / 2.25;
          float k4 = 6.28318530718 / 1.48;
          float k5 = 6.28318530718 / 0.93;
          float k6 = 6.28318530718 / 0.57;
          float aa0 = oceanWaveLod(footprint, 6.80);
          float aa1 = oceanWaveLod(footprint, 4.70);
          float aa2 = oceanWaveLod(footprint, 3.35);
          float aa3 = oceanWaveLod(footprint, 2.25);
          float aa4 = oceanWaveLod(footprint, 1.48);
          float aa5 = oceanWaveLod(footprint, 0.93);
          float aa6 = oceanWaveLod(footprint, 0.57);
          vec2 d1 = normalize(wind * 0.866 + crossWind * 0.5);
          vec2 d2 = normalize(wind * 0.5 - crossWind * 0.866);
          vec2 d3 = normalize(crossWind * 0.94 - wind * 0.34);
          vec2 d4 = normalize(wind * 0.28 + crossWind * 0.96);
          vec2 d5 = normalize(-wind * 0.72 + crossWind * 0.69);
          vec2 d6 = normalize(wind * 0.18 - crossWind * 0.98);
          vec2 detailXZ = xz + oceanDetailWarp(xz, time) * 0.58;
          // A compact directional spectrum replaces the old dominant
          // wind-aligned ripple. Each band carries less energy and a unique
          // direction/phase, so surviving LOD bands cannot collapse into
          // evenly spaced parallel rows.
          vec2 micro = wind * (0.075 * k0 * cos(dot(detailXZ, wind) * k0 + time * oceanOmega(k0, 0.94) + 0.41) * aa0);
          micro += d1 * (0.061 * k1 * cos(dot(detailXZ, d1) * k1 - time * oceanOmega(k1, 1.03) + 2.17) * aa1);
          micro += d2 * (0.048 * k2 * cos(dot(detailXZ, d2) * k2 + time * oceanOmega(k2, 0.98) + 4.63) * aa2);
          micro += d3 * (0.034 * k3 * cos(dot(detailXZ, d3) * k3 - time * oceanOmega(k3, 1.06) + 1.29) * aa3);
          micro += d4 * (0.024 * k4 * cos(dot(detailXZ, d4) * k4 + time * oceanOmega(k4, 1.01) + 5.31) * aa4);
          micro += d5 * (0.014 * k5 * cos(dot(detailXZ, d5) * k5 - time * oceanOmega(k5, 0.96) + 3.44) * aa5);
          micro += d6 * (0.007 * k6 * cos(dot(detailXZ, d6) * k6 + time * oceanOmega(k6, 1.08) + 0.83) * aa6);

          // Use centered finite-difference gradients of advected value noise
          // rather than a scrolling scalar tint. These are unresolved slope
          // bands: the same fields shape the normal and local BRDF roughness,
          // so glints break into facets instead of receiving a painted mask.
          vec2 noiseUvA = detailXZ * 0.075 + wind * time * 0.03;
          vec2 noiseUvB = detailXZ * 0.14 - crossWind * time * 0.021;
          vec2 noiseUvC = detailXZ * 0.27 + vec2(-time * 0.041, time * 0.029);
          float noiseStepA = 0.10;
          float noiseStepB = 0.07;
          float noiseStepC = 0.045;
          vec2 noiseGradientA = vec2(
            noise(noiseUvA + vec2(noiseStepA, 0.0)) - noise(noiseUvA - vec2(noiseStepA, 0.0)),
            noise(noiseUvA + vec2(0.0, noiseStepA)) - noise(noiseUvA - vec2(0.0, noiseStepA))
          ) / (2.0 * noiseStepA);
          vec2 noiseGradientB = vec2(
            noise(noiseUvB + vec2(noiseStepB, 0.0)) - noise(noiseUvB - vec2(noiseStepB, 0.0)),
            noise(noiseUvB + vec2(0.0, noiseStepB)) - noise(noiseUvB - vec2(0.0, noiseStepB))
          ) / (2.0 * noiseStepB);
          vec2 noiseGradientC = vec2(
            noise(noiseUvC + vec2(noiseStepC, 0.0)) - noise(noiseUvC - vec2(noiseStepC, 0.0)),
            noise(noiseUvC + vec2(0.0, noiseStepC)) - noise(noiseUvC - vec2(0.0, noiseStepC))
          ) / (2.0 * noiseStepC);
          float fieldLodA = 1.0 - smoothstep(0.65, 3.0, footprint * 0.075);
          float fieldLodB = 1.0 - smoothstep(0.42, 2.3, footprint * 0.14);
          float fieldLodC = 1.0 - smoothstep(0.22, 1.7, footprint * 0.27);
          micro += noiseGradientA * (0.055 * fieldLodA);
          micro += noiseGradientB * (0.030 * fieldLodB);
          micro += noiseGradientC * (0.014 * fieldLodC);

          vec3 resolved = normalize(macro + vec3(-micro.x * 0.58, 0.0, -micro.y * 0.58));
          slopeVariance = clamp(dot(micro, micro) * 0.90, 0.0, 0.20);
          // Raster derivatives of the analytic normal depend on the mesh
          // cell size. Use the shared spectral curvature and unresolved slope
          // energy instead, so the sun lobe cannot change at a patch join.
          normalVariation = clamp(
            curvatureEnergy * footprint * 0.35 + sqrt(max(slopeVariance, 0.0)) * 0.75,
            0.0,
            0.35
          );
          float fold = smoothstep(0.92, 0.24, jacobian);
          crest = clamp((1.0 - resolved.y) * (1.35 + 0.35 * phaseEnergy / max(totalAmplitude, 0.001)) + fold * 0.42, 0.0, 1.0);
          return resolved;
        }

        float decodeDepth(float raw) {
          if (raw >= 0.999999) return uCameraFar;
          // Three.js stores perspective depth in [0, 1]; the reconstructed
          // view-space Z is negative in front of the camera, so return its
          // positive distance for path-length/rejection tests.
          return -(uCameraNear * uCameraFar) / ((uCameraFar - uCameraNear) * raw - uCameraFar);
        }

        float sampleSunVisibility(vec2 uv) {
          return texture2D(tSunVisibility, clamp(uv, vec2(0.002), vec2(0.998))).r;
        }

        // Reconstruct the current-frame visibility mask at the same refracted
        // receiver pixel as scene color. The mask is produced after the
        // water-free capture, so this restores moving-caster shadows without
        // feeding water back through its own refraction buffer. Depth-aware
        // neighbours smooth only uncertain mask edges and cannot cross voxel
        // silhouettes or the shoreline depth discontinuity.
        float refractedSunVisibility(vec2 uv, float referenceDepth) {
          float center = sampleSunVisibility(uv);
          float uncertainty = smoothstep(0.02, 0.98, 4.0 * center * (1.0 - center));
          if (uHasSceneDepth == 0 || uncertainty <= 0.0) return center;

          vec2 texel = 1.0 / max(uResolution, vec2(1.0));
          float depthTolerance = max(0.025, referenceDepth * 0.015);
          float weightedVisibility = center;
          float totalWeight = 1.0;
          for (int sampleIndex = 0; sampleIndex < 4; sampleIndex++) {
            vec2 offset = sampleIndex == 0 ? vec2(texel.x, 0.0) :
              sampleIndex == 1 ? vec2(-texel.x, 0.0) :
              sampleIndex == 2 ? vec2(0.0, texel.y) : vec2(0.0, -texel.y);
            vec2 neighbourUv = clamp(uv + offset, vec2(0.002), vec2(0.998));
            float neighbourDepth = decodeDepth(texture2D(tSceneDepth, neighbourUv).r);
            float depthWeight = 1.0 - smoothstep(
              depthTolerance,
              depthTolerance * 4.0,
              abs(neighbourDepth - referenceDepth)
            );
            weightedVisibility += sampleSunVisibility(neighbourUv) * depthWeight;
            totalWeight += depthWeight;
          }
          float filtered = weightedVisibility / max(totalWeight, 0.0001);
          return mix(center, filtered, 0.55 * uncertainty);
        }

        vec3 reconstructWorldPosition(vec2 uv, float rawDepth) {
          vec4 clip = vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
          vec4 view = uProjectionMatrixInverse * clip;
          view /= view.w;
          return (uViewMatrixInverse * vec4(view.xyz, 1.0)).xyz;
        }

        vec2 projectWorldToUv(vec3 worldPosition, out float valid) {
          vec4 clip = uProjectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
          valid = step(0.0001, clip.w);
          return clip.xy / max(clip.w, 0.0001) * 0.5 + 0.5;
        }

        float ggxDistribution(float noH, float alpha) {
          float alpha2 = alpha * alpha;
          float denominator = noH * noH * (alpha2 - 1.0) + 1.0;
          return alpha2 / max(3.14159265 * denominator * denominator, 0.0001);
        }

        float smithMasking(float noV, float noL, float alpha) {
          float k = alpha * alpha * 0.5;
          float gv = noV / max(noV * (1.0 - k) + k, 0.0001);
          float gl = noL / max(noL * (1.0 - k) + k, 0.0001);
          return gv * gl;
        }

        vec3 skyRadiance(vec3 direction) {
          vec3 d = normalize(direction);
          float up = clamp(d.y, -1.0, 1.0);
          vec3 gradient = mix(uSkyHorizon, uSkyTop, pow(max(up, 0.0), 0.48));
          vec3 lower = mix(uSkyAerosol, uSkyHorizon, 0.58);
          vec3 base = mix(lower, gradient, smoothstep(-0.38, 0.14, up));
          float aerosol = smoothstep(-0.18, 0.0, up) * (1.0 - smoothstep(0.0, 0.30, up)) * uSkyAerosolStrength;
          base = mix(base, uSkyAerosol, aerosol);
          float sun = max(dot(d, normalize(uSunDir)), 0.0);
          // The finite sun is integrated by the water BRDF below. Keep only
          // its atmospheric halo in reflected sky radiance; including a
          // second needle-like disc here created the unnaturally thin white
          // line visible through the middle of the glitter path.
          base += uSunColor * (pow(sun, 28.0) * 0.30 + pow(sun, 5.0) * 0.045);
          return max(base * uSkyRadianceScale, vec3(0.0));
        }

        // Exact unpolarized dielectric Fresnel plus a one-pixel filtered
        // critical-angle coverage term. The filter is applied only to the
        // binary Snell-window domain; the interface normal remains analytic.
        vec3 dielectricFresnel(float cosIncident, float etaIncident, float etaTransmitted, out float canTransmit, out float cosTransmitted) {
          float etaRatio = etaIncident / etaTransmitted;
          float sinTransmitted2 = etaRatio * etaRatio * (1.0 - cosIncident * cosIncident);
          float criticalWidth = clamp(fwidth(sinTransmitted2) * 1.5, 0.001, 0.05);
          canTransmit = 1.0 - smoothstep(1.0 - criticalWidth, 1.0 + criticalWidth, sinTransmitted2);
          cosTransmitted = sqrt(max(1.0 - sinTransmitted2, 0.0));
          float ci = max(cosIncident, 0.0001);
          float rs = (etaIncident * ci - etaTransmitted * cosTransmitted) /
            max(etaIncident * ci + etaTransmitted * cosTransmitted, 0.0001);
          float rp = (etaTransmitted * ci - etaIncident * cosTransmitted) /
            max(etaTransmitted * ci + etaIncident * cosTransmitted, 0.0001);
          float fresnel = 0.5 * (rs * rs + rp * rp);
          // Outside the physical domain the reflected energy is exactly one;
          // only the coverage mask is softened for raster stability.
          fresnel = mix(fresnel, 1.0, step(1.0, sinTransmitted2));
          return vec3(fresnel, canTransmit, cosTransmitted);
        }

        // GLSL refract() returns a zero vector outside the transmissive cone.
        // Evaluate the limiting critical-angle direction as well so the
        // Snell-window radiance remains numerically continuous while physical
        // windowCoverage and Fresnel reduce its energy to zero in TIR.
        vec3 criticalSafeRefract(
          vec3 incidentDirection,
          vec3 orientedNormal,
          float etaRatio
        ) {
          float incidentCos = clamp(
            -dot(orientedNormal, incidentDirection),
            0.0,
            1.0
          );
          vec3 incidentTangent = incidentDirection +
            orientedNormal * incidentCos;
          float incidentSin = length(incidentTangent);
          vec3 tangentDirection = incidentTangent /
            max(incidentSin, 0.0001);
          float transmittedSin = min(etaRatio * incidentSin, 0.9999);
          float safeTransmittedCos = sqrt(max(
            1.0 - transmittedSin * transmittedSin,
            0.0
          ));
          return normalize(
            tangentDirection * transmittedSin -
            orientedNormal * safeTransmittedCos
          );
        }

        void main() {
          float crest = 0.0;
          float jacobian = 1.0;
          float slopeVariance = 0.0;
          float normalVariation = 0.0;
          vec3 transportNormal = normalize(vNormalVary);
          float surfaceFootprint = oceanPixelFootprint(vBaseWorld);
          // Rebuild the displaced optical carrier from the continuous base
          // plane. Rasterized vWorld is still used for the visible geometry,
          // but BRDF/refraction inputs must not inherit the neighboring
          // triangles' interpolation across the inner/outer mesh join.
          vec3 opticalWorld = vWorld;
          if (uOceanMode) {
            opticalWorld = vBaseWorld + oceanWaveDisplacement(
              vBaseWorld,
              uTime,
              surfaceFootprint
            );
          }
          vec3 normal = uOceanMode
            ? waveNormal(
                vBaseWorld.xz,
                uTime,
                surfaceFootprint,
                crest,
                jacobian,
                slopeVariance,
                normalVariation,
                transportNormal
              )
            : normalize(vNormalVary);
          // The whole interface draw has one incident medium. A displaced
          // sheet can expose both raster face orientations near a crest or at
          // a waterline crossing, but that must never mix air->water and
          // water->air optics in one frame. The live displaced surface at the
          // camera owns this uniform state; critical-angle coverage below is
          // still resolved independently per pixel.
          bool underwaterView = uCameraUnderwater;
          if (underwaterView && normal.y > 0.0) normal = -normal;
          if (!underwaterView && normal.y < 0.0) normal = -normal;
          if (underwaterView && transportNormal.y > 0.0) transportNormal = -transportNormal;
          if (!underwaterView && transportNormal.y < 0.0) transportNormal = -transportNormal;
          vec3 viewDirection = normalize(cameraPosition - opticalWorld);
          float eta = underwaterView ? (1.0 / uEtaAirWater) : uEtaAirWater;
          float etaIncident = underwaterView ? (1.0 / uEtaAirWater) : 1.0;
          float etaTransmitted = underwaterView ? 1.0 : (1.0 / uEtaAirWater);
          float cosIncident = clamp(abs(dot(normal, viewDirection)), 0.0, 1.0);
          float windowCoverage = 0.0;
          float transmittedCos = 0.0;
          vec3 fresnelResult = dielectricFresnel(cosIncident, etaIncident, etaTransmitted, windowCoverage, transmittedCos);
          float fresnel = clamp(fresnelResult.x + uFresnelBias, 0.0, 1.0);
          // The resolved normal contains sub-pixel capillary detail. At a
          // geometric grazing view an individual tilted microfacet must not
          // open a bright transmission hole through an interface whose
          // filtered footprint is reflection dominated. Use the flat carrier
          // surface as a conservative Fresnel floor for above-water views.
          float geometricCosIncident = clamp(abs(viewDirection.y), 0.0, 1.0);
          float geometricCoverage = 0.0;
          float geometricTransmittedCos = 0.0;
          vec3 geometricFresnelResult = dielectricFresnel(
            geometricCosIncident,
            etaIncident,
            etaTransmitted,
            geometricCoverage,
            geometricTransmittedCos
          );
          if (!underwaterView) fresnel = max(fresnel, geometricFresnelResult.x);
          vec3 incident = -viewDirection;
          vec3 refractedDirection = criticalSafeRefract(
            incident,
            transportNormal,
            eta
          );

          vec3 deep = uColor;
          vec3 transmitted = deep;
          vec3 reflected = deep;
          float pathLength = uDepthApprox / max(abs(refractedDirection.y), 0.08);
          vec3 sceneRefraction = deep;
          float screenProjectionCoverage = 1.0;
          float sceneHitValidity = 0.0;

          if (!underwaterView) {
            reflected = skyRadiance(reflect(incident, normal));
            vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
            if (uForwardProjection && uHasSceneColor == 1 && uHasSceneDepth == 1) {
              // The source geometry was already transported through Snell's
              // interface before rasterization. Color, depth, coverage, and
              // silhouette therefore occupy this exact water pixel together.
              vec4 apparentSample = texture2D(tSceneColor, screenUv);
              float apparentRawDepth = texture2D(tSceneDepth, screenUv).r;
              float depthCoverage = 1.0 - step(0.999999, apparentRawDepth);
              // Filtered alpha is the silhouette's coverage authority. Depth
              // is nearest-sampled and may select the clear neighbour at an
              // antialiased edge; it may refine path length but must never
              // erase that color/coverage sample.
              sceneHitValidity = clamp(apparentSample.a, 0.0, 1.0);
              screenProjectionCoverage = sceneHitValidity;
              sceneRefraction = apparentSample.rgb / max(apparentSample.a, 0.001);

              // Forward vertices preserve their real radial camera distance
              // in target depth. Intersect that sphere with the physically
              // refracted ray to recover the actual water-segment length.
              vec3 apparentWorld = reconstructWorldPosition(screenUv, apparentRawDepth);
              float sourceDistance = length(apparentWorld - cameraPosition);
              vec3 interfaceOffset = opticalWorld - cameraPosition;
              float rayProjection = dot(interfaceOffset, refractedDirection);
              float discriminant = rayProjection * rayProjection +
                sourceDistance * sourceDistance -
                dot(interfaceOffset, interfaceOffset);
              float physicalWaterPath = -rayProjection + sqrt(max(discriminant, 0.0));
              pathLength = mix(
                pathLength,
                max(physicalWaterPath, 0.0),
                sceneHitValidity * depthCoverage
              );
            } else {
              // Legacy block water is a bounded translucent sheet rather than
              // the global ocean interface. Keep its conventional lookup
              // isolated from the ocean's forward optical contract.
              float surfaceDepth = -(viewMatrix * vec4(opticalWorld, 1.0)).z;
              float baseRawDepth = uHasSceneDepth == 1
                ? texture2D(tSceneDepth, screenUv).r
                : 1.0;
              float baseBackgroundDepth = decodeDepth(baseRawDepth);
              vec3 opticalDirection = normalize(mix(
                incident,
                refractedDirection,
                clamp(uRefractAmount, 0.0, 1.0)
              ));
              vec3 opticalView = normalize(mat3(viewMatrix) * opticalDirection);
              float estimatedTravel = uDepthApprox / max(abs(refractedDirection.y), 0.08);
              if (uHasSceneDepth == 1 && baseRawDepth < 0.999999) {
                float axialGap = max(baseBackgroundDepth - surfaceDepth, 0.0);
                estimatedTravel = axialGap / max(-opticalView.z, 0.08);
              }
              float projectedValid = 0.0;
              vec2 projectedUv = projectWorldToUv(
                opticalWorld + opticalDirection * estimatedTravel,
                projectedValid
              );
              float insideUv = step(0.002, projectedUv.x) * step(0.002, projectedUv.y) *
                step(projectedUv.x, 0.998) * step(projectedUv.y, 0.998);
              screenProjectionCoverage = projectedValid * insideUv;
              vec2 resolvedUv = clamp(projectedUv, vec2(0.002), vec2(0.998));
              float resolvedRawDepth = uHasSceneDepth == 1
                ? texture2D(tSceneDepth, resolvedUv).r
                : 1.0;
              sceneHitValidity = screenProjectionCoverage;
              vec4 sceneSample = uHasSceneColor == 1
                ? texture2D(tSceneColor, resolvedUv)
                : vec4(deep, 0.0);
              if (uHasSunVisibility == 1) {
                float receiverDepth = decodeDepth(resolvedRawDepth);
                float sunVisibility = refractedSunVisibility(resolvedUv, receiverDepth);
                float directLightFraction = clamp(sceneSample.a, 0.0, 1.0);
                sceneSample.rgb *= mix(1.0, sunVisibility, directLightFraction);
              }
              sceneRefraction = sceneSample.rgb;
              pathLength = mix(pathLength, estimatedTravel, sceneHitValidity);
            }
            vec3 transmittance = exp(-uAbsorption * max(pathLength, 0.0));
            float forwardScatter = pow(max(dot(viewDirection, -normalize(uSunDir)), 0.0), 4.0);
            vec3 scatterColor = mix(deep * 0.72, uFogColor * 0.38, 0.55);
            scatterColor += uSunColor * uFogColor * forwardScatter * 0.08;
            vec3 receiverRadiance = sceneRefraction * transmittance +
              scatterColor * (1.0 - transmittance);
            vec3 openWaterRadiance = deep * transmittance +
              scatterColor * (1.0 - transmittance);
            transmitted = mix(openWaterRadiance, receiverRadiance, sceneHitValidity);
          } else {
            // Underwater Snell window: evaluate one continuous transmitted
            // sky body on every underside fragment. Fresnel and the filtered
            // critical-angle coverage below own the smooth transition to TIR;
            // there is no second boolean material mode.
            float viewUpness = smoothstep(-0.55, 0.72, viewDirection.y);
            vec3 ambientDown = vec3(0.012, 0.035, 0.055);
            vec3 ambientUp = vec3(0.035, 0.120, 0.160);
            vec3 mediumAmbient = mix(ambientDown, ambientUp, viewUpness);
            float upwellingSun = pow(max(dot(normalize(reflect(incident, normal)), normalize(uSunDir)), 0.0), 6.0) * 0.06;
            vec3 underwaterReflection = mediumAmbient *
              (0.66 + 0.18 * max(dot(normal, viewDirection), 0.0));
            underwaterReflection += uColor * 0.28 + uSunColor * upwellingSun;
            vec3 windowDirection = criticalSafeRefract(incident, normal, eta);
            vec3 window = skyRadiance(windowDirection);
            // Snell stretch broadens the transmitted sun lobe at grazing
            // incidence. Derivative filtering keeps the lobe stable while
            // preserving a sharp disc at normal incidence.
            float snellEta = etaIncident / max(etaTransmitted, 0.001);
            float snellStretch = max(snellEta * cosIncident / max(transmittedCos, 0.04), 1.0);
            float snellSpread = (snellStretch - 1.0) * normalVariation * 0.5;
            float lobeExponent = 1.0 / max(1.0 / 700.0 + snellSpread * snellSpread, 0.0001);
            float windowSun = max(dot(windowDirection, normalize(uSunDir)), 0.0);
            float transmittedSun = pow(windowSun, lobeExponent) * lobeExponent * (24.0 / 700.0);
            float transmittedHalo = pow(windowSun, 24.0) * 0.08;
            window += uSunColor * (transmittedSun + transmittedHalo);
            if (uForwardProjection && uHasSceneColor == 1) {
              vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
              vec4 apparentSample = texture2D(tSceneColor, screenUv);
              float apparentCoverage = clamp(apparentSample.a, 0.0, 1.0);
              vec3 apparentRadiance = apparentSample.rgb /
                max(apparentSample.a, 0.001);
              window = mix(window, apparentRadiance, apparentCoverage);
              sceneHitValidity = apparentCoverage;
              screenProjectionCoverage = apparentCoverage;
            }
            transmitted = window;
            reflected = underwaterReflection;
            pathLength = 0.0;
          }

          float bodyFog = 1.0 - exp(-max(pathLength, 0.0) / max(uWaterClarity, 1.0));
          if (underwaterView) transmitted = mix(transmitted, uFogColor, bodyFog * uUnderwaterFogStrength);
          // Only the legacy bounded block-water lookup needs a grazing
          // validity interval. The ocean's forward projection remains valid
          // across the frustum and is governed solely by exact Fresnel.
          float grazingWidth = clamp(fwidth(geometricCosIncident) * 2.0, 0.002, 0.025);
          float grazingTransmissionCoverage = uForwardProjection
            ? 1.0
            : smoothstep(
            0.035 - grazingWidth,
            0.140 + grazingWidth,
            geometricCosIncident
          );
          float interfaceTransmission = underwaterView
            ? windowCoverage * (1.0 - fresnel)
            : (1.0 - fresnel) * grazingTransmissionCoverage;
          float transmissionWeight = clamp(interfaceTransmission, 0.0, 1.0);
          float reflectionWeight = 1.0 - transmissionWeight;
          // Every transmitted source receives this one explicit
          // (1 - Fresnel)-derived interface weight.
          vec3 color = reflected * reflectionWeight + transmitted * transmissionWeight;

          vec3 lightDirection = normalize(uSunDir);
          vec3 halfVector = normalize(viewDirection + lightDirection);
          float noV = max(dot(normal, viewDirection), 0.001);
          float noL = max(dot(normal, lightDirection), 0.0);
          float noH = max(dot(normal, halfVector), 0.0);
          float voH = max(dot(viewDirection, halfVector), 0.0);
          float dielectricF0Base = (1.0 - 1.333) / (1.0 + 1.333);
          float dielectricF0 = dielectricF0Base * dielectricF0Base;
          float sunFresnel = dielectricF0 + (1.0 - dielectricF0) * pow(1.0 - voH, 5.0);
          float roughnessControl = clamp(uRoughness, 0.0, 1.0);
          // Keep the lobe filter in the same analytic domain as displacement
          // and the fragment normal. A screen-space derivative here would
          // measure the inner/outer mesh tessellation and draw its boundary
          // through the reflected sun path.
          float normalVariance = normalVariation * normalVariation;
          float filteredRoughness = sqrt(roughnessControl * roughnessControl + normalVariance);
          // Unresolved slope energy comes from the same directional/noise
          // cascade as the normal. It widens the local facet distribution in
          // busy patches, breaking the sun path into irregular glints while
          // leaving quiet patches sharp. No independent color mask is used.
          float glintBreakup = smoothstep(0.0015, 0.028, slopeVariance);
          float localRoughness = clamp(
            mix(roughnessControl, filteredRoughness, 0.55) + glintBreakup * 0.24,
            0.0,
            1.0
          );
          float normalFootprint = normalVariation;
          float solarVariance = 0.5 * 0.004675 * 0.004675;
          float coreAlpha = mix(0.055, 0.16, localRoughness * localRoughness);
          coreAlpha = sqrt(
            coreAlpha * coreAlpha +
            normalFootprint * normalFootprint * 0.20 +
            solarVariance
          );
          float skirtAlpha = min(0.38, coreAlpha * 2.25 + 0.015);
          float coreLobe = ggxDistribution(noH, coreAlpha) * smithMasking(noV, noL, coreAlpha);
          float skirtLobe = ggxDistribution(noH, skirtAlpha) * smithMasking(noV, noL, skirtAlpha);
          // A normalized core-and-skirt slope distribution approximates the
          // broad Cox-Munk glitter path of a calm, lightly wind-ruffled sea.
          // Mixing normalized lobes preserves energy while widening the path;
          // derivative variance softens its edge as facets become sub-pixel.
          float sunLobe = mix(coreLobe, skirtLobe, 0.42);
          float specular = sunLobe * sunFresnel * noL /
            max(4.0 * noV * noL, 0.001);
          if (!underwaterView) color += uSunColor * specular * uSpecular;

          float foamFold = uOceanMode ? smoothstep(0.92, 0.20, jacobian) : 0.0;
          float foamNoiseLarge = noise(opticalWorld.xz * 0.115 + uTime * vec2(uFoamDrift * 0.24, -uFoamDrift * 0.16));
          float foamNoiseFine = noise(opticalWorld.xz * 0.68 - uTime * vec2(uFoamDrift * 0.82, uFoamDrift * 0.54));
          float foamBreakup = mix(foamNoiseLarge, foamNoiseFine, 0.48);
          // Coastal foam is driven by the actual terrain/water column. This
          // avoids the old rectangular-boundary train, which could project
          // long white ribbons across open water. The height field follows
          // the same terrain generator as the playable island, so bays and
          // irregular shoreline pockets receive foam while deep offshore
          // water remains untouched.
          vec2 shoreXZ = vBaseWorld.xz;
          float terrainTop = sampleTerrainTop(shoreXZ);
          float waterColumn = uWaterLevel - terrainTop;
          float waterSide = smoothstep(-0.35, 0.16, waterColumn);
          float shallowBand = 1.0 - smoothstep(0.35, 5.5, waterColumn);
          float shorelineBand = waterSide * shallowBand;
          vec2 foamDomain = shoreXZ + oceanDetailWarp(shoreXZ, uTime) * 0.35;
          float patchLarge = noise(foamDomain * 0.12 + uTime * vec2(0.012, -0.009));
          float patchMedium = noise(foamDomain * 0.34 - uTime * vec2(0.033, 0.021));
          float patchFine = noise(foamDomain * 0.88 + uTime * vec2(-0.071, 0.048));
          float patchValue = patchLarge * 0.52 + patchMedium * 0.32 + patchFine * 0.16;
          float patchMask = smoothstep(0.47, 0.70, patchValue);
          // A noisy moving front makes each patch taper into the water. Foam
          // still requires a resolved wave arrival below; the shoreline mask
          // alone must never become a permanent contour around the water.
          float frontOffset = (patchMedium - 0.5) * 1.35 + (patchFine - 0.5) * 0.55;
          float foamFront = 1.0 - smoothstep(-0.28, 1.35, waterColumn + frontOffset);
          float wavePulse = smoothstep(0.08, 0.46, max(opticalWorld.y - uWaterLevel, 0.0) + crest * 0.26 + foamFold * 0.30);
          float swashArrival = smoothstep(
            0.10,
            0.62,
            wavePulse + foamFold * 0.28 + crest * 0.18
          );
          float shoreFoam = shorelineBand * patchMask * swashArrival *
            (0.24 + 0.76 * max(foamFront, wavePulse));
          shoreFoam = clamp(shoreFoam, 0.0, 1.0);
          float foamPotential = max(max(foamFold, crest * 0.72), shoreFoam);
          float foam = smoothstep(uFoamThreshold * 0.72, 0.92, foamPotential * mix(0.66, 1.38, foamBreakup * uFoamNoise));
          foam = max(foam, shoreFoam * 0.78);
          color = mix(color, vec3(0.92, 0.98, 1.0), foam * uFoamIntensity);
          color = mix(color, color * uNightTint, (1.0 - clamp(uAmbientIntensity, 0.0, 1.0)) * 0.45);
          color *= mix(0.20, 1.0, clamp(uAmbientIntensity, 0.0, 1.0));

          if (uDebugMode == 1) color = vec3(clamp(vHeight - uWaterLevel + 0.5, 0.0, 1.0));
          else if (uDebugMode == 2) color = normal * 0.5 + 0.5;
          else if (uDebugMode == 3) color = vec3(fresnel);
          else if (uDebugMode == 4) color = vec3(sceneHitValidity, 1.0 - windowCoverage, clamp(pathLength / 16.0, 0.0, 1.0));
          else if (uDebugMode == 5) color = exp(-uAbsorption * max(pathLength, 0.0));
          else if (uDebugMode == 6) color = vec3(foam, crest, 1.0 - normal.y);
          else if (uDebugMode == 7) color = vec3(
            screenProjectionCoverage,
            sceneHitValidity,
            underwaterView ? windowCoverage : 1.0 - fresnel
          );
          else if (uDebugMode == 8) color = vec3(
            clamp(slopeVariance * 28.0, 0.0, 1.0),
            clamp(localRoughness, 0.0, 1.0),
            clamp(specular * 18.0, 0.0, 1.0)
          );
          else if (uDebugMode == 9) color = vec3(
            clamp(surfaceFootprint / 12.0, 0.0, 1.0),
            oceanWaveLod(surfaceFootprint, 40.0),
            oceanWaveLod(surfaceFootprint, 8.0)
          );

          // The opaque ocean carries its exact visible fragment depth in a
          // reserved low-alpha range. Later medium and lens passes can then
          // use the displaced interface actually rasterized at this pixel,
          // even though their separate scene capture intentionally hides all
          // water. Opaque block materials start at alpha 1/255, so the ranges
          // cannot alias.
          float oceanSurfaceDepth = clamp(
            vViewDepth / max(uCameraFar, 0.001),
            0.0,
            1.0
          ) * ${OCEAN_SURFACE_DEPTH_ALPHA_SCALE.toFixed(6)};
          gl_FragColor = vec4(
            max(color, vec3(0.0)),
            uOceanMode ? oceanSurfaceDepth : clamp(uAlpha, 0.0, 1.0)
          );
        }
      `,
    })

    this.ocean = ocean
  }

  setTime(timeSeconds: number): void { this.uniforms.uTime.value = timeSeconds }

  setColor(color: THREE.Color): void { (this.uniforms.uColor.value as THREE.Color).copy(color) }

  setMap(texture: THREE.Texture | null): void {
    this.uniforms.uMap.value = texture
    this.uniforms.uUseMap.value = false
  }

  setTileScale(scale: number): void { this.uniforms.uTileScale.value = Math.max(1e-3, scale) }

  setUseWorldUV(enabled: boolean): void { this.uniforms.uUseWorldUV.value = enabled }

  setBounds(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    this.uniforms.uInnerMinX.value = bounds.minX
    this.uniforms.uInnerMaxX.value = bounds.maxX
    this.uniforms.uInnerMinZ.value = bounds.minZ
    this.uniforms.uInnerMaxZ.value = bounds.maxZ
  }

  setTerrainHeightMap(texture: THREE.Texture | null, heightScale = 128): void {
    this.uniforms.uTerrainHeightMap.value = texture ?? terrainHeightFallback
    this.uniforms.uTerrainHeightMapEnabled.value = !!texture
    this.uniforms.uTerrainHeightScale.value = Math.max(1, heightScale)
  }

  setEdge(_strength: number, _width: number): void {
    // Legacy edge brightening is intentionally disabled; the ocean plane and
    // visual seabed share geometry instead of hiding a seam with a tint.
    void _strength
    void _width
  }

  setAlpha(alphaValue: number): void {
    const alpha = THREE.MathUtils.clamp(alphaValue, 0, 1)
    this.uniforms.uAlpha.value = alpha
    if (!this.ocean) this.depthWrite = alpha >= 1.0
  }

  setFresnelAlpha(_base: number, _scale: number): void {
    // Kept for callers that tune the legacy block-water material. The new
    // shader uses physical Fresnel for color and keeps alpha independent.
    void _base
    void _scale
  }

  setRefraction(strength: number, eta = 1.0 / 1.333, waveAmp = 1.0, waveSpeed = 1.0, fresnelBias = 0.02): void {
    this.uniforms.uRefractAmount.value = Math.max(0, strength)
    this.uniforms.uEtaAirWater.value = Math.max(1e-3, eta)
    this.uniforms.uWaveAmp.value = Math.max(0, waveAmp)
    this.uniforms.uWaveSpeed.value = Math.max(0, waveSpeed)
    this.uniforms.uFresnelBias.value = Math.max(0, fresnelBias)
  }

  setSun(direction: THREE.Vector3, color?: THREE.Color): void {
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(direction).normalize()
    if (color) (this.uniforms.uSunColor.value as THREE.Color).copy(color)
  }

  setAmbientLighting(intensity: number, nightTint?: THREE.Color): void {
    this.uniforms.uAmbientIntensity.value = THREE.MathUtils.clamp(intensity, 0, 1)
    if (nightTint) (this.uniforms.uNightTint.value as THREE.Color).copy(nightTint)
  }

  setSkyColors(topColor: THREE.Color, horizonColor: THREE.Color): void {
    (this.uniforms.uSkyTop.value as THREE.Color).copy(topColor)
    ;(this.uniforms.uSkyHorizon.value as THREE.Color).copy(horizonColor)
  }

  setSkyAtmosphere(aerosol: THREE.Color, strength: number, radianceScale = 1.25): void {
    (this.uniforms.uSkyAerosol.value as THREE.Color).copy(aerosol)
    this.uniforms.uSkyAerosolStrength.value = THREE.MathUtils.clamp(strength, 0, 1)
    this.uniforms.uSkyRadianceScale.value = Math.max(0.1, radianceScale)
  }

  setWaterLevel(level: number): void { this.uniforms.uWaterLevel.value = level }

  setCamera(camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld()
    ;(this.uniforms.uProjectionMatrix.value as THREE.Matrix4).copy(camera.projectionMatrix)
    ;(this.uniforms.uProjectionMatrixInverse.value as THREE.Matrix4).copy(camera.projectionMatrixInverse)
    ;(this.uniforms.uViewMatrixInverse.value as THREE.Matrix4).copy(camera.matrixWorld)
    this.uniforms.uCameraNear.value = camera.near
    this.uniforms.uCameraFar.value = camera.far
  }

  setCameraUnderwater(underwater: boolean): void { this.uniforms.uCameraUnderwater.value = underwater }

  setSceneInputs(sceneColor: THREE.Texture | null, sceneDepth: THREE.Texture | null, resolution: { x: number; y: number }, cameraNear: number, cameraFar: number): void {
    this.uniforms.tSceneColor.value = sceneColor
    this.uniforms.tSceneDepth.value = sceneDepth
    this.uniforms.uHasSceneColor.value = sceneColor ? 1 : 0
    this.uniforms.uHasSceneDepth.value = sceneDepth ? 1 : 0
    ;(this.uniforms.uResolution.value as THREE.Vector2).set(Math.max(1, Math.floor(resolution.x)), Math.max(1, Math.floor(resolution.y)))
    this.uniforms.uCameraNear.value = cameraNear
    this.uniforms.uCameraFar.value = cameraFar
  }

  setForwardRefractionInputs(
    sceneColor: THREE.Texture | null,
    sceneDepth: THREE.Texture | null,
    resolution: { x: number; y: number },
    cameraNear: number,
    cameraFar: number,
  ): void {
    this.setSceneInputs(sceneColor, sceneDepth, resolution, cameraNear, cameraFar)
    this.uniforms.uForwardProjection.value = !!sceneColor && !!sceneDepth
  }

  setSunVisibility(texture: THREE.Texture | null): void {
    this.uniforms.tSunVisibility.value = texture
    this.uniforms.uHasSunVisibility.value = texture ? 1 : 0
  }

  setScreenRefraction(sceneColor: THREE.Texture | null, resolution?: { x: number; y: number }): void {
    this.uniforms.tSceneColor.value = sceneColor
    this.uniforms.uHasSceneColor.value = sceneColor ? 1 : 0
    if (resolution) (this.uniforms.uResolution.value as THREE.Vector2).set(Math.max(1, resolution.x), Math.max(1, resolution.y))
  }

  setWaves(params: { amp?: number; chop?: number; speed?: number }): void {
    if (params.amp !== undefined) this.uniforms.uWaveAmp.value = Math.max(0, params.amp)
    if (params.chop !== undefined) this.uniforms.uWaveChop.value = Math.max(0, params.chop)
    if (params.speed !== undefined) this.uniforms.uWaveSpeed.value = Math.max(0, params.speed)
  }

  setDebugMode(mode: number): void { this.uniforms.uDebugMode.value = Math.max(0, Math.floor(mode)) }
}
