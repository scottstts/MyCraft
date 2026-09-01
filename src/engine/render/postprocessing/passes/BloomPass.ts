// Lightweight wrapper to use UnrealBloomPass with our settings
// We keep thresholds/strength exposed to Engine
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import * as THREE from 'three'
import { RENDER_STYLE } from '../../settings/RenderStyle'

export class BloomWrapperPass extends UnrealBloomPass {
  constructor(width: number, height: number){
    super(
      new THREE.Vector2(width, height),
      RENDER_STYLE.bloom.strength,
      RENDER_STYLE.bloom.radius,
      RENDER_STYLE.bloom.threshold,
    )
    // RGB bloom is additive, but alpha is an internal pre-lens interface
    // channel. Preserve the incoming alpha exactly so LensFlarePass can see
    // the visible ocean even though its geometric depth capture hides water.
    this.blendMaterial.blending = THREE.CustomBlending
    this.blendMaterial.blendEquation = THREE.AddEquation
    this.blendMaterial.blendSrc = THREE.OneFactor
    this.blendMaterial.blendDst = THREE.OneFactor
    this.blendMaterial.blendEquationAlpha = THREE.AddEquation
    this.blendMaterial.blendSrcAlpha = THREE.ZeroFactor
    this.blendMaterial.blendDstAlpha = THREE.OneFactor
  }
  setSize(width: number, height: number){ super.setSize(width, height) }
  setSettings({ enabled, strength, threshold }: { enabled?: boolean; strength?: number; threshold?: number }){
    if(enabled!==undefined) this.enabled = enabled
    if(strength!==undefined) this.strength = strength
    if(threshold!==undefined) this.threshold = threshold
  }
}
