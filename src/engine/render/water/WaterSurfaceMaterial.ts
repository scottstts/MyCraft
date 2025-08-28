import * as THREE from 'three'

export interface WaterSurfaceParams {
  map: THREE.Texture | null
  color?: THREE.Color | number | string
  tileScale?: number // world units per texture tile
  useWorldUV?: boolean // true for world-quad (far ocean), false for block mesh (use vUv)
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
}

export class WaterSurfaceMaterial extends THREE.ShaderMaterial {
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
        uMap: { value: params.map ?? null },
        uUseMap: { value: !!params.map },
        uTileScale: { value: tileScale },
        uUseWorldUV: { value: useWorldUV },
        uInnerMinX: { value: b.minX },
        uInnerMaxX: { value: b.maxX },
        uInnerMinZ: { value: b.minZ },
        uInnerMaxZ: { value: b.maxZ },
        uEdgeStrength: { value: 0.0 },
        uEdgeWidth: { value: 2.0 },
        uAlpha: { value: 1.0 },
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
        uniform sampler2D uMap; uniform bool uUseMap; uniform float uTileScale; uniform bool uUseWorldUV;
        uniform float uInnerMinX, uInnerMaxX, uInnerMinZ, uInnerMaxZ;
        uniform float uEdgeStrength; uniform float uEdgeWidth; uniform float uAlpha;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); float a=hash(i); float b=hash(i+vec2(1.0,0.0)); float c=hash(i+vec2(0.0,1.0)); float d=hash(i+vec2(1.0,1.0)); vec2 u=f*f*(3.0-2.0*f); return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y; }
        vec2 uvY(vec3 w){ return vec2(w.x / uTileScale, -w.z / uTileScale); }
        vec2 uvX(vec3 w){ return vec2(-w.z / uTileScale, w.y / uTileScale); }
        vec2 uvZ(vec3 w){ return vec2(w.x / uTileScale, w.y / uTileScale); }
        vec3 sampleTriPlanar(vec3 wpos, vec3 n){
          vec3 an = abs(normalize(n));
          an = max(an, vec3(1e-4));
          an /= (an.x + an.y + an.z);
          vec3 cx = texture2D(uMap, uvX(wpos)).rgb;
          vec3 cy = texture2D(uMap, uvY(wpos)).rgb;
          vec3 cz = texture2D(uMap, uvZ(wpos)).rgb;
          return cx*an.x + cy*an.y + cz*an.z;
        }
        vec3 sampleWaterColor(){
          if (!uUseMap) {
            vec2 p = vWorld.xz * 0.03;
            float n = noise(p + vec2(uTime*0.03, -uTime*0.02));
            float m = noise(p*2.0 - vec2(uTime*0.06, uTime*0.05));
            float wave = smoothstep(0.35, 0.75, 0.5*n + 0.5*m);
            vec3 hi = mix(uColor, vec3(0.85, 0.93, 1.0), 0.25);
            return mix(uColor, hi, wave * 0.35);
          }
          if (uUseWorldUV) {
            return sampleTriPlanar(vWorld, vNormalVary);
          } else {
            // Fallback to mesh UVs (less ideal for steep angles)
            return texture2D(uMap, vUvVary).rgb;
          }
        }
        void main(){
          vec3 col = sampleWaterColor();
          // Optional subtle ocean-only edge softening (disabled by default)
          float outside = max(max(uInnerMinX - vWorld.x, vWorld.x - uInnerMaxX), max(uInnerMinZ - vWorld.z, vWorld.z - uInnerMaxZ));
          float f = uEdgeStrength * smoothstep(0.0, max(uEdgeWidth, 1e-3), outside);
          col = mix(col, vec3(0.88, 0.94, 1.0), f);
          gl_FragColor = vec4(col, clamp(uAlpha, 0.0, 1.0));
        }
      `,
    })
  }

  setTime(t: number){ (this.uniforms.uTime.value as number) = t }
  setColor(c: THREE.Color){ (this.uniforms.uColor.value as THREE.Color).copy(c) }
  setMap(tex: THREE.Texture | null){ this.uniforms.uMap.value = tex; this.uniforms.uUseMap.value = !!tex }
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
}
