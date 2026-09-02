import * as THREE from 'three'
import { BlockMaterial } from '../BlockMaterial'
import type { AtlasConfig } from '../Atlas'
import { CHUNK_SIZE } from '../../../config/constants'
import { createTerrainSampler, type TerrainSampler } from '../../world/TerrainGenerator'
import { getOceanMaxAmplitude, OCEAN_WATER_CENTER_OFFSET, OCEAN_WAVES, sampleOceanHeight } from './OceanWaveField'
import { WaterSurfaceMaterial } from './WaterSurfaceMaterial'
import { CAUSTIC_REFERENCE_DEPTH, CAUSTIC_TILE_SIZE, WaterCaustics } from './WaterCaustics'
import {
  createProceduralVoxelTileTexture,
  extractProceduralAtlasTile,
} from '../ProceduralVoxelTextures'
import { setForwardRefractionWaterState } from './ForwardRefraction'
import type { ForwardRefractionParticipantRegistry } from './ForwardRefraction'

const TERRAIN_HEIGHT_TEXTURE_SCALE = 128
const SEABED_FLOOR_Y = 0
const SEABED_FAR_CELL_SIZE = 16
// The player camera is 70 degrees vertical and commonly runs at widescreen
// aspects. Far-plane corner rays can travel a little over twice the axial far
// distance, so an ocean sized only to `far` exposes its square boundary near
// the left/right horizon. Keep that outer-only lattice conservative and coarse;
// the inner patch still owns near-field tessellation.
const OCEAN_FRUSTUM_COVERAGE_SCALE = 2.10
const OCEAN_OUTER_CELL_SIZE = 16
// The lowest bounded wave trough is at WATER_LEVEL. Keep the render-only
// receiver one complete voxel below it so no generated "seabed" top can
// cross the optical interface and enter the water-free scene capture.
const SEABED_SURFACE_CLEARANCE = 2
function createTerrainHeightTexture(
  bounds: WaterSystemOptions['bounds'],
  terrainSampler: TerrainSampler,
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
      const height = terrainSampler(worldX, worldZ).height
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
  /** Atlas metadata used to reproduce the exact voxel sand texels. */
  seabedAtlas?: AtlasConfig
  /** Authoritative voxel-water material hidden from the refraction capture. */
  blockWaterMaterial?: WaterSurfaceMaterial
  /** WebGL renderer used for the render-only differential-area caustic map. */
  renderer?: THREE.WebGLRenderer
  forwardRefractionParticipants?: ForwardRefractionParticipantRegistry
  /** Registration hooks for the composer depth-prepass shadow sampler guard. */
  registerShadowSamplingMaterial?: (material: THREE.Material) => void
  unregisterShadowSamplingMaterial?: (material: THREE.Material) => void
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
  private terrainSampler: TerrainSampler
  private readonly caustics: WaterCaustics | null
  private readonly blockWaterMaterial: WaterSurfaceMaterial | null
  private readonly forwardRefractionParticipants?: ForwardRefractionParticipantRegistry
  private seabedMaterial: BlockMaterial | null = null
  private seabedTexture: THREE.Texture | null = null
  private seabedGroup: THREE.Group | null = null
  private time = 0
  private disposed = false
  private seabedBuildToken = 0
  private cameraUnderwater = false
  private cameraSurfaceY = 0
  private sceneColor: THREE.Texture | null = null
  private sceneDepth: THREE.Texture | null = null
  private forwardRefractionColor: THREE.Texture | null = null
  private forwardRefractionDepth: THREE.Texture | null = null
  private forwardRefractionResolution = new THREE.Vector2(1, 1)
  private sunVisibility: THREE.Texture | null = null
  private resolution = new THREE.Vector2(1, 1)
  private cameraNear = 0.1
  private cameraFar = 1024
  private opaqueCaptureActive = false
  private oceanWasVisible = true
  private blockWaterWasVisible = true
  private sunIntensity = 1.35

  constructor(scene: THREE.Scene, options: WaterSystemOptions) {
    this.scene = scene
    this.options = options
    this.blockWaterMaterial = options.blockWaterMaterial ?? null
    this.forwardRefractionParticipants = options.forwardRefractionParticipants
    this.group = new THREE.Group()
    this.group.name = 'WaterSystem'
    this.oceanGroup = new THREE.Group()
    this.oceanGroup.name = 'OceanSurface'
    this.group.add(this.oceanGroup)

    // Construct the seeded noise streams once per world configuration. The
    // terrain height texture, seabed geometry, and shoreline helpers all share
    // this exact sampler rather than rebuilding eight noise generators for
    // every queried column.
    this.terrainSampler = createTerrainSampler(options.seed, options.worldRadius)
    // The water shader needs the same terrain height field that defines the
    // playable shoreline. This keeps foam on shallow coast water instead of
    // guessing from the rectangular map boundary.
    this.terrainHeightTexture = createTerrainHeightTexture(options.bounds, this.terrainSampler)

    const surfaceY = options.waterLevel + OCEAN_WATER_CENTER_OFFSET
    this.cameraSurfaceY = surfaceY
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
    this.material.setRefraction(1.0, 1.0 / 1.333, 1.0, 1.0, 0.0)
    this.material.setAlpha(1)

    let caustics: WaterCaustics | null = null
    if (options.renderer) {
      try {
        caustics = new WaterCaustics(options.renderer, {
          resolution: 256,
          extent: CAUSTIC_TILE_SIZE,
          patchExtent: CAUSTIC_TILE_SIZE * 1.5,
          projectDepth: 24,
        })
      } catch (error) {
        console.warn('[WaterSystem] Differential-area caustics unavailable:', error)
      }
    }
    this.caustics = caustics

    const far = Math.max(128, options.farDistance)
    const innerSize = Math.min(512, Math.max(256, far * 0.42))
    const innerSegments = innerSize <= 320 ? 128 : 160
    const innerHalf = innerSize * 0.5
    const outerHalf = far * OCEAN_FRUSTUM_COVERAGE_SCALE
    const innerCellSize = innerSize / innerSegments
    // Keep the horizon strips sampled often enough that long swells do not
    // collapse into broad, parallel quads. Their shader still filters the
    // shortest detail by footprint; this budget preserves the cascade's
    // large directional shape without introducing an inner/outer grid seam.
    // The strip lattice is stitched explicitly below: the outer radial cell
    // starts at the inner grid's cell width and grows smoothly toward the
    // horizon, rather than interpolating over a separate coarse edge lattice.
    const outerBandSegments = Math.max(2, Math.ceil((outerHalf - innerHalf) / OCEAN_OUTER_CELL_SIZE))

    const inner = new THREE.Mesh(this.createGridGeometry(innerSize, innerSegments), this.material)
    inner.name = 'OceanSurfaceInner'
    inner.renderOrder = 2
    inner.frustumCulled = false
    this.oceanGroup.add(inner)

    const innerAxis = this.createUniformCoordinates(-innerHalf, innerHalf, innerSegments)
    const negativeOuterAxis = this.createTransitionCoordinates(
      -innerHalf,
      -outerHalf,
      outerBandSegments,
      innerCellSize,
    ).reverse()
    const positiveOuterAxis = this.createTransitionCoordinates(
      innerHalf,
      outerHalf,
      outerBandSegments,
      innerCellSize,
    )
    const fullTangentAxis = [
      ...negativeOuterAxis.slice(0, -1),
      ...innerAxis,
      ...positiveOuterAxis.slice(1),
    ]
    const northRadialAxis = positiveOuterAxis
    const southRadialAxis = negativeOuterAxis
    const strips: Array<{ x: number[]; z: number[]; name: string }> = [
      // The central part of every strip reuses the inner grid's exact
      // boundary coordinates. The outer portions use a smoothly expanding
      // lattice, so no displaced edge is reconstructed from a different set
      // of samples at the inner/outer join.
      { x: fullTangentAxis, z: northRadialAxis, name: 'OceanSurfaceNorth' },
      { x: fullTangentAxis, z: southRadialAxis, name: 'OceanSurfaceSouth' },
      { x: southRadialAxis, z: fullTangentAxis, name: 'OceanSurfaceWest' },
      { x: northRadialAxis, z: fullTangentAxis, name: 'OceanSurfaceEast' },
    ]
    for (const strip of strips) {
      const mesh = new THREE.Mesh(this.createCoordinateGeometry(strip.x, strip.z), this.material)
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

  /** Live displaced interface height at the camera's world-space XZ. */
  getCameraSurfaceY(): number { return this.cameraSurfaceY }

  getCausticTexture(): THREE.Texture | null { return this.caustics?.getTexture() ?? null }

  getCausticOrigin(): { x: number; y: number } { return this.caustics?.getOrigin() ?? { x: 0, y: 0 } }

  getCausticExtent(): number { return this.caustics?.getExtent() ?? 256 }

  getCausticResolution(): { x: number; y: number } { return this.caustics?.getResolution() ?? { x: 1, y: 1 } }

  getCausticReferenceDepth(): number { return this.caustics?.getReferenceDepth() ?? CAUSTIC_REFERENCE_DEPTH }

  setSeed(seed: number): void {
    if (this.options.seed === seed || this.disposed) return
    this.options.seed = seed
    this.terrainSampler = createTerrainSampler(seed, this.options.worldRadius)
    this.updateTerrainHeightTexture()
    this.seabedBuildToken += 1
    if (this.seabedGroup) {
      this.scene.remove(this.seabedGroup)
      this.disposeGroup(this.seabedGroup)
      this.seabedGroup = null
    }
    this.disposeSeabedMaterial()
    this.seabedMaterial = null
    this.seabedTexture?.dispose()
    this.seabedTexture = null
    void this.buildSeabed(this.seabedBuildToken)
  }

  setOpaqueCaptureMode(hidden: boolean): void {
    if (hidden === this.opaqueCaptureActive) return
    this.opaqueCaptureActive = hidden
    if (hidden) {
      this.oceanWasVisible = this.oceanGroup.visible
      this.blockWaterWasVisible = this.blockWaterMaterial?.visible ?? true
      this.oceanGroup.visible = false
      if (this.blockWaterMaterial) this.blockWaterMaterial.visible = false
      return
    }
    this.oceanGroup.visible = this.oceanWasVisible
    if (this.blockWaterMaterial) this.blockWaterMaterial.visible = this.blockWaterWasVisible
  }

  setSceneInputs(sceneColor: THREE.Texture | null, sceneDepth: THREE.Texture | null, resolution: { x: number; y: number }, cameraNear: number, cameraFar: number): void {
    this.sceneColor = sceneColor
    this.sceneDepth = sceneDepth
    this.resolution.set(Math.max(1, Math.floor(resolution.x)), Math.max(1, Math.floor(resolution.y)))
    this.cameraNear = cameraNear
    this.cameraFar = cameraFar
    this.material.setSceneInputs(sceneColor, sceneDepth, this.resolution, cameraNear, cameraFar)
    this.blockWaterMaterial?.setSceneInputs(sceneColor, sceneDepth, this.resolution, cameraNear, cameraFar)
  }

  setForwardRefractionInputs(
    sceneColor: THREE.Texture | null,
    sceneDepth: THREE.Texture | null,
    resolution: { x: number; y: number },
    cameraNear: number,
    cameraFar: number,
  ): void {
    this.forwardRefractionColor = sceneColor
    this.forwardRefractionDepth = sceneDepth
    this.forwardRefractionResolution.set(
      Math.max(1, Math.floor(resolution.x)),
      Math.max(1, Math.floor(resolution.y)),
    )
    this.material.setForwardRefractionInputs(
      sceneColor,
      sceneDepth,
      resolution,
      cameraNear,
      cameraFar,
    )
  }

  setSunVisibility(texture: THREE.Texture | null): void {
    this.sunVisibility = texture
    this.material.setSunVisibility(texture)
    this.blockWaterMaterial?.setSunVisibility(texture)
  }

  setSun(direction: THREE.Vector3, color?: THREE.Color, sunIntensity = 1.35): void {
    this.sunIntensity = Math.max(0, sunIntensity)
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
    this.material.setCamera(camera)
    this.blockWaterMaterial?.setCamera(camera)

    // Follow the camera on a stable 16-block grid.  Absolute world XZ is used
    // in the shader, so moving the mesh cannot make waves swim underfoot.
    const snap = 16
    this.oceanGroup.position.x = Math.floor(camera.position.x / snap) * snap
    this.oceanGroup.position.z = Math.floor(camera.position.z / snap) * snap

    // Camera medium is an exact point classification against the same live
    // displaced surface used by the ocean mesh. Do not add a height band or
    // derive this state from face orientation: the visible surface itself
    // supplies the continuous screen-space waterline during a crossing.
    this.cameraSurfaceY = this.surfaceY
      + sampleOceanHeight(camera.position.x, camera.position.z, this.time)
    this.cameraUnderwater = camera.position.y < this.cameraSurfaceY
    this.material.setCameraUnderwater(this.cameraUnderwater)
    setForwardRefractionWaterState({
      waterLevel: this.surfaceY,
      time: this.time,
      waveAmp: Number(this.material.uniforms.uWaveAmp.value),
      waveChop: Number(this.material.uniforms.uWaveChop.value),
      waveSpeed: Number(this.material.uniforms.uWaveSpeed.value),
      cameraUnderwater: this.cameraUnderwater,
    })

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
      cameraSurfaceY: this.cameraSurfaceY,
      surfaceY: this.surfaceY,
      maxWaveAmplitude: getOceanMaxAmplitude(),
      waveField: {
        representation: 'deterministic-discrete-directional-spectrum',
        components: OCEAN_WAVES.length,
        lod: 'undeformed-base-plane-pixel-footprint',
        sharedSlopeResponse: true,
      },
      oceanMeshes: this.oceanGroup.children.length,
      seabedReady: !!this.seabedGroup,
      seabedMeshes: seabedMeshes.length,
      caustics: this.caustics?.getDiagnostics() ?? null,
      sceneInputs: { color: !!this.sceneColor, depth: !!this.sceneDepth, resolution: this.resolution.toArray(), near: this.cameraNear, far: this.cameraFar },
      forwardRefraction: {
        color: !!this.forwardRefractionColor,
        depth: !!this.forwardRefractionDepth,
        resolution: this.forwardRefractionResolution.toArray(),
        projection: 'forward-fermat-snell',
      },
      sunVisibility: !!this.sunVisibility,
      waterExcludedFromCapture: this.opaqueCaptureActive,
    }
  }

  dispose(): void {
    this.disposed = true
    this.seabedBuildToken += 1
    this.scene.remove(this.group)
    this.disposeGroup(this.group)
    if (this.seabedGroup) {
      this.scene.remove(this.seabedGroup)
      this.disposeGroup(this.seabedGroup)
      this.seabedGroup = null
    }
    this.material.dispose()
    this.terrainHeightTexture.dispose()
    this.disposeSeabedMaterial()
    this.seabedTexture?.dispose()
    this.caustics?.dispose()
  }

  private disposeGroup(group: THREE.Group): void {
    this.forwardRefractionParticipants?.unregisterTree(group)
    group.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
    })
  }

  private createGridGeometry(size: number, segments: number): THREE.BufferGeometry {
    return this.createRectGeometry(-size * 0.5, -size * 0.5, size * 0.5, size * 0.5, segments, segments)
  }

  private createRectGeometry(x0: number, z0: number, x1: number, z1: number, nx: number, nz: number): THREE.BufferGeometry {
    return this.createCoordinateGeometry(
      this.createUniformCoordinates(x0, x1, nx),
      this.createUniformCoordinates(z0, z1, nz),
    )
  }

  private createUniformCoordinates(start: number, end: number, segments: number): number[] {
    const count = Math.max(1, Math.floor(segments))
    return Array.from({ length: count + 1 }, (_, index) => THREE.MathUtils.lerp(start, end, index / count))
  }

  /**
   * Build a transition axis from an inner patch edge toward an outer edge.
   * The first cell exactly matches the dense inner grid and later cells grow
   * gradually. This keeps the displaced surface and its raster footprint
   * continuous without paying the inner-grid vertex cost to the horizon.
   */
  private createTransitionCoordinates(
    boundary: number,
    outer: number,
    segments: number,
    firstCellSize: number,
  ): number[] {
    const count = Math.max(1, Math.floor(segments))
    const span = Math.abs(outer - boundary)
    if (span <= 1e-6 || count === 1) return [boundary, outer]

    const direction = Math.sign(outer - boundary)
    const firstCell = Math.min(Math.abs(firstCellSize), span)
    const lastCell = 2 * span / count - firstCell
    if (lastCell <= 0) return this.createUniformCoordinates(boundary, outer, count)

    const coordinates = [boundary]
    let distance = 0
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0 : index / (count - 1)
      const cellSize = firstCell + (lastCell - firstCell) * t
      distance += cellSize
      coordinates.push(index === count - 1 ? outer : boundary + direction * distance)
    }
    return coordinates
  }

  private createCoordinateGeometry(xCoordinates: number[], zCoordinates: number[]): THREE.BufferGeometry {
    const nx = Math.max(1, xCoordinates.length - 1)
    const nz = Math.max(1, zCoordinates.length - 1)
    const positions = new Float32Array(xCoordinates.length * zCoordinates.length * 3)
    const normals = new Float32Array(xCoordinates.length * zCoordinates.length * 3)
    const uvs = new Float32Array(xCoordinates.length * zCoordinates.length * 2)
    let p = 0
    let n = 0
    let uv = 0
    for (const z of zCoordinates) {
      for (const x of xCoordinates) {
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
      const sand = this.createAtlasSandTexture() ?? createProceduralVoxelTileTexture('sand', {
        tileSize: this.options.seabedAtlas?.tileSize ?? 16,
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
      // Voxel terrain uses the 16px atlas tile with nearest sampling and no
      // mip chain. The extension must use the same effective sampling path;
      // its former trilinear/anisotropic path changed both colour and scale.
      sand.minFilter = THREE.NearestFilter
      sand.generateMipmaps = false
      sand.anisotropy = 1
      sand.needsUpdate = true
      this.seabedTexture = sand

      if (this.disposed || buildToken !== this.seabedBuildToken) {
        sand.dispose()
        return
      }
      this.seabedMaterial = new BlockMaterial(sand, null)
      // Atlas-backed terrain returns before the standalone multi-tap AA path.
      // Disable that path here so the extracted sand tile behaves identically.
      this.seabedMaterial.setAntialiasing(false)
      this.seabedMaterial.setAALodBias(false)
      this.seabedMaterial.setMaterialProperties(0.8, 0.0, 0.3)
      this.seabedMaterial.setWaterCaustics(true, this.surfaceY, 0.80, 0, this.getCausticReferenceDepth(), this.sunIntensity)
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
      // the authored boundary match, while the distant field smooths one
      // continuous receiver over 16-block samples below pixel footprint.
      const farGeometry = this.createFarSeabedGeometry(nearRange, SEABED_FAR_CELL_SIZE)
      const far = new THREE.Mesh(farGeometry.surface, this.seabedMaterial)
      far.name = 'SeabedFarLOD'
      far.renderOrder = 0
      far.frustumCulled = true
      this.seabedGroup.add(far)
      const closure = new THREE.Mesh(farGeometry.closure, this.seabedMaterial)
      closure.name = 'SeabedFarClosure'
      closure.renderOrder = 0
      closure.frustumCulled = true
      this.seabedGroup.add(closure)
      this.scene.add(this.seabedGroup)
      this.forwardRefractionParticipants?.registerTree(this.seabedGroup)
      this.options.registerShadowSamplingMaterial?.(this.seabedMaterial)
    } catch (error) {
      console.warn('[WaterSystem] Failed to build visual seabed extension:', error)
    }
  }

  private createAtlasSandTexture(): THREE.Texture | null {
    const atlas = this.options.seabedAtlas
    const source = this.options.blockMaterialSource?.uniforms.map?.value as THREE.Texture | undefined
    const tile = atlas?.tiles.sand
    if (!atlas || !tile || !source) return null

    const tileSize = Math.max(1, Math.floor(atlas.tileSize))
    const proceduralTile = extractProceduralAtlasTile(source, tile, tileSize)
    if (proceduralTile) return proceduralTile

    const image = source.image as (CanvasImageSource & { width?: number; height?: number }) | undefined
    if (!image || typeof document === 'undefined') return null
    const imageWidth = Number(image.width ?? 0)
    const imageHeight = Number(image.height ?? 0)
    if (imageWidth < (tile[0] + 1) * tileSize || imageHeight < (tile[1] + 1) * tileSize) return null

    const canvas = document.createElement('canvas')
    canvas.width = tileSize
    canvas.height = tileSize
    const context = canvas.getContext('2d')
    if (!context) return null
    context.imageSmoothingEnabled = false
    context.drawImage(
      image,
      tile[0] * tileSize,
      tile[1] * tileSize,
      tileSize,
      tileSize,
      0,
      0,
      tileSize,
      tileSize,
    )
    return new THREE.CanvasTexture(canvas)
  }

  /** Authoritative terrain sampling remains unchanged for foam/shoreline use. */
  private sampleTerrainHeight(x: number, z: number): number {
    return this.terrainSampler(x, z).height
  }

  /**
   * Render-only geometry outside the barrier is always ocean floor. The
   * island generator is radial while gameplay bounds are rectangular, so a
   * raw query outside the rectangle can legitimately return land. Clamping
   * only this visual receiver prevents those land-height LOD slabs from
   * crossing the water surface without changing World or player collision.
   */
  private sampleSeabedHeight(x: number, z: number): number {
    return Math.min(
      this.sampleTerrainHeight(x, z),
      this.options.waterLevel - SEABED_SURFACE_CLEARANCE,
    )
  }

  private updateTerrainHeightTexture(): void {
    const image = this.terrainHeightTexture.image as { data: Uint8Array; width: number; height: number }
    const spanX = Math.max(1, this.options.bounds.maxX - this.options.bounds.minX)
    const spanZ = Math.max(1, this.options.bounds.maxZ - this.options.bounds.minZ)
    for (let z = 0; z < image.height; z += 1) {
      const worldZ = this.options.bounds.minZ + ((z + 0.5) / image.height) * spanZ
      for (let x = 0; x < image.width; x += 1) {
        const worldX = this.options.bounds.minX + ((x + 0.5) / image.width) * spanX
        const height = this.sampleTerrainHeight(worldX, worldZ)
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

    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const ao: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    // The ring and the authoritative chunks meet at a column-height
    // boundary. Cache the ring plus only the one-cell seam halo needed by its
    // neighbour comparisons. A dense numeric grid avoids hundreds of
    // thousands of temporary "x,z" strings and Map lookups while never
    // evaluating the discarded world interior.
    const sampleMinX = x0 - 1
    const sampleMinZ = z0 - 1
    const sampleWidth = x1 - x0 + 2
    const sampleDepth = z1 - z0 + 2
    const heights = new Float32Array(sampleWidth * sampleDepth)
    heights.fill(Number.NaN)
    const cachedHeight = (x: number, z: number): number => {
      const localX = x - sampleMinX
      const localZ = z - sampleMinZ
      if (localX < 0 || localX >= sampleWidth || localZ < 0 || localZ >= sampleDepth) {
        throw new RangeError(`[WaterSystem] Voxel ring neighbour outside cache: (${x}, ${z})`)
      }
      const index = localZ * sampleWidth + localX
      const cached = heights[index]
      if (!Number.isNaN(cached)) return cached
      // Sample the real terrain on the gameplay side so either its chunk face
      // or this extension's complementary face closes every height
      // difference. Applying the visual seabed clamp on both sides can
      // fabricate an unsupported shelf at that seam.
      const height = this.insideBounds(x, z)
        ? this.sampleTerrainHeight(x, z)
        : this.sampleSeabedHeight(x, z)
      heights[index] = height
      return height
    }

    const neighbors: Array<{ dx: number; dz: number; normal: Vec3Tuple }> = [
      { dx: 1, dz: 0, normal: [1, 0, 0] },
      { dx: -1, dz: 0, normal: [-1, 0, 0] },
      { dx: 0, dz: 1, normal: [0, 0, 1] },
      { dx: 0, dz: -1, normal: [0, 0, -1] },
    ]

    const appendRingCell = (x: number, z: number): void => {
      const height = cachedHeight(x, z)
      this.appendQuad(positions, normals, uvs, ao, colors, indices,
        [[x, height + 1, z], [x + 1, height + 1, z], [x + 1, height + 1, z + 1], [x, height + 1, z + 1]],
        [0, 1, 0], [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]])

      for (const neighbor of neighbors) {
        const neighborHeight = cachedHeight(x + neighbor.dx, z + neighbor.dz)
        if (neighborHeight >= height) continue
        for (let y = neighborHeight + 1; y <= height; y += 1) {
          let face: Vec3Tuple[]
          let faceUv: Array<[number, number]>
          if (neighbor.dx === 1) {
            face = [[x + 1, y, z + 1], [x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1]]
            // X-facing walls use Z as their horizontal tangent. X is
            // constant on this face; using it for U collapses the U span
            // to zero and stretches one sand tile across the whole wall.
            faceUv = [[z + 1, y], [z, y], [z, y + 1], [z + 1, y + 1]]
          } else if (neighbor.dx === -1) {
            face = [[x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]]
            // See the +X case above: the side-plane coordinate, not the
            // constant normal-axis coordinate, owns horizontal U.
            faceUv = [[z, y], [z + 1, y], [z + 1, y + 1], [z, y + 1]]
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

    const appendStrip = (stripZ0: number, stripZ1: number, stripX0: number, stripX1: number): void => {
      for (let z = stripZ0; z < stripZ1; z += 1) {
        for (let x = stripX0; x < stripX1; x += 1) appendRingCell(x, z)
      }
    }

    // Four non-overlapping strips cover exactly the outside ring. The
    // north/south strips own the corners; west/east only cover the interior
    // span, avoiding duplicate seam faces.
    const innerX0 = Math.ceil(minX)
    const innerX1 = Math.ceil(maxX)
    const innerZ0 = Math.ceil(minZ)
    const innerZ1 = Math.ceil(maxZ)
    appendStrip(z0, innerZ0, x0, x1)
    appendStrip(innerZ1, z1, x0, x1)
    appendStrip(innerZ0, innerZ1, x0, innerX0)
    appendStrip(innerZ0, innerZ1, innerX1, x1)
    return this.makeGeometry(positions, normals, uvs, ao, colors, indices)
  }

  private createFarSeabedGeometry(
    nearRange: number,
    cellSize: number,
  ): { surface: THREE.BufferGeometry; closure: THREE.BufferGeometry } {
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
    const cellKey = (x: number, z: number): string => `${x},${z}`
    for (let z = z0; z < z1; z += cellSize) {
      for (let x = x0; x < x1; x += cellSize) {
        const centerX = x + cellSize * 0.5
        const centerZ = z + cellSize * 0.5
        if (centerX >= nearMinX && centerX < nearMaxX && centerZ >= nearMinZ && centerZ < nearMaxZ) continue
        heights.set(cellKey(x, z), this.sampleSeabedHeight(Math.floor(centerX), Math.floor(centerZ)))
      }
    }

    // Average the four neighbouring coarse cells at every grid vertex. This
    // keeps the far representation continuous instead of exposing one flat
    // 16x16 top plate per LOD sample through refraction.
    const vertexHeights = new Map<string, number>()
    const vertexHeight = (x: number, z: number): number => {
      const key = cellKey(x, z)
      const cached = vertexHeights.get(key)
      if (cached !== undefined) return cached
      const samples = [
        heights.get(cellKey(x - cellSize, z - cellSize)),
        heights.get(cellKey(x, z - cellSize)),
        heights.get(cellKey(x - cellSize, z)),
        heights.get(cellKey(x, z)),
      ].filter((height): height is number => height !== undefined)
      const terrainHeight = samples.length > 0
        ? samples.reduce((sum, height) => sum + height, 0) / samples.length
        : this.sampleSeabedHeight(x, z)
      const top = terrainHeight + 1
      vertexHeights.set(key, top)
      return top
    }

    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const ao: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const closurePositions: number[] = []
    const closureNormals: number[] = []
    const closureUvs: number[] = []
    const closureAo: number[] = []
    const closureColors: number[] = []
    const closureIndices: number[] = []
    const topVertices = new Map<string, number>()
    const topVertex = (x: number, z: number): number => {
      const key = cellKey(x, z)
      const cached = topVertices.get(key)
      if (cached !== undefined) return cached
      const height = vertexHeight(x, z)
      const left = vertexHeight(x - cellSize, z)
      const right = vertexHeight(x + cellSize, z)
      const back = vertexHeight(x, z - cellSize)
      const front = vertexHeight(x, z + cellSize)
      const normal = new THREE.Vector3(left - right, cellSize * 2, back - front).normalize()
      const index = positions.length / 3
      positions.push(x, height, z)
      normals.push(normal.x, normal.y, normal.z)
      uvs.push(x, z)
      // Match the base ambient visibility assigned to isolated solid voxel
      // faces by mesher.worker instead of giving the extension full ambient.
      ao.push(0.7)
      colors.push(1, 1, 1)
      topVertices.set(key, index)
      return index
    }

    for (const key of heights.keys()) {
      const [xText, zText] = key.split(',')
      const x = Number(xText)
      const z = Number(zText)
      const a = topVertex(x, z)
      const b = topVertex(x + cellSize, z)
      const c = topVertex(x + cellSize, z + cellSize)
      const d = topVertex(x, z + cellSize)
      const acDifference = Math.abs(vertexHeight(x, z) - vertexHeight(x + cellSize, z + cellSize))
      const bdDifference = Math.abs(vertexHeight(x + cellSize, z) - vertexHeight(x, z + cellSize))
      if (acDifference <= bdDifference) indices.push(a, d, c, a, c, b)
      else indices.push(a, d, b, b, d, c)

      const sideNeighbors: Array<{ dx: number; dz: number; normal: Vec3Tuple }> = [
        { dx: cellSize, dz: 0, normal: [1, 0, 0] },
        { dx: -cellSize, dz: 0, normal: [-1, 0, 0] },
        { dx: 0, dz: cellSize, normal: [0, 0, 1] },
        { dx: 0, dz: -cellSize, normal: [0, 0, -1] },
      ]
      for (const neighbor of sideNeighbors) {
        if (heights.has(cellKey(x + neighbor.dx, z + neighbor.dz))) continue
        // Close both the central near/far seam and the outer perimeter. These
        // are real visible seabed faces and must remain in the water-free
        // scene capture; otherwise depth disappears exactly where a refracted
        // ray reaches the terrain boundary.
        if (neighbor.dx > 0) {
          this.appendTiledWall(closurePositions, closureNormals, closureUvs, closureAo, closureColors, closureIndices,
            [x + cellSize, SEABED_FLOOR_Y, z + cellSize], [x + cellSize, SEABED_FLOOR_Y, z],
            [x + cellSize, vertexHeight(x + cellSize, z + cellSize), z + cellSize], [x + cellSize, vertexHeight(x + cellSize, z), z],
            neighbor.normal)
        } else if (neighbor.dx < 0) {
          this.appendTiledWall(closurePositions, closureNormals, closureUvs, closureAo, closureColors, closureIndices,
            [x, SEABED_FLOOR_Y, z], [x, SEABED_FLOOR_Y, z + cellSize],
            [x, vertexHeight(x, z), z], [x, vertexHeight(x, z + cellSize), z + cellSize],
            neighbor.normal)
        } else if (neighbor.dz > 0) {
          this.appendTiledWall(closurePositions, closureNormals, closureUvs, closureAo, closureColors, closureIndices,
            [x, SEABED_FLOOR_Y, z + cellSize], [x + cellSize, SEABED_FLOOR_Y, z + cellSize],
            [x, vertexHeight(x, z + cellSize), z + cellSize], [x + cellSize, vertexHeight(x + cellSize, z + cellSize), z + cellSize],
            neighbor.normal)
        } else {
          this.appendTiledWall(closurePositions, closureNormals, closureUvs, closureAo, closureColors, closureIndices,
            [x + cellSize, SEABED_FLOOR_Y, z], [x, SEABED_FLOOR_Y, z],
            [x + cellSize, vertexHeight(x + cellSize, z), z], [x, vertexHeight(x, z), z],
            neighbor.normal)
        }
      }
    }
    return {
      surface: this.makeGeometry(positions, normals, uvs, ao, colors, indices),
      closure: this.makeGeometry(
        closurePositions,
        closureNormals,
        closureUvs,
        closureAo,
        closureColors,
        closureIndices,
      ),
    }
  }

  /**
   * Emit a far-LOD wall with one sand tile per world block along its long
   * axis. The old closure emitted one 16-block quad and relied on a large
   * absolute UV span. Although RepeatWrapping can represent that mapping,
   * the large primitive makes the side's minified footprint unstable and
   * allows the atlas tile to read as a stretched band at oblique underwater
   * views. Keep each segment's U range local and at most one tile wide; V
   * remains world-height based so the vertical sand scale stays consistent
   * with the one-block ring.
   */
  private appendTiledWall(
    positions: number[],
    normals: number[],
    uvs: number[],
    ao: number[],
    colors: number[],
    indices: number[],
    bottomStart: Vec3Tuple,
    bottomEnd: Vec3Tuple,
    topStart: Vec3Tuple,
    topEnd: Vec3Tuple,
    normal: Vec3Tuple,
  ): void {
    const edgeLength = Math.hypot(
      bottomEnd[0] - bottomStart[0],
      bottomEnd[2] - bottomStart[2],
    )
    const segments = Math.max(1, Math.ceil(edgeLength - 1e-6))
    const uIncreases = Math.abs(bottomEnd[0] - bottomStart[0]) > 1e-6
      ? bottomEnd[0] > bottomStart[0]
      : bottomEnd[2] > bottomStart[2]
    const lerpPoint = (start: Vec3Tuple, end: Vec3Tuple, t: number): Vec3Tuple => [
      THREE.MathUtils.lerp(start[0], end[0], t),
      THREE.MathUtils.lerp(start[1], end[1], t),
      THREE.MathUtils.lerp(start[2], end[2], t),
    ]

    for (let segment = 0; segment < segments; segment += 1) {
      const t0 = segment / segments
      const t1 = (segment + 1) / segments
      const segmentBottomStart = lerpPoint(bottomStart, bottomEnd, t0)
      const segmentBottomEnd = lerpPoint(bottomStart, bottomEnd, t1)
      const segmentTopStart = lerpPoint(topStart, topEnd, t0)
      const segmentTopEnd = lerpPoint(topStart, topEnd, t1)
      // Reset U for every world-block segment. Using t0/t1 here would map
      // the whole LOD edge to one tile and recreate the visible stretch.
      const u0 = uIncreases ? 0 : 1
      const u1 = uIncreases ? 1 : 0
      const v0 = Math.max(0, segmentTopStart[1] - segmentBottomStart[1])
      const v1 = Math.max(0, segmentTopEnd[1] - segmentBottomEnd[1])
      this.appendQuad(
        positions,
        normals,
        uvs,
        ao,
        colors,
        indices,
        [segmentBottomStart, segmentBottomEnd, segmentTopEnd, segmentTopStart],
        normal,
        [[u0, 0], [u1, 0], [u1, v1], [u0, v0]],
      )
    }
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
      ao.push(0.7)
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
      for (const key of [
        'sunDirection',
        'sunColor',
        'dayLight',
        'starLight',
        'skyAmbient',
        'roughness',
        'metalness',
        'envMapIntensity',
        'lightingMix',
        'ditherAmount',
      ]) {
        if (sourceUniforms[key] && targetUniforms[key]) targetUniforms[key].value = sourceUniforms[key].value
      }
      // The visual-only seabed is still a real sun-shadow receiver. Share the
      // complete binding so terrain and the animated character remain able to
      // cast into it underwater, including after target resizes and during
      // Composer's feedback-safe depth capture.
      this.seabedMaterial.shareVoxelShadowState(source)
    }
    this.seabedMaterial.setWaterCaustics(true, this.surfaceY, 0.80, this.time, this.getCausticReferenceDepth(), this.sunIntensity)
  }

  private disposeSeabedMaterial(): void {
    const material = this.seabedMaterial
    if (!material) return
    this.seabedMaterial = null
    this.options.unregisterShadowSamplingMaterial?.(material)
    material.dispose()
  }

  private applyCaustics(): void {
    if (!this.caustics) return
    const texture = this.caustics.getTexture()
    const origin = this.caustics.getOrigin()
    const extent = this.caustics.getExtent()
    const resolution = this.caustics.getResolution()
    const referenceDepth = this.caustics.getReferenceDepth()
    this.options.blockMaterialSource?.setWaterCausticTexture(texture, origin, extent, resolution, referenceDepth)
    this.seabedMaterial?.setWaterCausticTexture(texture, origin, extent, resolution, referenceDepth)
  }
}
