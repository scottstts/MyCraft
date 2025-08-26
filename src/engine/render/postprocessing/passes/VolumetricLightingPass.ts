import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

export class VolumetricLightingPass extends ShaderPass {
  private _sunDirView = new THREE.Vector3(0.6,0.8,0.1).normalize()
  constructor() {
    super({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2(1,1) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        invProjection: { value: new THREE.Matrix4() },
        invView: { value: new THREE.Matrix4() },
        sunDirView: { value: new THREE.Vector3(0.6,0.8,0.1).normalize() },
        enabled: { value: true },
        intensity: { value: 0.1 },
        steps: { value: 32 },
      },
      vertexShader: `
        varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} 
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tDepth; varying vec2 vUv; 
        uniform vec2 resolution; uniform float cameraNear; uniform float cameraFar; 
        uniform mat4 invProjection; uniform mat4 invView; uniform vec3 sunDirView; 
        uniform bool enabled; uniform float intensity; uniform int steps; 

        float readDepth(vec2 coord){
          float z=texture2D(tDepth,coord).r; if (z==1.0) return cameraFar; 
          float vz=(cameraNear*cameraFar)/((cameraFar-cameraNear)*z-cameraFar); return -vz; }

        vec3 marchVol(vec2 uv,float viewDepth){
          int N = max(1, steps); float stepLen=max(1.0, viewDepth)/float(N); 
          vec3 accum=vec3(0.0); float trans=1.0; 
          vec2 dirSS = normalize(sunDirView.xy + vec2(1e-5));
          vec2 stepUV = dirSS * 1.5 / min(resolution.x, resolution.y);
          vec2 sUv = uv; float z=viewDepth; 
          for(int i=0;i<128;i++){ if(i>=N) break; sUv -= stepUV; z -= stepLen; if(z<=0.0) break; 
            float sd = readDepth(sUv); if(sd < z - 0.5){ trans *= 0.96; } accum += vec3(1.0)*trans*0.02; trans*=0.99; }
          return accum * intensity; }

        void main(){ vec3 col = texture2D(tDiffuse,vUv).rgb; float vd = readDepth(vUv);
          if(enabled){ col += marchVol(vUv, vd); } gl_FragColor = vec4(col,1.0);} 
      `
    })
  }
  setDepthTexture(depth: THREE.DepthTexture){ this.uniforms.tDepth.value = depth }
  setSize(w: number,h: number){ (this.uniforms.resolution.value as THREE.Vector2).set(w,h) }
  setCamera(cam: THREE.PerspectiveCamera){ this.uniforms.cameraNear.value = cam.near; this.uniforms.cameraFar.value = cam.far; (this.uniforms.invProjection.value as THREE.Matrix4).copy(cam.projectionMatrixInverse); (this.uniforms.invView.value as THREE.Matrix4).copy(cam.matrixWorldInverse) }
  setSunDirWorld(dir: THREE.Vector3, cam: THREE.PerspectiveCamera){ const m3 = new THREE.Matrix3().setFromMatrix4(cam.matrixWorldInverse); this._sunDirView.copy(dir).applyMatrix3(m3).normalize(); (this.uniforms.sunDirView.value as THREE.Vector3).copy(this._sunDirView) }
  setSettings({ enabled, intensity, steps }: { enabled?: boolean; intensity?: number; steps?: number }){ if(enabled!==undefined) this.uniforms.enabled.value = enabled; if(intensity!==undefined) this.uniforms.intensity.value = intensity; if(steps!==undefined) this.uniforms.steps.value = steps }
}
