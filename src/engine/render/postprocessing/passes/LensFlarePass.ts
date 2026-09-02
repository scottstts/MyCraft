import * as THREE from 'three'
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js'
import type { AtmosphereState } from '../../atmosphere/AtmosphereModel'
import { WATER_IOR } from '../../water/WaterOptics'
import {
  FILMIC_FLARE_BRIGHT_FRAGMENT_SHADER,
  FILMIC_FLARE_COMPOSITE_FRAGMENT_SHADER,
  FILMIC_FLARE_FRAGMENT_SHADER,
  FILMIC_FLARE_OCCLUSION_FRAGMENT_SHADER,
  FILMIC_FLARE_SEED_FRAGMENT_SHADER,
  FILMIC_FLARE_TEMPORAL_BLOOM_FRAGMENT_SHADER,
  FILMIC_FLARE_VERTEX_SHADER,
} from './filmicLensFlareShaders'

export const FILMIC_LENS_FLARE_PRESET = Object.freeze({
  initialFovDeg: 58,
  minimumFovDeg: 26,
  maximumFovDeg: 105,
  initialSourceScreen: Object.freeze([0.785, 0.625] as const),
  strength: 1,
  exposure: 0.92,
})

type UniformMap = Record<string, THREE.IUniform>

export interface LensFlareProjection {
  sourceTop: THREE.Vector2
  visibility: number
  fieldCos: number
  fieldSin: number
  fieldDirection: THREE.Vector2
}

export interface LensFlareDiagnostics {
  enabled: boolean
  cameraSubmerged: boolean
  debugMode: number
  sourceTop: [number, number]
  sourceVisibility: number
  fieldCos: number
  fieldSin: number
  fieldDirection: [number, number]
  strength: number
  renderTargets: Array<{
    name: string
    width: number
    height: number
    type: number
  }>
}

const scratchForward = new THREE.Vector3()
const scratchRight = new THREE.Vector3()
const scratchUp = new THREE.Vector3()
const scratchSun = new THREE.Vector3()
const scratchApparentSun = new THREE.Vector3()

function smoothstep(value: number, minimum: number, maximum: number): number {
  return THREE.MathUtils.smoothstep(value, minimum, maximum)
}

/** Matches the analytic solar-disc envelope in SkyDome. */
export function computeLensFlareSunEnergy(sunElevationY: number): number {
  const visibility = smoothstep(sunElevationY, -0.14, 0.02)
  const elevationEnergy = THREE.MathUtils.lerp(
    0.18,
    1,
    smoothstep(sunElevationY, -0.02, 0.30),
  )
  return visibility * elevationEnergy
}

/**
 * Apparent direction of an above-water directional source seen from water.
 * Refract the incoming air ray into water, then reverse it back into the
 * camera-to-source convention used by the lens projection. A flat carrier
 * normal keeps the source inside the canonical 48.75-degree Snell window;
 * the surface shader supplies the smaller wave-normal deformation and lobe.
 */
export function refractLensFlareSunDirectionUnderwater(
  sunDirection: THREE.Vector3,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  scratchSun.copy(sunDirection).normalize()
  const eta = 1 / WATER_IOR
  const cosIncident = THREE.MathUtils.clamp(scratchSun.y, 0, 1)
  const transmittedCos = Math.sqrt(Math.max(
    1 - eta * eta * (1 - cosIncident * cosIncident),
    0,
  ))
  return target.set(
    scratchSun.x * eta,
    transmittedCos,
    scratchSun.z * eta,
  ).normalize()
}

/**
 * Projects an infinite directional emitter with the same top-origin contract
 * as the TSL reference. Field deformation is derived from the 3-D view angle,
 * while the previous finite axis is retained at the optical centre.
 */
export function projectLensFlareSource(
  camera: THREE.PerspectiveCamera,
  sunDirection: THREE.Vector3,
  sunEnergy = 1,
  previousSource = new THREE.Vector2(...FILMIC_LENS_FLARE_PRESET.initialSourceScreen),
  previousFieldDirection = new THREE.Vector2(1, 0),
  target?: LensFlareProjection,
): LensFlareProjection {
  const result = target ?? {
    sourceTop: new THREE.Vector2(),
    visibility: 0,
    fieldCos: 1,
    fieldSin: 0,
    fieldDirection: new THREE.Vector2(),
  }

  camera.getWorldDirection(scratchForward).normalize()
  scratchRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
  scratchUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
  scratchSun.copy(sunDirection).normalize()

  const depth = scratchSun.dot(scratchForward)
  if (depth <= 0.015 || !Number.isFinite(depth)) {
    result.sourceTop.copy(previousSource)
    result.visibility = 0
    result.fieldCos = 1
    result.fieldSin = 0
    result.fieldDirection.copy(previousFieldDirection)
    return result
  }

  const aspect = Math.max(1e-6, camera.aspect)
  const fovDeg = THREE.MathUtils.clamp(
    camera.fov,
    FILMIC_LENS_FLARE_PRESET.minimumFovDeg,
    FILMIC_LENS_FLARE_PRESET.maximumFovDeg,
  )
  const tangent = Math.tan(THREE.MathUtils.degToRad(fovDeg) * 0.5)
  const sourceX = 0.5 + scratchSun.dot(scratchRight) / (depth * tangent * aspect) * 0.5
  const sourceY = 0.5 - scratchSun.dot(scratchUp) / (depth * tangent) * 0.5

  if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) {
    result.sourceTop.copy(previousSource)
    result.visibility = 0
    result.fieldCos = 1
    result.fieldSin = 0
    result.fieldDirection.copy(previousFieldDirection)
    return result
  }

  const fieldCos = THREE.MathUtils.clamp(depth, 0, 1)
  result.fieldCos = fieldCos
  result.fieldSin = Math.sqrt(Math.max(0, 1 - fieldCos * fieldCos))

  const fieldX = (sourceX - 0.5) * aspect
  const fieldY = sourceY - 0.5
  const fieldLength = Math.hypot(fieldX, fieldY)
  if (fieldLength > 1e-7) {
    result.fieldDirection.set(fieldX / fieldLength, fieldY / fieldLength)
  } else {
    result.fieldDirection.copy(previousFieldDirection)
  }

  const outside = Math.max(0, -sourceX, sourceX - 1, -sourceY, sourceY - 1)
  const edgeFade = THREE.MathUtils.clamp(1 - outside / 0.36, 0, 1)
  const facingFade = smoothstep(depth, 0.015, 0.12)
  result.visibility = edgeFade * facingFade * THREE.MathUtils.clamp(sunEnergy, 0, 1)
  result.sourceTop.set(
    THREE.MathUtils.clamp(sourceX, -2, 3),
    THREE.MathUtils.clamp(sourceY, -2, 3),
  )
  return result
}

function createRenderTarget(
  width: number,
  height: number,
  name: string,
  type: THREE.TextureDataType = THREE.HalfFloatType,
): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  })
  target.texture.name = name
  target.texture.colorSpace = THREE.NoColorSpace
  target.texture.generateMipmaps = false
  return target
}

function createShaderMaterial(fragmentShader: string, uniforms: UniformMap): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FILMIC_FLARE_VERTEX_SHADER,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  })
}

export interface GaussianTapPair {
  offset: number
  weight: number
}

export interface GaussianTapLayout {
  centerWeight: number
  pairs: GaussianTapPair[]
  tailOffset: number
  tailWeight: number
}

/**
 * Combine adjacent symmetric Gaussian taps into bilinear-filtered samples.
 * The offset is the weighted centroid of the pair, so the linear sample
 * preserves the pair's first moment while replacing two fetches with one.
 */
export function createGaussianTapLayout(kernelRadius: number): GaussianTapLayout {
  const safeRadius = Math.max(1, Math.floor(kernelRadius))
  const sigma = safeRadius / 3
  const coefficients = Array.from({ length: safeRadius }, (_, index) => (
    0.39894 * Math.exp(-0.5 * index * index / (sigma * sigma)) / sigma
  ))
  const pairs: GaussianTapPair[] = []
  let tailOffset = 0
  let tailWeight = 0
  for (let index = 1; index < safeRadius; index += 2) {
    const next = index + 1
    if (next >= safeRadius) {
      tailOffset = index
      tailWeight = coefficients[index]
      break
    }
    const weight = coefficients[index] + coefficients[next]
    pairs.push({
      offset: (index * coefficients[index] + next * coefficients[next]) / weight,
      weight,
    })
  }
  return {
    centerWeight: coefficients[0],
    pairs,
    tailOffset,
    tailWeight,
  }
}

function createBlurMaterial(kernelRadius: number): THREE.ShaderMaterial {
  const layout = createGaussianTapLayout(kernelRadius)

  return createShaderMaterial(/* glsl */ `
    precision highp float;
    #define GAUSSIAN_PAIR_COUNT ${Math.max(1, layout.pairs.length)}
    uniform sampler2D colorTexture;
    uniform vec2 invSize;
    uniform vec2 direction;
    uniform vec2 gaussianPairs[GAUSSIAN_PAIR_COUNT];
    uniform float gaussianCenterWeight;
    uniform float gaussianTailOffset;
    uniform float gaussianTailWeight;
    varying vec2 vUv;

    void main() {
      vec3 diffuseSum = texture2D(colorTexture, vUv).rgb * gaussianCenterWeight;
      for (int i = 0; i < GAUSSIAN_PAIR_COUNT; i++) {
        vec2 pair = gaussianPairs[i];
        vec2 offset = direction * invSize * pair.x;
        diffuseSum += (
          texture2D(colorTexture, vUv + offset).rgb
          + texture2D(colorTexture, vUv - offset).rgb
        ) * pair.y;
      }
      if (gaussianTailWeight > 0.0) {
        vec2 offset = direction * invSize * gaussianTailOffset;
        diffuseSum += (
          texture2D(colorTexture, vUv + offset).rgb
          + texture2D(colorTexture, vUv - offset).rgb
        ) * gaussianTailWeight;
      }
      gl_FragColor = vec4(diffuseSum, 1.0);
    }
  `, {
    colorTexture: { value: null },
    invSize: { value: new THREE.Vector2(0.5, 0.5) },
    direction: { value: new THREE.Vector2(1, 0) },
    gaussianPairs: { value: layout.pairs.map((pair) => new THREE.Vector2(pair.offset, pair.weight)) },
    gaussianCenterWeight: { value: layout.centerWeight },
    gaussianTailOffset: { value: layout.tailOffset },
    gaussianTailWeight: { value: layout.tailWeight },
  })
}

class FilmicBloomPyramid {
  readonly name: string
  readonly strength: number
  readonly radius: number
  readonly threshold: number
  readonly brightTarget: THREE.WebGLRenderTarget

  private readonly horizontalTargets: THREE.WebGLRenderTarget[] = []
  private readonly verticalTargets: THREE.WebGLRenderTarget[] = []
  private readonly blurMaterials: THREE.ShaderMaterial[] = []
  private readonly compositeMaterial: THREE.ShaderMaterial
  private readonly temporalTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null
  private readonly temporalMaterial: THREE.ShaderMaterial | null
  private temporalIndex = 0
  private temporalHistoryValid = false

  constructor(
    name: string,
    strength: number,
    radius: number,
    threshold: number,
    temporalPersistence = false,
  ) {
    this.name = name
    this.strength = strength
    this.radius = radius
    this.threshold = threshold
    this.brightTarget = createRenderTarget(1, 1, `${name}.bright`)
    const kernelRadii = [6, 10, 14, 18, 22]
    for (let index = 0; index < kernelRadii.length; index += 1) {
      this.horizontalTargets.push(createRenderTarget(1, 1, `${name}.h${index}`))
      this.verticalTargets.push(createRenderTarget(1, 1, `${name}.v${index}`))
      this.blurMaterials.push(createBlurMaterial(kernelRadii[index]))
    }

    this.compositeMaterial = createShaderMaterial(/* glsl */ `
      precision highp float;
      uniform sampler2D blurTexture0;
      uniform sampler2D blurTexture1;
      uniform sampler2D blurTexture2;
      uniform sampler2D blurTexture3;
      uniform sampler2D blurTexture4;
      uniform float bloomStrength;
      uniform float bloomRadius;
      varying vec2 vUv;

      float lerpBloomFactor(float factor) {
        return mix(factor, 1.2 - factor, bloomRadius);
      }

      void main() {
        vec3 color = texture2D(blurTexture0, vUv).rgb * lerpBloomFactor(1.0)
          + texture2D(blurTexture1, vUv).rgb * lerpBloomFactor(0.8)
          + texture2D(blurTexture2, vUv).rgb * lerpBloomFactor(0.6)
          + texture2D(blurTexture3, vUv).rgb * lerpBloomFactor(0.4)
          + texture2D(blurTexture4, vUv).rgb * lerpBloomFactor(0.2);
        gl_FragColor = vec4(color * bloomStrength, 1.0);
      }
    `, {
      blurTexture0: { value: this.verticalTargets[0].texture },
      blurTexture1: { value: this.verticalTargets[1].texture },
      blurTexture2: { value: this.verticalTargets[2].texture },
      blurTexture3: { value: this.verticalTargets[3].texture },
      blurTexture4: { value: this.verticalTargets[4].texture },
      bloomStrength: { value: strength },
      bloomRadius: { value: radius },
    })

    this.temporalTargets = temporalPersistence
      ? [
          createRenderTarget(1, 1, `${name}.history0`),
          createRenderTarget(1, 1, `${name}.history1`),
        ]
      : null
    this.temporalMaterial = temporalPersistence
      ? createShaderMaterial(FILMIC_FLARE_TEMPORAL_BLOOM_FRAGMENT_SHADER, {
          currentBloom: { value: this.horizontalTargets[0].texture },
          previousBloom: { value: this.temporalTargets?.[0].texture ?? null },
          occlusionTexture: { value: null },
          deltaTime: { value: 0 },
          historyValid: { value: 0 },
        })
      : null
  }

  get texture(): THREE.Texture {
    return this.temporalTargets
      ? this.temporalTargets[this.temporalIndex].texture
      : this.horizontalTargets[0].texture
  }

  setSize(width: number, height: number): void {
    let currentWidth = Math.max(1, Math.round(width / 2))
    let currentHeight = Math.max(1, Math.round(height / 2))
    this.brightTarget.setSize(currentWidth, currentHeight)
    if (this.temporalTargets) {
      for (const target of this.temporalTargets) target.setSize(currentWidth, currentHeight)
      // Reallocation invalidates the old frame's pixel correspondence even
      // when the source remains visible through a resize.
      this.temporalHistoryValid = false
    }

    for (let index = 0; index < this.blurMaterials.length; index += 1) {
      this.horizontalTargets[index].setSize(currentWidth, currentHeight)
      this.verticalTargets[index].setSize(currentWidth, currentHeight)
      ;(this.blurMaterials[index].uniforms.invSize.value as THREE.Vector2).set(
        1 / currentWidth,
        1 / currentHeight,
      )
      currentWidth = Math.max(1, Math.round(currentWidth / 2))
      currentHeight = Math.max(1, Math.round(currentHeight / 2))
    }
  }

  renderFromBright(renderer: THREE.WebGLRenderer, quad: FullScreenQuad): void {
    let inputTarget = this.brightTarget
    for (let index = 0; index < this.blurMaterials.length; index += 1) {
      const material = this.blurMaterials[index]
      material.uniforms.colorTexture.value = inputTarget.texture
      ;(material.uniforms.direction.value as THREE.Vector2).set(1, 0)
      quad.material = material
      renderer.setRenderTarget(this.horizontalTargets[index])
      renderer.clear(true, false, false)
      quad.render(renderer)

      material.uniforms.colorTexture.value = this.horizontalTargets[index].texture
      ;(material.uniforms.direction.value as THREE.Vector2).set(0, 1)
      renderer.setRenderTarget(this.verticalTargets[index])
      renderer.clear(true, false, false)
      quad.render(renderer)
      inputTarget = this.verticalTargets[index]
    }

    quad.material = this.compositeMaterial
    renderer.setRenderTarget(this.horizontalTargets[0])
    renderer.clear(true, false, false)
    quad.render(renderer)
  }

  clearOutput(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(this.horizontalTargets[0])
    renderer.clear(true, false, false)
    if (this.temporalTargets) {
      for (const target of this.temporalTargets) {
        renderer.setRenderTarget(target)
        renderer.clear(true, false, false)
      }
      this.temporalHistoryValid = false
    }
  }

  invalidateTemporalHistory(): void {
    this.temporalHistoryValid = false
  }

  renderTemporal(
    renderer: THREE.WebGLRenderer,
    quad: FullScreenQuad,
    deltaTime: number,
    occlusionTexture: THREE.Texture,
  ): void {
    if (!this.temporalTargets || !this.temporalMaterial) return
    const previousIndex = this.temporalIndex
    const nextIndex = previousIndex === 0 ? 1 : 0
    this.temporalMaterial.uniforms.currentBloom.value = this.horizontalTargets[0].texture
    this.temporalMaterial.uniforms.previousBloom.value = this.temporalTargets[previousIndex].texture
    this.temporalMaterial.uniforms.occlusionTexture.value = occlusionTexture
    this.temporalMaterial.uniforms.deltaTime.value = Number.isFinite(deltaTime)
      ? Math.max(0, deltaTime)
      : 0
    this.temporalMaterial.uniforms.historyValid.value = this.temporalHistoryValid ? 1 : 0
    quad.material = this.temporalMaterial
    renderer.setRenderTarget(this.temporalTargets[nextIndex])
    renderer.clear(true, false, false)
    quad.render(renderer)
    this.temporalIndex = nextIndex
    this.temporalHistoryValid = true
  }

  getTargets(): THREE.WebGLRenderTarget[] {
    return [
      this.brightTarget,
      ...this.horizontalTargets,
      ...this.verticalTargets,
      ...(this.temporalTargets ?? []),
    ]
  }

  dispose(): void {
    this.brightTarget.dispose()
    for (const target of this.horizontalTargets) target.dispose()
    for (const target of this.verticalTargets) target.dispose()
    for (const material of this.blurMaterials) material.dispose()
    this.compositeMaterial.dispose()
    if (this.temporalTargets) {
      for (const target of this.temporalTargets) target.dispose()
    }
    this.temporalMaterial?.dispose()
  }
}

/** WebGL translation of the complete filmic-lens-flare TSL example. */
export class LensFlarePass extends Pass {
  private readonly commonUniforms: UniformMap
  private readonly occlusionMaterial: THREE.ShaderMaterial
  private readonly flareMaterial: THREE.ShaderMaterial
  private readonly seedMaterial: THREE.ShaderMaterial
  private readonly flareBrightMaterial: THREE.ShaderMaterial
  private readonly compositeMaterial: THREE.ShaderMaterial
  private readonly quad: FullScreenQuad
  private readonly occlusionTarget: THREE.WebGLRenderTarget
  private readonly flareTarget: THREE.WebGLRenderTarget
  // Keep the reference bloom geometry and highlight gates, but trim the two
  // sun-fed lobes so the solar disc does not overwhelm the authored ghosts.
  private readonly sourceBloom = new FilmicBloomPyramid('LensFlare.sourceBloom', 0.42, 0.80, 0.0105, true)
  private readonly haloBloom = new FilmicBloomPyramid('LensFlare.haloBloom', 0.50, 0.96, 0.0080, true)
  private readonly flareBloom = new FilmicBloomPyramid('LensFlare.flareBloom', 0.84, 0.90, 0.0300)
  private readonly projection: LensFlareProjection
  private readonly previousSource = new THREE.Vector2(...FILMIC_LENS_FLARE_PRESET.initialSourceScreen)
  private readonly previousFieldDirection = new THREE.Vector2(1, 0)
  private readonly oldClearColor = new THREE.Color()
  private effectEnabled = true
  private cameraSubmerged = false
  private debugMode = 0
  private elapsedSeconds = 0
  private opticalTargetsValid = false
  private opticsWereActive = false

  constructor() {
    super()
    this.commonUniforms = {
      tDiffuse: { value: null },
      tOcclusion: { value: null },
      resolution: { value: new THREE.Vector2(1, 1) },
      aspect: { value: 1 },
      sourceTop: { value: this.previousSource.clone() },
      sourceVisibility: { value: 0 },
      fieldCos: { value: 1 },
      fieldSin: { value: 0 },
      fieldDirection: { value: this.previousFieldDirection.clone() },
      strength: { value: FILMIC_LENS_FLARE_PRESET.strength },
      effectMix: { value: 1 },
    }

    this.occlusionTarget = createRenderTarget(
      1,
      1,
      'LensFlare.occlusion',
      THREE.UnsignedByteType,
    )
    this.occlusionTarget.texture.minFilter = THREE.NearestFilter
    this.occlusionTarget.texture.magFilter = THREE.NearestFilter
    this.flareTarget = createRenderTarget(1, 1, 'LensFlare.flare')
    this.commonUniforms.tOcclusion.value = this.occlusionTarget.texture

    this.occlusionMaterial = createShaderMaterial(FILMIC_FLARE_OCCLUSION_FRAGMENT_SHADER, {
      tDepth: { value: null },
      tSceneColor: this.commonUniforms.tDiffuse,
      resolution: this.commonUniforms.resolution,
      sourceTop: this.commonUniforms.sourceTop,
      solarDiscRadiusUv: { value: 0.0042 },
      sourceThroughWater: { value: 0 },
    })
    this.flareMaterial = createShaderMaterial(FILMIC_FLARE_FRAGMENT_SHADER, {
      ...this.commonUniforms,
    })
    this.seedMaterial = createShaderMaterial(FILMIC_FLARE_SEED_FRAGMENT_SHADER, {
      ...this.commonUniforms,
      seedMode: { value: 0 },
      bloomThreshold: { value: this.sourceBloom.threshold },
    })
    this.flareBrightMaterial = createShaderMaterial(FILMIC_FLARE_BRIGHT_FRAGMENT_SHADER, {
      bloomInput: { value: this.flareTarget.texture },
      bloomThreshold: { value: this.flareBloom.threshold },
    })
    this.compositeMaterial = createShaderMaterial(FILMIC_FLARE_COMPOSITE_FRAGMENT_SHADER, {
      ...this.commonUniforms,
      sourceBloom: { value: this.sourceBloom.texture },
      haloBloom: { value: this.haloBloom.texture },
      flareTexture: { value: this.flareTarget.texture },
      flareBloom: { value: this.flareBloom.texture },
      timeSeconds: { value: 0 },
      hardEnabled: { value: 1 },
      debugMode: { value: 0 },
    })
    this.quad = new FullScreenQuad(this.compositeMaterial)
    this.projection = {
      sourceTop: this.previousSource.clone(),
      visibility: 0,
      fieldCos: 1,
      fieldSin: 0,
      fieldDirection: this.previousFieldDirection.clone(),
    }
  }

  setDepthTexture(depth: THREE.DepthTexture): void {
    this.occlusionMaterial.uniforms.tDepth.value = depth
  }

  setSize(width: number, height: number): void {
    const safeWidth = Math.max(1, Math.floor(width))
    const safeHeight = Math.max(1, Math.floor(height))
    ;(this.commonUniforms.resolution.value as THREE.Vector2).set(safeWidth, safeHeight)
    this.commonUniforms.aspect.value = safeWidth / safeHeight
    this.flareTarget.setSize(safeWidth, safeHeight)
    this.sourceBloom.setSize(safeWidth, safeHeight)
    this.haloBloom.setSize(safeWidth, safeHeight)
    this.flareBloom.setSize(safeWidth, safeHeight)
    this.opticalTargetsValid = false
  }

  update(
    camera: THREE.PerspectiveCamera,
    sunDirection: THREE.Vector3,
    atmosphere?: AtmosphereState,
  ): void {
    const direction = atmosphere?.sunDirection ?? sunDirection
    const sunEnergy = computeLensFlareSunEnergy(direction.y)
    const apparentDirection = this.cameraSubmerged
      ? refractLensFlareSunDirectionUnderwater(direction, scratchApparentSun)
      : direction
    projectLensFlareSource(
      camera,
      apparentDirection,
      sunEnergy,
      this.previousSource,
      this.previousFieldDirection,
      this.projection,
    )

    this.previousSource.copy(this.projection.sourceTop)
    this.previousFieldDirection.copy(this.projection.fieldDirection)
    ;(this.commonUniforms.sourceTop.value as THREE.Vector2).copy(this.projection.sourceTop)
    this.commonUniforms.sourceVisibility.value = this.projection.visibility
    this.commonUniforms.fieldCos.value = this.projection.fieldCos
    this.commonUniforms.fieldSin.value = this.projection.fieldSin
    ;(this.commonUniforms.fieldDirection.value as THREE.Vector2).copy(this.projection.fieldDirection)
    const halfFov = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(
      camera.fov,
      FILMIC_LENS_FLARE_PRESET.minimumFovDeg,
      FILMIC_LENS_FLARE_PRESET.maximumFovDeg,
    )) * 0.5
    this.occlusionMaterial.uniforms.solarDiscRadiusUv.value = (
      Math.tan(THREE.MathUtils.degToRad(0.53) * 0.5) / (2 * Math.tan(halfFov))
    )
  }

  setCameraSubmerged(value: boolean): void {
    if (this.cameraSubmerged === value) return
    this.cameraSubmerged = value
    this.occlusionMaterial.uniforms.sourceThroughWater.value = value ? 1 : 0
    // The source changes discontinuously between the direct and Snell-mapped
    // coordinates at the physical medium boundary. Do not leave persistent
    // source/halo bloom behind at the old coordinate after that change.
    this.sourceBloom.invalidateTemporalHistory()
    this.haloBloom.invalidateTemporalHistory()
  }

  setEnabled(enabled: boolean): void {
    this.effectEnabled = enabled
    this.commonUniforms.effectMix.value = enabled ? 1 : 0
    this.compositeMaterial.uniforms.hardEnabled.value = enabled ? 1 : 0
  }

  setIntensity(value: number): void {
    this.commonUniforms.strength.value = THREE.MathUtils.clamp(value, 0, 2)
  }

  setDebugMode(mode: number): void {
    this.debugMode = THREE.MathUtils.clamp(Math.floor(mode), 0, 8)
    this.compositeMaterial.uniforms.debugMode.value = this.debugMode
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime = 0,
  ): void {
    this.elapsedSeconds += Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0
    this.commonUniforms.tDiffuse.value = readBuffer.texture
    this.compositeMaterial.uniforms.timeSeconds.value = this.elapsedSeconds

    const previousTarget = renderer.getRenderTarget()
    renderer.getClearColor(this.oldClearColor)
    const previousClearAlpha = renderer.getClearAlpha()
    const previousAutoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.setClearColor(0x000000, 0)

    try {
      const shouldRenderOptics = this.effectEnabled
        && Number(this.commonUniforms.sourceVisibility.value) > 1e-6

      if (shouldRenderOptics) {
        this.renderMaterial(renderer, this.occlusionTarget, this.occlusionMaterial)
        this.renderMaterial(renderer, this.flareTarget, this.flareMaterial)

        this.seedMaterial.uniforms.seedMode.value = 0
        this.seedMaterial.uniforms.bloomThreshold.value = this.sourceBloom.threshold
        this.renderMaterial(renderer, this.sourceBloom.brightTarget, this.seedMaterial)
        this.sourceBloom.renderFromBright(renderer, this.quad)
        this.sourceBloom.renderTemporal(renderer, this.quad, deltaTime, this.occlusionTarget.texture)

        this.seedMaterial.uniforms.seedMode.value = 1
        this.seedMaterial.uniforms.bloomThreshold.value = this.haloBloom.threshold
        this.renderMaterial(renderer, this.haloBloom.brightTarget, this.seedMaterial)
        this.haloBloom.renderFromBright(renderer, this.quad)
        this.haloBloom.renderTemporal(renderer, this.quad, deltaTime, this.occlusionTarget.texture)

        this.flareBrightMaterial.uniforms.bloomInput.value = this.flareTarget.texture
        this.flareBrightMaterial.uniforms.bloomThreshold.value = this.flareBloom.threshold
        this.renderMaterial(renderer, this.flareBloom.brightTarget, this.flareBrightMaterial)
        this.flareBloom.renderFromBright(renderer, this.quad)

        this.compositeMaterial.uniforms.sourceBloom.value = this.sourceBloom.texture
        this.compositeMaterial.uniforms.haloBloom.value = this.haloBloom.texture
        this.opticalTargetsValid = true
        this.opticsWereActive = true
      } else {
        // The composite pass remains in the graph even when the flare is
        // hidden. Clear persistent optical history on the initial invalid
        // frame and on the active -> inactive transition, then leave the
        // neutral targets untouched while the source remains unavailable.
        if (!this.opticalTargetsValid || this.opticsWereActive) {
          this.clearOpticalTargets(renderer)
          this.opticalTargetsValid = true
        }
        this.opticsWereActive = false
      }

      this.quad.material = this.compositeMaterial
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer)
      if (this.clear) renderer.clear(true, false, false)
      this.quad.render(renderer)
    } finally {
      renderer.setClearColor(this.oldClearColor, previousClearAlpha)
      renderer.autoClear = previousAutoClear
      renderer.setRenderTarget(previousTarget)
    }
  }

  getDiagnostics(): LensFlareDiagnostics {
    const targets = [
      this.occlusionTarget,
      this.flareTarget,
      ...this.sourceBloom.getTargets(),
      ...this.haloBloom.getTargets(),
      ...this.flareBloom.getTargets(),
    ]
    return {
      enabled: this.effectEnabled,
      cameraSubmerged: this.cameraSubmerged,
      debugMode: this.debugMode,
      sourceTop: this.projection.sourceTop.toArray(),
      sourceVisibility: this.projection.visibility,
      fieldCos: this.projection.fieldCos,
      fieldSin: this.projection.fieldSin,
      fieldDirection: this.projection.fieldDirection.toArray(),
      strength: Number(this.commonUniforms.strength.value),
      renderTargets: targets.map((target) => ({
        name: target.texture.name,
        width: target.width,
        height: target.height,
        type: target.texture.type,
      })),
    }
  }

  dispose(): void {
    this.occlusionTarget.dispose()
    this.flareTarget.dispose()
    this.sourceBloom.dispose()
    this.haloBloom.dispose()
    this.flareBloom.dispose()
    this.occlusionMaterial.dispose()
    this.flareMaterial.dispose()
    this.seedMaterial.dispose()
    this.flareBrightMaterial.dispose()
    this.compositeMaterial.dispose()
    this.quad.dispose()
  }

  private renderMaterial(
    renderer: THREE.WebGLRenderer,
    target: THREE.WebGLRenderTarget,
    material: THREE.Material,
  ): void {
    this.quad.material = material
    renderer.setRenderTarget(target)
    renderer.clear(true, false, false)
    this.quad.render(renderer)
  }

  private clearOpticalTargets(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(this.occlusionTarget)
    renderer.clear(true, false, false)
    renderer.setRenderTarget(this.flareTarget)
    renderer.clear(true, false, false)
    this.sourceBloom.clearOutput(renderer)
    this.haloBloom.clearOutput(renderer)
    this.flareBloom.clearOutput(renderer)
  }

}
