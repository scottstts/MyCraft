/**
 * WebGL post-processing pipeline built on EffectComposer.
 * The pass order is RenderPass -> SSAO -> AerialPerspective -> ExposureMeter
 * -> Bloom -> LensFlare -> OutputPass. SSAO and voxel shadow ownership remain
 * unchanged; atmosphere and output transforms are centralized here.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { SSAOPass } from './passes/SSAOPass'
import { BloomWrapperPass } from './passes/BloomPass'
import { LensFlarePass } from './passes/LensFlarePass'
import { AerialPerspectivePass } from './passes/AerialPerspectivePass'
import { ExposureMeterPass } from './passes/ExposureMeterPass'
import type { AtmosphereState } from '../atmosphere/AtmosphereModel'
import { RENDER_STYLE } from '../settings/RenderStyle'
import type { VoxelSunShadowPass } from '../lighting/VoxelSunShadowPass.js'

export class Composer {
  private composer: EffectComposer
  private renderPass: RenderPass
  private ssao: SSAOPass
  private aerial: AerialPerspectivePass
  private bloom: BloomWrapperPass
  private lens: LensFlarePass
  private meter: ExposureMeterPass
  private output: OutputPass
  private depthTarget: THREE.WebGLRenderTarget
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private voxelSunShadow: VoxelSunShadowPass | null = null

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number) {
    // Use default internal ping-pong color buffers for composer
    this.composer = new EffectComposer(renderer)
    this.renderer = renderer
    this.scene = scene

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

    this.renderPass = new RenderPass(scene, camera)
    this.composer.addPass(this.renderPass)

    this.ssao = new SSAOPass()
    this.ssao.setDepthTexture(this.depthTarget.depthTexture)
    this.ssao.setSize(effective.width, effective.height)
    this.composer.addPass(this.ssao)

    this.aerial = new AerialPerspectivePass()
    this.aerial.setDepthTexture(this.depthTarget.depthTexture)
    this.aerial.setSize(effective.width, effective.height)
    this.composer.addPass(this.aerial)

    this.meter = new ExposureMeterPass(RENDER_STYLE.exposure, RENDER_STYLE.exposure.meterWidth, RENDER_STYLE.exposure.meterHeight)
    this.composer.addPass(this.meter)

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

  setPixelRatio(pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio)
    const size = this.renderer.getSize(new THREE.Vector2())
    const effective = this.getEffectiveSize(size.x, size.y)
    this.depthTarget.setSize(effective.width, effective.height)
    if (this.depthTarget.depthTexture) {
      this.depthTarget.depthTexture.image.width = effective.width
      this.depthTarget.depthTexture.image.height = effective.height
      this.depthTarget.depthTexture.needsUpdate = true
    }
    this.voxelSunShadow?.setSize(size.x, size.y)
  }

  setSize(w: number, h: number) {
    const effective = this.getEffectiveSize(w, h)
    this.depthTarget.setSize(effective.width, effective.height)
    // Ensure attached depth texture tracks the new size
    if (this.depthTarget.depthTexture) {
      this.depthTarget.depthTexture.image.width = effective.width
      this.depthTarget.depthTexture.image.height = effective.height
      this.depthTarget.depthTexture.needsUpdate = true
    }
    this.composer.setSize(w, h)
    this.ssao.setSize(effective.width, effective.height)
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
  private setShadowSamplingEnabled(enabled: boolean): Array<{
    enabledUniform: { value: unknown };
    enabledValue: unknown;
    depthUniform: { value: unknown } | undefined;
    depthValue: unknown;
  }> {
    const states: Array<{
      enabledUniform: { value: unknown };
      enabledValue: unknown;
      depthUniform: { value: unknown } | undefined;
      depthValue: unknown;
    }> = [];
    const seen = new Set<object>();
    this.scene.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const entry of materials) {
        const uniforms = (entry as THREE.ShaderMaterial).uniforms as Record<string, { value: unknown }> | undefined;
        const enabledUniform = uniforms?.voxelShadowEnabled;
        if (!enabledUniform) continue;
        // Chunk meshes share one BlockMaterial (and grass chunks share one
        // GrassMaterial).  Save each uniform exactly once; otherwise later
        // duplicate entries would restore the already-disabled value.
        if (seen.has(enabledUniform)) continue;
        seen.add(enabledUniform);
        const depthUniform = uniforms?.voxelShadowDepth;
        states.push({
          enabledUniform,
          enabledValue: enabledUniform.value,
          depthUniform,
          depthValue: depthUniform?.value,
        });
        enabledUniform.value = enabled;
        // Detach the actual framebuffer texture. WebGL validates feedback
        // loops from sampler bindings even when the shader branch is false.
        if (depthUniform) depthUniform.value = null;
      }
    });
    return states;
  }

  private restoreShadowSampling(states: Array<{
    enabledUniform: { value: unknown };
    enabledValue: unknown;
    depthUniform: { value: unknown } | undefined;
    depthValue: unknown;
  }>): void {
    for (const state of states) {
      state.enabledUniform.value = state.enabledValue;
      if (state.depthUniform) state.depthUniform.value = state.depthValue;
    }
  }

  getDepthTexture(): THREE.DepthTexture {
    return this.depthTarget.depthTexture as THREE.DepthTexture
  }
  update(camera: THREE.PerspectiveCamera, sunDirWorld: THREE.Vector3, sunColor?: THREE.Color, atmosphere?: AtmosphereState) {
    // Render depth prepass into separate target to avoid feedback
    const shadowStates = this.setShadowSamplingEnabled(false);
    const prev = this.renderer.getRenderTarget()
    try {
      this.renderer.setRenderTarget(this.depthTarget)
      this.renderer.clear(true, true, true)
      this.renderer.render(this.scene, camera)
    } finally {
      this.renderer.setRenderTarget(prev)
      this.restoreShadowSampling(shadowStates);
    }

    // Resolve voxel visibility after depth is current and before the color
    // RenderPass samples its screen-space mask.
    this.voxelSunShadow?.update(camera, sunDirWorld)

    // Update per-pass uniforms
    this.ssao.setCamera(camera)
    this.aerial.setCamera(camera)
    if (atmosphere) this.aerial.setAtmosphereState(atmosphere)
    this.lens.setCamera(camera)
    this.lens.setSun(sunDirWorld, sunColor ?? new THREE.Color(1,1,0.95), camera)
  }
  setSSAOWaterLevel(y: number){ this.ssao.setWaterLevel(y) }
  setSSAO(enabled: boolean, intensity: number, radius: number) { this.ssao.setSettings({ enabled, intensity, radius }) }
  setBloom(enabled: boolean, strength: number, threshold: number) { this.bloom.setSettings({ enabled, strength, threshold }) }
  setLens(enabled: boolean, intensity: number) { this.lens.setEnabled(enabled); this.lens.setIntensity(intensity) }
  setAerialPerspective(enabled: boolean, maxDistance: number) { this.aerial.setSettings({ enabled, maxDistance }) }
  getExposureDiagnostics() { return this.meter.getDiagnostics() }
  resetExposure() { this.meter.reset() }
  render() { this.composer.render() }

  dispose(): void {
    this.voxelSunShadow?.dispose()
    this.depthTarget.dispose()
    this.composer.dispose()
  }
}
