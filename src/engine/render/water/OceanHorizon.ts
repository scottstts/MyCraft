import * as THREE from 'three'

export interface OceanHorizonOptions {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  waterLevel: number
  farDistance: number
  color?: THREE.Color | number | string
  map?: THREE.Texture
  tileScale?: number
}

/**
 * OceanHorizon creates a non-interactive "infinite" ocean illusion by
 * adding four large water quads around the world bounds that extend
 * toward the far plane. These quads sit at water level and fade into fog,
 * visually matching the sky horizon while the player remains bounded.
 */
export class OceanHorizon {
  private group: THREE.Group
  private material: THREE.ShaderMaterial
  private time: number = 0

  constructor(scene: THREE.Scene, opts: OceanHorizonOptions) {
    const color = new THREE.Color(opts.color ?? 0x4aa3d8)
    const tileScale = Math.max(1e-3, opts.tileScale ?? 1.0)

    // Subtle animated color ripples; no displacement to avoid seams at bounds
    this.material = new THREE.ShaderMaterial({
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: color },
        uTime: { value: 0 },
        uInnerMinX: { value: opts.bounds.minX },
        uInnerMaxX: { value: opts.bounds.maxX },
        uInnerMinZ: { value: opts.bounds.minZ },
        uInnerMaxZ: { value: opts.bounds.maxZ },
        uMap: { value: opts.map ?? null },
        uUseMap: { value: !!opts.map },
        uTileScale: { value: tileScale },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor; uniform float uTime; varying vec3 vWorld;
        uniform float uInnerMinX, uInnerMaxX, uInnerMinZ, uInnerMaxZ;
        uniform sampler2D uMap; uniform bool uUseMap; uniform float uTileScale;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f*f*(3.0-2.0*f);
          return mix(a, b, u.x) + (c - a)*u.y*(1.0 - u.x) + (d - b)*u.x*u.y;
        }
        void main(){
          vec3 base = uColor;
          if (uUseMap) {
            // Match voxel water top mapping: u -> +X, v -> -(+Z)
            vec2 tileUV = vec2(fract(vWorld.x / uTileScale), 1.0 - fract(vWorld.z / uTileScale));
            base = texture2D(uMap, tileUV).rgb;
          } else {
            // Gentle animated ripples in color only (fallback)
            vec2 p = vWorld.xz * 0.03;
            float n = noise(p + vec2(uTime*0.03, -uTime*0.02));
            float m = noise(p*2.0 - vec2(uTime*0.06, uTime*0.05));
            float wave = smoothstep(0.35, 0.75, 0.5*n + 0.5*m);
            vec3 hi2 = mix(base, vec3(0.85, 0.93, 1.0), 0.25);
            base = mix(base, hi2, wave * 0.35);
          }
          vec3 col = base;
          // Gentle inner-edge blend to better match near voxel water
          float dx = min(abs(vWorld.x - uInnerMinX), abs(vWorld.x - uInnerMaxX));
          float dz = min(abs(vWorld.z - uInnerMinZ), abs(vWorld.z - uInnerMaxZ));
          float d = min(dx, dz);
          float edgeBlend = clamp(1.0 - exp(-d * 0.12), 0.0, 1.0);
          // Slight lightening near the edge (reduces seam contrast)
          col = mix(col * 0.98, vec3(0.85, 0.93, 1.0), (1.0 - edgeBlend) * 0.2);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })

    this.group = new THREE.Group()
    this.group.name = 'OceanHorizon'

    const { minX, maxX, minZ, maxZ } = opts.bounds
    const y = opts.waterLevel + 1.0 - 0.001 // align to water surface height
    const pad = 0.0 // keep inner edges exact to avoid z-fighting with world
    const far = Math.max(opts.farDistance, 1)

    // Build four outward bands: North(-Z), South(+Z), West(-X), East(+X)
    const bands: Array<{ x0:number,x1:number,z0:number,z1:number }> = [
      // North band
      { x0: minX - far, x1: maxX + far, z0: minZ - far, z1: minZ + pad },
      // South band
      { x0: minX - far, x1: maxX + far, z0: maxZ - pad, z1: maxZ + far },
      // West band
      { x0: minX - far, x1: minX + pad, z0: minZ - far, z1: maxZ + far },
      // East band
      { x0: maxX - pad, x1: maxX + far, z0: minZ - far, z1: maxZ + far },
    ]

    for (const b of bands) {
      const mesh = new THREE.Mesh(this.makeQuad(b.x0, b.z0, b.x1, b.z1, y), this.material)
      mesh.frustumCulled = true
      this.group.add(mesh)
    }

    scene.add(this.group)
  }

  private makeQuad(x0: number, z0: number, x1: number, z1: number, y: number): THREE.BufferGeometry {
    // Two triangles forming a rectangle on the XZ plane at y
    const positions = new Float32Array([
      x0, y, z0,
      x1, y, z0,
      x1, y, z1,
      x0, y, z0,
      x1, y, z1,
      x0, y, z1,
    ])
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }

  setColor(c: THREE.Color){ this.material.uniforms.uColor.value.copy(c) }
  setMap(tex: THREE.Texture | null, tileScale = 1.0){
    this.material.uniforms.uMap.value = tex;
    this.material.uniforms.uUseMap.value = !!tex;
    this.material.uniforms.uTileScale.value = Math.max(1e-3, tileScale);
  }

  update(dt: number){
    this.time += dt
    this.material.uniforms.uTime.value = this.time
  }

  dispose(scene: THREE.Scene){
    scene.remove(this.group)
    this.group.traverse((obj) => {
      const m = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (m) {
        const mats = Array.isArray(m) ? m : [m]
        mats.forEach(mm => mm.dispose())
      }
      const g = (obj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
      g?.dispose()
    })
  }
}
