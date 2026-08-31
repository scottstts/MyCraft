import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import {
  CAUSTIC_FIELD_SCALE,
  CAUSTIC_REFERENCE_DEPTH,
  WATER_ABSORPTION,
  WATER_IOR,
  WATER_SCATTERING,
} from '../../water/WaterOptics'

function createCausticFallback(): THREE.DataTexture {
  // The caustic target stores concentration / 4. A neutral field is therefore
  // 0.25; the sampler decodes it back to one rather than creating a bright
  // fallback decal while the optional target is unavailable.
  const neutral = Math.round(255 / CAUSTIC_FIELD_SCALE)
  const texture = new THREE.DataTexture(new Uint8Array([neutral, neutral, neutral, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * Participating underwater-medium composite for the WebGL renderer.
 *
 * WaterSurfaceMaterial owns the air/water interface. This pass owns the
 * bounded camera-to-receiver water segment: Beer-Lambert extinction, single
 * scattering from sky and sun irradiance, a Henyey-Greenstein phase response,
 * and a world-anchored particulate density field. The medium is integrated
 * per ray, so a frame may contain dry terrain, a waterline, and deep seabed
 * without classifying the whole screen as one medium.
 */
export class UnderwaterPass extends ShaderPass {
  private readonly causticFallback: THREE.DataTexture

  constructor() {
    const causticFallback = createCausticFallback()
    super({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1024.0 },
        invProjectionMatrix: { value: new THREE.Matrix4() },
        cameraMatrixWorld: { value: new THREE.Matrix4() },
        uCameraPosition: { value: new THREE.Vector3() },
        waterLevel: { value: 43.0 },
        // Coefficients are in world metres. Scattering is deliberately
        // non-zero so deep water tends toward blue-green airlight instead of
        // collapsing to a black vacuum after the red channel is absorbed.
        absorption: { value: new THREE.Vector3(...WATER_ABSORPTION) },
        scattering: { value: new THREE.Vector3(...WATER_SCATTERING) },
        fogColor: { value: new THREE.Color(0.10, 0.36, 0.55) },
        fogStrength: { value: 0.86 },
        skyAmbient: { value: new THREE.Color(0.12, 0.18, 0.32) },
        sunIntensity: { value: 1.35 },
        phaseG: { value: 0.28 },
        mediumTime: { value: 0.0 },
        uSunDirection: { value: new THREE.Vector3(0.35, 0.9, 0.2).normalize() },
        uSunColor: { value: new THREE.Color(1.0, 0.98, 0.90) },
        causticMap: { value: causticFallback },
        causticMapEnabled: { value: false },
        causticOrigin: { value: new THREE.Vector2() },
        causticExtent: { value: 17.0 },
        causticResolution: { value: new THREE.Vector2(256, 256) },
        causticReferenceDepth: { value: CAUSTIC_REFERENCE_DEPTH },
        causticFieldScale: { value: CAUSTIC_FIELD_SCALE },
        // underwater means that a water system is present and this pass is
        // allowed to run. It is deliberately not the camera's medium state:
        // the camera can be above the surface while a receiver ray crosses it.
        underwater: { value: false },
        debugMode: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform mat4 invProjectionMatrix;
        uniform mat4 cameraMatrixWorld;
        uniform vec3 uCameraPosition;
        uniform float waterLevel;
        uniform vec3 absorption;
        uniform vec3 scattering;
        uniform vec3 fogColor;
        uniform float fogStrength;
        uniform vec3 skyAmbient;
        uniform float sunIntensity;
        uniform float phaseG;
        uniform float mediumTime;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform sampler2D causticMap;
        uniform bool causticMapEnabled;
        uniform vec2 causticOrigin;
        uniform float causticExtent;
        uniform vec2 causticResolution;
        uniform float causticReferenceDepth;
        uniform float causticFieldScale;
        uniform bool underwater;
        uniform int debugMode;
        varying vec2 vUv;

        const float WATERLINE_TRANSITION = 0.65;
        const int MEDIUM_SAMPLES = 8;
        const float WATER_IOR = ${WATER_IOR.toFixed(3)};

        float readViewDepth(float rawDepth) {
          if (rawDepth >= 0.999999) return cameraFar;
          float viewZ = (cameraNear * cameraFar) / ((cameraFar - cameraNear) * rawDepth - cameraFar);
          return -viewZ;
        }

        vec3 worldRay(out vec3 viewRay) {
          vec2 ndc = vUv * 2.0 - 1.0;
          vec4 farView = invProjectionMatrix * vec4(ndc, 1.0, 1.0);
          farView /= max(farView.w, 1e-5);
          viewRay = normalize(farView.xyz);
          return normalize((cameraMatrixWorld * vec4(viewRay, 0.0)).xyz);
        }

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 345.45));
          p += dot(p, p + 34.345);
          return fract(p.x * p.y);
        }

        float valueNoise(vec2 p) {
          vec2 cell = floor(p);
          vec2 local = fract(p);
          vec2 fade = local * local * (3.0 - 2.0 * local);
          float a = hash21(cell);
          float b = hash21(cell + vec2(1.0, 0.0));
          float c = hash21(cell + vec2(0.0, 1.0));
          float d = hash21(cell + vec2(1.0, 1.0));
          return mix(mix(a, b, fade.x), mix(c, d, fade.x), fade.y);
        }

        // World-anchored density avoids screen-space fog and gives suspended
        // sediment/algae enough coherent variation to read as a medium. The
        // y terms make the field change through the column, while the time
        // offsets provide slow current advection.
        float particleDensity(vec3 worldPosition) {
          vec2 broadUv = worldPosition.xz * 0.045
            + vec2(worldPosition.y * 0.019, -worldPosition.y * 0.014)
            + vec2(mediumTime * 0.012, -mediumTime * 0.009);
          vec2 fineUv = worldPosition.xz * 0.19
            + vec2(worldPosition.y * 0.061, -worldPosition.y * 0.047)
            + vec2(-mediumTime * 0.027, mediumTime * 0.021);
          float broad = valueNoise(broadUv);
          float fine = valueNoise(fineUv);
          return clamp(0.78 + (broad - 0.5) * 0.36 + (fine - 0.5) * 0.14, 0.32, 1.18);
        }

        // Relative Henyey-Greenstein phase. Its isotropic value is one, which
        // keeps the authored sun/sky irradiance units legible in the integral.
        float relativePhase(float cosTheta, float g) {
          float g2 = g * g;
          float denominator = pow(max(1.0 + g2 - 2.0 * g * cosTheta, 0.001), 1.5);
          return (1.0 - g2) / denominator;
        }

        float interfaceTransmission(float cosIncident) {
          float eta = 1.0 / WATER_IOR;
          float sinTransmitted2 = eta * eta * max(1.0 - cosIncident * cosIncident, 0.0);
          if (sinTransmitted2 >= 1.0) return 0.0;
          float cosTransmitted = sqrt(max(1.0 - sinTransmitted2, 0.0));
          float rs = (cosIncident - WATER_IOR * cosTransmitted)
            / max(cosIncident + WATER_IOR * cosTransmitted, 0.001);
          float rp = (WATER_IOR * cosIncident - cosTransmitted)
            / max(WATER_IOR * cosIncident + cosTransmitted, 0.001);
          return clamp(1.0 - 0.5 * (rs * rs + rp * rp), 0.0, 1.0);
        }

        float sampleCausticField(vec3 worldPosition) {
          if (!causticMapEnabled) return 1.0;
          vec3 sun = normalize(uSunDirection);
          vec3 refractedSun = refract(-sun, vec3(0.0, 1.0, 0.0), 1.0 / WATER_IOR);
          float depth = max(waterLevel - worldPosition.y, 0.0);
          float vertical = max(-refractedSun.y, 0.12);
          float referenceTravel = (causticReferenceDepth - depth) / vertical;
          vec2 projected = worldPosition.xz + refractedSun.xz * referenceTravel;
          vec2 causticCoord = (projected - causticOrigin) / max(causticExtent, 1.0) + 0.5;
          vec2 uv = fract(causticCoord);
          float center = texture2D(causticMap, uv).r;
          // The caustic target uses linear filtering. The volume contribution
          // is intentionally low-frequency; receiver-side terrain sampling
          // owns derivative-aware footprint rejection.
          return clamp(center * causticFieldScale, 0.0, 8.0);
        }

        void main() {
          vec4 source = texture2D(tDiffuse, vUv);
          if (!underwater) {
            gl_FragColor = source;
            return;
          }

          // Above-water ocean pixels already contain interface reflection and
          // Fresnel-weighted transmission from WaterSurfaceMaterial. Do not
          // integrate a second camera-side volume over that mixed interface.
          float waterSurfaceMask = 1.0 - step(0.001, source.a);
          float cameraAboveWater = step(waterLevel, uCameraPosition.y);
          if (waterSurfaceMask > 0.5 && cameraAboveWater > 0.5) {
            gl_FragColor = source;
            return;
          }

          vec3 viewRay;
          vec3 ray = worldRay(viewRay);
          float sceneViewDepth = readViewDepth(texture2D(tDepth, vUv).r);
          float sceneDistance = sceneViewDepth / max(-viewRay.z, 0.02);

          // Solve the water interval in ray distance. The same equations work
          // from either side of the interface and retain only crossings that
          // occur before the visible receiver.
          float surfaceDistance = -1.0;
          if (abs(ray.y) > 0.001) {
            surfaceDistance = (waterLevel - uCameraPosition.y) / ray.y;
          }
          float crossingAhead = max(
            step(0.001, surfaceDistance),
            step(abs(surfaceDistance), 0.001) * step(0.0, -ray.y)
          );
          float cameraBelow = step(0.001, waterLevel - uCameraPosition.y);
          float crossedDistance = clamp(surfaceDistance, 0.0, sceneDistance);
          float waterDistance = cameraBelow > 0.5
            ? (crossingAhead > 0.5 ? crossedDistance : sceneDistance)
            : (crossingAhead > 0.5 ? max(sceneDistance - crossedDistance, 0.0) : 0.0);
          waterDistance = min(max(waterDistance, 0.0), cameraFar);
          float waterStart = cameraBelow < 0.5 && crossingAhead > 0.5
            ? crossedDistance
            : 0.0;

          // Keep the authored soft camera transition for the below-surface
          // view. Above the interface, non-marker receivers get their actual
          // water interval at full strength; the visible ocean marker returned
          // above is the one case whose mixed interface must remain untouched.
          float cameraWaterBlend = smoothstep(
            -WATERLINE_TRANSITION,
            WATERLINE_TRANSITION,
            waterLevel - uCameraPosition.y
          );
          float mediumBlend = cameraBelow > 0.5 ? cameraWaterBlend : 1.0;

          vec3 transmittance = vec3(1.0);
          vec3 inScatter = vec3(0.0);
          float debugCaustic = 1.0;
          float debugDensity = 0.0;
          float debugSunPhase = 0.0;
          if (waterDistance > 0.001) {
            float segmentLength = waterDistance / float(MEDIUM_SAMPLES);
            float densityScale = max(fogStrength, 0.001);
            vec3 sigmaBase = absorption + scattering;
            vec3 sun = normalize(uSunDirection);
            vec3 refractedSun = refract(-sun, vec3(0.0, 1.0, 0.0), 1.0 / WATER_IOR);
            float lightVertical = max(-refractedSun.y, 0.12);
            float sunVisibility = smoothstep(0.04, 0.18, max(sun.y, 0.0));
            float surfaceT = interfaceTransmission(max(sun.y, 0.0));
            float phase = relativePhase(dot(ray, sun), clamp(phaseG, -0.85, 0.85));
            debugSunPhase = phase * sunVisibility;

            for (int sampleIndex = 0; sampleIndex < MEDIUM_SAMPLES; sampleIndex++) {
              float sampleDistance = segmentLength * (float(sampleIndex) + 0.5);
              vec3 samplePosition = uCameraPosition + ray * (waterStart + sampleDistance);
              float density = particleDensity(samplePosition) * densityScale;
              vec3 sigmaS = scattering * density;
              vec3 sigmaT = sigmaBase * density;
              vec3 stepTransmittance = exp(-sigmaT * segmentLength);
              vec3 scatterFraction = sigmaS / max(sigmaT, vec3(0.0001));

              float sampleDepth = max(waterLevel - samplePosition.y, 0.0);
              float lightDistance = sampleDepth / lightVertical;
              vec3 lightTransmittance = exp(-sigmaBase * lightDistance * densityScale * 0.90);
              float caustic = sampleCausticField(samplePosition);
              float causticTransport = mix(1.0, caustic, 0.42);
              vec3 ambientSource = mix(skyAmbient, fogColor, 0.35)
                * (0.82 + 0.18 * max(ray.y, 0.0));
              vec3 sunSource = uSunColor * sunIntensity * sunVisibility * surfaceT
                * lightTransmittance * phase * causticTransport;
              inScatter += transmittance * (ambientSource + sunSource)
                * scatterFraction * (vec3(1.0) - stepTransmittance);
              transmittance *= stepTransmittance;

              debugCaustic = caustic;
              debugDensity = density;
            }
          }

          vec3 color = source.rgb * transmittance + inScatter;
          color = mix(source.rgb, color, mediumBlend);

          if (debugMode == 1) color = vec3(clamp(waterDistance / 64.0, 0.0, 1.0) * mediumBlend);
          else if (debugMode == 2) color = mix(vec3(1.0), transmittance, mediumBlend);
          else if (debugMode == 3) color = vec3(clamp(1.0 - transmittance.g, 0.0, 1.0) * mediumBlend);
          else if (debugMode == 4) color = vec3(clamp(debugCaustic / ${CAUSTIC_FIELD_SCALE.toFixed(1)}, 0.0, 1.0) * mediumBlend);
          else if (debugMode == 5) color = vec3(clamp(debugDensity, 0.0, 1.0) * mediumBlend);
          else if (debugMode == 6) color = vec3(clamp(debugSunPhase / 2.0, 0.0, 1.0) * mediumBlend);

          gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
        }
      `,
    })
    this.causticFallback = causticFallback
  }

  setDepthTexture(depth: THREE.Texture | null): void { this.uniforms.tDepth.value = depth }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.uniforms.cameraNear.value = camera.near
    this.uniforms.cameraFar.value = camera.far
    ;(this.uniforms.invProjectionMatrix.value as THREE.Matrix4).copy(camera.projectionMatrixInverse)
    ;(this.uniforms.cameraMatrixWorld.value as THREE.Matrix4).copy(camera.matrixWorld)
    ;(this.uniforms.uCameraPosition.value as THREE.Vector3).copy(camera.position)
  }

  setWaterLevel(level: number): void { this.uniforms.waterLevel.value = level }

  setAbsorption(value: THREE.Vector3): void { (this.uniforms.absorption.value as THREE.Vector3).copy(value) }

  setScattering(value: THREE.Vector3): void { (this.uniforms.scattering.value as THREE.Vector3).copy(value) }

  setFogColor(value: THREE.Color): void { (this.uniforms.fogColor.value as THREE.Color).copy(value) }

  setFogStrength(value: number): void { this.uniforms.fogStrength.value = Math.max(0, value) }

  setSun(direction: THREE.Vector3, color: THREE.Color): void {
    ;(this.uniforms.uSunDirection.value as THREE.Vector3).copy(direction).normalize()
    ;(this.uniforms.uSunColor.value as THREE.Color).copy(color)
  }

  setAtmosphere(skyIrradiance: THREE.Color, intensity: number): void {
    ;(this.uniforms.skyAmbient.value as THREE.Color).copy(skyIrradiance)
    this.uniforms.sunIntensity.value = Math.max(0, intensity)
  }

  setTime(timeSeconds: number): void { this.uniforms.mediumTime.value = timeSeconds }

  setCaustics(
    texture: THREE.Texture | null,
    origin: { x: number; y: number },
    extent: number,
    resolution: { x: number; y: number },
    referenceDepth = CAUSTIC_REFERENCE_DEPTH,
  ): void {
    this.uniforms.causticMap.value = texture ?? this.causticFallback
    this.uniforms.causticMapEnabled.value = !!texture
    ;(this.uniforms.causticOrigin.value as THREE.Vector2).set(origin.x, origin.y)
    this.uniforms.causticExtent.value = Math.max(1, extent)
    ;(this.uniforms.causticResolution.value as THREE.Vector2).set(Math.max(1, resolution.x), Math.max(1, resolution.y))
    this.uniforms.causticReferenceDepth.value = Math.max(2, referenceDepth)
  }

  setUnderwater(value: boolean): void { this.uniforms.underwater.value = value }

  setDebugMode(mode: number): void { this.uniforms.debugMode.value = Math.max(0, Math.floor(mode)) }

  dispose(): void {
    this.material.dispose()
    this.causticFallback.dispose()
  }
}
