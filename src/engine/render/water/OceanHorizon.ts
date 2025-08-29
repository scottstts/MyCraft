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

    // Geometry: four strips around the world bounds, extending toward far plane
    // Inner edge heights sampled from world generator to be seamless with real terrain
    const { minX, maxX, minZ, maxZ } = opts.bounds
    const seed = opts.seed ?? 12345
    const worldRadius = opts.worldRadius ?? 200
    const far = Math.max(opts.farDistance, 1)

    this.seabedGroup = new THREE.Group()
    this.seabedGroup.name = 'SeabedHorizon'

    const step = CHUNK_SIZE.x // sample once per chunk along each edge

    // North edge (minZ): runs along X
    this.seabedGroup.add(
      this.buildSeabedStrip({
        startA: new THREE.Vector3(minX, 0, minZ),
        endA:   new THREE.Vector3(maxX, 0, minZ),
        startB: new THREE.Vector3(minX, 0, minZ - far),
        endB:   new THREE.Vector3(maxX, 0, minZ - far),
        sampleAlong: 'x',
        step,
        seed,
        worldRadius,
      })
    )
    // South edge (maxZ): runs along X
    this.seabedGroup.add(
      this.buildSeabedStrip({
        startA: new THREE.Vector3(minX, 0, maxZ),
        endA:   new THREE.Vector3(maxX, 0, maxZ),
        startB: new THREE.Vector3(minX, 0, maxZ + far),
        endB:   new THREE.Vector3(maxX, 0, maxZ + far),
        sampleAlong: 'x',
        step,
        seed,
        worldRadius,
      })
    )
    // West edge (minX): runs along Z
    this.seabedGroup.add(
      this.buildSeabedStrip({
        startA: new THREE.Vector3(minX, 0, minZ),
        endA:   new THREE.Vector3(minX, 0, maxZ),
        startB: new THREE.Vector3(minX - far, 0, minZ),
        endB:   new THREE.Vector3(minX - far, 0, maxZ),
        sampleAlong: 'z',
        step,
        seed,
        worldRadius,
      })
    )
    // East edge (maxX): runs along Z
    this.seabedGroup.add(
      this.buildSeabedStrip({
        startA: new THREE.Vector3(maxX, 0, minZ),
        endA:   new THREE.Vector3(maxX, 0, maxZ),
        startB: new THREE.Vector3(maxX + far, 0, minZ),
        endB:   new THREE.Vector3(maxX + far, 0, maxZ),
        sampleAlong: 'z',
        step,
        seed,
        worldRadius,
      })
    )

    // Ensure seabed renders before transparent water (opaque render path)
    this.seabedGroup.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (mesh && mesh.material) {
        mesh.renderOrder = 0 // default; draw with other opaque
      }
    })

    scene.add(this.seabedGroup)
  }

  private buildSeabedStrip(params: {
    startA: THREE.Vector3; // inner edge start
    endA: THREE.Vector3;   // inner edge end
    startB: THREE.Vector3; // far edge start
    endB: THREE.Vector3;   // far edge end
    sampleAlong: 'x' | 'z';
    step: number;
    seed: number;
    worldRadius: number;
  }): THREE.Mesh {
    const { startA, endA, startB, endB, sampleAlong, step, seed, worldRadius } = params

    // Build a strip segmented along the inner edge to match real seabed heights
    const axisLen = sampleAlong === 'x' ? (endA.x - startA.x) : (endA.z - startA.z)
    const dir = axisLen >= 0 ? 1 : -1
    const totalLen = Math.abs(axisLen)
    const nSeg = Math.max(1, Math.ceil(totalLen / Math.max(1, step)))
    const segSize = totalLen / nSeg

    // Precompute inner heights along samples
    const innerSamples: Array<{ x: number; z: number; y: number }> = []
    for (let i = 0; i <= nSeg; i++) {
      const t = i / nSeg
      const x = THREE.MathUtils.lerp(startA.x, endA.x, t)
      const z = THREE.MathUtils.lerp(startA.z, endA.z, t)
      const h = getHeightAtPosition(x, z, seed, worldRadius)
      // Match top surface of voxel column (top face is at height + 1)
      innerSamples.push({ x, z, y: h + 1 })
    }
    // Far edge height: smooth average of inner heights to avoid sharp slopes
    const avgY = innerSamples.reduce((s, p) => s + p.y, 0) / innerSamples.length
    const farY = avgY

    // Build buffers
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    let vtx = 0

    for (let i = 0; i < nSeg; i++) {
      // Segment endpoints on inner edge
      const a0 = innerSamples[i]
      const a1 = innerSamples[i + 1]
      // Corresponding points on far edge (same parametric t, constant farY)
      const t0 = i / nSeg
      const t1 = (i + 1) / nSeg
      const b0 = new THREE.Vector3(
        THREE.MathUtils.lerp(startB.x, endB.x, t0),
        farY,
        THREE.MathUtils.lerp(startB.z, endB.z, t0),
      )
      const b1 = new THREE.Vector3(
        THREE.MathUtils.lerp(startB.x, endB.x, t1),
        farY,
        THREE.MathUtils.lerp(startB.z, endB.z, t1),
      )

      // Two triangles per segment: a0-a1-b1 and a0-b1-b0
      const quad = [
        new THREE.Vector3(a0.x, a0.y, a0.z),
        new THREE.Vector3(a1.x, a1.y, a1.z),
        b1,
        new THREE.Vector3(a0.x, a0.y, a0.z),
        b1,
        b0,
      ]
      for (const p of quad) {
        positions.push(p.x, p.y, p.z)
        // Upward normal to match top faces of blocks (saves GPU and matches sand tops)
        normals.push(0, 1, 0)
        // World-based UVs so tiles align with block grid (1 repeat per block)
        // Match top-face UV orientation: U along +X, V along -Z to be consistent with mesher
        uvs.push(p.x, -p.z)
      }
      indices.push(vtx, vtx + 1, vtx + 2, vtx + 3, vtx + 4, vtx + 5)
      vtx += 6
    }

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geom.setIndex(indices)
    geom.computeBoundingBox()
    geom.computeBoundingSphere()

    const mesh = new THREE.Mesh(geom, this.seabedMaterial as THREE.Material)
    mesh.frustumCulled = true
    // Draw before transparent water
    mesh.renderOrder = 0
    return mesh
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
