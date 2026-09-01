import * as THREE from 'three'
import {
  CAUSTIC_FIELD_SCALE,
  CAUSTIC_REFERENCE_DEPTH,
  WATER_EXTINCTION,
  WATER_IOR,
} from './water/WaterOptics'

type UniformRecord = Record<string, { value: unknown }>

function createNeutralCausticTexture(): THREE.DataTexture {
  const neutral = Math.round((1 / CAUSTIC_FIELD_SCALE) * 255)
  const texture = new THREE.DataTexture(
    new Uint8Array([neutral, neutral, neutral, 255]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.colorSpace = THREE.NoColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

/**
 * Pixel-art seaweed material.
 *
 * The material follows the grass cutout contract, but owns a rooted water
 * current deformation and the underwater direct-light response. Native Three
 * shadow maps are disabled by the renderer; voxel visibility and its shared
 * depth-aware receiver are therefore the authoritative shadow inputs here.
 */
export class SeaweedMaterial extends THREE.ShaderMaterial {
  private readonly neutralCausticTexture: THREE.DataTexture

  constructor(map: THREE.Texture) {
    const neutralCausticTexture = createNeutralCausticTexture()
    const vertexShader = `
      precision highp float;

      attribute float aSeed;

      uniform float uTime;
      uniform float uFlowStrength;
      uniform float uFlowSpeed;
      uniform float uFlutter;
      uniform vec2 uFlowDirection;
      uniform float uWaterLevel;

      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying float vWaterDepth;
      varying float vFlow;

      float hash11(float value) {
        return fract(sin(value * 91.173 + 17.31) * 43758.5453123);
      }

      void main() {
        vec4 anchorWorld4 = modelMatrix * instanceMatrix * vec4(0.5, 0.0, 0.5, 1.0);
        vec3 anchorWorld = anchorWorld4.xyz;
        vec2 flowDirection = normalize(uFlowDirection);
        vec2 sideDirection = vec2(-flowDirection.y, flowDirection.x);
        float bladeT = clamp(position.y, 0.0, 1.0);
        float instanceHeight = max(length(instanceMatrix[1].xyz), 0.001);
        float seedPhase = aSeed * 6.28318530718;
        float phase = dot(anchorWorld.xz, flowDirection) * 0.115
          + dot(anchorWorld.xz, sideDirection) * 0.021
          - uTime * uFlowSpeed
          + seedPhase;
        float crossPhase = dot(anchorWorld.xz, sideDirection) * 0.17
          + dot(anchorWorld.xz, flowDirection) * 0.031
          + uTime * uFlowSpeed * 0.43
          + seedPhase * 0.67;

        // A traveling vertical phase makes each segmented card flex as a
        // continuous underwater wave instead of rocking as one rigid sheet.
        // The smooth envelope is exactly zero at the root, preserving the
        // block-top attachment while the upper sections follow the current.
        float rooted = bladeT * bladeT * (3.0 - 2.0 * bladeT);
        float alongWave = phase + bladeT * 2.45;
        float crossWave = crossPhase - bladeT * 2.85;
        float currentWave = sin(alongWave) * 0.68
          + sin(alongWave * 0.53 - uTime * uFlowSpeed * 0.18 + seedPhase * 0.37) * 0.22;
        float sideWave = sin(crossWave) * 0.18;
        float gust = 0.82 + 0.18 * sin(uTime * uFlowSpeed * 0.37 + seedPhase * 1.7);
        float bendAmplitude = uFlowStrength * instanceHeight * rooted * gust;
        vec2 displacement = (
          flowDirection * currentWave + sideDirection * sideWave
        ) * bendAmplitude;
        float flutter = sin(
          uTime * (4.0 + hash11(aSeed) * 1.5)
          + seedPhase * 2.7
          + dot(anchorWorld.xz, sideDirection) * 0.31
          + bladeT * 5.0
        ) * uFlutter * instanceHeight * pow(bladeT, 2.6);
        displacement += sideDirection * flutter;

        vec3 localPosition = position;
        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(localPosition, 1.0);
        worldPosition.xz += displacement;

        vec3 baseNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vec3 currentNormal = normalize(
          baseNormal
          - vec3(displacement.x, 0.0, displacement.y) * 0.42
          + vec3(0.0, 0.10, 0.0) * rooted
        );

        vUv = uv;
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = currentNormal;
        vWaterDepth = max(uWaterLevel - worldPosition.y, 0.0);
        vFlow = clamp(0.5 + currentWave * 0.36 + sideWave * 0.22, 0.0, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `

    const fragmentShader = `
      precision highp float;

      uniform sampler2D map;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform float dayLight;
      uniform float starLight;
      uniform vec3 skyAmbient;
      uniform float alphaCutoff;

      uniform sampler2D voxelShadowMask;
      uniform vec2 voxelShadowResolution;
      uniform bool voxelShadowEnabled;

      uniform bool waterCausticEnabled;
      uniform float waterCausticLevel;
      uniform float waterCausticIntensity;
      uniform float waterCausticReferenceDepth;
      uniform float waterCausticFieldScale;
      uniform float waterCausticSunIntensity;
      uniform vec3 waterCausticExtinction;
      uniform sampler2D waterCausticMap;
      uniform bool waterCausticMapEnabled;
      uniform vec2 waterCausticOrigin;
      uniform float waterCausticExtent;

      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying float vWaterDepth;
      varying float vFlow;

      float getVoxelShadowMask() {
        if (!voxelShadowEnabled) return 1.0;
        vec2 uv = gl_FragCoord.xy / max(voxelShadowResolution, vec2(1.0));
        // The full-screen voxel pass already resolves a filtered visibility
        // value. A single lookup keeps dense alpha cards from multiplying
        // that pass's cost with another five-tap depth reconstruction.
        return texture2D(voxelShadowMask, clamp(uv, vec2(0.0), vec2(1.0))).r;
      }

      float sampleWaterCaustics(vec3 worldPosition) {
        vec3 sun = normalize(sunDirection);
        vec3 refractedSun = refract(
          -sun,
          vec3(0.0, 1.0, 0.0),
          1.0 / ${WATER_IOR.toFixed(3)}
        );
        float depth = max(waterCausticLevel - worldPosition.y, 0.0);
        float vertical = max(-refractedSun.y, 0.12);
        float referenceTravel = (waterCausticReferenceDepth - depth) / vertical;
        vec2 projected = worldPosition.xz + refractedSun.xz * referenceTravel;
        vec2 causticCoord = (projected - waterCausticOrigin)
          / max(waterCausticExtent, 1.0) + 0.5;
        // WaterCaustics owns the filtered/mipmapped footprint. One linear
        // sample is sufficient for the thin vegetation receiver and avoids
        // the old 20-sample per-fragment caustic gather.
        return clamp(
          texture2D(waterCausticMap, causticCoord).r * waterCausticFieldScale,
          0.0,
          8.0
        );
      }

      float waterSunTransmission(float cosIncident) {
        float eta = 1.0 / ${WATER_IOR.toFixed(3)};
        float sinTransmitted2 = eta * eta * max(1.0 - cosIncident * cosIncident, 0.0);
        if (sinTransmitted2 >= 1.0) return 0.0;
        float cosTransmitted = sqrt(max(1.0 - sinTransmitted2, 0.0));
        float rs = (cosIncident - ${WATER_IOR.toFixed(3)} * cosTransmitted)
          / max(cosIncident + ${WATER_IOR.toFixed(3)} * cosTransmitted, 0.001);
        float rp = (${WATER_IOR.toFixed(3)} * cosIncident - cosTransmitted)
          / max(${WATER_IOR.toFixed(3)} * cosIncident + cosTransmitted, 0.001);
        return clamp(1.0 - 0.5 * (rs * rs + rp * rp), 0.0, 1.0);
      }

      void main() {
        vec4 tex = texture2D(map, vUv);
        if (tex.a < alphaCutoff) discard;

        vec3 albedo = tex.rgb;
        vec3 normal = normalize(vWorldNormal);
        vec3 sun = normalize(sunDirection);
        float sunDot = abs(dot(normal, sun));
        float shadow = getVoxelShadowMask();
        float day = clamp(dayLight, 0.0, 1.0);
        vec3 starAmb = vec3(0.02, 0.025, 0.04) * 0.35
          * clamp(starLight, 0.0, 1.0);
        vec3 ambient = skyAmbient + starAmb;
        vec3 directSun = sunColor * sunDot * day * shadow;

        // Keep the sampled green readable through the water medium while
        // allowing deeper plants to pick up a restrained blue-green cast.
        float depthTint = smoothstep(4.0, 24.0, vWaterDepth);
        vec3 waterTint = mix(
          vec3(1.0),
          vec3(0.74, 0.96, 1.04),
          depthTint * 0.24
        );
        albedo *= waterTint;

        vec3 backScatter = vec3(0.16, 0.34, 0.10)
          * pow(max(dot(-normal, sun), 0.0), 2.0)
          * 0.22
          * day;
        vec3 color = albedo * (ambient + directSun + backScatter);

        if (waterCausticEnabled && waterCausticMapEnabled) {
          float submerged = 1.0 - smoothstep(
            waterCausticLevel - 0.75,
            waterCausticLevel + 0.25,
            vWorldPosition.y
          );
          float sunActive = smoothstep(0.02, 0.18, waterCausticSunIntensity);
          if (submerged > 0.001 && sunActive > 0.001) {
            vec3 refractedSun = refract(
              -sun,
              vec3(0.0, 1.0, 0.0),
              1.0 / ${WATER_IOR.toFixed(3)}
            );
            float receiverCos = abs(dot(normal, -refractedSun));
            float airCos = max(abs(dot(normal, sun)), 0.001);
            float angleRatio = receiverCos / airCos;
            float depth = max(waterCausticLevel - vWorldPosition.y, 0.0);
            float lightDistance = depth / max(-refractedSun.y, 0.12);
            vec3 lightTransmittance = exp(-waterCausticExtinction * lightDistance);
            float sunScale = clamp(waterCausticSunIntensity / 1.35, 0.0, 1.0);
            float field = sampleWaterCaustics(vWorldPosition);
            float focusedField = mix(
              1.0,
              field,
              clamp(waterCausticIntensity, 0.0, 1.0)
            );
            vec3 transport = lightTransmittance
              * waterSunTransmission(max(sun.y, 0.0))
              * sunScale
              * angleRatio
              * focusedField;
            vec3 waterDirect = directSun * transport;
            // Only direct sunlight is replaced by the caustic transport. Sky,
            // stars, albedo, and the local back-scatter remain independent.
            color += albedo * (waterDirect - directSun)
              * submerged
              * sunActive;
          }
        }

        // Slight motion-linked luminance variation keeps dense stands from
        // reading as identical copies while the texture remains authoritative.
        color *= mix(0.94, 1.06, vFlow);
        gl_FragColor = vec4(color, 1.0);
      }
    `

    super({
      name: 'MyCraftSeaweedMaterial',
      vertexShader,
      fragmentShader,
      uniforms: {
        map: { value: map },
        uTime: { value: 0 },
        uFlowStrength: { value: 0.075 },
        uFlowSpeed: { value: 0.72 },
        uFlutter: { value: 0.018 },
        uFlowDirection: { value: new THREE.Vector2(0.72, 0.69).normalize() },
        uWaterLevel: { value: 42.5 },
        sunDirection: { value: new THREE.Vector3(0.35, 0.9, 0.2).normalize() },
        sunColor: { value: new THREE.Color(1, 1, 1) },
        dayLight: { value: 1 },
        starLight: { value: 0 },
        skyAmbient: { value: new THREE.Color(0.12, 0.18, 0.32) },
        alphaCutoff: { value: 0.15 },
        voxelShadowMask: { value: null },
        voxelShadowDepth: { value: null },
        voxelShadowResolution: { value: new THREE.Vector2(1, 1) },
        voxelShadowCameraNear: { value: 0.1 },
        voxelShadowCameraFar: { value: 1024 },
        voxelShadowEnabled: { value: false },
        waterCausticEnabled: { value: false },
        waterCausticLevel: { value: 42.5 },
        waterCausticIntensity: { value: 0.8 },
        waterCausticReferenceDepth: { value: CAUSTIC_REFERENCE_DEPTH },
        waterCausticFieldScale: { value: CAUSTIC_FIELD_SCALE },
        waterCausticSunIntensity: { value: 1.35 },
        waterCausticExtinction: { value: new THREE.Vector3(...WATER_EXTINCTION) },
        waterCausticMap: { value: neutralCausticTexture },
        waterCausticMapEnabled: { value: false },
        waterCausticOrigin: { value: new THREE.Vector2(0, 0) },
        waterCausticExtent: { value: 256 },
        waterCausticResolution: { value: new THREE.Vector2(1, 1) },
      },
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      alphaTest: 0.15,
      toneMapped: false,
      lights: false,
    })
    this.neutralCausticTexture = neutralCausticTexture
  }

  setMap(texture: THREE.Texture): void {
    this.uniforms.map.value = texture
    this.needsUpdate = true
  }

  setTime(time: number): void { this.uniforms.uTime.value = time }

  setWaterLevel(level: number): void {
    this.uniforms.uWaterLevel.value = level
    this.uniforms.waterCausticLevel.value = level
  }

  setFlow(direction: THREE.Vector2, strength: number, speed: number, flutter: number): void {
    (this.uniforms.uFlowDirection.value as THREE.Vector2).copy(direction).normalize()
    this.uniforms.uFlowStrength.value = Math.max(0, strength)
    this.uniforms.uFlowSpeed.value = Math.max(0, speed)
    this.uniforms.uFlutter.value = Math.max(0, flutter)
  }

  setSun(direction: THREE.Vector3, color: THREE.Color): void {
    (this.uniforms.sunDirection.value as THREE.Vector3).copy(direction).normalize()
    ;(this.uniforms.sunColor.value as THREE.Color).copy(color)
  }

  setDayNight(day: number, star: number): void {
    this.uniforms.dayLight.value = THREE.MathUtils.clamp(day, 0, 1)
    this.uniforms.starLight.value = THREE.MathUtils.clamp(star, 0, 1)
  }

  setSkyAmbient(color: THREE.Color): void {
    (this.uniforms.skyAmbient.value as THREE.Color).copy(color)
  }

  setAlphaCutoff(cutoff: number): void {
    this.uniforms.alphaCutoff.value = THREE.MathUtils.clamp(cutoff, 0, 1)
  }

  setVoxelShadowTexture(texture: THREE.Texture, width: number, height: number, enabled = true): void {
    this.uniforms.voxelShadowMask.value = texture
    ;(this.uniforms.voxelShadowResolution.value as THREE.Vector2).set(Math.max(1, width), Math.max(1, height))
    this.uniforms.voxelShadowEnabled.value = enabled
  }

  setVoxelShadowDepthTexture(texture: THREE.Texture, near: number, far: number): void {
    this.uniforms.voxelShadowDepth.value = texture
    this.uniforms.voxelShadowCameraNear.value = near
    this.uniforms.voxelShadowCameraFar.value = far
  }

  /** Share the live voxel-shadow binding, including resize/capture toggles. */
  shareVoxelShadowState(source: THREE.ShaderMaterial): void {
    const sourceUniforms = source.uniforms as UniformRecord
    const keys = [
      'voxelShadowMask',
      'voxelShadowDepth',
      'voxelShadowResolution',
      'voxelShadowCameraNear',
      'voxelShadowCameraFar',
      'voxelShadowEnabled',
    ] as const
    for (const key of keys) {
      const uniform = sourceUniforms[key]
      if (uniform) this.uniforms[key] = uniform
    }
  }

  setWaterCaustics(
    enabled: boolean,
    waterLevel: number,
    intensity: number,
    referenceDepth = CAUSTIC_REFERENCE_DEPTH,
    sunIntensity = 1.35,
  ): void {
    this.uniforms.waterCausticEnabled.value = enabled
    this.uniforms.waterCausticLevel.value = waterLevel
    this.uniforms.uWaterLevel.value = waterLevel
    this.uniforms.waterCausticIntensity.value = Math.max(0, intensity)
    this.uniforms.waterCausticReferenceDepth.value = Math.max(2, referenceDepth)
    this.uniforms.waterCausticSunIntensity.value = Math.max(0, sunIntensity)
  }

  setWaterCausticTexture(
    texture: THREE.Texture | null,
    origin: { x: number; y: number },
    extent: number,
    resolution: { x: number; y: number },
    referenceDepth = CAUSTIC_REFERENCE_DEPTH,
  ): void {
    this.uniforms.waterCausticMap.value = texture ?? this.neutralCausticTexture
    this.uniforms.waterCausticMapEnabled.value = !!texture
    ;(this.uniforms.waterCausticOrigin.value as THREE.Vector2).set(origin.x, origin.y)
    this.uniforms.waterCausticExtent.value = Math.max(1, extent)
    ;(this.uniforms.waterCausticResolution.value as THREE.Vector2).set(
      Math.max(1, resolution.x),
      Math.max(1, resolution.y),
    )
    this.uniforms.waterCausticReferenceDepth.value = Math.max(2, referenceDepth)
  }

  dispose(): void {
    this.neutralCausticTexture.dispose()
    super.dispose()
  }
}
