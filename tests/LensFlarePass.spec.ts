import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  FILMIC_LENS_FLARE_PRESET,
  LensFlarePass,
  createGaussianTapLayout,
  computeLensFlareSunEnergy,
  projectLensFlareSource,
  refractLensFlareSunDirectionUnderwater,
} from '../src/engine/render/postprocessing/passes/LensFlarePass'
import {
  FILMIC_FLARE_COMPOSITE_FRAGMENT_SHADER,
  FILMIC_FLARE_FRAGMENT_SHADER,
  FILMIC_FLARE_OCCLUSION_FRAGMENT_SHADER,
  FILMIC_FLARE_TEMPORAL_BLOOM_FRAGMENT_SHADER,
} from '../src/engine/render/postprocessing/passes/filmicLensFlareShaders'

function createCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 1_000)
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -1)
  camera.updateMatrixWorld(true)
  return camera
}

describe('filmic lens flare WebGL port', () => {
  it('keeps the reference camera and exposure contract', () => {
    expect(FILMIC_LENS_FLARE_PRESET).toMatchObject({
      initialFovDeg: 58,
      minimumFovDeg: 26,
      maximumFovDeg: 105,
      initialSourceScreen: [0.785, 0.625],
      strength: 1,
      exposure: 0.92,
    })
  })

  it('projects the directional sun into top-origin screen coordinates', () => {
    const camera = createCamera()
    const centered = projectLensFlareSource(camera, new THREE.Vector3(0, 0, -1))
    expect(centered.sourceTop.x).toBeCloseTo(0.5, 6)
    expect(centered.sourceTop.y).toBeCloseTo(0.5, 6)
    expect(centered.visibility).toBeCloseTo(1, 6)

    const upperRight = projectLensFlareSource(
      camera,
      new THREE.Vector3(0.25, 0.15, -1).normalize(),
    )
    expect(upperRight.sourceTop.x).toBeGreaterThan(0.5)
    expect(upperRight.sourceTop.y).toBeLessThan(0.5)
    expect(upperRight.visibility).toBeGreaterThan(0)
    expect(upperRight.fieldSin).toBeGreaterThan(0)
  })

  it('suppresses invalid, behind-camera, off-frame, and below-horizon emitters', () => {
    const camera = createCamera()
    const retainedSource = new THREE.Vector2(0.72, 0.31)
    const retainedAxis = new THREE.Vector2(0.8, -0.6)
    const behind = projectLensFlareSource(
      camera,
      new THREE.Vector3(0, 0, 1),
      1,
      retainedSource,
      retainedAxis,
    )
    expect(behind.visibility).toBe(0)
    expect(behind.sourceTop.toArray()).toEqual(retainedSource.toArray())
    expect(behind.fieldDirection.toArray()).toEqual(retainedAxis.toArray())

    const offFrame = projectLensFlareSource(
      camera,
      new THREE.Vector3(4, 0, -1).normalize(),
    )
    expect(offFrame.visibility).toBe(0)
    expect(computeLensFlareSunEnergy(-0.2)).toBe(0)
    expect(computeLensFlareSunEnergy(1)).toBeCloseTo(1)
  })

  it('maps the underwater lens source into the physical Snell window', () => {
    const overhead = refractLensFlareSunDirectionUnderwater(new THREE.Vector3(0, 1, 0))
    expect(overhead.toArray()).toEqual([0, 1, 0])

    const horizon = refractLensFlareSunDirectionUnderwater(new THREE.Vector3(1, 0, 0))
    const criticalAngle = Math.asin(1 / 1.333)
    expect(Math.acos(horizon.y)).toBeCloseTo(criticalAngle, 6)
    expect(horizon.x).toBeCloseTo(1 / 1.333, 6)
    expect(horizon.y).toBeGreaterThan(0)

    const obliqueSun = new THREE.Vector3(0.8, 0.25, -0.4).normalize()
    const apparent = refractLensFlareSunDirectionUnderwater(obliqueSun)
    expect(Math.acos(apparent.y)).toBeLessThanOrEqual(criticalAngle + 1e-8)
    expect(Math.sign(apparent.x)).toBe(Math.sign(obliqueSun.x))
    expect(Math.sign(apparent.z)).toBe(Math.sign(obliqueSun.z))
  })

  it('feeds the Snell-mapped source to the complete underwater flare graph', () => {
    const camera = createCamera()
    const sun = new THREE.Vector3(0.35, 0.72, -0.60).normalize()
    const apparent = refractLensFlareSunDirectionUnderwater(sun)
    const expectedProjection = projectLensFlareSource(
      camera,
      apparent,
      computeLensFlareSunEnergy(sun.y),
    )
    const pass = new LensFlarePass()

    pass.setCameraSubmerged(true)
    pass.update(camera, sun)
    const diagnostics = pass.getDiagnostics()

    expect(diagnostics.cameraSubmerged).toBe(true)
    expect(diagnostics.sourceTop[0]).toBeCloseTo(expectedProjection.sourceTop.x, 6)
    expect(diagnostics.sourceTop[1]).toBeCloseTo(expectedProjection.sourceTop.y, 6)
    expect(diagnostics.sourceVisibility).toBeCloseTo(expectedProjection.visibility, 6)

    pass.dispose()
  })

  it('retains all three five-level bloom graphs and their authored thresholds', () => {
    const pass = new LensFlarePass()
    pass.setSize(1280, 720)
    const diagnostics = pass.getDiagnostics()

    expect(diagnostics.renderTargets).toHaveLength(39)
    expect(diagnostics.renderTargets.map((target) => target.name)).toEqual(
      expect.arrayContaining([
        'LensFlare.sourceBloom.bright',
        'LensFlare.sourceBloom.v4',
        'LensFlare.haloBloom.bright',
        'LensFlare.haloBloom.v4',
        'LensFlare.flareBloom.bright',
        'LensFlare.flareBloom.v4',
        'LensFlare.sourceBloom.history0',
        'LensFlare.sourceBloom.history1',
        'LensFlare.haloBloom.history0',
        'LensFlare.haloBloom.history1',
      ]),
    )
    expect(diagnostics.renderTargets.find((target) => target.name === 'LensFlare.flare')).toMatchObject({
      width: 1280,
      height: 720,
      type: THREE.HalfFloatType,
    })
    pass.dispose()
  })

  it('pairs adjacent Gaussian taps at weighted bilinear centroids', () => {
    const layout = createGaussianTapLayout(22)
    expect(layout.pairs).toHaveLength(10)
    expect(layout.tailOffset).toBe(21)
    expect(layout.tailWeight).toBeGreaterThan(0)
    for (let index = 0; index < layout.pairs.length; index += 1) {
      const pair = layout.pairs[index]
      expect(pair.offset).toBeGreaterThan(1 + index * 2)
      expect(pair.offset).toBeLessThan(2 + index * 2)
      expect(pair.weight).toBeGreaterThan(0)
    }

    const pass = new LensFlarePass()
    const sourceBloom = pass['sourceBloom'] as {
      blurMaterials: THREE.ShaderMaterial[]
    }
    const largestKernel = sourceBloom.blurMaterials[4]
    expect(largestKernel.fragmentShader).toContain('#define GAUSSIAN_PAIR_COUNT 10')
    // The fixed loop expands to ten paired offsets at compile time; the
    // source contains only the center, two pair-side, and two tail-side
    // bilinear lookup sites.
    expect((largestKernel.fragmentShader.match(/texture2D\(colorTexture/g) ?? []).length).toBe(5)
    pass.dispose()
  })

  it('contains the complete ghost, star, veil, film, and grain stages', () => {
    for (const marker of [
      'gTerminalA',
      'gTerminalB',
      'gCool',
      'gWarm0',
      'gBead4',
      'radialGhostRgb',
      'spectralSpread',
      'whiteStar',
    ]) {
      expect(FILMIC_FLARE_FRAGMENT_SHADER).toContain(marker)
    }

    for (const marker of [
      'sourceBloomColor',
      'haloBloomColor',
      'flareBloomColor',
      'veilMask',
      'milkMask',
      'filmTint',
      'creamyShoulder',
      'vignette',
      'grainMask',
    ]) {
      expect(FILMIC_FLARE_COMPOSITE_FRAGMENT_SHADER).toContain(marker)
    }

    expect(FILMIC_FLARE_TEMPORAL_BLOOM_FRAGMENT_SHADER).toContain(
      'float retainedFraction = mix(0.035, 0.96, aperture)',
    )
    expect(FILMIC_FLARE_OCCLUSION_FRAGMENT_SHADER).toContain('apertureVisibility')
    expect(FILMIC_FLARE_OCCLUSION_FRAGMENT_SHADER).toContain('solarDiscRadiusUv')
    expect(FILMIC_FLARE_OCCLUSION_FRAGMENT_SHADER).toContain('outer / 16.0')
    expect(FILMIC_FLARE_OCCLUSION_FRAGMENT_SHADER).toContain('uniform sampler2D tSceneColor')
    expect(FILMIC_FLARE_OCCLUSION_FRAGMENT_SHADER).toContain('uniform float sourceThroughWater')
    expect(FILMIC_FLARE_OCCLUSION_FRAGMENT_SHADER).toContain('float visibleWater = 1.0 - step(0.002000')
    expect(FILMIC_FLARE_OCCLUSION_FRAGMENT_SHADER).toContain(
      'float mediumAperture = mix(1.0 - visibleWater, 1.0, sourceThroughWater)',
    )
  })
})
