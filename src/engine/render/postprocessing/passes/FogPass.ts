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
        contrast: { value: 1.15 },
        saturation: { value: 1.1 },
        // Matrices and params for horizon haze (above-water extra fog)
        invProjectionMatrix: { value: new THREE.Matrix4() },
        cameraMatrixWorld: { value: new THREE.Matrix4() },
        hazeEnabled: { value: false },
        waterLevel: { value: 42.0 },
        hazeStart: { value: 400.0 },
        hazeDensity: { value: 0.004 },
        hazeMaxMix: { value: 0.5 },
        hazeAngleBoost: { value: 0.0 },
        hazePlaneBoost: { value: 0.0 },
        hazePlaneBand: { value: 6.0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tDepth; varying vec2 vUv;
        uniform float cameraNear; uniform float cameraFar; uniform bool enabled;
        uniform float baseDensity; uniform float maxDistance; uniform vec3 fogColor; uniform float dayLight;
        uniform float exposure; uniform float contrast; uniform float saturation;
        // Horizon haze and matrices
        uniform mat4 invProjectionMatrix; uniform mat4 cameraMatrixWorld;
        uniform bool hazeEnabled; uniform float waterLevel; uniform float hazeStart; uniform float hazeDensity; uniform float hazeMaxMix;
        uniform float hazeAngleBoost; uniform float hazePlaneBoost; uniform float hazePlaneBand;
        float readDepth(vec2 uv){ float z=texture2D(tDepth,uv).r; if(z==1.0) return cameraFar; float vz=(cameraNear*cameraFar)/((cameraFar-cameraNear)*z-cameraFar); return -vz; }
        vec3 adjustColor(vec3 color, float contrast, float saturation) {
          color = (color - 0.5) * contrast + 0.5;
          float grey = dot(color, vec3(0.299, 0.587, 0.114));
          color = mix(vec3(grey), color, saturation);
          return color;
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
        vec3 rayDirWorld(){
          vec2 ndc = vUv * 2.0 - 1.0;
          vec4 clip = vec4(ndc, 1.0, 1.0);
          vec4 viewFar = invProjectionMatrix * clip; viewFar /= viewFar.w;
          vec3 dirV = normalize(viewFar.xyz);
          return normalize((cameraMatrixWorld * vec4(dirV, 0.0)).xyz);
        }
        void main(){ vec3 col = texture2D(tDiffuse,vUv).rgb; col *= exposure; float d = readDepth(vUv); if(enabled){ bool bg = d >= cameraFar*0.99; d = min(d, maxDistance); float f = 1.0 - exp(-d * baseDensity); if (bg) { f *= mix(0.3, 1.0, clamp(dayLight,0.0,1.0)); } 
        // Preserve bright highlights like sun glints by reducing fog on bright pixels
        float brightness = max(col.r, max(col.g, col.b));
        float highlightPreserve = 1.0 - smoothstep(0.8, 2.0, brightness);
        f *= highlightPreserve;
        col = mix(col, fogColor, clamp(f,0.0,0.9)); }
        // Extra haze above water at far distance
        if (hazeEnabled) {
          float dV = readDepth(vUv);
          if (dV < cameraFar) {
            vec3 pw = reconstructWorldPos(dV);
            if (pw.y > waterLevel) {
              float dd = max(0.0, dV - hazeStart);
              float hf = 1.0 - exp(-dd * hazeDensity);
              // Boost haze near horizon angles (grazing rays)
              vec3 dw = rayDirWorld();
              float ang = 1.0 - smoothstep(0.12, 0.6, abs(dw.y)); // 1 near horizon, 0 when looking down/up
              hf *= (1.0 + hazeAngleBoost * ang);
              // Boost haze near the water plane within a small band above water
              float p = clamp(1.0 - (pw.y - waterLevel) / max(1e-3, hazePlaneBand), 0.0, 1.0);
              hf *= (1.0 + hazePlaneBoost * p);
              hf = clamp(hf, 0.0, hazeMaxMix);
              col = mix(col, fogColor, hf);
            }
          }
        }
        col = adjustColor(col, contrast, saturation); gl_FragColor = vec4(col,1.0);} 
      `
    })
  }
  setDepthTexture(depth: THREE.DepthTexture){ this.uniforms.tDepth.value = depth }
  setCamera(cam: THREE.PerspectiveCamera){
    this.uniforms.cameraNear.value = cam.near; this.uniforms.cameraFar.value = cam.far
    ;(this.uniforms.invProjectionMatrix.value as THREE.Matrix4).copy(cam.projectionMatrixInverse)
    ;(this.uniforms.cameraMatrixWorld.value as THREE.Matrix4).copy(cam.matrixWorld)
  }
  setSettings({ enabled, baseDensity, maxDistance }: { enabled?: boolean; baseDensity?: number; maxDistance?: number }){ if(enabled!==undefined) this.uniforms.enabled.value = enabled; if(baseDensity!==undefined) this.uniforms.baseDensity.value = baseDensity; if(maxDistance!==undefined) this.uniforms.maxDistance.value = maxDistance }
  setColor(c: THREE.Color){ (this.uniforms.fogColor.value as THREE.Color).copy(c) }
  setDayLight(v: number){ this.uniforms.dayLight.value = THREE.MathUtils.clamp(v,0,1) }
  setColorGrading({ exposure, contrast, saturation }: { exposure?: number; contrast?: number; saturation?: number }){ if(exposure!==undefined) this.uniforms.exposure.value = exposure; if(contrast!==undefined) this.uniforms.contrast.value = contrast; if(saturation!==undefined) this.uniforms.saturation.value = saturation }
  setHorizonHaze(params: { enabled?: boolean; waterLevel?: number; hazeStart?: number; hazeDensity?: number; hazeMaxMix?: number; hazeAngleBoost?: number; hazePlaneBoost?: number; hazePlaneBand?: number }){
    if (params.enabled !== undefined) this.uniforms.hazeEnabled.value = params.enabled
    if (params.waterLevel !== undefined) this.uniforms.waterLevel.value = params.waterLevel
    if (params.hazeStart !== undefined) this.uniforms.hazeStart.value = params.hazeStart
    if (params.hazeDensity !== undefined) this.uniforms.hazeDensity.value = params.hazeDensity
    if (params.hazeMaxMix !== undefined) this.uniforms.hazeMaxMix.value = params.hazeMaxMix
    if (params.hazeAngleBoost !== undefined) this.uniforms.hazeAngleBoost.value = params.hazeAngleBoost
    if (params.hazePlaneBoost !== undefined) this.uniforms.hazePlaneBoost.value = params.hazePlaneBoost
    if (params.hazePlaneBand !== undefined) this.uniforms.hazePlaneBand.value = params.hazePlaneBand
  }
}
