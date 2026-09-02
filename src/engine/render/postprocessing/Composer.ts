/**
 * WebGL post-processing pipeline built on EffectComposer.
 * The active pass order is RenderPass -> AerialPerspective -> Underwater
 * medium -> Bloom -> LensFlare -> OutputPass. Screen-space AO and adaptive
 * exposure are intentionally not part of the active chain: voxel/per-vertex
 * AO owns local grounding, and exposure remains a fixed renderer setting.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { BloomWrapperPass } from './passes/BloomPass'
import { FILMIC_LENS_FLARE_PRESET, LensFlarePass } from './passes/LensFlarePass'
import { AerialPerspectivePass } from './passes/AerialPerspectivePass'
import { UnderwaterPass } from './passes/UnderwaterPass'
import type { AtmosphereState } from '../atmosphere/AtmosphereModel'
import type { VoxelSunShadowPass } from '../lighting/VoxelSunShadowPass.js'
import {
  ForwardRefractionParticipantRegistry,
} from '../water/ForwardRefraction'
import { ForwardRefractionPass } from '../water/ForwardRefractionPass'
import {
  ShadowSamplingMaterialRegistry,
  type ShadowSamplingUniformState,
} from '../ShadowSamplingRegistry'

export class Composer {
  private composer: EffectComposer
  private renderPass: RenderPass
  private aerial: AerialPerspectivePass
  private bloom: BloomWrapperPass
  private lens: LensFlarePass
  private output: OutputPass
  private underwater: UnderwaterPass
  private depthTarget: THREE.WebGLRenderTarget
  private forwardRefraction: ForwardRefractionPass
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private voxelSunShadow: VoxelSunShadowPass | null = null
  private readonly shadowSamplingMaterials = new ShadowSamplingMaterialRegistry()
  private readonly forwardRefractionParticipants: ForwardRefractionParticipantRegistry
  private beforeOpaqueCapture: (() => void) | null = null
  private afterOpaqueCapture: (() => void) | null = null
  private underwaterEnabled = false

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    forwardRefractionParticipants?: ForwardRefractionParticipantRegistry,
  ) {
    // Use default internal ping-pong color buffers for composer
    this.composer = new EffectComposer(renderer)
    this.renderer = renderer
    this.scene = scene
    this.forwardRefractionParticipants = forwardRefractionParticipants ?? new ForwardRefractionParticipantRegistry()

    const effective = this.getEffectiveSize(width, height)

    // Separate depth target to avoid feedback loops
    // Use higher-precision depth to reduce aerial-perspective banding:
    // 24-bit depth + 8-bit stencil.
    this.depthTarget = new THREE.WebGLRenderTarget(effective.width, effective.height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: true,
    })
    const depthTex = new THREE.DepthTexture(effective.width, effective.height, THREE.UnsignedInt248Type)
    depthTex.format = THREE.DepthStencilFormat
    this.depthTarget.depthTexture = depthTex
    this.depthTarget.texture.colorSpace = THREE.NoColorSpace
    this.forwardRefraction = new ForwardRefractionPass(
      renderer,
      scene,
      effective.width,
      effective.height,
      this.forwardRefractionParticipants,
    )

    this.renderPass = new RenderPass(scene, camera)
    this.composer.addPass(this.renderPass)

    this.aerial = new AerialPerspectivePass()
    this.aerial.setDepthTexture(this.depthTarget.depthTexture)
    this.aerial.setSize(effective.width, effective.height)
    this.composer.addPass(this.aerial)

    this.underwater = new UnderwaterPass()
    this.underwater.setDepthTexture(this.depthTarget.depthTexture)
    this.composer.addPass(this.underwater)

    this.bloom = new BloomWrapperPass(width, height)
    this.composer.addPass(this.bloom)

    // Lens flare is additive and remains scene-linear until OutputPass.
    this.lens = new LensFlarePass()
    this.lens.setDepthTexture(this.depthTarget.depthTexture)
    this.lens.setSize(effective.width, effective.height)
    this.composer.addPass(this.lens)

    this.output = new OutputPass()
    this.composer.addPass(this.output)
  }

  private getEffectiveSize(width: number, height: number) {
    const pixelRatio = this.renderer.getPixelRatio()
    return {
      width: Math.max(1, Math.floor(width * pixelRatio)),
      height: Math.max(1, Math.floor(height * pixelRatio)),
    }
  }

  /**
   * Resize every post-processing target from one logical viewport commit.
   * The renderer has already applied the same logical size and DPR through
   * setDrawingBufferSize before this method is called.
   */
  setSize(w: number, h: number, pixelRatio = this.renderer.getPixelRatio()) {
    this.composer.setPixelRatio(pixelRatio)
    const effective = this.getEffectiveSize(w, h)
    this.depthTarget.setSize(effective.width, effective.height)
    this.forwardRefraction.setSize(effective.width, effective.height)
    // Ensure attached depth texture tracks the new size
    if (this.depthTarget.depthTexture) {
      this.depthTarget.depthTexture.image.width = effective.width
      this.depthTarget.depthTexture.image.height = effective.height
      this.depthTarget.depthTexture.needsUpdate = true
    }
    this.composer.setSize(w, h)
    this.aerial.setSize(effective.width, effective.height)
    this.bloom.setSize(effective.width, effective.height)
    this.lens.setSize(effective.width, effective.height)
    this.voxelSunShadow?.setSize(w, h)
  }

  /** Attach the sole sun-visibility producer and share the depth prepass. */
  setVoxelSunShadowPass(pass: VoxelSunShadowPass | null): void {
    this.voxelSunShadow = pass
    if (pass && this.depthTarget.depthTexture) pass.setDepthTexture(this.depthTarget.depthTexture)
  }

  /**
   * The depth prepass owns `depthTarget.depthTexture` as its framebuffer
   * attachment.  Custom terrain/grass materials also sample that texture for
   * edge-aware shadow reconstruction in the final color pass; sampling it
   * during this prepass would form a WebGL feedback loop.  Temporarily turn
   * the complete voxel-shadow lookup off while writing depth, then restore
   * each material's previous state before the visibility pass and final draw.
   */
  registerShadowSamplingMaterial(material: THREE.Material): void {
    this.shadowSamplingMaterials.register(material)
  }

  unregisterShadowSamplingMaterial(material: THREE.Material): void {
    this.shadowSamplingMaterials.unregister(material)
  }

  private setShadowSamplingEnabled(enabled: boolean): ShadowSamplingUniformState[] {
    return this.shadowSamplingMaterials.toggle(enabled)
  }

  private restoreShadowSampling(states: ShadowSamplingUniformState[]): void {
    this.shadowSamplingMaterials.restore(states)
  }

  getDepthTexture(): THREE.DepthTexture {
    return this.depthTarget.depthTexture as THREE.DepthTexture
  }

  getSceneColorTexture(): THREE.Texture {
    return this.depthTarget.texture
  }

  getSceneColorResolution(): { x: number; y: number } {
    return { x: this.depthTarget.width, y: this.depthTarget.height }
  }

  getForwardRefractionColorTexture(): THREE.Texture {
    return this.forwardRefraction.getColorTexture()
  }

  getForwardRefractionDepthTexture(): THREE.DepthTexture {
    return this.forwardRefraction.getDepthTexture()
  }

  getForwardRefractionResolution(): { x: number; y: number } {
    return this.forwardRefraction.getResolution()
  }

  getForwardRefractionDiagnostics(): Record<string, unknown> {
    return this.forwardRefraction.getDiagnostics()
  }

  setOpaqueCaptureHooks(before: (() => void) | null, after: (() => void) | null): void {
    this.beforeOpaqueCapture = before
    this.afterOpaqueCapture = after
  }

  setUnderwater(enabled: boolean): void {
    this.underwaterEnabled = enabled
    this.underwater.setUnderwater(enabled)
  }

  setUnderwaterWaterLevel(level: number): void { this.underwater.setWaterLevel(level) }

  setWaterCameraState(submerged: boolean, cameraSurfaceY: number): void {
    this.aerial.setCameraSubmerged(submerged)
    this.aerial.setCameraSurfaceY(cameraSurfaceY)
    this.underwater.setCameraSubmerged(submerged)
    this.underwater.setCameraSurfaceY(cameraSurfaceY)
    this.lens.setCameraSubmerged(submerged)
  }

  setUnderwaterDebugMode(mode: number): void { this.underwater.setDebugMode(mode) }

  /** Share the live render-only caustic field with the underwater medium. */
  setUnderwaterCaustics(
    texture: THREE.Texture | null,
    origin: { x: number; y: number },
    extent: number,
    resolution: { x: number; y: number },
    referenceDepth = 24,
  ): void {
    this.underwater.setCaustics(texture, origin, extent, resolution, referenceDepth)
  }

  setUnderwaterTime(timeSeconds: number): void { this.underwater.setTime(timeSeconds) }

  update(camera: THREE.PerspectiveCamera, sunDirWorld: THREE.Vector3, sunColor?: THREE.Color, atmosphere?: AtmosphereState) {
    // Render depth prepass into separate target to avoid feedback
    const shadowStates = this.setShadowSamplingEnabled(false);
    const prev = this.renderer.getRenderTarget()
    try {
      this.beforeOpaqueCapture?.()
      this.renderer.setRenderTarget(this.depthTarget)
      this.renderer.clear(true, true, true)
      this.renderer.render(this.scene, camera)
    } finally {
      this.renderer.setRenderTarget(prev)
      this.afterOpaqueCapture?.()
      this.restoreShadowSampling(shadowStates);
    }

    // Resolve voxel visibility after depth is current and before the color
    // RenderPass samples its screen-space mask.
    this.voxelSunShadow?.update(camera, sunDirWorld)

    // Transport opposite-medium geometry through the interface before the
    // ocean samples it. This pass rasterizes the refracted silhouette itself;
    // no water fragment searches or displaces the ordinary scene image.
    this.forwardRefraction.render(camera, (receiverTexture, receiverDepth) => {
      this.voxelSunShadow?.updateForward(receiverTexture, receiverDepth)
    })

    // Update per-pass uniforms
    this.aerial.setCamera(camera)
    this.underwater.setCamera(camera)
    this.underwater.setSun(sunDirWorld, sunColor ?? new THREE.Color(1, 1, 0.95))
    this.underwater.setUnderwater(this.underwaterEnabled)
    if (atmosphere) {
      this.aerial.setAtmosphereState(atmosphere)
      this.underwater.setAtmosphere(atmosphere.skyIrradiance, atmosphere.sunIntensity)
    }
    this.lens.update(camera, sunDirWorld, atmosphere)
  }
  /**
   * Kept for callers that still provide the old SSAO settings. Screen-space
   * AO is deliberately bypassed in this renderer; voxel/per-vertex AO remains
   * the active local-occlusion signal.
   */
  setSSAOWaterLevel(y: number): void { void y }
  setSSAO(enabled: boolean, intensity: number, radius: number): void {
    void enabled
    void intensity
    void radius
  }
  setBloom(enabled: boolean, strength: number, threshold: number) { this.bloom.setSettings({ enabled, strength, threshold }) }
  setLens(enabled: boolean, intensity: number) { this.lens.setEnabled(enabled); this.lens.setIntensity(intensity) }
  setLensDebugMode(mode: number) { this.lens.setDebugMode(mode) }
  getLensDiagnostics() { return this.lens.getDiagnostics() }
  setAerialPerspective(enabled: boolean, maxDistance: number) { this.aerial.setSettings({ enabled, maxDistance }) }
  getExposureDiagnostics() {
    return {
      enabled: false,
      averageLuminance: 0.18,
      targetExposure: FILMIC_LENS_FLARE_PRESET.exposure,
      currentExposure: this.renderer.toneMappingExposure,
      pending: false,
      readbackFailures: 0,
    }
  }
  resetExposure() { this.renderer.toneMappingExposure = FILMIC_LENS_FLARE_PRESET.exposure }
  render(deltaSeconds = 0) {
    // Never let EffectComposer fall back to its own wall-clock delta. The
    // engine supplies the bounded simulation delta; callers that omit it get
    // a deterministic zero for any future time-based post effect.
    const boundedDelta = Number.isFinite(deltaSeconds)
      ? Math.min(0.1, Math.max(0, deltaSeconds))
      : 0
    this.composer.render(boundedDelta)
  }

  dispose(): void {
    this.voxelSunShadow?.dispose()
    this.depthTarget.dispose()
    this.forwardRefraction.dispose()
    this.shadowSamplingMaterials.clear()
    this.underwater.dispose()
    this.lens.dispose()
    this.composer.dispose()
  }
}
