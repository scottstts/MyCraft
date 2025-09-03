import * as THREE from 'three'
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
        ssaoIntensity: { value: 0.35 },
        ssaoRadius: { value: 0.02 },
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
        
        // Simple hash for per-pixel random rotation (avoids fixed ring banding)
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float readDepth(vec2 coord) {
          float z = texture2D(tDepth, coord).r;
          if (z == 1.0) return cameraFar;
          float viewZ = (cameraNear * cameraFar) / ((cameraFar - cameraNear) * z - cameraFar);
          return -viewZ;
        }
        float aoFunc(vec2 uv) {
          if (!ssaoEnabled) return 1.0;
          float current = readDepth(uv); if (current >= cameraFar*0.99) return 1.0;
          // Screen-space radius in pixels -> convert to UV
          float baseRadius = ssaoRadius * 200.0; // ~pixels at 1080p
          // Per-pixel random rotation to break banding
          float angle0 = hash12(uv * resolution) * 6.2831853;
          float cs = cos(angle0); float sn = sin(angle0);
          mat2 rot = mat2(cs, -sn, sn, cs);
          
          int samples = 16;
          float occlusion = 0.0;
          // Continuous falloff within a reasonable depth window
          const float maxDelta = 5.0; // world/view units window
          for (int i=0;i<16;i++){
            float t = (float(i) + 0.5) / 16.0;
            // Distribute samples from near center to radius with a slight bias to inner ring
            float r = mix(0.25, 1.0, t);
            float a = t * 6.2831853;
            vec2 dir = vec2(cos(a), sin(a));
            vec2 o = rot * dir * (baseRadius * r) / resolution;
            vec2 suv = clamp(uv + o, vec2(0.0), vec2(1.0));
            float sd = readDepth(suv);
            float diff = current - sd; // positive when sample is closer (occluder)
            if (diff > 0.001) {
              float w = 1.0 - clamp(diff / maxDelta, 0.0, 1.0);
              // Closer occluders contribute more, farther ones fade
              occlusion += w;
            }
          }
          occlusion = (occlusion / float(samples)) * ssaoIntensity;
          // Limit darkening to avoid conflict with dynamic shadows and baked AO
          return clamp(1.0 - occlusion * 0.75, 0.5, 1.0);
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
