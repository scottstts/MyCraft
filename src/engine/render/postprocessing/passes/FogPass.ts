import * as THREE from 'three'
// @ts-ignore
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

export class FogPass extends ShaderPass {
  constructor(){
    super({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        enabled: { value: true },
        baseDensity: { value: 0.002 },
        maxDistance: { value: 600 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tDepth; varying vec2 vUv;
        uniform float cameraNear; uniform float cameraFar; uniform bool enabled;
        uniform float baseDensity; uniform float maxDistance;
        float readDepth(vec2 uv){ float z=texture2D(tDepth,uv).r; if(z==1.0) return cameraFar; float vz=(cameraNear*cameraFar)/((cameraFar-cameraNear)*z-cameraFar); return -vz; }
        void main(){ vec3 col = texture2D(tDiffuse,vUv).rgb; float d = readDepth(vUv); if(enabled){ d = min(d, maxDistance); float f = 1.0 - exp(-d * baseDensity); vec3 fogC = vec3(0.72,0.82,0.92); col = mix(col, fogC, clamp(f,0.0,0.9)); } gl_FragColor = vec4(col,1.0);} 
      `
    })
  }
  setDepthTexture(depth: THREE.DepthTexture){ this.uniforms.tDepth.value = depth }
  setCamera(cam: THREE.PerspectiveCamera){ this.uniforms.cameraNear.value = cam.near; this.uniforms.cameraFar.value = cam.far }
  setSettings({ enabled, baseDensity, maxDistance }: { enabled?: boolean; baseDensity?: number; maxDistance?: number }){ if(enabled!==undefined) this.uniforms.enabled.value = enabled; if(baseDensity!==undefined) this.uniforms.baseDensity.value = baseDensity; if(maxDistance!==undefined) this.uniforms.maxDistance.value = maxDistance }
}

