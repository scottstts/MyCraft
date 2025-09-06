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
        invProjectionMatrix: { value: new THREE.Matrix4() },
        cameraMatrixWorld: { value: new THREE.Matrix4() },
        waterLevel: { value: 42.0 },
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
        uniform mat4 invProjectionMatrix;
        uniform mat4 cameraMatrixWorld;
        uniform float waterLevel;
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
        vec3 reconstructWorldPos(float viewDepth){
          vec2 ndc = vUv * 2.0 - 1.0;
          vec4 clip = vec4(ndc, 1.0, 1.0);
          vec4 viewFar = invProjectionMatrix * clip; viewFar /= viewFar.w;
          vec3 dirV = normalize(viewFar.xyz);
          float t = viewDepth / max(1e-4, -dirV.z);
          vec3 posV = dirV * t;
          vec4 posW = cameraMatrixWorld * vec4(posV, 1.0);
          return posW.xyz;
        }
        float aoFunc(vec2 uv) {
          if (!ssaoEnabled) return 1.0;
          float current = readDepth(uv);
          if (current >= cameraFar * 0.99) return 1.0;
          // Skip SSAO for underwater pixels (world Y below water plane). This
          // prevents the far seabed ramp from producing a horizon-wide AO seam.
          vec3 pw = reconstructWorldPos(current);
          if (pw.y < waterLevel - 0.1) return 1.0;
          
          // Mild flatness gating to avoid AO on perfectly flat areas only
          float px = 1.5 / min(resolution.x, resolution.y);
          float d1 = readDepth(clamp(uv + vec2(px, 0.0), vec2(0.0), vec2(1.0)));
          float d2 = readDepth(clamp(uv + vec2(-px, 0.0), vec2(0.0), vec2(1.0)));
          float d3 = readDepth(clamp(uv + vec2(0.0, px), vec2(0.0), vec2(1.0)));
          float d4 = readDepth(clamp(uv + vec2(0.0, -px), vec2(0.0), vec2(1.0)));
          if (d1 >= cameraFar*0.99) d1 = current; if (d2 >= cameraFar*0.99) d2 = current;
          if (d3 >= cameraFar*0.99) d3 = current; if (d4 >= cameraFar*0.99) d4 = current;
          float dmin = min(min(d1,d2), min(d3,d4));
          float dmax = max(max(d1,d2), max(d3,d4));
          float drange = dmax - dmin;
          float eps = mix(0.01, 0.25, clamp(current / cameraFar, 0.0, 1.0));
          float edgeMask = smoothstep(eps * 0.25, eps, drange);

          // Screen-space radius in pixels -> convert to UV
          float baseRadius = ssaoRadius * 200.0;
          // Per-pixel random rotation to break banding
          float angle0 = hash12(uv * resolution) * 6.2831853;
          float cs = cos(angle0); float sn = sin(angle0);
          mat2 rot = mat2(cs, -sn, sn, cs);
          
          int samples = 16;
          float occlusion = 0.0;
          float valid = 0.0;
          // Depth-scaled tolerance to avoid far-distance banding
          float depthScale = clamp(current / cameraFar, 0.0, 1.0);
          float maxDelta = mix(2.0, 20.0, depthScale);
          float thickness = mix(0.01, 0.15, depthScale);
          for (int i = 0; i < 16; i++){
            float t = (float(i) + 0.5) / 16.0;
            float r = mix(0.25, 1.0, t);
            float a = t * 6.2831853;
            vec2 dir = vec2(cos(a), sin(a));
            vec2 o = rot * dir * (baseRadius * r) / resolution;
            vec2 suv = clamp(uv + o, vec2(0.0), vec2(1.0));
            float sd = readDepth(suv);
            if (sd >= cameraFar * 0.99) continue; // ignore background
            valid += 1.0;
            float diff = current - sd; // positive when sample is closer
            // Simple bias-only SSAO is more robust for our voxel terrain
            if (diff > thickness) {
              float w = 1.0 - clamp((diff - thickness) / maxDelta, 0.0, 1.0);
              occlusion += w;
            }
          }
          // Normalize by number of valid samples to avoid artifacts when
          // background samples dominate (common near the horizon over water).
          occlusion = (occlusion / max(1.0, valid)) * ssaoIntensity * (0.75 + 0.25 * edgeMask);
          // Also fade AO as we approach the far plane (hidden by fog anyway)
          // Fade earlier so far-field planes (ocean/sea-bed) never accumulate AO
          float farFade = smoothstep(cameraFar * 0.30, cameraFar * 0.65, current);
          occlusion *= (1.0 - farFade);
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
    ;(this.uniforms.invProjectionMatrix.value as THREE.Matrix4).copy(cam.projectionMatrixInverse)
    ;(this.uniforms.cameraMatrixWorld.value as THREE.Matrix4).copy(cam.matrixWorld)
  }
  setWaterLevel(y: number){ this.uniforms.waterLevel.value = y }
  setSettings({ enabled, intensity, radius }: { enabled?: boolean; intensity?: number; radius?: number }) {
    if (enabled !== undefined) this.uniforms.ssaoEnabled.value = enabled
    if (intensity !== undefined) this.uniforms.ssaoIntensity.value = intensity
    if (radius !== undefined) this.uniforms.ssaoRadius.value = radius
  }
}
