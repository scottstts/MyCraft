/**
 * WebGL post-processing pipeline built on EffectComposer.
 * The pass order is RenderPass -> SSAO -> Volumetrics -> Bloom -> Fog/Color.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { SSAOPass } from './passes/SSAOPass'
import { VolumetricLightingPass } from './passes/VolumetricLightingPass'
import { BloomWrapperPass } from './passes/BloomPass'
import { FogPass } from './passes/FogPass'
import { LensFlarePass } from './passes/LensFlarePass'

export class Composer {
  private composer: EffectComposer
  private renderPass: RenderPass
  private ssao: SSAOPass
  private vol: VolumetricLightingPass
  private bloom: BloomWrapperPass
  private lens: LensFlarePass
  private fog: FogPass
  private depthTarget: THREE.WebGLRenderTarget
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number) {
    // Use default internal ping-pong color buffers for composer
    this.composer = new EffectComposer(renderer)
    this.renderer = renderer
    this.scene = scene

    const effective = this.getEffectiveSize(width, height)

    // Separate depth target to avoid feedback loops
    // Use higher-precision depth to reduce banding in fog: 24-bit depth + 8-bit stencil
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

    this.vol = new VolumetricLightingPass()
    this.vol.setDepthTexture(this.depthTarget.depthTexture)
    this.vol.setSize(effective.width, effective.height)
    this.composer.addPass(this.vol)

    this.bloom = new BloomWrapperPass(width, height)
    this.composer.addPass(this.bloom)

    // Lens flare (additive, before fog)
    this.lens = new LensFlarePass()
    this.lens.setDepthTexture(this.depthTarget.depthTexture)
    this.lens.setSize(effective.width, effective.height)
    this.composer.addPass(this.lens)

    this.fog = new FogPass()
    this.fog.setDepthTexture(this.depthTarget.depthTexture)
    this.composer.addPass(this.fog)
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
    this.vol.setSize(effective.width, effective.height)
    this.bloom.setSize(effective.width, effective.height)
    this.lens.setSize(effective.width, effective.height)
  }
  update(camera: THREE.PerspectiveCamera, sunDirWorld: THREE.Vector3, sunColor?: THREE.Color) {
    // Render depth prepass into separate target to avoid feedback
    const prev = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.depthTarget)
    this.renderer.clear(true, true, true)
    this.renderer.render(this.scene, camera)
    this.renderer.setRenderTarget(prev)

    // Update per-pass uniforms
    this.ssao.setCamera(camera)
    this.vol.setCamera(camera)
    this.vol.setSunDirWorld(sunDirWorld, camera)
    this.lens.setCamera(camera)
    this.lens.setSun(sunDirWorld, sunColor ?? new THREE.Color(1,1,0.95), camera)
    this.fog.setCamera(camera)
  }
  setSSAOWaterLevel(y: number){ this.ssao.setWaterLevel(y) }
  setSSAO(enabled: boolean, intensity: number, radius: number) { this.ssao.setSettings({ enabled, intensity, radius }) }
  setVolumetrics(enabled: boolean, intensity: number, steps: number) { this.vol.setSettings({ enabled, intensity, steps }) }
  setBloom(enabled: boolean, strength: number, threshold: number) { this.bloom.setSettings({ enabled, strength, threshold }) }
  setLens(enabled: boolean, intensity: number) { this.lens.setEnabled(enabled); this.lens.setIntensity(intensity) }
  setFog(enabled: boolean, baseDensity: number, maxDistance: number) { this.fog.setSettings({ enabled, baseDensity, maxDistance }) }
  setHorizonHaze(params: { enabled?: boolean; waterLevel?: number; hazeStart?: number; hazeDensity?: number; hazeMaxMix?: number; hazeAngleBoost?: number; hazePlaneBoost?: number; hazePlaneBand?: number }) { this.fog.setHorizonHaze(params) }
  setFogColor(color: THREE.Color) { this.fog.setColor(color) }
  setFogDayLight(v: number) { this.fog.setDayLight(v) }
  setColorGrading(exposure: number, contrast: number, saturation: number) { this.fog.setColorGrading({ exposure, contrast, saturation }) }
  render() { this.composer.render() }
}
