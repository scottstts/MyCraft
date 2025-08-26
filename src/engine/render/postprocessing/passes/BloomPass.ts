// Lightweight wrapper to use UnrealBloomPass with our settings
// We keep thresholds/strength exposed to Engine
// @ts-ignore
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import * as THREE from 'three'

export class BloomWrapperPass extends UnrealBloomPass {
  constructor(width: number, height: number){
    super(new THREE.Vector2(width, height), 0.15, 0.5, 0.3)
  }
  setSize(width: number, height: number){ super.setSize(width, height) }
  setSettings({ enabled, strength, threshold }: { enabled?: boolean; strength?: number; threshold?: number }){
    if(enabled!==undefined) (this as any).enabled = enabled
    if(strength!==undefined) this.strength = strength
    if(threshold!==undefined) this.threshold = threshold
  }
}
