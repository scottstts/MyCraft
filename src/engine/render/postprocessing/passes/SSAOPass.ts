import * as THREE from 'three'
// @ts-ignore
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

export class SSAOPass extends ShaderPass {
  constructor() {
    super({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2(1,1) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        ssaoEnabled: { value: true },
        ssaoIntensity: { value: 0.3 },
        ssaoRadius: { value: 0.01 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 resolution;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform bool ssaoEnabled;
        uniform float ssaoIntensity;
        uniform float ssaoRadius;
        varying vec2 vUv;
        float readDepth(vec2 coord) {
          float z = texture2D(tDepth, coord).r;
          if (z == 1.0) return cameraFar;
          float viewZ = (cameraNear * cameraFar) / ((cameraFar - cameraNear) * z - cameraFar);
          return -viewZ;
        }
        float aoFunc(vec2 uv) {
          if (!ssaoEnabled) return 1.0;
          float occlusion = 0.0; int samples = 8;
          float depth = readDepth(uv); if (depth >= cameraFar*0.99) return 1.0;
          float radius = ssaoRadius * 200.0;
          for (int i=0;i<8;i++){
            float a = float(i) / 8.0 * 6.2831853;
            vec2 o = vec2(cos(a), sin(a)) * radius / resolution;
            vec2 suv = clamp(uv + o, vec2(0.0), vec2(1.0));
            float d = readDepth(suv);
            float diff = d - depth; if (diff > 0.1 && diff < 5.0) occlusion += 1.0;
          }
          occlusion = (occlusion / 8.0) * ssaoIntensity;
          return clamp(1.0 - occlusion * 0.5, 0.3, 1.0);
        }
        void main(){
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          float ao = aoFunc(vUv);
          gl_FragColor = vec4(color * ao, 1.0);
        }
      `
    })
  }
  setDepthTexture(depth: THREE.DepthTexture) { this.uniforms.tDepth.value = depth }
  setSize(w: number, h: number) {
    (this.uniforms.resolution.value as THREE.Vector2).set(w, h)
  }
  setCamera(cam: THREE.PerspectiveCamera) {
    this.uniforms.cameraNear.value = cam.near
    this.uniforms.cameraFar.value = cam.far
  }
  setSettings({ enabled, intensity, radius }: { enabled?: boolean; intensity?: number; radius?: number }) {
    if (enabled !== undefined) this.uniforms.ssaoEnabled.value = enabled
    if (intensity !== undefined) this.uniforms.ssaoIntensity.value = intensity
    if (radius !== undefined) this.uniforms.ssaoRadius.value = radius
  }
}
