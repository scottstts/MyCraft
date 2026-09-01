import * as THREE from 'three'
import { OCEAN_WAVES, oceanWaveDeclarations } from './OceanWaveField'

/** Refractive indices used by both the forward projection and water BRDF. */
export const AIR_REFRACTIVE_INDEX = 1.0
export const WATER_REFRACTIVE_INDEX = 1.333
export const FORWARD_REFRACTION_SOLVE_STEPS = 14

const CRITICAL_TANGENT = Math.tan(
  Math.asin(AIR_REFRACTIVE_INDEX / WATER_REFRACTIVE_INDEX),
)

const forwardVisibilityFallback = new THREE.DataTexture(
  new Uint8Array([255, 255, 255, 255]),
  1,
  1,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
)
forwardVisibilityFallback.colorSpace = THREE.NoColorSpace
forwardVisibilityFallback.needsUpdate = true

const forwardReceiverFallback = new THREE.DataTexture(
  new Float32Array([0, 0, 0, 0]),
  1,
  1,
  THREE.RGBAFormat,
  THREE.FloatType,
)
forwardReceiverFallback.colorSpace = THREE.NoColorSpace
forwardReceiverFallback.needsUpdate = true

export const forwardRefractionUniforms = {
  uForwardRefractionActive: { value: 0 },
  uForwardWaterLevel: { value: 43.5 },
  uForwardRefractionTime: { value: 0 },
  uForwardRefractionWaveAmp: { value: 1 },
  uForwardRefractionWaveChop: { value: 1 },
  uForwardRefractionWaveSpeed: { value: 1 },
  uForwardRefractionResolution: { value: new THREE.Vector2(1, 1) },
  uForwardProjectionMatrix: { value: new THREE.Matrix4() },
  uForwardCameraUnderwater: { value: false },
  uForwardRefractionOutputReceiver: { value: 0 },
  uForwardSunVisibility: { value: forwardVisibilityFallback as THREE.Texture },
  uForwardReceiverWorld: { value: forwardReceiverFallback as THREE.Texture },
}

export const FORWARD_REFRACTION_MATERIAL_FLAG = 'mycraftForwardRefraction'

export interface ForwardRefractionWaterState {
  waterLevel: number
  time: number
  waveAmp: number
  waveChop: number
  waveSpeed: number
  cameraUnderwater: boolean
}

export function setForwardRefractionWaterState(
  state: ForwardRefractionWaterState,
): void {
  forwardRefractionUniforms.uForwardWaterLevel.value = state.waterLevel
  forwardRefractionUniforms.uForwardRefractionTime.value = state.time
  forwardRefractionUniforms.uForwardRefractionWaveAmp.value = state.waveAmp
  forwardRefractionUniforms.uForwardRefractionWaveChop.value = state.waveChop
  forwardRefractionUniforms.uForwardRefractionWaveSpeed.value = state.waveSpeed
  forwardRefractionUniforms.uForwardCameraUnderwater.value = state.cameraUnderwater
}

export function setForwardRefractionResolution(width: number, height: number): void {
  forwardRefractionUniforms.uForwardRefractionResolution.value.set(
    Math.max(1, Math.floor(width)),
    Math.max(1, Math.floor(height)),
  )
}

export function setForwardRefractionCamera(camera: THREE.PerspectiveCamera): void {
  forwardRefractionUniforms.uForwardProjectionMatrix.value.copy(
    camera.projectionMatrix,
  )
}

export function setForwardRefractionActive(active: boolean): void {
  forwardRefractionUniforms.uForwardRefractionActive.value = active ? 1 : 0
}

export function setForwardRefractionOutputReceiver(active: boolean): void {
  forwardRefractionUniforms.uForwardRefractionOutputReceiver.value = active ? 1 : 0
}

export function setForwardRefractionSunVisibility(texture: THREE.Texture | null): void {
  forwardRefractionUniforms.uForwardSunVisibility.value = texture ?? forwardVisibilityFallback
}

export function setForwardRefractionReceiverTexture(texture: THREE.Texture | null): void {
  forwardRefractionUniforms.uForwardReceiverWorld.value = texture ?? forwardReceiverFallback
}

/** CPU reference for the flat-interface Fermat solve used by contract tests. */
export function solveFlatRefractionInterface(
  camera: THREE.Vector3,
  source: THREE.Vector3,
  waterLevel: number,
  cameraUnderwater: boolean,
): THREE.Vector3 {
  const cameraDistance = Math.max(
    cameraUnderwater ? waterLevel - camera.y : camera.y - waterLevel,
    1e-9,
  )
  const sourceDistance = Math.max(
    cameraUnderwater ? source.y - waterLevel : waterLevel - source.y,
    1e-9,
  )
  const tangentOffset = new THREE.Vector2(source.x - camera.x, source.z - camera.z)
  const tangentLength = tangentOffset.length()
  if (tangentLength <= 1e-12) return new THREE.Vector3(camera.x, waterLevel, camera.z)
  tangentOffset.multiplyScalar(1 / tangentLength)

  const cameraIor = cameraUnderwater
    ? WATER_REFRACTIVE_INDEX
    : AIR_REFRACTIVE_INDEX
  const sourceIor = cameraUnderwater
    ? AIR_REFRACTIVE_INDEX
    : WATER_REFRACTIVE_INDEX
  let low = cameraUnderwater
    ? 0
    : Math.max(tangentLength - sourceDistance * CRITICAL_TANGENT, 0)
  let high = cameraUnderwater
    ? Math.min(tangentLength, cameraDistance * CRITICAL_TANGENT)
    : tangentLength

  for (let iteration = 0; iteration < FORWARD_REFRACTION_SOLVE_STEPS; iteration++) {
    const middle = (low + high) * 0.5
    const sourceTangentDistance = tangentLength - middle
    const cameraSine = middle / Math.hypot(cameraDistance, middle)
    const sourceSine = sourceTangentDistance /
      Math.hypot(sourceDistance, sourceTangentDistance)
    if (cameraIor * cameraSine < sourceIor * sourceSine) low = middle
    else high = middle
  }
  const crossingDistance = (low + high) * 0.5
  return new THREE.Vector3(
    camera.x + tangentOffset.x * crossingDistance,
    waterLevel,
    camera.z + tangentOffset.y * crossingDistance,
  )
}

export function attachForwardRefractionUniforms(material: THREE.ShaderMaterial): void {
  Object.assign(material.uniforms, forwardRefractionUniforms)
  material.userData[FORWARD_REFRACTION_MATERIAL_FLAG] = true
}

export function isForwardRefractionMaterial(material: THREE.Material): boolean {
  return material.userData[FORWARD_REFRACTION_MATERIAL_FLAG] === true
}

const macroNormalTerms = OCEAN_WAVES.map((_, index) => `
  {
    float k = 6.28318530718 / OCEAN_WAVE_LENGTH_${index};
    float depthK = min(k * OCEAN_WATER_DEPTH, 20.0);
    float depthExp = exp(min(2.0 * depthK, 20.0));
    float depthTanh = (depthExp - 1.0) / (depthExp + 1.0);
    float omega = sqrt(max(
      9.81 * k * depthTanh +
      OCEAN_SURFACE_TENSION_OVER_DENSITY * k * k * k,
      0.0
    )) * OCEAN_WAVE_SPEED_${index} * uForwardRefractionWaveSpeed;
    float phase = k * dot(OCEAN_WAVE_DIRECTION_${index}, baseXZ) -
      omega * uForwardRefractionTime + OCEAN_WAVE_PHASE_${index};
    float amplitude = OCEAN_WAVE_AMPLITUDE_${index} *
      min(uForwardRefractionWaveAmp, 1.0) *
      oceanWaveLod(footprint, OCEAN_WAVE_LENGTH_${index});
    float q = OCEAN_WAVE_STEEPNESS_${index} * uForwardRefractionWaveChop;
    float s = sin(phase);
    float c = cos(phase);
    float dx = OCEAN_WAVE_DIRECTION_${index}.x;
    float dz = OCEAN_WAVE_DIRECTION_${index}.y;
    float phaseDx = k * dx;
    float phaseDz = k * dz;
    displacement.xz += OCEAN_WAVE_DIRECTION_${index} * q * amplitude * c;
    displacement.y += amplitude * s;
    tangentX += vec3(
      -q * amplitude * dx * phaseDx * s,
      amplitude * phaseDx * c,
      -q * amplitude * dz * phaseDx * s
    );
    tangentZ += vec3(
      -q * amplitude * dx * phaseDz * s,
      amplitude * phaseDz * c,
      -q * amplitude * dz * phaseDz * s
    );
  }
`).join('\n')

/**
 * Shared vertex-stage optical model.
 *
 * Each source vertex solves Fermat's stationary path across the locally
 * planar tangent of the live Gerstner surface. The solve is bracketed by the
 * water critical angle, so its absolute error does not grow with source
 * distance. The projected point keeps the source's radial camera distance;
 * the water pass can therefore recover the physical in-water path from the
 * target depth without another screen-space search.
 */
export function forwardRefractionVertexDeclarations(): string {
  return /* glsl */ `
    uniform float uForwardRefractionActive;
    uniform float uForwardWaterLevel;
    uniform float uForwardRefractionTime;
    uniform float uForwardRefractionWaveAmp;
    uniform float uForwardRefractionWaveChop;
    uniform float uForwardRefractionWaveSpeed;
    uniform vec2 uForwardRefractionResolution;
    uniform mat4 uForwardProjectionMatrix;
    uniform bool uForwardCameraUnderwater;
    varying vec3 vForwardRefractionSourceWorld;
    varying float vForwardRefractionSignedHeight;

    #define uWaveAmp uForwardRefractionWaveAmp
    #define uWaveChop uForwardRefractionWaveChop
    #define uWaveSpeed uForwardRefractionWaveSpeed
    ${oceanWaveDeclarations()}
    #undef uWaveAmp
    #undef uWaveChop
    #undef uWaveSpeed

    float forwardRefractionPixelFootprint(vec3 surfacePosition) {
      vec3 toCamera = cameraPosition - surfacePosition;
      float distanceToSurface = length(toCamera);
      float surfaceCos = abs(toCamera.y) / max(distanceToSurface, 0.001);
      float pixelAngle = 2.0 / max(
        abs(uForwardProjectionMatrix[1][1]) * uForwardRefractionResolution.y,
        1.0
      );
      return distanceToSurface * pixelAngle / max(surfaceCos, 0.08);
    }

    vec3 forwardRefractionSurfacePoint(vec2 baseXZ) {
      vec3 base = vec3(baseXZ.x, uForwardWaterLevel, baseXZ.y);
      float footprint = forwardRefractionPixelFootprint(base);
      return base + oceanWaveDisplacement(
        base,
        uForwardRefractionTime,
        footprint
      );
    }

    vec2 forwardRefractionBaseAtWorldXZ(vec2 worldXZ) {
      vec2 baseXZ = worldXZ;
      for (int iteration = 0; iteration < 1; iteration++) {
        vec3 surface = forwardRefractionSurfacePoint(baseXZ);
        baseXZ += worldXZ - surface.xz;
      }
      return baseXZ;
    }

    vec3 forwardRefractionSurfaceAtWorldXZ(vec2 worldXZ) {
      return forwardRefractionSurfacePoint(
        forwardRefractionBaseAtWorldXZ(worldXZ)
      );
    }

    void forwardRefractionSurfaceFrame(
      vec2 baseXZ,
      out vec3 surfacePoint,
      out vec3 surfaceNormal
    ) {
      vec3 base = vec3(baseXZ.x, uForwardWaterLevel, baseXZ.y);
      float footprint = forwardRefractionPixelFootprint(base);
      vec3 displacement = vec3(0.0);
      vec3 tangentX = vec3(1.0, 0.0, 0.0);
      vec3 tangentZ = vec3(0.0, 0.0, 1.0);
      ${macroNormalTerms}
      displacement.y = clamp(
        displacement.y,
        -OCEAN_WAVE_HALF_RANGE,
        OCEAN_WAVE_HALF_RANGE
      );
      surfacePoint = base + displacement;
      surfaceNormal = normalize(cross(tangentZ, tangentX));
    }

    vec3 forwardRefractionSolveTangentInterface(
      vec3 sourceWorld,
      vec3 planePoint,
      vec3 orientedNormal
    ) {
      float cameraPlaneDistance = max(
        dot(planePoint - cameraPosition, orientedNormal),
        0.001
      );
      float sourcePlaneDistance = max(
        dot(sourceWorld - planePoint, orientedNormal),
        0.001
      );
      vec3 cameraProjection = cameraPosition +
        orientedNormal * cameraPlaneDistance;
      vec3 sourceProjection = sourceWorld -
        orientedNormal * sourcePlaneDistance;
      vec3 tangentOffset = sourceProjection - cameraProjection;
      float tangentLength = length(tangentOffset);
      vec3 tangent = tangentOffset / max(tangentLength, 0.001);
      float cameraIor = uForwardCameraUnderwater
        ? ${WATER_REFRACTIVE_INDEX.toFixed(6)}
        : ${AIR_REFRACTIVE_INDEX.toFixed(6)};
      float sourceIor = uForwardCameraUnderwater
        ? ${AIR_REFRACTIVE_INDEX.toFixed(6)}
        : ${WATER_REFRACTIVE_INDEX.toFixed(6)};

      float cameraReach = cameraPlaneDistance * ${CRITICAL_TANGENT.toFixed(9)};
      float sourceReach = sourcePlaneDistance * ${CRITICAL_TANGENT.toFixed(9)};
      float low = uForwardCameraUnderwater
        ? 0.0
        : max(tangentLength - sourceReach, 0.0);
      float high = uForwardCameraUnderwater
        ? min(tangentLength, cameraReach)
        : tangentLength;

      for (int iteration = 0; iteration < ${FORWARD_REFRACTION_SOLVE_STEPS}; iteration++) {
        float middle = (low + high) * 0.5;
        float sourceTangentDistance = tangentLength - middle;
        float cameraSine = middle / sqrt(
          cameraPlaneDistance * cameraPlaneDistance + middle * middle
        );
        float sourceSine = sourceTangentDistance / sqrt(
          sourcePlaneDistance * sourcePlaneDistance +
          sourceTangentDistance * sourceTangentDistance
        );
        if (cameraIor * cameraSine < sourceIor * sourceSine) low = middle;
        else high = middle;
      }
      return cameraProjection + tangent * ((low + high) * 0.5);
    }

    vec4 forwardRefractionProject(vec3 sourceWorld, vec4 directClip) {
      vForwardRefractionSourceWorld = sourceWorld;
      vForwardRefractionSignedHeight = 0.0;
      if (uForwardRefractionActive < 0.5) return directClip;

      float signedHeight = sourceWorld.y - uForwardWaterLevel;
      if (abs(signedHeight) <= OCEAN_WAVE_HALF_RANGE) {
        vec3 sourceSurface = forwardRefractionSurfaceAtWorldXZ(sourceWorld.xz);
        signedHeight = sourceWorld.y - sourceSurface.y;
      }
      vForwardRefractionSignedHeight = signedHeight;
      bool oppositeMedium = uForwardCameraUnderwater
        ? signedHeight > 0.0
        : signedHeight < 0.0;
      if (!oppositeMedium) return directClip;

      float normalOrientation = uForwardCameraUnderwater ? 1.0 : -1.0;
      vec3 meanInterface = forwardRefractionSolveTangentInterface(
        sourceWorld,
        vec3(cameraPosition.x, uForwardWaterLevel, cameraPosition.z),
        vec3(0.0, normalOrientation, 0.0)
      );

      // Re-anchor the exact flat-interface root on the live parametric
      // surface, then repeat once. This is a local-plane Newton refinement of
      // Fermat's stationary path, not a screen-space receiver search.
      vec2 firstBase = forwardRefractionBaseAtWorldXZ(meanInterface.xz);
      vec3 firstPoint;
      vec3 firstNormal;
      forwardRefractionSurfaceFrame(firstBase, firstPoint, firstNormal);
      firstNormal *= normalOrientation;
      vec3 firstInterface = forwardRefractionSolveTangentInterface(
        sourceWorld,
        firstPoint,
        firstNormal
      );

      vec2 refinedBase = forwardRefractionBaseAtWorldXZ(firstInterface.xz);
      vec3 refinedPoint;
      vec3 refinedNormal;
      forwardRefractionSurfaceFrame(refinedBase, refinedPoint, refinedNormal);
      refinedNormal *= normalOrientation;
      vec3 apparentInterface = forwardRefractionSolveTangentInterface(
        sourceWorld,
        refinedPoint,
        refinedNormal
      );

      vec3 apparentDirection = normalize(apparentInterface - cameraPosition);
      float sourceDistance = length(sourceWorld - cameraPosition);
      vec3 apparentWorld = cameraPosition + apparentDirection * sourceDistance;
      return projectionMatrix * viewMatrix * vec4(apparentWorld, 1.0);
    }
  `
}

export function forwardRefractionFragmentDeclarations(): string {
  return /* glsl */ `
    uniform float uForwardRefractionActive;
    uniform bool uForwardCameraUnderwater;
    uniform float uForwardRefractionOutputReceiver;
    uniform sampler2D uForwardSunVisibility;
    uniform sampler2D uForwardReceiverWorld;
    varying vec3 vForwardRefractionSourceWorld;
    varying float vForwardRefractionSignedHeight;

    void forwardRefractionDiscardCameraMedium() {
      if (uForwardRefractionActive < 0.5) return;
      if (
        uForwardCameraUnderwater
          ? vForwardRefractionSignedHeight <= 0.0
          : vForwardRefractionSignedHeight >= 0.0
      ) {
        discard;
      }
    }

    void forwardRefractionAccumulateVisibility(
      vec2 uv,
      vec3 expectedSource,
      float positionTolerance,
      inout float weightedVisibility,
      inout float weightSum
    ) {
      vec4 receiver = texture2D(uForwardReceiverWorld, uv);
      if (receiver.a <= 0.0) return;
      float sourceError = length(receiver.rgb - expectedSource);
      float sourceWeight = 1.0 - smoothstep(
        positionTolerance,
        positionTolerance * 2.0,
        sourceError
      );
      weightedVisibility += texture2D(uForwardSunVisibility, uv).r * sourceWeight;
      weightSum += sourceWeight;
    }

    float forwardRefractionSunVisibility(vec2 resolution, vec3 sourceWorld) {
      vec2 safeResolution = max(resolution, vec2(1.0));
      vec2 uv = gl_FragCoord.xy / safeResolution;
      vec2 texel = 1.0 / safeResolution;
      float center = texture2D(uForwardSunVisibility, uv).r;

      // The forward optical map changes the receiver-space footprint of one
      // apparent pixel. Reconstruct irradiance only from neighbours whose
      // stored source point agrees with that local Jacobian. This integrates
      // the pixel footprint without crossing a refracted silhouette or block
      // discontinuity.
      vec3 sourceDx = dFdx(sourceWorld);
      vec3 sourceDy = dFdy(sourceWorld);
      float sourceFootprint = max(length(sourceDx), length(sourceDy));
      float positionTolerance = max(0.0025, sourceFootprint * 0.35);
      float weightedVisibility = center * 4.0;
      float weightSum = 4.0;
      forwardRefractionAccumulateVisibility(
        uv + vec2(texel.x, 0.0),
        sourceWorld + sourceDx,
        positionTolerance,
        weightedVisibility,
        weightSum
      );
      forwardRefractionAccumulateVisibility(
        uv - vec2(texel.x, 0.0),
        sourceWorld - sourceDx,
        positionTolerance,
        weightedVisibility,
        weightSum
      );
      forwardRefractionAccumulateVisibility(
        uv + vec2(0.0, texel.y),
        sourceWorld + sourceDy,
        positionTolerance,
        weightedVisibility,
        weightSum
      );
      forwardRefractionAccumulateVisibility(
        uv - vec2(0.0, texel.y),
        sourceWorld - sourceDy,
        positionTolerance,
        weightedVisibility,
        weightSum
      );
      return weightedVisibility / max(weightSum, 1.0);
    }

    vec3 forwardRefractionStoreReceiver(vec3 sourceWorld) {
      return sourceWorld;
    }
  `
}

/** Add the forward optical branch to an opaque MeshStandardMaterial. */
export function enableMeshStandardForwardRefraction(
  material: THREE.MeshStandardMaterial,
): void {
  if (isForwardRefractionMaterial(material)) return
  const previousCompile = material.onBeforeCompile
  const previousCacheKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer)
    Object.assign(shader.uniforms, forwardRefractionUniforms)
    shader.vertexShader = `${forwardRefractionVertexDeclarations()}\n${shader.vertexShader}`
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
          vec4 forwardLocalPosition = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            forwardLocalPosition = batchingMatrix * forwardLocalPosition;
          #endif
          #ifdef USE_INSTANCING
            forwardLocalPosition = instanceMatrix * forwardLocalPosition;
          #endif
          vec4 forwardWorldPosition = modelMatrix * forwardLocalPosition;
          vec4 mvPosition = viewMatrix * forwardWorldPosition;
          vec4 forwardDirectClip = projectionMatrix * mvPosition;
          vec4 forwardApparentClip = forwardRefractionProject(
            forwardWorldPosition.xyz,
            forwardDirectClip
          );
          gl_Position = forwardApparentClip;
        `,
      )
    shader.fragmentShader = `${forwardRefractionFragmentDeclarations()}\n${shader.fragmentShader}`
      .replace(
        'void main() {',
        /* glsl */ `void main() {
  forwardRefractionDiscardCameraMedium();
  if (uForwardRefractionOutputReceiver > 0.5) {
    gl_FragColor = vec4(
      forwardRefractionStoreReceiver(vForwardRefractionSourceWorld),
      1.0
    );
    return;
  }`,
      )
  }
  material.customProgramCacheKey = () => `${previousCacheKey()}|forward-refraction-v1`
  material.userData[FORWARD_REFRACTION_MATERIAL_FLAG] = true
  material.needsUpdate = true
}
