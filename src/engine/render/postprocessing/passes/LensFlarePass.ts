import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

export class LensFlarePass extends ShaderPass {
  private _sunNdc = new THREE.Vector2(-10, -10)
  private _sunVisible = 0
  private _sunColor = new THREE.Color(1,1,1)

  constructor(){
    super({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2(1,1) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        sunNdc: { value: new THREE.Vector2(-10,-10) },
        sunVisible: { value: 0.0 },
        sunColor: { value: new THREE.Color(1,1,1) },
        intensity: { value: 0.6 },
        enabled: { value: true },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tDepth; varying vec2 vUv; 
        uniform vec2 resolution; uniform float cameraNear; uniform float cameraFar; 
        uniform vec2 sunNdc; uniform float sunVisible; uniform vec3 sunColor; 
        uniform float intensity; uniform bool enabled;

        float readDepth(vec2 uv){ float z=texture2D(tDepth,uv).r; if(z==1.0) return cameraFar; float vz=(cameraNear*cameraFar)/((cameraFar-cameraNear)*z-cameraFar); return -vz; }

        // Soft circular glow
        float glow(vec2 uv, vec2 c, float r){ float d = length(uv - c); float x = clamp(1.0 - d/r, 0.0, 1.0); return x*x; }

        // Anisotropic streak along axis dir
        float streak(vec2 uv, vec2 c, vec2 dir, float len, float width){
          vec2 p = uv - c; float t = dot(p, dir); float l = clamp(1.0 - abs(t)/len, 0.0, 1.0); 
          float w = length(p - dir*t); float ga = exp(- (w*w) / (width*width));
          return l * ga; 
        }

        // Ghost sample at position along center<->sun axis
        float ghost(vec2 uv, vec2 center, vec2 sun, float k, float size){
          vec2 p = mix(center, sun, k); return glow(uv, p, size);
        }

        void main(){
          vec3 col = texture2D(tDiffuse, vUv).rgb;
          if (!enabled || sunVisible <= 0.0) { gl_FragColor = vec4(col,1.0); return; }

          vec2 sunSS = sunNdc * 0.5 + 0.5; // NDC->UV
          // Occlusion probe: if geometry present at sun pixel, disable flare
          float occ = 1.0;
          if (sunSS.x >= 0.0 && sunSS.x <= 1.0 && sunSS.y >= 0.0 && sunSS.y <= 1.0) {
            float sd = readDepth(sunSS);
            // If depth is finite near cameraFar, assume sky -> no occluder; else fully occluded
            occ = sd > cameraFar * 0.99 ? 1.0 : 0.0;
          }

          // Distance from center scales amount
          vec2 center = vec2(0.5, 0.5);
          float dc = clamp(1.0 - length(sunSS - center), 0.0, 1.0);
          float amount = intensity * sunVisible * occ * smoothstep(0.2, 0.9, dc);

          vec3 flare = vec3(0.0);
          // Halo around sun
          flare += sunColor * glow(vUv, sunSS, 0.15) * 0.8;
          // Streak along axis from sun to center
          vec2 dir = normalize(center - sunSS + vec2(1e-5));
          flare += sunColor * streak(vUv, sunSS, dir, 0.6, 0.01) * 0.35;
          flare += sunColor * streak(vUv, sunSS, vec2(-dir.y, dir.x), 0.4, 0.008) * 0.2;
          // Ghosts mirrored about center
          float sizes[4]; sizes[0]=0.06; sizes[1]=0.045; sizes[2]=0.035; sizes[3]=0.025;
          float ks[4]; ks[0]=-0.5; ks[1]=1.3; ks[2]=-1.1; ks[3]=1.8;
          for (int i=0;i<4;i++){
            float g = ghost(vUv, center, sunSS, ks[i], sizes[i]);
            flare += sunColor * g * (0.18 - 0.03*float(i));
          }

          col += flare * amount;
          gl_FragColor = vec4(col,1.0);
        }
      `,
    })
  }

  setDepthTexture(depth: THREE.DepthTexture){ this.uniforms.tDepth.value = depth }
  setSize(w: number, h: number){ (this.uniforms.resolution.value as THREE.Vector2).set(w,h) }
  setCamera(cam: THREE.PerspectiveCamera){ this.uniforms.cameraNear.value = cam.near; this.uniforms.cameraFar.value = cam.far }
  setEnabled(enabled: boolean){ this.uniforms.enabled.value = enabled }
  setIntensity(value: number){ this.uniforms.intensity.value = value }
  setSun(dirWorld: THREE.Vector3, color: THREE.Color, cam: THREE.PerspectiveCamera){
    // Project a point far along sun direction into screen space
    this._sunColor.copy(color)
    const sunPosWorld = new THREE.Vector3().copy(dirWorld).multiplyScalar(10000)
    const mvp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    const v4 = new THREE.Vector4(sunPosWorld.x, sunPosWorld.y, sunPosWorld.z, 1.0).applyMatrix4(mvp)
    let visible = 0
    const ndc = this._sunNdc
    if (v4.w !== 0){ ndc.set(v4.x / v4.w, v4.y / v4.w); }
    // Disable when sun is below the horizon
    if (dirWorld.y > 0) {
      // Visible if in front of camera and inside the screen
      if (v4.w > 0 && Math.abs(ndc.x) <= 1.0 && Math.abs(ndc.y) <= 1.0) visible = 1
    } else {
      visible = 0
    }
    this._sunVisible = visible
    ;(this.uniforms.sunNdc.value as THREE.Vector2).copy(ndc)
    ;(this.uniforms.sunColor.value as THREE.Color).copy(this._sunColor)
    this.uniforms.sunVisible.value = this._sunVisible
  }
}
