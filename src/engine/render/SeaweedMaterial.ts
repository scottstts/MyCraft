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
      varying vec3 vViewPosition;
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
        float phase = dot(anchorWorld.xz, flowDirection) * 0.19
          - uTime * uFlowSpeed
          + aSeed * 6.28318530718;
        float crossPhase = dot(anchorWorld.xz, sideDirection) * 0.13
          + uTime * uFlowSpeed * 0.71
          + aSeed * 3.17;
        float broadCurrent = sin(phase) * 0.58
          + sin(phase * 0.47 + aSeed * 4.7) * 0.27
          + sin(crossPhase) * 0.15;
        float gust = 0.72 + 0.28 * sin(uTime * uFlowSpeed * 0.42 + aSeed * 9.0);
        float rooted = pow(bladeT, 1.62);
        float bend = uFlowStrength * instanceHeight
          * (0.74 + broadCurrent * 0.26)
          * gust
          * rooted;
        float flutter = sin(uTime * (5.0 + hash11(aSeed) * 2.0)
          + aSeed * 19.0 + anchorWorld.x * 0.23 - anchorWorld.z * 0.17)
          * uFlutter
          * instanceHeight
          * pow(bladeT, 2.15);

        vec3 localPosition = position;
        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(localPosition, 1.0);
        worldPosition.xz += flowDirection * bend + sideDirection * flutter;

        vec3 baseNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vec3 currentNormal = normalize(
          baseNormal
          - vec3(flowDirection.x, 0.0, flowDirection.y) * uFlowStrength * rooted * 0.52
          + vec3(0.0, 0.10, 0.0) * rooted
        );

        vUv = uv;
        vWorldPosition = worldPosition.xyz;
        vViewPosition = (viewMatrix * worldPosition).xyz;
        vWorldNormal = currentNormal;
        vWaterDepth = max(uWaterLevel - worldPosition.y, 0.0);
        vFlow = clamp(0.5 + broadCurrent * 0.5, 0.0, 1.0);
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
      uniform sampler2D voxelShadowDepth;
      uniform vec2 voxelShadowResolution;
      uniform float voxelShadowCameraNear;
      uniform float voxelShadowCameraFar;
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
      uniform vec2 waterCausticResolution;

      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vViewPosition;
      varying vec3 vWorldNormal;
      varying float vWaterDepth;
      varying float vFlow;

      float decodeVoxelShadowDepth(float raw) {
        if (raw >= 0.999999) return voxelShadowCameraFar;
        return (voxelShadowCameraNear * voxelShadowCameraFar) /
          ((voxelShadowCameraFar - voxelShadowCameraNear) * raw - voxelShadowCameraFar);
      }

      float sampleVoxelShadowDepth(vec2 uv) {
        return -decodeVoxelShadowDepth(
          texture2D(voxelShadowDepth, clamp(uv, vec2(0.0), vec2(1.0))).r
        );
      }

      float sampleVoxelShadow(vec2 uv) {
        return texture2D(voxelShadowMask, clamp(uv, vec2(0.0), vec2(1.0))).r;
      }

      float getVoxelShadowMask() {
        if (!voxelShadowEnabled) return 1.0;
        vec2 uv = gl_FragCoord.xy / max(voxelShadowResolution, vec2(1.0));
        float center = sampleVoxelShadow(uv);
        float uncertainty = smoothstep(0.02, 0.98, 4.0 * center * (1.0 - center));
        if (uncertainty <= 0.0) return center;
        vec2 texel = 1.0 / max(voxelShadowResolution, vec2(1.0));
        float referenceDepth = -vViewPosition.z;
        vec2 offsets[4];
        offsets[0] = vec2(texel.x, 0.0);
        offsets[1] = vec2(-texel.x, 0.0);
        offsets[2] = vec2(0.0, texel.y);
        offsets[3] = vec2(0.0, -texel.y);
        float weighted = 0.0;
        float weightSum = 0.0;
        for (int i = 0; i < 4; i++) {
          float neighbourDepth = sampleVoxelShadowDepth(uv + offsets[i]);
          float tolerance = max(0.025, referenceDepth * 0.015);
          float weight = 1.0 - smoothstep(
            tolerance,
            tolerance * 4.0,
            abs(neighbourDepth - referenceDepth)
          );
          weighted += sampleVoxelShadow(uv + offsets[i]) * weight;
          weightSum += weight;
        }
        if (weightSum <= 1e-4) return center;
        return mix(center, weighted / weightSum, 0.55 * uncertainty);
      }

      float sampleWaterCausticPhase(
        vec2 causticCoord,
        vec2 phaseOffset,
        vec2 diagonalA,
        vec2 diagonalB,
        float footprintMix
      ) {
        vec2 uv = causticCoord + phaseOffset;
        float center = texture2D(waterCausticMap, uv).r;
        float footprintAverage = (
          texture2D(waterCausticMap, uv + diagonalA).r
          + texture2D(waterCausticMap, uv - diagonalA).r
          + texture2D(waterCausticMap, uv + diagonalB).r
          + texture2D(waterCausticMap, uv - diagonalB).r
        ) * 0.25;
        return clamp(
          mix(center, footprintAverage, footprintMix) * waterCausticFieldScale,
          0.0,
          8.0
        );
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

        vec2 footprintX = dFdx(causticCoord);
        vec2 footprintY = dFdy(causticCoord);
        vec2 diagonalA = (footprintX + footprintY) * 0.35;
        vec2 diagonalB = (footprintX - footprintY) * 0.35;
        float footprint = max(length(footprintX), length(footprintY))
          * max(waterCausticResolution.x, waterCausticResolution.y);
        float footprintMix = smoothstep(0.75, 3.0, footprint);

        float f00 = sampleWaterCausticPhase(
          causticCoord, vec2(0.0), diagonalA, diagonalB, footprintMix
        );
        float f10 = sampleWaterCausticPhase(
          causticCoord, vec2(0.5, 0.0), diagonalA, diagonalB, footprintMix
        );
        float f01 = sampleWaterCausticPhase(
          causticCoord, vec2(0.0, 0.5), diagonalA, diagonalB, footprintMix
        );
        float f11 = sampleWaterCausticPhase(
          causticCoord, vec2(0.5), diagonalA, diagonalB, footprintMix
        );
        float focusedExcess = max(f00 - 1.0, 0.0)
          + max(f10 - 1.0, 0.0)
          + max(f01 - 1.0, 0.0)
          + max(f11 - 1.0, 0.0);
        return clamp(1.0 + focusedExcess, 0.0, 8.0);
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
        uFlowStrength: { value: 0.22 },
        uFlowSpeed: { value: 0.82 },
        uFlutter: { value: 0.08 },
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
