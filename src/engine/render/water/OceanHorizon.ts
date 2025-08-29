import * as THREE from 'three'
import { WaterSurfaceMaterial } from './WaterSurfaceMaterial'
import { BlockMaterial } from '../BlockMaterial'
import { CHUNK_SIZE } from '../../../config/constants'
import { getHeightAtPosition } from '../../world/TerrainGenerator'

export interface OceanHorizonOptions {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  waterLevel: number
  farDistance: number
  color?: THREE.Color | number | string
  map?: THREE.Texture
  tileScale?: number
  // For seabed horizon (fake infinite ocean floor)
  enableSeabed?: boolean
  /** World generation seed for sampling coast/ocean floor at the world edge */
  seed?: number
  /** Estimated world radius used by height sampling */
  worldRadius?: number
  /** Source block material to sync lighting/shadows so seabed matches terrain sand */
  blockMaterialSource?: BlockMaterial
}

/**
 * OceanHorizon creates a non-interactive "infinite" ocean illusion by
 * adding four large quads around the world bounds that extend toward the far plane.
 * Uses the same water material as terrain water for a perfect visual match.
 */
export class OceanHorizon {
  private group: THREE.Group
  private material: WaterSurfaceMaterial
  private time: number = 0
  // Seabed (fake ocean floor) resources
  private seabedMaterial: BlockMaterial | null = null
  private seabedGroup: THREE.Group | null = null
  private blockMaterialSource: BlockMaterial | null = null

  constructor(scene: THREE.Scene, opts: OceanHorizonOptions) {
    this.group = new THREE.Group()
    this.group.name = 'OceanHorizon'

    // Shared water material configured for world UV mapping
    this.material = new WaterSurfaceMaterial({
      map: opts.map ?? null,
      color: opts.color,
      tileScale: opts.tileScale ?? 1.0,
      useWorldUV: true,
      bounds: opts.bounds,
    })
    // Match translucency and refraction of terrain water for visual consistency
    this.material.setAlpha(0.7)
    this.material.setRefraction(0.18, 0.75, 0.12, 0.035, 0.06)

    const { minX, maxX, minZ, maxZ } = opts.bounds
    const y = opts.waterLevel + 1.0 - 0.001 // align to water surface height
    const pad = 0.0 // keep inner edges exact to avoid z-fighting with world
    const far = Math.max(opts.farDistance, 1)

    // Build 8 tiles around the center bounds (tic-tac-toe layout minus center)
    const tiles: Array<{ x0:number,x1:number,z0:number,z1:number }> = [
      // Top row (north)
      { x0: minX,       x1: maxX,       z0: minZ - far, z1: minZ + pad }, // top-middle
      { x0: minX - far, x1: minX + pad, z0: minZ - far, z1: minZ + pad }, // top-left corner
      { x0: maxX - pad, x1: maxX + far, z0: minZ - far, z1: minZ + pad }, // top-right corner
      // Middle row (west/east)
      { x0: minX - far, x1: minX + pad, z0: minZ,       z1: maxZ       }, // left-middle
      { x0: maxX - pad, x1: maxX + far, z0: minZ,       z1: maxZ       }, // right-middle
      // Bottom row (south)
      { x0: minX,       x1: maxX,       z0: maxZ - pad, z1: maxZ + far }, // bottom-middle
      { x0: minX - far, x1: minX + pad, z0: maxZ - pad, z1: maxZ + far }, // bottom-left corner
      { x0: maxX - pad, x1: maxX + far, z0: maxZ - pad, z1: maxZ + far }, // bottom-right corner
    ]

    for (const t of tiles) {
      const mesh = new THREE.Mesh(this.makeQuad(t.x0, t.z0, t.x1, t.z1, y), this.material)
      mesh.frustumCulled = true
      // Draw after chunk transparent water to match terrain water blending
      mesh.renderOrder = 2
      this.group.add(mesh)
    }

    scene.add(this.group)

    // Optionally build the fake infinite seabed to visually continue the ocean floor
    if (opts.enableSeabed) {
      this.blockMaterialSource = opts.blockMaterialSource ?? null
      this.buildSeabed(scene, opts)
    }
  }

  private makeQuad(x0: number, z0: number, x1: number, z1: number, y: number): THREE.BufferGeometry {
    const positions = new Float32Array([
      x0, y, z0,
      x1, y, z0,
      x1, y, z1,
      x0, y, z0,
      x1, y, z1,
      x0, y, z1,
    ])
    
    // Add UV coordinates to match terrain water block behavior
    const uvs = new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 0,
      1, 1,
      0, 1,
    ])
    
    // Add normals pointing up (same as terrain water top faces)
    const normals = new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ])
    
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }

  setColor(c: THREE.Color){ this.material.setColor(c) }
  setMap(tex: THREE.Texture | null, tileScale = 1.0){
    this.material.setMap(tex)
    this.material.setTileScale(tileScale)
  }

  update(dt: number){
    this.time += dt
    this.material.setTime(this.time)
    // Keep seabed material uniforms in sync with terrain block material for a perfect match
    if (this.seabedMaterial && this.blockMaterialSource) {
      this.syncSeabedUniforms(this.blockMaterialSource)
    }
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
    if (this.seabedGroup) {
      scene.remove(this.seabedGroup)
      this.seabedGroup.traverse((obj) => {
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

  // --- Seabed horizon implementation ---
  private async buildSeabed(scene: THREE.Scene, opts: OceanHorizonOptions) {
    const sandTex = await this.loadSandTexture()
    // Configure repeat so UVs based on world units tile naturally
    sandTex.wrapS = THREE.RepeatWrapping
    sandTex.wrapT = THREE.RepeatWrapping
    sandTex.colorSpace = THREE.SRGBColorSpace
    sandTex.magFilter = THREE.NearestFilter
    sandTex.minFilter = THREE.LinearMipMapLinearFilter
    sandTex.generateMipmaps = true
    sandTex.needsUpdate = true

    // Material: reuse BlockMaterial shader for identical look to terrain sand
    this.seabedMaterial = new BlockMaterial(sandTex, null)
    // Use same roughness/metalness/env intensity as terrain default
    this.seabedMaterial.setMaterialProperties(0.8, 0.0, 0.3)

    // If we have a source block material, immediately sync key uniforms (and will continue per-frame)
    if (this.blockMaterialSource) {
      this.syncSeabedUniforms(this.blockMaterialSource)
    }

    // Geometry: build 8 tiles around the world bounds (tic-tac-toe minus center)
    // All tiles lie at a single height sampled from the real seabed along the world edge.
    const { minX, maxX, minZ, maxZ } = opts.bounds
    const seed = opts.seed ?? 12345
    const worldRadius = opts.worldRadius ?? Math.max(maxX - minX, maxZ - minZ) / 2
    const far = Math.max(opts.farDistance, 1)

    // Determine uniform seabed height to use for all fake tiles
    const yEdge = this.sampleEdgeSeabedHeight({ bounds: opts.bounds, seed, worldRadius })
    this.seabedGroup = new THREE.Group()
    this.seabedGroup.name = 'SeabedHorizon'

    const quads: Array<{ x0:number, x1:number, z0:number, z1:number }> = [
    // Top row (north)
    { x0: minX,       x1: maxX,       z0: minZ - far, z1: minZ       }, // top-middle
    { x0: minX - far, x1: minX,       z0: minZ - far, z1: minZ       }, // top-left corner
    { x0: maxX,       x1: maxX + far, z0: minZ - far, z1: minZ       }, // top-right corner
    // Middle row (west/east)
    { x0: minX - far, x1: minX,       z0: minZ,       z1: maxZ       }, // left-middle
    { x0: maxX,       x1: maxX + far, z0: minZ,       z1: maxZ       }, // right-middle
    // Bottom row (south)
    { x0: minX,       x1: maxX,       z0: maxZ,       z1: maxZ + far }, // bottom-middle
    { x0: minX - far, x1: minX,       z0: maxZ,       z1: maxZ + far }, // bottom-left corner
    { x0: maxX,       x1: maxX + far, z0: maxZ,       z1: maxZ + far }, // bottom-right corner
  ]

  for (const q of quads) {
    const geom = this.makeQuadWorldUV(q.x0, q.z0, q.x1, q.z1, yEdge)
    const mesh = new THREE.Mesh(geom, this.seabedMaterial as THREE.Material)
    mesh.frustumCulled = true
    mesh.renderOrder = 0 // opaque
    this.seabedGroup.add(mesh)
  }
    scene.add(this.seabedGroup)
  }

  private makeQuadWorldUV(x0: number, z0: number, x1: number, z1: number, y: number): THREE.BufferGeometry {
    const positions = new Float32Array([
    x0, y, z0,
    x0, y, z1,
    x1, y, z1,
    x0, y, z0,
    x1, y, z1,
    x1, y, z0,
   ])
    // World-space UVs so the sand texture tiles per block and aligns with terrain
    const uvs = new Float32Array([
      x0, -z0,
      x0, -z1,
      x1, -z1,
      x0, -z0,
      x1, -z1,
      x1, -z0,
    ])
    const normals = new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ])
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }

  private sampleEdgeSeabedHeight(params: { bounds: { minX:number; maxX:number; minZ:number; maxZ:number }, seed:
    number, worldRadius: number }): number {
    const { minX, maxX, minZ, maxZ } = params.bounds
    const { seed, worldRadius } = params
    // Sample at a resolution tied to chunk size, but not too sparse
    const step = Math.max(4, Math.floor(Math.min(CHUNK_SIZE.x, CHUNK_SIZE.z) / 2))
    const heights: number[] = []
    
    // Sample just outside the world bounds to match the seam closely
    const oceanOffset = Math.max(1, Math.floor(Math.min(CHUNK_SIZE.x, CHUNK_SIZE.z) / 8))
    
    // North ocean edge: z = minZ - oceanOffset
    for (let x = minX; x <= maxX; x += step) {
      const h = getHeightAtPosition(x, minZ - oceanOffset, seed, worldRadius)
      heights.push(h)
    }
    // South ocean edge: z = maxZ + oceanOffset  
    for (let x = minX; x <= maxX; x += step) {
      const h = getHeightAtPosition(x, maxZ + oceanOffset, seed, worldRadius)
      heights.push(h)
    }
    // West ocean edge: x = minX - oceanOffset
    for (let z = minZ; z <= maxZ; z += step) {
      const h = getHeightAtPosition(minX - oceanOffset, z, seed, worldRadius)
      heights.push(h)
    }
    // East ocean edge: x = maxX + oceanOffset
    for (let z = minZ; z <= maxZ; z += step) {
      const h = getHeightAtPosition(maxX + oceanOffset, z, seed, worldRadius)
      heights.push(h)
    }
    
    // Choose a robust lower-bound estimate near the seam (25th percentile)
    let y: number
    if (heights.length) {
      heights.sort((a, b) => a - b)
      const idx = Math.max(0, Math.min(heights.length - 1, Math.floor(heights.length * 0.25)))
      y = heights[idx]
    } else {
      // Dynamic fallback: sample one representative point just outside bounds
      y = getHeightAtPosition(maxX + oceanOffset, minZ - oceanOffset, seed, worldRadius)
    }
    // Tiny bias down to avoid z-fighting at the seam
    return y - 0.001
  }

  private loadSandTexture(): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load('/src/assets/textures/sand.png', (tex) => resolve(tex), undefined, reject)
    })
  }

  private syncSeabedUniforms(src: BlockMaterial) {
    if (!this.seabedMaterial) return
    const dst = this.seabedMaterial
    const su = (src as any).uniforms as Record<string, { value: unknown }>
    const du = (dst as any).uniforms as Record<string, { value: unknown }>
    // Copy core lighting/shadow/time uniforms so appearance matches blocks exactly
    const keys = [
      'sunDirection','sunColor','dayLight','starLight',
      'shadowMap0','shadowMap1','shadowMap2','shadowMap3',
      'shadowMatrix0','shadowMatrix1','shadowMatrix2','shadowMatrix3',
      'shadowCascades','shadowDistances','shadowSoftness','shadowBias','shadowNormalBias','shadowIntensity','shadowResolution','shadowBlendFraction',
      'cloudShadowEnabled','cloudShadowIntensity','cloudShadowAltitude','cloudShadowScale','cloudCoverage','cloudDensity','cloudWind',
      'time','materialFogEnabled'
    ]
    for (const k of keys) {
      if (su[k] && du[k]) du[k].value = su[k].value
    }
  }
}
