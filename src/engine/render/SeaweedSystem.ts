import * as THREE from 'three'
import seaweedTextureUrl from '../../assets/textures/seaweed.png'
import { CHUNK_SIZE } from '../../config/constants'
import {
  createSeaweedSessionSeed,
  generateSeaweedAnchors,
  type SeaweedAnchor,
  type SeaweedFieldBounds,
  type SeaweedFieldDiagnostics,
} from './SeaweedField'
import { SeaweedMaterial } from './SeaweedMaterial'
import { createXBillboardGeometry } from './BillboardGeometry'
import { CAUSTIC_REFERENCE_DEPTH } from './water/WaterOptics'

export interface SeaweedSystemOptions {
  bounds: SeaweedFieldBounds
  terrainSeed: number
  worldRadius: number
  waterLevel: number
  /** Omit to create a fresh random field for this game load. */
  distributionSeed?: number
}

function createPlaceholderTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    // Keep the asynchronous loading frame invisible rather than showing a
    // white rectangle where the alpha-cutout asset will arrive.
    new Uint8Array([255, 255, 255, 0]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

function configureSeaweedTexture(texture: THREE.Texture): void {
  texture.flipY = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
}

function getTextureAspect(texture: THREE.Texture): number | null {
  const image = texture.image as {
    width?: number
    height?: number
    naturalWidth?: number
    naturalHeight?: number
  } | undefined
  const width = image?.naturalWidth || image?.width || 0
  const height = image?.naturalHeight || image?.height || 0
  if (width <= 0 || height <= 0) return null
  const aspect = width / height
  return Number.isFinite(aspect) && aspect > 0 ? aspect : null
}

function chunkCoordinate(position: number): number {
  return Math.floor(position / CHUNK_SIZE.x)
}

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`
}

/**
 * Render-only ocean vegetation. It deliberately has no World listener:
 * seaweed is not a block, is never selectable, and is absent from gameplay
 * data, interaction, saves, collision, and inventory.
 */
export class SeaweedSystem {
  private readonly scene: THREE.Scene
  private readonly options: SeaweedSystemOptions
  private readonly distributionSeed: number
  private readonly material: SeaweedMaterial
  private baseGeometry: THREE.BufferGeometry | null = null
  private texture: THREE.Texture
  /** Set only from the loaded seaweed image's actual pixel dimensions. */
  private textureAspect: number | null = null
  private readonly groups = new Map<string, THREE.Group>()
  private anchors: SeaweedAnchor[] = []
  private fieldDiagnostics: SeaweedFieldDiagnostics = {
    distributionSeed: 0,
    candidateCount: 0,
    acceptedCount: 0,
    minDistance: 0,
    minimumDepth: 0,
    safeSurfaceY: 0,
    depthRange: { min: 0, max: 0 },
    heightRange: { min: 0, max: 0 },
    oceanOnly: true,
    weightedBy: [],
  }
  private disposed = false

  constructor(scene: THREE.Scene, options: SeaweedSystemOptions) {
    this.scene = scene
    this.distributionSeed = options.distributionSeed ?? createSeaweedSessionSeed()
    this.options = {
      ...options,
      distributionSeed: this.distributionSeed,
    }

    const placeholder = createPlaceholderTexture()
    this.texture = placeholder
    this.material = new SeaweedMaterial(placeholder)

    if (typeof document !== 'undefined') {
      new THREE.TextureLoader().load(
        seaweedTextureUrl as unknown as string,
        (texture) => {
          if (this.disposed) {
            texture.dispose()
            return
          }
          configureSeaweedTexture(texture)
          this.texture = texture
          this.material.setMap(texture)
          this.updateTextureAspect(texture)
          placeholder.dispose()
        },
        undefined,
        (error) => {
          console.warn('[SeaweedSystem] Failed to load seaweed texture:', error)
        },
      )
      // Keep the placeholder active until the image has dimensions. The
      // billboard cannot be sized correctly until the asset itself is loaded.
    }

    this.material.setWaterLevel(options.waterLevel + 0.5)
    this.material.setWaterCaustics(true, options.waterLevel + 0.5, 0.8, CAUSTIC_REFERENCE_DEPTH, 1.35)
    this.rebuildField()
  }

  getMaterial(): SeaweedMaterial { return this.material }

  getTexture(): THREE.Texture { return this.texture }

  getShadowAnchors(): ReadonlyArray<SeaweedAnchor> { return this.anchors }

  getDistributionSeed(): number { return this.distributionSeed }

  setTerrainSeed(seed: number): void {
    if (this.options.terrainSeed === seed || this.disposed) return
    this.options.terrainSeed = seed
    this.rebuildField()
  }

  update(timeSeconds: number): void {
    if (this.disposed) return
    this.material.setTime(timeSeconds)
  }

  setWaterLevel(level: number): void {
    this.material.setWaterLevel(level)
  }

  setSun(direction: THREE.Vector3, color: THREE.Color): void {
    this.material.setSun(direction, color)
  }

  setDayNight(day: number, star: number): void {
    this.material.setDayNight(day, star)
  }

  setSkyAmbient(color: THREE.Color): void {
    this.material.setSkyAmbient(color)
  }

  setVoxelShadowTexture(texture: THREE.Texture, width: number, height: number, enabled = true): void {
    this.material.setVoxelShadowTexture(texture, width, height, enabled)
  }

  setVoxelShadowDepthTexture(texture: THREE.Texture, near: number, far: number): void {
    this.material.setVoxelShadowDepthTexture(texture, near, far)
  }

  shareVoxelShadowState(source: THREE.ShaderMaterial): void {
    this.material.shareVoxelShadowState(source)
  }

  setWaterCaustics(
    enabled: boolean,
    waterLevel: number,
    intensity: number,
    referenceDepth = CAUSTIC_REFERENCE_DEPTH,
    sunIntensity = 1.35,
  ): void {
    this.material.setWaterCaustics(enabled, waterLevel, intensity, referenceDepth, sunIntensity)
  }

  setWaterCausticTexture(
    texture: THREE.Texture | null,
    origin: { x: number; y: number },
    extent: number,
    resolution: { x: number; y: number },
    referenceDepth = CAUSTIC_REFERENCE_DEPTH,
  ): void {
    this.material.setWaterCausticTexture(texture, origin, extent, resolution, referenceDepth)
  }

  getDiagnostics(): SeaweedFieldDiagnostics & {
    chunkGroups: number
    texture: string
    textureAspect: number | null
    castShadow: boolean
    receiveShadow: boolean
    renderOrder: number
  } {
    return {
      ...this.fieldDiagnostics,
      chunkGroups: this.groups.size,
      texture: 'src/assets/textures/seaweed.png',
      textureAspect: this.textureAspect,
      castShadow: true,
      receiveShadow: true,
      renderOrder: 1,
    }
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeGroups()
    this.baseGeometry?.dispose()
    this.material.dispose()
    this.texture.dispose()
  }

  private rebuildField(): void {
    this.disposeGroups()
    const generated = generateSeaweedAnchors({
      bounds: this.options.bounds,
      terrainSeed: this.options.terrainSeed,
      worldRadius: this.options.worldRadius,
      distributionSeed: this.distributionSeed,
      waterLevel: this.options.waterLevel,
    })
    this.anchors = generated.anchors
    this.fieldDiagnostics = generated.diagnostics
    this.rebuildGroups()
  }

  private rebuildGroups(): void {
    if (!this.baseGeometry || this.disposed) return

    const anchorsByChunk = new Map<string, SeaweedAnchor[]>()
    for (const anchor of this.anchors) {
      const key = chunkKey(chunkCoordinate(anchor.x), chunkCoordinate(anchor.z))
      const list = anchorsByChunk.get(key)
      if (list) list.push(anchor)
      else anchorsByChunk.set(key, [anchor])
    }

    for (const [key, chunkAnchors] of anchorsByChunk) {
      const [cx, cz] = key.split(',').map(Number)
      const geometry = this.baseGeometry.clone()
      const seeds = new Float32Array(chunkAnchors.length)
      geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
      const mesh = new THREE.InstancedMesh(geometry, this.material, chunkAnchors.length)
      mesh.name = `SeaweedBillboards:${key}`
      // The project renderer resolves sun visibility through the shared voxel
      // pass, but retaining these flags keeps the object a valid native
      // shadow caster/receiver if a future renderer enables raster shadows.
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.renderOrder = 1
      mesh.frustumCulled = true

      const dummy = new THREE.Object3D()
      const centerOffset = new THREE.Vector3()
      const yawAxis = new THREE.Vector3(0, 1, 0)
      for (let index = 0; index < chunkAnchors.length; index += 1) {
        const anchor = chunkAnchors[index]
        const localX = anchor.x - cx * CHUNK_SIZE.x
        const localZ = anchor.z - cz * CHUNK_SIZE.z
        const widthScale = 0.78 + anchor.seed * 0.34
        seeds[index] = anchor.seed
        // Preserve the continuous root while giving each plant a random yaw.
        // The shared billboard geometry is centered at (0.5, 0.5), so its
        // scaled/rotated center offset must be subtracted from the instance
        // translation rather than assuming a unit, axis-aligned transform.
        dummy.quaternion.setFromAxisAngle(yawAxis, anchor.seed * Math.PI * 2)
        dummy.scale.set(widthScale, anchor.height, widthScale)
        centerOffset.set(0.5 * widthScale, 0, 0.5 * widthScale).applyQuaternion(dummy.quaternion)
        dummy.position.set(
          localX - centerOffset.x,
          anchor.rootY,
          localZ - centerOffset.z,
        )
        dummy.updateMatrix()
        mesh.setMatrixAt(index, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      ;(geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute).needsUpdate = true
      mesh.computeBoundingSphere()

      const group = new THREE.Group()
      group.name = `SeaweedChunk:${key}`
      group.position.set(cx * CHUNK_SIZE.x, 0, cz * CHUNK_SIZE.z)
      group.add(mesh)
      this.scene.add(group)
      this.groups.set(key, group)
    }
  }

  private updateTextureAspect(texture: THREE.Texture): void {
    const aspect = getTextureAspect(texture)
    if (aspect === null) {
      console.warn('[SeaweedSystem] Seaweed texture has no usable image dimensions')
      return
    }
    if (this.baseGeometry && this.textureAspect !== null && Math.abs(aspect - this.textureAspect) < 1e-4) {
      return
    }
    this.textureAspect = aspect
    this.baseGeometry?.dispose()
    this.baseGeometry = createXBillboardGeometry(this.textureAspect, 1.0)
    this.disposeGroups()
    this.rebuildGroups()
  }

  private disposeGroups(): void {
    for (const group of this.groups.values()) {
      this.scene.remove(group)
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
    }
    this.groups.clear()
  }
}
