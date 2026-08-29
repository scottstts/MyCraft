import * as THREE from 'three'
import { BlockMaterial } from '../BlockMaterial'
import { CHUNK_SIZE } from '../../../config/constants'
import { getHeightAtPosition } from '../../world/TerrainGenerator'
import { getOceanMaxAmplitude, OCEAN_WATER_CENTER_OFFSET, sampleOceanHeight } from './OceanWaveField'
import { WaterSurfaceMaterial } from './WaterSurfaceMaterial'
import { CAUSTIC_TILE_SIZE, WaterCaustics } from './WaterCaustics'
import sandTextureUrl from '../../../assets/textures/sand.png'

const TERRAIN_HEIGHT_TEXTURE_SCALE = 128
// Keep the surface material on one optical side until the camera is clearly
// across the interface. UnderwaterPass blends the participating medium over
// this same band, so the material branch cannot flip while the view is still
// visibly split by the waterline.
const CAMERA_OPTICS_THRESHOLD = 0.65

function createTerrainHeightTexture(
  bounds: WaterSystemOptions['bounds'],
  seed: number,
  worldRadius: number,
): THREE.DataTexture {
  const spanX = Math.max(1, bounds.maxX - bounds.minX)
  const spanZ = Math.max(1, bounds.maxZ - bounds.minZ)
  const desiredResolution = Math.ceil(Math.max(spanX, spanZ) / 1.5)
  let resolution = 64
  while (resolution < desiredResolution && resolution < 256) resolution *= 2
  const data = new Uint8Array(resolution * resolution * 4)
  for (let z = 0; z < resolution; z += 1) {
    const worldZ = bounds.minZ + ((z + 0.5) / resolution) * spanZ
    for (let x = 0; x < resolution; x += 1) {
      const worldX = bounds.minX + ((x + 0.5) / resolution) * spanX
      const height = getHeightAtPosition(worldX, worldZ, seed, worldRadius)
      const encoded = Math.round(THREE.MathUtils.clamp(height / TERRAIN_HEIGHT_TEXTURE_SCALE, 0, 1) * 255)
      const index = (z * resolution + x) * 4
      data[index] = encoded
      data[index + 1] = encoded
      data[index + 2] = encoded
      data[index + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export interface WaterSystemOptions {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  waterLevel: number
  farDistance: number
  seed: number
  worldRadius: number
  color?: THREE.Color | number | string
  blockMaterialSource?: BlockMaterial
  anisotropy?: number
  /** WebGL renderer used for the render-only differential-area caustic map. */
  renderer?: THREE.WebGLRenderer
}

type Vec3Tuple = [number, number, number]

/**
 * Render-only water owner.  It deliberately does not own World, chunks,
 * collision, selection, saves, or player movement.  The ocean plane and the
 * visual seabed are entirely outside the gameplay data model.
 */
export class WaterSystem {
  private readonly scene: THREE.Scene
  private readonly options: WaterSystemOptions
  private readonly group: THREE.Group
  private readonly oceanGroup: THREE.Group
  private readonly material: WaterSurfaceMaterial
  private readonly terrainHeightTexture: THREE.DataTexture
  private readonly caustics: WaterCaustics | null
  private seabedMaterial: BlockMaterial | null = null
  private seabedGroup: THREE.Group | null = null
  private time = 0
  private disposed = false
  private seabedBuildToken = 0
  private cameraUnderwater = false
  private sceneColor: THREE.Texture | null = null
  private sceneDepth: THREE.Texture | null = null
  private resolution = new THREE.Vector2(1, 1)
  private cameraNear = 0.1
  private cameraFar = 1024

  constructor(scene: THREE.Scene, options: WaterSystemOptions) {
    this.scene = scene
    this.options = options
    this.group = new THREE.Group()
    this.group.name = 'WaterSystem'
    this.oceanGroup = new THREE.Group()
    this.oceanGroup.name = 'OceanSurface'
    this.group.add(this.oceanGroup)

    // The water shader needs the same terrain height field that defines the
    // playable shoreline. This keeps foam on shallow coast water instead of
    // guessing from the rectangular map boundary.
    this.terrainHeightTexture = createTerrainHeightTexture(options.bounds, options.seed, options.worldRadius)

    const surfaceY = options.waterLevel + OCEAN_WATER_CENTER_OFFSET
    this.material = new WaterSurfaceMaterial({
      map: null,
      color: options.color ?? 0x1a6f8e,
      tileScale: 1,
      useWorldUV: true,
      bounds: options.bounds,
      ocean: true,
      terrainHeightMap: this.terrainHeightTexture,
      terrainHeightScale: TERRAIN_HEIGHT_TEXTURE_SCALE,
    })
    this.material.setWaterLevel(surfaceY)
    this.material.setRefraction(0.18, 1.0 / 1.333, 1.0, 1.0, 0.0)
    this.material.setAlpha(1)

    let caustics: WaterCaustics | null = null
    if (options.renderer) {
      try {
        caustics = new WaterCaustics(options.renderer, {
          resolution: 256,
          extent: CAUSTIC_TILE_SIZE,
          patchExtent: CAUSTIC_TILE_SIZE * 1.35,
          projectDepth: 24,
        })
      } catch (error) {
        console.warn('[WaterSystem] Differential-area caustics unavailable:', error)
      }
    }
    this.caustics = caustics

    const far = Math.max(128, options.farDistance)
    const innerSize = Math.min(512, Math.max(256, far * 0.42))
    const outerSize = far * 2.05
    const innerSegments = innerSize <= 320 ? 128 : 160
    // Keep the horizon strips sampled often enough that long swells do not
    // collapse into broad, parallel quads.  Their shader still fades the
    // shortest detail by footprint; this budget only preserves the cascade's
    // large directional shape at distance.
    const outerSegments = Math.max(64, Math.min(192, Math.ceil(outerSize / 10)))

    const inner = new THREE.Mesh(this.createGridGeometry(innerSize, innerSegments), this.material)
    inner.name = 'OceanSurfaceInner'
    inner.renderOrder = 2
    inner.frustumCulled = false
    this.oceanGroup.add(inner)

    const innerHalf = innerSize * 0.5
    const outerHalf = outerSize * 0.5
    const strips: Array<{ x0: number; z0: number; x1: number; z1: number; nx: number; nz: number; name: string }> = [
      { x0: -outerHalf, z0: innerHalf, x1: outerHalf, z1: outerHalf, nx: outerSegments, nz: Math.max(4, Math.ceil((outerHalf - innerHalf) / 16)), name: 'OceanSurfaceNorth' },
      { x0: -outerHalf, z0: -outerHalf, x1: outerHalf, z1: -innerHalf, nx: outerSegments, nz: Math.max(4, Math.ceil((outerHalf - innerHalf) / 16)), name: 'OceanSurfaceSouth' },
      { x0: -outerHalf, z0: -innerHalf, x1: -innerHalf, z1: innerHalf, nx: Math.max(4, Math.ceil((outerHalf - innerHalf) / 16)), nz: Math.max(4, Math.ceil(innerSize / 16)), name: 'OceanSurfaceWest' },
      { x0: innerHalf, z0: -innerHalf, x1: outerHalf, z1: innerHalf, nx: Math.max(4, Math.ceil((outerHalf - innerHalf) / 16)), nz: Math.max(4, Math.ceil(innerSize / 16)), name: 'OceanSurfaceEast' },
    ]
    for (const strip of strips) {
      const mesh = new THREE.Mesh(this.createRectGeometry(strip.x0, strip.z0, strip.x1, strip.z1, strip.nx, strip.nz), this.material)
      mesh.name = strip.name
      mesh.renderOrder = 2
      mesh.frustumCulled = false
      this.oceanGroup.add(mesh)
    }

    this.oceanGroup.position.y = surfaceY
    this.group.position.y = 0
    scene.add(this.group)
    void this.buildSeabed(++this.seabedBuildToken)
  }

  /** Centerline of the visual one-voxel water envelope (bottom + 0.5). */
  get surfaceY(): number { return this.options.waterLevel + OCEAN_WATER_CENTER_OFFSET }

  getTime(): number { return this.time }

  isCameraUnderwater(): boolean { return this.cameraUnderwater }

  getCausticTexture(): THREE.Texture | null { return this.caustics?.getTexture() ?? null }

  getCausticOrigin(): { x: number; y: number } { return this.caustics?.getOrigin() ?? { x: 0, y: 0 } }

  getCausticExtent(): number { return this.caustics?.getExtent() ?? 256 }

  getCausticResolution(): { x: number; y: number } { return this.caustics?.getResolution() ?? { x: 1, y: 1 } }

  setSeed(seed: number): void {
    if (this.options.seed === seed || this.disposed) return
    this.options.seed = seed
    this.updateTerrainHeightTexture()
    this.seabedBuildToken += 1
    if (this.seabedGroup) {
      this.scene.remove(this.seabedGroup)
      this.disposeGroup(this.seabedGroup)
      this.seabedGroup = null
    }
    this.seabedMaterial?.dispose()
    this.seabedMaterial = null
    void this.buildSeabed(this.seabedBuildToken)
  }

  setOpaqueCaptureMode(hidden: boolean): void { this.oceanGroup.visible = !hidden }

  setSceneInputs(sceneColor: THREE.Texture | null, sceneDepth: THREE.Texture | null, resolution: { x: number; y: number }, cameraNear: number, cameraFar: number): void {
    this.sceneColor = sceneColor
    this.sceneDepth = sceneDepth
    this.resolution.set(Math.max(1, Math.floor(resolution.x)), Math.max(1, Math.floor(resolution.y)))
    this.cameraNear = cameraNear
    this.cameraFar = cameraFar
    this.material.setSceneInputs(sceneColor, sceneDepth, this.resolution, cameraNear, cameraFar)
  }

  setSun(direction: THREE.Vector3, color?: THREE.Color): void {
    this.material.setSun(direction, color)
    this.caustics?.setSun(direction)
    if (this.seabedMaterial) this.seabedMaterial.setSunUniforms(direction, color ?? new THREE.Color(1, 1, 1))
  }

  setAmbientLighting(intensity: number, nightTint?: THREE.Color): void {
    this.material.setAmbientLighting(intensity, nightTint)
    if (this.seabedMaterial) this.seabedMaterial.setDayLight(intensity)
  }

  setSkyColors(topColor: THREE.Color, horizonColor: THREE.Color): void { this.material.setSkyColors(topColor, horizonColor) }

  setSkyAtmosphere(aerosol: THREE.Color, strength: number, radianceScale = 1.25): void {
    this.material.setSkyAtmosphere(aerosol, strength, radianceScale)
  }

  setDebugMode(mode: number): void { this.material.setDebugMode(mode) }

  update(deltaSeconds: number, camera: THREE.PerspectiveCamera): void {
    if (this.disposed) return
    this.time += Math.min(0.1, Math.max(0, deltaSeconds))
    this.material.setTime(this.time)
    this.material.setWaterLevel(this.surfaceY)

    // Follow the camera on a stable 16-block grid.  Absolute world XZ is used
    // in the shader, so moving the mesh cannot make waves swim underfoot.
    const snap = 16
    this.oceanGroup.position.x = Math.floor(camera.position.x / snap) * snap
    this.oceanGroup.position.z = Math.floor(camera.position.z / snap) * snap

    const waveSurface = this.surfaceY + sampleOceanHeight(camera.position.x, camera.position.z, this.time)
    this.cameraUnderwater = camera.position.y < waveSurface - CAMERA_OPTICS_THRESHOLD
    this.material.setCameraUnderwater(this.cameraUnderwater)

    this.syncSeabedMaterial()
    if (this.caustics) {
      this.caustics.update(this.time, camera.position.x, camera.position.z)
      this.applyCaustics()
    }
  }

  getDiagnostics(): Record<string, unknown> {
    const seabedMeshes = this.seabedGroup?.children.filter((child) => child instanceof THREE.Mesh) ?? []
    return {
      time: this.time,
      cameraUnderwater: this.cameraUnderwater,
      surfaceY: this.surfaceY,
      maxWaveAmplitude: getOceanMaxAmplitude(),
      oceanMeshes: this.oceanGroup.children.length,
      seabedReady: !!this.seabedGroup,
      seabedMeshes: seabedMeshes.length,
      caustics: this.caustics?.getDiagnostics() ?? null,
      sceneInputs: { color: !!this.sceneColor, depth: !!this.sceneDepth, resolution: this.resolution.toArray(), near: this.cameraNear, far: this.cameraFar },
    }
  }

  dispose(): void {
    this.disposed = true
    this.seabedBuildToken += 1
    this.scene.remove(this.group)
    this.disposeGroup(this.group)
    if (this.seabedGroup) this.disposeGroup(this.seabedGroup)
    this.material.dispose()
    this.terrainHeightTexture.dispose()
    this.seabedMaterial?.dispose()
    this.caustics?.dispose()
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
    })
  }

  private createGridGeometry(size: number, segments: number): THREE.BufferGeometry {
    return this.createRectGeometry(-size * 0.5, -size * 0.5, size * 0.5, size * 0.5, segments, segments)
  }

  private createRectGeometry(x0: number, z0: number, x1: number, z1: number, nx: number, nz: number): THREE.BufferGeometry {
    const positions = new Float32Array((nx + 1) * (nz + 1) * 3)
    const normals = new Float32Array((nx + 1) * (nz + 1) * 3)
    const uvs = new Float32Array((nx + 1) * (nz + 1) * 2)
    let p = 0
    let n = 0
    let uv = 0
    for (let j = 0; j <= nz; j += 1) {
      const tz = j / nz
      const z = THREE.MathUtils.lerp(z0, z1, tz)
      for (let i = 0; i <= nx; i += 1) {
        const tx = i / nx
        const x = THREE.MathUtils.lerp(x0, x1, tx)
        positions[p++] = x
        positions[p++] = 0
        positions[p++] = z
        normals[n++] = 0
        normals[n++] = 1
        normals[n++] = 0
        uvs[uv++] = x
        uvs[uv++] = z
      }
    }
    const indices = new Uint32Array(nx * nz * 6)
    let index = 0
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const a = j * (nx + 1) + i
        const b = a + 1
        const c = a + nx + 1
        const d = c + 1
        indices[index++] = a
        indices[index++] = c
        indices[index++] = b
        indices[index++] = b
        indices[index++] = c
        indices[index++] = d
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.computeBoundingSphere()
    return geometry
  }

  private async buildSeabed(buildToken: number): Promise<void> {
    try {
      const sand = await new Promise<THREE.Texture>((resolve, reject) => {
        new THREE.TextureLoader().load(sandTextureUrl, resolve, undefined, reject)
      })
      if (this.disposed || buildToken !== this.seabedBuildToken) {
        sand.dispose()
        return
      }
      sand.flipY = true
      sand.colorSpace = THREE.SRGBColorSpace
      sand.wrapS = THREE.RepeatWrapping
      sand.wrapT = THREE.RepeatWrapping
      sand.magFilter = THREE.NearestFilter
      sand.minFilter = THREE.LinearMipMapLinearFilter
      sand.generateMipmaps = true
      try { sand.anisotropy = Math.max(1, Math.floor(this.options.anisotropy ?? 8)) } catch { /* optional extension */ }
      sand.needsUpdate = true

      if (this.disposed || buildToken !== this.seabedBuildToken) {
        sand.dispose()
        return
      }
      this.seabedMaterial = new BlockMaterial(sand, null)
      this.seabedMaterial.setAntialiasing(true, 1.0)
      this.seabedMaterial.setAALodBias(true, 0.9)
      this.seabedMaterial.setMaterialProperties(0.8, 0.0, 0.3)
      this.seabedMaterial.setWaterCaustics(true, this.surfaceY, 0.80)
      this.syncSeabedMaterial()

      if (this.disposed || buildToken !== this.seabedBuildToken) {
        this.seabedMaterial.dispose()
        this.seabedMaterial = null
        sand.dispose()
        return
      }
      this.seabedGroup = new THREE.Group()
      this.seabedGroup.name = 'SeabedVisualExtension'
      const nearRange = Math.max(CHUNK_SIZE.x, CHUNK_SIZE.z)
      const near = new THREE.Mesh(this.createVoxelRingGeometry(nearRange), this.seabedMaterial)
      near.name = 'SeabedVoxelRing'
      near.renderOrder = 0
      near.frustumCulled = true
      this.seabedGroup.add(near)

      // Keep the horizon extension inexpensive; the one-block voxel ring is
      // the authored boundary match, while the distant field is below pixel
      // footprint and uses a 16-block quantized LOD.
      const far = new THREE.Mesh(this.createFarSeabedGeometry(nearRange, 16), this.seabedMaterial)
      far.name = 'SeabedFarLOD'
      far.renderOrder = 0
      far.frustumCulled = true
      this.seabedGroup.add(far)
      this.scene.add(this.seabedGroup)
    } catch (error) {
      console.warn('[WaterSystem] Failed to build visual seabed extension:', error)
    }
  }

  private sampleHeight(x: number, z: number): number {
    return getHeightAtPosition(x, z, this.options.seed, this.options.worldRadius)
  }

  private updateTerrainHeightTexture(): void {
    const image = this.terrainHeightTexture.image as { data: Uint8Array; width: number; height: number }
    const spanX = Math.max(1, this.options.bounds.maxX - this.options.bounds.minX)
    const spanZ = Math.max(1, this.options.bounds.maxZ - this.options.bounds.minZ)
    for (let z = 0; z < image.height; z += 1) {
      const worldZ = this.options.bounds.minZ + ((z + 0.5) / image.height) * spanZ
      for (let x = 0; x < image.width; x += 1) {
        const worldX = this.options.bounds.minX + ((x + 0.5) / image.width) * spanX
        const height = this.sampleHeight(worldX, worldZ)
        const encoded = Math.round(THREE.MathUtils.clamp(height / TERRAIN_HEIGHT_TEXTURE_SCALE, 0, 1) * 255)
        const index = (z * image.width + x) * 4
        image.data[index] = encoded
        image.data[index + 1] = encoded
        image.data[index + 2] = encoded
        image.data[index + 3] = 255
      }
    }
    this.terrainHeightTexture.needsUpdate = true
    this.material.setTerrainHeightMap(this.terrainHeightTexture, TERRAIN_HEIGHT_TEXTURE_SCALE)
  }

  private insideBounds(x: number, z: number): boolean {
    return x >= this.options.bounds.minX && x < this.options.bounds.maxX && z >= this.options.bounds.minZ && z < this.options.bounds.maxZ
  }

  private createVoxelRingGeometry(nearRange: number): THREE.BufferGeometry {
    const { minX, maxX, minZ, maxZ } = this.options.bounds
    const x0 = Math.floor(minX - nearRange)
    const x1 = Math.ceil(maxX + nearRange)
    const z0 = Math.floor(minZ - nearRange)
    const z1 = Math.ceil(maxZ + nearRange)
    const heights = new Map<string, number>()
    for (let z = z0 - 1; z <= z1; z += 1) {
      for (let x = x0 - 1; x <= x1; x += 1) heights.set(`${x},${z}`, this.sampleHeight(x, z))
    }

    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const ao: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    for (let z = z0; z < z1; z += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (this.insideBounds(x, z)) continue
        const height = heights.get(`${x},${z}`) ?? this.sampleHeight(x, z)
        this.appendQuad(positions, normals, uvs, ao, colors, indices,
          [[x, height + 1, z], [x + 1, height + 1, z], [x + 1, height + 1, z + 1], [x, height + 1, z + 1]],
          [0, 1, 0], [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]])

        const neighbors: Array<{ dx: number; dz: number; normal: Vec3Tuple }> = [
          { dx: 1, dz: 0, normal: [1, 0, 0] },
          { dx: -1, dz: 0, normal: [-1, 0, 0] },
          { dx: 0, dz: 1, normal: [0, 0, 1] },
          { dx: 0, dz: -1, normal: [0, 0, -1] },
        ]
        for (const neighbor of neighbors) {
          const nx = x + neighbor.dx
          const nz = z + neighbor.dz
          if (this.insideBounds(nx, nz)) continue
          const neighborHeight = heights.get(`${nx},${nz}`) ?? this.sampleHeight(nx, nz)
          if (neighborHeight >= height) continue
          for (let y = neighborHeight + 1; y <= height; y += 1) {
            let face: Vec3Tuple[]
            let faceUv: Array<[number, number]>
            if (neighbor.dx === 1) {
              face = [[x + 1, y, z + 1], [x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1]]
              faceUv = [[x + 1, y], [x + 1, y], [x + 1, y + 1], [x + 1, y + 1]]
            } else if (neighbor.dx === -1) {
              face = [[x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]]
              faceUv = [[x, y], [x, y], [x, y + 1], [x, y + 1]]
            } else if (neighbor.dz === 1) {
              face = [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]]
              faceUv = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]
            } else {
              face = [[x + 1, y, z], [x, y, z], [x, y + 1, z], [x + 1, y + 1, z]]
              faceUv = [[x + 1, y], [x, y], [x, y + 1], [x + 1, y + 1]]
            }
            this.appendQuad(positions, normals, uvs, ao, colors, indices, face, neighbor.normal, faceUv)
          }
        }
      }
    }
    return this.makeGeometry(positions, normals, uvs, ao, colors, indices)
  }

  private createFarSeabedGeometry(nearRange: number, cellSize: number): THREE.BufferGeometry {
    const far = Math.max(128, this.options.farDistance)
    const { minX, maxX, minZ, maxZ } = this.options.bounds
    const x0 = Math.floor((minX - far) / cellSize) * cellSize
    const x1 = Math.ceil((maxX + far) / cellSize) * cellSize
    const z0 = Math.floor((minZ - far) / cellSize) * cellSize
    const z1 = Math.ceil((maxZ + far) / cellSize) * cellSize
    const nearMinX = minX - nearRange
    const nearMaxX = maxX + nearRange
    const nearMinZ = minZ - nearRange
    const nearMaxZ = maxZ + nearRange
    const heights = new Map<string, number>()
    for (let z = z0; z < z1; z += cellSize) {
      for (let x = x0; x < x1; x += cellSize) {
        const centerX = x + cellSize * 0.5
        const centerZ = z + cellSize * 0.5
        if (centerX >= nearMinX && centerX < nearMaxX && centerZ >= nearMinZ && centerZ < nearMaxZ) continue
        heights.set(`${x},${z}`, this.sampleHeight(Math.floor(centerX), Math.floor(centerZ)))
      }
    }
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const ao: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    for (const [key, height] of heights) {
      const [xText, zText] = key.split(',')
      const x = Number(xText)
      const z = Number(zText)
      this.appendQuad(positions, normals, uvs, ao, colors, indices,
        [[x, height + 1, z], [x + cellSize, height + 1, z], [x + cellSize, height + 1, z + cellSize], [x, height + 1, z + cellSize]],
        [0, 1, 0], [[x, z], [x + cellSize, z], [x + cellSize, z + cellSize], [x, z + cellSize]])
      const sideNeighbors: Array<{ dx: number; dz: number; normal: Vec3Tuple }> = [
        { dx: cellSize, dz: 0, normal: [1, 0, 0] },
        { dx: -cellSize, dz: 0, normal: [-1, 0, 0] },
        { dx: 0, dz: cellSize, normal: [0, 0, 1] },
        { dx: 0, dz: -cellSize, normal: [0, 0, -1] },
      ]
      for (const neighbor of sideNeighbors) {
        const neighborHeight = heights.get(`${x + neighbor.dx},${z + neighbor.dz}`)
        if (neighborHeight === undefined || neighborHeight >= height) continue
        const y = neighborHeight + 1
        if (neighbor.dx > 0) {
          this.appendQuad(positions, normals, uvs, ao, colors, indices,
            [[x + cellSize, y, z + cellSize], [x + cellSize, y, z], [x + cellSize, height + 1, z], [x + cellSize, height + 1, z + cellSize]],
            neighbor.normal, [[x + cellSize, y], [x + cellSize, y], [x + cellSize, height + 1], [x + cellSize, height + 1]])
        } else if (neighbor.dx < 0) {
          this.appendQuad(positions, normals, uvs, ao, colors, indices,
            [[x, y, z], [x, y, z + cellSize], [x, height + 1, z + cellSize], [x, height + 1, z]],
            neighbor.normal, [[x, y], [x, y], [x, height + 1], [x, height + 1]])
        } else if (neighbor.dz > 0) {
          this.appendQuad(positions, normals, uvs, ao, colors, indices,
            [[x, y, z + cellSize], [x + cellSize, y, z + cellSize], [x + cellSize, height + 1, z + cellSize], [x, height + 1, z + cellSize]],
            neighbor.normal, [[x, y], [x + cellSize, y], [x + cellSize, height + 1], [x, height + 1]])
        } else {
          this.appendQuad(positions, normals, uvs, ao, colors, indices,
            [[x + cellSize, y, z], [x, y, z], [x, height + 1, z], [x + cellSize, height + 1, z]],
            neighbor.normal, [[x + cellSize, y], [x, y], [x, height + 1], [x + cellSize, height + 1]])
        }
      }
    }
    return this.makeGeometry(positions, normals, uvs, ao, colors, indices)
  }

  private appendQuad(
    positions: number[],
    normals: number[],
    uvs: number[],
    ao: number[],
    colors: number[],
    indices: number[],
    points: Vec3Tuple[],
    normal: Vec3Tuple,
    faceUvs: Array<[number, number]>,
  ): void {
    const start = positions.length / 3
    for (let i = 0; i < 4; i += 1) {
      const point = points[i]
      positions.push(point[0], point[1], point[2])
      normals.push(normal[0], normal[1], normal[2])
      uvs.push(faceUvs[i][0], faceUvs[i][1])
      ao.push(1)
      colors.push(1, 1, 1)
    }
    const ax = points[1][0] - points[0][0]
    const ay = points[1][1] - points[0][1]
    const az = points[1][2] - points[0][2]
    const bx = points[2][0] - points[0][0]
    const by = points[2][1] - points[0][1]
    const bz = points[2][2] - points[0][2]
    const crossX = ay * bz - az * by
    const crossY = az * bx - ax * bz
    const crossZ = ax * by - ay * bx
    const aligned = crossX * normal[0] + crossY * normal[1] + crossZ * normal[2] >= 0
    if (aligned) indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
    else indices.push(start, start + 2, start + 1, start, start + 3, start + 2)
  }

  private makeGeometry(positions: number[], normals: number[], uvs: number[], ao: number[], colors: number[], indices: number[]): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setIndex(indices)
    geometry.computeBoundingSphere()
    return geometry
  }

  private syncSeabedMaterial(): void {
    if (!this.seabedMaterial) return
    const source = this.options.blockMaterialSource
    if (source) {
      const sourceUniforms = source.uniforms as Record<string, THREE.IUniform>
      const targetUniforms = this.seabedMaterial.uniforms as Record<string, THREE.IUniform>
      for (const key of ['sunDirection', 'sunColor', 'dayLight', 'starLight', 'skyAmbient']) {
        if (sourceUniforms[key] && targetUniforms[key]) targetUniforms[key].value = sourceUniforms[key].value
      }
    }
    this.seabedMaterial.setWaterCaustics(true, this.surfaceY, 0.80, this.time)
  }

  private applyCaustics(): void {
    if (!this.caustics) return
    const texture = this.caustics.getTexture()
    const origin = this.caustics.getOrigin()
    const extent = this.caustics.getExtent()
    const resolution = this.caustics.getResolution()
    this.options.blockMaterialSource?.setWaterCausticTexture(texture, origin, extent, resolution)
    this.seabedMaterial?.setWaterCausticTexture(texture, origin, extent, resolution)
  }
}
