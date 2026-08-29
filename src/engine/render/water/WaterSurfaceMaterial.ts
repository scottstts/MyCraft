import * as THREE from 'three'
import { OCEAN_WAVES, oceanWaveDeclarations } from './OceanWaveField'

export interface WaterSurfaceParams {
  map: THREE.Texture | null
  color?: THREE.Color | number | string
  tileScale?: number
  useWorldUV?: boolean
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Ocean meshes are opaque composited surfaces; block water stays blended. */
  ocean?: boolean
}

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
        uHasSceneColor: { value: 0 },
        uHasSceneDepth: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 1024.0 },
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

        vec3 oceanDisplacement(vec2 xz, float time) {
          vec3 displaced = vec3(0.0);
          vec2 warpedXZ = xz + oceanDomainWarp(xz, time);
          ${Array.from({ length: OCEAN_WAVES.length }, (_, index) => `
            {
              float k = 6.28318530718 / OCEAN_WAVE_LENGTH_${index};
              float omega = oceanOmega(k, OCEAN_WAVE_SPEED_${index});
              float phase = k * dot(OCEAN_WAVE_DIRECTION_${index}, warpedXZ) - omega * time + OCEAN_WAVE_PHASE_${index};
              float amplitude = OCEAN_WAVE_AMPLITUDE_${index} * oceanWaveGroupEnvelope(warpedXZ, time, float(${index})) * min(uWaveAmp, 1.0);
              float c = cos(phase);
              displaced.xz += OCEAN_WAVE_DIRECTION_${index} * OCEAN_WAVE_STEEPNESS_${index} * amplitude * uWaveChop * c;
              displaced.y += amplitude * sin(phase);
            }
          `).join('\n')}
          displaced.y = clamp(displaced.y, -OCEAN_WAVE_HALF_RANGE, OCEAN_WAVE_HALF_RANGE);
          return displaced;
        }

        void main() {
          vec4 baseWorld = modelMatrix * vec4(position, 1.0);
          vec3 displacedWorld = baseWorld.xyz;
          vec2 baseXZ = uUseWorldUV ? baseWorld.xz : baseWorld.xz * uTileScale;
          if (uOceanMode) displacedWorld += oceanDisplacement(baseXZ, uTime);

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
        uniform int uHasSceneColor;
        uniform int uHasSceneDepth;
        uniform vec2 uResolution;
        uniform float uCameraNear;
        uniform float uCameraFar;
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

        vec3 waveNormal(vec2 xz, float time, out float crest, out float jacobian) {
          vec3 tangentX = vec3(1.0, 0.0, 0.0);
          vec3 tangentZ = vec3(0.0, 0.0, 1.0);
          float jxx = 1.0;
          float jxz = 0.0;
          float jzx = 0.0;
          float jzz = 1.0;
          float phaseEnergy = 0.0;
          float totalAmplitude = 0.0;
          vec2 warpedXZ = xz + oceanDomainWarp(xz, time);
          vec2 dWarpDx;
          vec2 dWarpDz;
          oceanDomainWarpPartials(xz, time, dWarpDx, dWarpDz);
          ${Array.from({ length: OCEAN_WAVES.length }, (_, index) => `
            {
              float k = 6.28318530718 / OCEAN_WAVE_LENGTH_${index};
              float omega = oceanOmega(k, OCEAN_WAVE_SPEED_${index});
              float phase = k * dot(OCEAN_WAVE_DIRECTION_${index}, warpedXZ) - omega * time + OCEAN_WAVE_PHASE_${index};
              float amplitude = OCEAN_WAVE_AMPLITUDE_${index} * oceanWaveGroupEnvelope(warpedXZ, time, float(${index})) * min(uWaveAmp, 1.0);
              float q = OCEAN_WAVE_STEEPNESS_${index} * uWaveChop;
              float s = sin(phase);
              float c = cos(phase);
              float dx = OCEAN_WAVE_DIRECTION_${index}.x;
              float dz = OCEAN_WAVE_DIRECTION_${index}.y;
              float phaseDx = k * (dx * (1.0 + dWarpDx.x) + dz * dWarpDx.y);
              float phaseDz = k * (dx * dWarpDz.x + dz * (1.0 + dWarpDz.y));
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
          jacobian = jxx * jzz - jxz * jzx;

          float footprint = max(length(dFdx(vWorld.xz)), length(dFdy(vWorld.xz)));
          vec2 wind = normalize(vec2(0.80, 0.40));
          vec2 crossWind = vec2(-wind.y, wind.x);
          float k0 = 6.28318530718 / 5.25;
          float k1 = 6.28318530718 / 3.0;
          float k2 = 6.28318530718 / 1.5;
          float k3 = 6.28318530718 / 0.95;
          float k4 = 6.28318530718 / 0.52;
          float aa0 = 1.0 - smoothstep(0.0, 2.0, footprint * k0);
          float aa1 = 1.0 - smoothstep(0.0, 1.5, footprint * k1);
          float aa2 = 1.0 - smoothstep(0.0, 1.0, footprint * k2);
          float aa3 = 1.0 - smoothstep(0.0, 0.85, footprint * k3);
          float aa4 = 1.0 - smoothstep(0.0, 0.65, footprint * k4);
          vec2 d1 = normalize(wind * 0.866 + crossWind * 0.5);
          vec2 d2 = normalize(wind * 0.5 - crossWind * 0.866);
          vec2 d3 = normalize(crossWind * 0.94 - wind * 0.34);
          vec2 d4 = normalize(wind * 0.28 + crossWind * 0.96);
          vec2 detailXZ = xz + oceanDomainWarp(xz, time) * 0.42;
          vec2 micro = wind * (0.12 * k0 * cos(dot(detailXZ, wind) * k0 + time * oceanOmega(k0, 1.0)) * aa0);
          micro += d1 * (0.08 * k1 * cos(dot(detailXZ, d1) * k1 - time * oceanOmega(k1, 1.0)) * aa1);
          micro += d2 * (0.05 * k2 * cos(dot(detailXZ, d2) * k2 + time * oceanOmega(k2, 1.0)) * aa2);
          // Two capillary bands add cross-wind facets at close range. Their
          // derivative filters fade the bands before they become glitter.
          micro += d3 * (0.018 * k3 * cos(dot(detailXZ, d3) * k3 + time * oceanOmega(k3, 1.0)) * aa3);
          micro += d4 * (0.010 * k4 * cos(dot(detailXZ, d4) * k4 - time * oceanOmega(k4, 1.0)) * aa4);

          // Use a finite-difference gradient of advected value noise rather
          // than a scrolling scalar tint; this produces broken, natural
          // facets while preserving a coherent normal field.
          vec2 noiseUvA = detailXZ * 0.075 + wind * time * 0.03;
          vec2 noiseUvB = detailXZ * 0.14 - crossWind * time * 0.021;
          float noiseA = noise(noiseUvA);
          float noiseB = noise(noiseUvB);
          float noiseStepA = 0.12;
          float noiseStepB = 0.08;
          vec2 noiseGradientA = vec2(
            noise(noiseUvA + vec2(noiseStepA, 0.0)) - noiseA,
            noise(noiseUvA + vec2(0.0, noiseStepA)) - noiseA
          ) / noiseStepA;
          vec2 noiseGradientB = vec2(
            noise(noiseUvB + vec2(noiseStepB, 0.0)) - noiseB,
            noise(noiseUvB + vec2(0.0, noiseStepB)) - noiseB
          ) / noiseStepB;
          micro += noiseGradientA * (0.025 * aa1);
          micro += noiseGradientB * (0.012 * aa2);

          vec3 resolved = normalize(macro + vec3(-micro.x * 0.58, 0.0, -micro.y * 0.58));
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

        vec3 skyRadiance(vec3 direction) {
          vec3 d = normalize(direction);
          float up = clamp(d.y, -1.0, 1.0);
          vec3 gradient = mix(uSkyHorizon, uSkyTop, pow(max(up, 0.0), 0.48));
          vec3 lower = mix(uSkyAerosol, uSkyHorizon, 0.58);
          vec3 base = mix(lower, gradient, smoothstep(-0.38, 0.14, up));
          float aerosol = smoothstep(-0.18, 0.0, up) * (1.0 - smoothstep(0.0, 0.30, up)) * uSkyAerosolStrength;
          base = mix(base, uSkyAerosol, aerosol);
          float sun = max(dot(d, normalize(uSunDir)), 0.0);
          base += uSunColor * (pow(sun, 2200.0) * 18.0 + pow(sun, 18.0) * 0.35 + pow(sun, 4.0) * 0.04);
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

        void main() {
          float crest = 0.0;
          float jacobian = 1.0;
          vec3 normal = uOceanMode ? waveNormal(vOceanXZ, uTime, crest, jacobian) : normalize(vNormalVary);
          if (uCameraUnderwater && normal.y > 0.0) normal = -normal;
          if (!uCameraUnderwater && normal.y < 0.0) normal = -normal;
          vec3 viewDirection = normalize(cameraPosition - vWorld);
          float eta = uCameraUnderwater ? (1.0 / uEtaAirWater) : uEtaAirWater;
          float etaIncident = uCameraUnderwater ? (1.0 / uEtaAirWater) : 1.0;
          float etaTransmitted = uCameraUnderwater ? 1.0 : (1.0 / uEtaAirWater);
          float cosIncident = clamp(abs(dot(normal, viewDirection)), 0.0, 1.0);
          float windowCoverage = 0.0;
          float transmittedCos = 0.0;
          vec3 fresnelResult = dielectricFresnel(cosIncident, etaIncident, etaTransmitted, windowCoverage, transmittedCos);
          float fresnel = clamp(fresnelResult.x + uFresnelBias, 0.0, 1.0);
          vec3 incident = -viewDirection;
          vec3 refractedDirection = refract(incident, normal, eta);
          bool tir = windowCoverage < 0.5 || length(refractedDirection) < 0.0001;

          vec3 deep = uColor;
          vec3 transmitted = deep;
          vec3 reflected = deep;
          float pathLength = uDepthApprox / max(abs(refractedDirection.y), 0.08);
          vec3 sceneRefraction = deep;
          float foregroundReject = 0.0;

          if (!uCameraUnderwater) {
            reflected = skyRadiance(reflect(incident, normal));
            vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
            vec2 refractionOffset = refractedDirection.xz * uRefractAmount * 0.025 + normal.xz * 0.008;
            vec2 refractedUv = clamp(screenUv + refractionOffset, vec2(0.002), vec2(0.998));
            float surfaceDepth = vViewDepth;
            float backgroundDepth = uCameraFar;
            if (uHasSceneDepth == 1) backgroundDepth = decodeDepth(texture2D(tSceneDepth, refractedUv).r);
            foregroundReject = step(backgroundDepth, surfaceDepth - 0.10);
            vec2 resolvedUv = mix(refractedUv, screenUv, foregroundReject);
            if (uHasSceneColor == 1) sceneRefraction = texture2D(tSceneColor, resolvedUv).rgb;
            if (uHasSceneDepth == 1 && foregroundReject < 0.5) {
              pathLength = max(0.0, backgroundDepth - surfaceDepth) / max(abs(refractedDirection.z), 0.08);
            }
            vec3 transmittance = exp(-uAbsorption * max(pathLength, 0.0));
            transmitted = sceneRefraction * transmittance + deep * (1.0 - transmittance);
            transmitted += vec3(0.0, 0.035, 0.055) * (1.0 - transmittance);
          } else {
            // Underwater Snell window: transmit the shared sky radiance only
            // inside the water-to-air cone, and keep a bright upwelling body
            // outside it so the critical rim reads as total internal
            // reflection instead of a dark pasted band.
            float viewUpness = smoothstep(-0.55, 0.72, viewDirection.y);
            vec3 ambientDown = vec3(0.012, 0.035, 0.055);
            vec3 ambientUp = vec3(0.035, 0.120, 0.160);
            vec3 mediumAmbient = mix(ambientDown, ambientUp, viewUpness);
            float upwellingSun = pow(max(dot(normalize(reflect(incident, normal)), normalize(uSunDir)), 0.0), 6.0) * 0.06;
            vec3 tirBody = mediumAmbient * (0.66 + 0.18 * max(dot(normal, viewDirection), 0.0));
            tirBody += uColor * 0.28 + uSunColor * upwellingSun;
            if (!tir) {
              vec3 windowDirection = normalize(refractedDirection);
              vec3 window = skyRadiance(windowDirection);
              // Snell stretch broadens the transmitted sun lobe at grazing
              // incidence.  Derivative filtering keeps the lobe stable while
              // preserving a sharp disc at normal incidence.
              float snellEta = etaIncident / max(etaTransmitted, 0.001);
              float snellStretch = max(snellEta * cosIncident / max(transmittedCos, 0.04), 1.0);
              float normalVariation = max(length(dFdx(normal)), length(dFdy(normal)));
              float snellSpread = (snellStretch - 1.0) * normalVariation * 0.5;
              float lobeExponent = 1.0 / max(1.0 / 700.0 + snellSpread * snellSpread, 0.0001);
              float windowSun = max(dot(windowDirection, normalize(uSunDir)), 0.0);
              float transmittedSun = pow(windowSun, lobeExponent) * lobeExponent * (24.0 / 700.0);
              float transmittedHalo = pow(windowSun, 24.0) * 0.08;
              window += uSunColor * (transmittedSun + transmittedHalo);
              transmitted = window;
            } else {
              transmitted = tirBody;
            }
            reflected = tirBody;
            pathLength = 0.0;
          }

          float bodyFog = 1.0 - exp(-max(pathLength, 0.0) / max(uWaterClarity, 1.0));
          if (uCameraUnderwater) transmitted = mix(transmitted, uFogColor, bodyFog * uUnderwaterFogStrength);
          float interfaceTransmission = uCameraUnderwater
            ? windowCoverage * (1.0 - fresnel)
            : (1.0 - fresnel);
          float reflectionWeight = uCameraUnderwater ? (1.0 - interfaceTransmission) : fresnel;
          vec3 color = mix(transmitted, reflected, clamp(reflectionWeight, 0.0, 1.0));

          vec3 halfVector = normalize(viewDirection + normalize(uSunDir));
          float specular = pow(max(dot(normal, halfVector), 0.0), mix(180.0, 1200.0, 1.0 - clamp(uRoughness, 0.0, 1.0))) * uSpecular;
          if (!uCameraUnderwater) color += uSunColor * specular;

          float foamFold = uOceanMode ? smoothstep(0.92, 0.20, jacobian) : 0.0;
          float foamNoiseLarge = noise(vWorld.xz * 0.115 + uTime * vec2(uFoamDrift * 0.24, -uFoamDrift * 0.16));
          float foamNoiseFine = noise(vWorld.xz * 0.68 - uTime * vec2(uFoamDrift * 0.82, uFoamDrift * 0.54));
          float foamBreakup = mix(foamNoiseLarge, foamNoiseFine, 0.48);
          // Coastal breaker band: the boundary is a broad shoaling zone, not
          // a hard rectangular stripe.  A directional low-frequency train is
          // gated by the live fold/crest field, then broken up by the same
          // foam history surrogate used in the open sea.
          float coastDistance = min(
            min(abs(vWorld.x - uInnerMinX), abs(vWorld.x - uInnerMaxX)),
            min(abs(vWorld.z - uInnerMinZ), abs(vWorld.z - uInnerMaxZ))
          );
          float coastMask = uOceanMode ? (1.0 - smoothstep(3.0, 28.0, coastDistance)) : 0.0;
          vec2 breakerWind = normalize(vec2(0.78, 0.63));
          float breakerTrain = 0.5 + 0.5 * sin(dot(vWorld.xz, breakerWind) * 0.24 - uTime * 0.78 + sin(vWorld.x * 0.075) * 0.75);
          float breaker = coastMask * smoothstep(0.50, 0.90, breakerTrain)
            * smoothstep(0.18, 0.82, crest + foamFold * 0.42);
          float foamPotential = max(max(foamFold, crest * 0.72), breaker);
          float foam = smoothstep(uFoamThreshold * 0.72, 0.92, foamPotential * mix(0.66, 1.38, foamBreakup * uFoamNoise));
          color = mix(color, vec3(0.92, 0.98, 1.0), foam * uFoamIntensity);
          color = mix(color, color * uNightTint, (1.0 - clamp(uAmbientIntensity, 0.0, 1.0)) * 0.45);
          color *= mix(0.20, 1.0, clamp(uAmbientIntensity, 0.0, 1.0));

          if (uDebugMode == 1) color = vec3(clamp(vHeight - uWaterLevel + 0.5, 0.0, 1.0));
          else if (uDebugMode == 2) color = normal * 0.5 + 0.5;
          else if (uDebugMode == 3) color = vec3(fresnel);
          else if (uDebugMode == 4) color = vec3(foregroundReject, tir ? 1.0 : 0.0, clamp(pathLength / 16.0, 0.0, 1.0));
          else if (uDebugMode == 5) color = exp(-uAbsorption * max(pathLength, 0.0));
          else if (uDebugMode == 6) color = vec3(foam, crest, 1.0 - normal.y);

          gl_FragColor = vec4(max(color, vec3(0.0)), uOceanMode ? 1.0 : clamp(uAlpha, 0.0, 1.0));
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
