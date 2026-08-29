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
  }
  setSize(width: number, height: number){ super.setSize(width, height) }
  setSettings({ enabled, strength, threshold }: { enabled?: boolean; strength?: number; threshold?: number }){
    if(enabled!==undefined) this.enabled = enabled
    if(strength!==undefined) this.strength = strength
    if(threshold!==undefined) this.threshold = threshold
  }
}
