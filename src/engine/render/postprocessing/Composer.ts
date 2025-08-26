/**
 * Composer scaffolding for future migration to EffectComposer
 * Current engine still uses SimplePostProcessor; this wrapper prepares
 * a pipeline of RenderPass -> SSAO -> Volumetrics -> Bloom -> Fog/Color.
 */
import * as THREE from 'three'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
// @ts-ignore
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
// @ts-ignore
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { SSAOPass } from './passes/SSAOPass'
import { VolumetricLightingPass } from './passes/VolumetricLightingPass'
import { BloomWrapperPass } from './passes/BloomPass'
import { FogPass } from './passes/FogPass'

export class Composer {
  private composer: EffectComposer
  private renderPass: RenderPass
  private ssao: SSAOPass
  private vol: VolumetricLightingPass
  private bloom: BloomWrapperPass
  private fog: FogPass
  private depthTarget: THREE.WebGLRenderTarget
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number) {
    // Use default internal ping-pong color buffers for composer
    this.composer = new EffectComposer(renderer)
    this.renderer = renderer
    this.scene = scene

    // Separate depth target to avoid feedback loops
    this.depthTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
    })
    this.depthTarget.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedShortType)
    this.depthTarget.depthTexture.format = THREE.DepthFormat

    this.renderPass = new RenderPass(scene, camera)
    this.composer.addPass(this.renderPass)

    this.ssao = new SSAOPass()
    this.ssao.setDepthTexture(this.depthTarget.depthTexture)
    this.ssao.setSize(width, height)
    this.composer.addPass(this.ssao)

    this.vol = new VolumetricLightingPass()
    this.vol.setDepthTexture(this.depthTarget.depthTexture)
    this.vol.setSize(width, height)
    this.composer.addPass(this.vol)

    this.bloom = new BloomWrapperPass(width, height)
    this.composer.addPass(this.bloom)

    this.fog = new FogPass()
    this.fog.setDepthTexture(this.depthTarget.depthTexture)
    this.composer.addPass(this.fog)
  }

  setSize(w: number, h: number) {
    this.depthTarget.setSize(w, h)
    this.composer.setSize(w, h)
    this.ssao.setSize(w, h)
    this.vol.setSize(w, h)
    this.bloom.setSize(w, h)
  }
  update(camera: THREE.PerspectiveCamera, sunDirWorld: THREE.Vector3) {
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
    this.fog.setCamera(camera)
  }
  setSSAO(enabled: boolean, intensity: number, radius: number) { this.ssao.setSettings({ enabled, intensity, radius }) }
  setVolumetrics(enabled: boolean, intensity: number, steps: number) { this.vol.setSettings({ enabled, intensity, steps }) }
  setBloom(enabled: boolean, strength: number, threshold: number) { this.bloom.setSettings({ enabled, strength, threshold }) }
  setFog(enabled: boolean, baseDensity: number, maxDistance: number) { this.fog.setSettings({ enabled, baseDensity, maxDistance }) }
  render() { this.composer.render() }
}
