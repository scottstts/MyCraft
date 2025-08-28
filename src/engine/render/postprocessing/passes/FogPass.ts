import * as THREE from 'three'
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
        fogColor: { value: new THREE.Color(0.72,0.82,0.92) },
        dayLight: { value: 1.0 },
        exposure: { value: 0.9 },
        contrast: { value: 1.05 },
        saturation: { value: 1.0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tDepth; varying vec2 vUv;
        uniform float cameraNear; uniform float cameraFar; uniform bool enabled;
        uniform float baseDensity; uniform float maxDistance; uniform vec3 fogColor; uniform float dayLight;
        uniform float exposure; uniform float contrast; uniform float saturation;
        float readDepth(vec2 uv){ float z=texture2D(tDepth,uv).r; if(z==1.0) return cameraFar; float vz=(cameraNear*cameraFar)/((cameraFar-cameraNear)*z-cameraFar); return -vz; }
        vec3 adjustColor(vec3 color, float contrast, float saturation) {
          color = (color - 0.5) * contrast + 0.5;
          float grey = dot(color, vec3(0.299, 0.587, 0.114));
          color = mix(vec3(grey), color, saturation);
          return color;
        }
        void main(){ vec3 col = texture2D(tDiffuse,vUv).rgb; col *= exposure; float d = readDepth(vUv); if(enabled){ bool bg = d >= cameraFar*0.99; d = min(d, maxDistance); float f = 1.0 - exp(-d * baseDensity); if (bg) { f *= mix(0.3, 1.0, clamp(dayLight,0.0,1.0)); } col = mix(col, fogColor, clamp(f,0.0,0.9)); } col = adjustColor(col, contrast, saturation); gl_FragColor = vec4(col,1.0);} 
      `
    })
  }
  setDepthTexture(depth: THREE.DepthTexture){ this.uniforms.tDepth.value = depth }
  setCamera(cam: THREE.PerspectiveCamera){ this.uniforms.cameraNear.value = cam.near; this.uniforms.cameraFar.value = cam.far }
  setSettings({ enabled, baseDensity, maxDistance }: { enabled?: boolean; baseDensity?: number; maxDistance?: number }){ if(enabled!==undefined) this.uniforms.enabled.value = enabled; if(baseDensity!==undefined) this.uniforms.baseDensity.value = baseDensity; if(maxDistance!==undefined) this.uniforms.maxDistance.value = maxDistance }
  setColor(c: THREE.Color){ (this.uniforms.fogColor.value as THREE.Color).copy(c) }
  setDayLight(v: number){ this.uniforms.dayLight.value = THREE.MathUtils.clamp(v,0,1) }
  setColorGrading({ exposure, contrast, saturation }: { exposure?: number; contrast?: number; saturation?: number }){ if(exposure!==undefined) this.uniforms.exposure.value = exposure; if(contrast!==undefined) this.uniforms.contrast.value = contrast; if(saturation!==undefined) this.uniforms.saturation.value = saturation }
}
