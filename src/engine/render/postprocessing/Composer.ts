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

export class Composer {
  private composer: EffectComposer
  // Kept minimal for now; we only expose composer

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true })
    target.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedShortType)
    this.composer = new EffectComposer(renderer, target)

    const renderPass = new RenderPass(scene, camera)
    this.composer.addPass(renderPass)

    // TODO: add SSAO, VolumetricLighting, Bloom, Fog, Color passes here
  }

  setSize(w: number, h: number) { this.composer.setSize(w, h) }
  render() { this.composer.render() }
}
