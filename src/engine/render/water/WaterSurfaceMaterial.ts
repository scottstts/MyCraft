import * as THREE from 'three'

export interface WaterSurfaceParams {
  map: THREE.Texture | null
  color?: THREE.Color | number | string
  tileScale?: number // world units per texture tile
  useWorldUV?: boolean // true for world-quad (far ocean), false for block mesh (use vUv)
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
}

export class WaterSurfaceMaterial extends THREE.ShaderMaterial {
  // --- Lightweight global ticker so near-water also animates without engine hooks ---
  private static _instances: Set<WaterSurfaceMaterial> = new Set();
  private static _rafId: number | null = null;
  private static _start: number = performance.now();
  private static _ensureTicker(){
    if (this._rafId !== null) return;
    const tick = () => {
      const t = (performance.now() - this._start) / 1000; // seconds
      for (const inst of this._instances) { try { inst.setTime(t); } catch { /* ignore */ } }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }
  constructor(params: WaterSurfaceParams){
    const color = new THREE.Color(params.color ?? 0x4aa3d8)
    const tileScale = Math.max(1e-3, params.tileScale ?? 1.0)
    const useWorldUV = !!params.useWorldUV
    const b = params.bounds ?? { minX: -1e9, maxX: 1e9, minZ: -1e9, maxZ: 1e9 }
    super({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: color },
        uTime: { value: 0 },
        // Texture inputs are retained for API compatibility, but shader is now fully procedural
        uMap: { value: params.map ?? null },
        uUseMap: { value: false }, // force procedural path regardless of texture availability
        uTileScale: { value: tileScale },
        uUseWorldUV: { value: useWorldUV },
        uInnerMinX: { value: b.minX },
        uInnerMaxX: { value: b.maxX },
        uInnerMinZ: { value: b.minZ },
        uInnerMaxZ: { value: b.maxZ },
        uEdgeStrength: { value: 0.0 },
        uEdgeWidth: { value: 2.0 },
        uAlpha: { value: 1.0 },
        // Water optics + waves
        uFresnel: { value: 0.06 },          // Fresnel strength for rim reflection
        uSpecular: { value: 0.9 },          // Sun glint strength
        uSunDir: { value: new THREE.Vector3(0.35, 0.9, 0.2).normalize() }, // default midday
        uSunColor: { value: new THREE.Color(1.0, 0.98, 0.90) },
        // Gerstner-like wave params
        uWaveAmp: { value: 0.12 },          // base amplitude (normal tilt)
        uChop: { value: 0.8 },              // choppiness (steeper crests)
        uWind: { value: new THREE.Vector2(0.8, 0.4).normalize() },
        uSpeed: { value: 0.8 },             // base phase speed (m/s)
        uL0: { value: 12.0 },               // primary wavelength (m)
        uL1: { value: 6.0 },                // secondary
        uL2: { value: 2.5 },                // micro ripples
        // Sky gradient controls (simple analytic sky for reflections)
        uSkyTop: { value: new THREE.Color(0.32, 0.50, 0.80) },
        uSkyHorizon: { value: new THREE.Color(0.68, 0.78, 0.92) },
      },
      vertexShader: `
        varying vec3 vWorld;
        varying vec2 vUvVary;
        varying vec3 vNormalVary;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vUvVary = uv;
          vNormalVary = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor; uniform float uTime; varying vec3 vWorld;
        varying vec2 vUvVary; varying vec3 vNormalVary;
        uniform float uTileScale; uniform bool uUseWorldUV; // kept for API stability
        uniform float uInnerMinX, uInnerMaxX, uInnerMinZ, uInnerMaxZ;
        uniform float uEdgeStrength; uniform float uEdgeWidth; uniform float uAlpha;
        // Optics
        uniform float uFresnel; uniform float uSpecular; uniform vec3 uSunColor; uniform vec3 uSunDir;
        // Waves
        uniform float uWaveAmp; uniform float uChop; uniform vec2 uWind; uniform float uSpeed; uniform float uL0; uniform float uL1; uniform float uL2;
        // Sky gradient
        uniform vec3 uSkyTop; uniform vec3 uSkyHorizon;

        // Utility noise (small and stable)
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); float a=hash(i); float b=hash(i+vec2(1.0,0.0)); float c=hash(i+vec2(0.0,1.0)); float d=hash(i+vec2(1.0,1.0)); vec2 u=f*f*(3.0-2.0*f); return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y; }

        // Compute Gerstner-style normal from three spectral components
        vec3 waveNormal(vec2 xz, float t){
          // Directions
          vec2 d0 = normalize(uWind);
          vec2 d1 = normalize(vec2(-uWind.y, uWind.x));
          vec2 d2 = normalize(vec2(-0.7*uWind.x + 0.4*uWind.y, 0.6*uWind.x + 0.7*uWind.y));
          float k0 = 6.2831853 / max(1e-3, uL0);
          float k1 = 6.2831853 / max(1e-3, uL1);
          float k2 = 6.2831853 / max(1e-3, uL2);
          float w0 = sqrt(9.8 * k0);
          float w1 = sqrt(9.8 * k1);
          float w2 = sqrt(9.8 * k2);
          float a0 = uWaveAmp;
          float a1 = uWaveAmp * 0.55;
          float a2 = uWaveAmp * 0.22;
          float ch = uChop;

          float p0 = dot(xz, d0) * k0 + t * (uSpeed * w0);
          float p1 = dot(xz, d1) * k1 + t * (0.8*uSpeed * w1);
          float p2 = dot(xz, d2) * k2 + t * (1.2*uSpeed * w2);

          // Height gradients -> normal
          vec2 grad = vec2(0.0);
          grad += d0 * (a0 * k0 * cos(p0));
          grad += d1 * (a1 * k1 * cos(p1));
          grad += d2 * (a2 * k2 * cos(p2));
          // Micro ripples using procedural noise to avoid repetition
          float n = noise(xz * 0.15 + vec2(0.123, -0.271) + t*0.05) * 2.0 - 1.0;
          grad += vec2(n*0.08, -n*0.06);

          vec3 N = normalize(vec3(-grad.x * ch, 1.0, -grad.y * ch));
          return N;
        }

        vec3 skyColor(vec3 dir){
          // Simple analytic sky: horizon brighter, zenith deeper blue.
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0); // -1..1 -> 0..1
          vec3 base = mix(uSkyHorizon, uSkyTop, pow(h, 0.65));
          return base;
        }

        float fresnelSchlick(float cosTheta, float F0){
          return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
        }

        void main(){
          vec3 V = normalize(cameraPosition - vWorld);
          // Stable world UV for waves whether using block UVs or world quads
          vec2 xz = uUseWorldUV ? vWorld.xz : (vWorld.xz * uTileScale);
          float t = uTime;
          vec3 N = waveNormal(xz, t);

          // Reflection from simplified sky
          vec3 R = reflect(-V, N);
          vec3 skyRef = skyColor(R);

          // Base water coloration (absorption): deepen with view angle
          float NdV = max(dot(N, V), 0.0);
          float F = fresnelSchlick(NdV, 0.02 + uFresnel); // small conductor-like F0
          vec3 deep = uColor;
          vec3 base = mix(deep, skyRef, F);

          // Sun specular glint
          vec3 L = normalize(uSunDir);
          float spec = max(dot(R, L), 0.0);
          // Very tight highlight with soft shoulder
          float glint = pow(spec, 220.0) * 0.9 + pow(spec, 32.0) * 0.2;
          vec3 sunGlint = uSunColor * glint * uSpecular;

          vec3 col = base + sunGlint;

          // Optional subtle ocean-only edge softening/brightening
          float outside = max(max(uInnerMinX - vWorld.x, vWorld.x - uInnerMaxX), max(uInnerMinZ - vWorld.z, vWorld.z - uInnerMaxZ));
          float f = uEdgeStrength * smoothstep(0.0, max(uEdgeWidth, 1e-3), outside);
          col = mix(col, vec3(0.88, 0.94, 1.0), f);

          // Tonemap-ish and gamma
          col = col / (col + vec3(1.0));
          col = pow(col, vec3(1.0/2.2));
          gl_FragColor = vec4(col, clamp(uAlpha, 0.0, 1.0));
        }
      `,
    })

    // Register instance for internal ticking
    WaterSurfaceMaterial._instances.add(this)
    WaterSurfaceMaterial._ensureTicker()
  }

  setTime(t: number){ (this.uniforms.uTime.value as number) = t }
  setColor(c: THREE.Color){ (this.uniforms.uColor.value as THREE.Color).copy(c) }
  setMap(tex: THREE.Texture | null){ this.uniforms.uMap.value = tex; this.uniforms.uUseMap.value = false /* procedural only */ }
  setTileScale(s: number){ this.uniforms.uTileScale.value = Math.max(1e-3, s) }
  setUseWorldUV(flag: boolean){ this.uniforms.uUseWorldUV.value = !!flag }
  setBounds(b: { minX: number; maxX: number; minZ: number; maxZ: number }){
    this.uniforms.uInnerMinX.value = b.minX;
    this.uniforms.uInnerMaxX.value = b.maxX;
    this.uniforms.uInnerMinZ.value = b.minZ;
    this.uniforms.uInnerMaxZ.value = b.maxZ;
  }
  setEdge(strength: number, width: number){
    this.uniforms.uEdgeStrength.value = Math.max(0, strength);
    this.uniforms.uEdgeWidth.value = Math.max(0.1, width);
  }
  setAlpha(a: number){
    const alpha = Math.max(0, Math.min(1, a));
    this.uniforms.uAlpha.value = alpha;
    // Depth write only when fully opaque
    this.depthWrite = alpha >= 1.0;
  }
  // Keep old signature for compatibility; now maps to wave/optics tuning
  setRefraction(_strength: number, _eta = 0.75, waveAmp = 0.15, waveScale = 0.035, fresnel = 0.08){
    this.uniforms.uWaveAmp.value = Math.max(0, waveAmp);
    // Map waveScale to wavelengths reasonably
    const s = Math.max(1e-4, waveScale);
    // Use _eta only to keep API parity and satisfy linting; neutralized influence
    const refrScale = 1.0 + 0.0 * (1.0 - _eta);
    this.uniforms.uL0.value = (12.0 / s) * refrScale;
    this.uniforms.uL1.value = (6.0 / s) * refrScale;
    this.uniforms.uL2.value = (2.5 / s) * refrScale;
    this.uniforms.uFresnel.value = Math.max(0, fresnel);
  }

  // Extra tuning knobs for new shader
  setSun(direction: THREE.Vector3, color?: THREE.Color){
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(direction).normalize()
    if (color) (this.uniforms.uSunColor.value as THREE.Color).copy(color)
  }
  setWaves(params: { amp?: number; chop?: number; wind?: THREE.Vector2; speed?: number; L0?: number; L1?: number; L2?: number }){
    if (params.amp !== undefined) this.uniforms.uWaveAmp.value = Math.max(0, params.amp)
    if (params.chop !== undefined) this.uniforms.uChop.value = Math.max(0, params.chop)
    if (params.wind) (this.uniforms.uWind.value as THREE.Vector2).copy(params.wind).normalize()
    if (params.speed !== undefined) this.uniforms.uSpeed.value = Math.max(0, params.speed)
    if (params.L0 !== undefined) this.uniforms.uL0.value = Math.max(1e-3, params.L0)
    if (params.L1 !== undefined) this.uniforms.uL1.value = Math.max(1e-3, params.L1)
    if (params.L2 !== undefined) this.uniforms.uL2.value = Math.max(1e-3, params.L2)
  }

  override dispose(): void {
    super.dispose()
    WaterSurfaceMaterial._instances.delete(this)
    if (!WaterSurfaceMaterial._instances.size && WaterSurfaceMaterial._rafId !== null) {
      cancelAnimationFrame(WaterSurfaceMaterial._rafId)
      WaterSurfaceMaterial._rafId = null
    }
  }
}
