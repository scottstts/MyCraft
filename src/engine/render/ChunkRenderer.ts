/**
 * ChunkRenderer - owns render buffers for authoritative chunks and compiles
 * immutable startup terrain into small static render regions.
 * Input: CHUNK_MESH events from ChunkPipeline
 * Output: up to three Three.js meshes per 1x1x1 chunk region
 */

import * as THREE from 'three'
import { EventEmitter } from '../utils/EventEmitter.js'
import type { ChunkKey, ChunkMeshResponse, MeshBuffers } from '../../types/workers.js'
import { CHUNK_SIZE } from '../../config/constants.js'
import {
  FORWARD_REFRACTION_LAYER,
  type ForwardRefractionParticipantRegistry,
  type ForwardRefractionReceiverMaterials,
} from './water/ForwardRefraction'
import {
  FORWARD_REFRACTION_INDEX_BUCKETS,
  getForwardRefractionMediumForBucket,
  type ForwardRefractionIndexBucket,
} from '../world/ForwardRefractionMeshing.js'

export interface ChunkRendererEvents extends Record<string, unknown> {
  MESH_CREATED: { key: ChunkKey; mesh: THREE.Mesh }
  MESH_UPDATED: { key: ChunkKey; mesh: THREE.Mesh }
  MESH_REMOVED: { key: ChunkKey }
}

export const STATIC_REGION_CHUNK_SIDE = 1

interface ChunkCoordinates {
  cx: number
  cy: number
  cz: number
}

interface RegionMeshes {
  opaque: THREE.Mesh | null
  cutout: THREE.Mesh | null
  transparent: THREE.Mesh | null
}

function parseChunkKey(key: ChunkKey): ChunkCoordinates {
  const [cx, cy, cz] = key.split(',').map((value) => Number(value))
  if (![cx, cy, cz].every(Number.isInteger)) {
    throw new Error(`[ChunkRenderer] Invalid chunk key: ${key}`)
  }
  return { cx, cy, cz }
}

export function getStaticRegionKey(key: ChunkKey): string {
  const { cx, cy, cz } = parseChunkKey(key)
  return `${Math.floor(cx / STATIC_REGION_CHUNK_SIDE)},${cy},${Math.floor(cz / STATIC_REGION_CHUNK_SIDE)}`
}

function hasVertices(buffer: MeshBuffers): boolean {
  return buffer.positions.length > 0
}

function mergeBuffers(
  entries: Array<{ buffer: MeshBuffers; offsetX: number; offsetZ: number }>,
): MeshBuffers | null {
  const nonEmpty = entries.filter(({ buffer }) => hasVertices(buffer))
  if (nonEmpty.length === 0) return null

  const vertexCount = nonEmpty.reduce((sum, { buffer }) => sum + buffer.positions.length / 3, 0)
  const indexCount = nonEmpty.reduce((sum, { buffer }) => sum + buffer.indices.length, 0)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const ao = new Float32Array(vertexCount)
  const hasColors = nonEmpty.some(({ buffer }) => buffer.colors.length > 0)
  const colors = hasColors ? new Float32Array(vertexCount * 3) : new Float32Array(0)
  if (hasColors) colors.fill(1)
  const indices = new Uint32Array(indexCount)
  const forwardIndexLengths = {} as Record<ForwardRefractionIndexBucket, number>
  for (const bucket of FORWARD_REFRACTION_INDEX_BUCKETS) {
    forwardIndexLengths[bucket] = nonEmpty.reduce(
      (sum, { buffer }) => sum + (buffer.forwardIndices?.[bucket]?.length ?? 0),
      0,
    )
  }
  const forwardIndices = {} as Partial<Record<ForwardRefractionIndexBucket, Uint32Array>>
  for (const bucket of FORWARD_REFRACTION_INDEX_BUCKETS) {
    if (forwardIndexLengths[bucket] > 0) {
      forwardIndices[bucket] = new Uint32Array(forwardIndexLengths[bucket])
    }
  }

  let vertexOffset = 0
  let positionOffset = 0
  let uvOffset = 0
  let indexOffset = 0
  const forwardIndexOffsets = {} as Record<ForwardRefractionIndexBucket, number>
  for (const bucket of FORWARD_REFRACTION_INDEX_BUCKETS) forwardIndexOffsets[bucket] = 0
  for (const { buffer, offsetX, offsetZ } of nonEmpty) {
    const localVertexCount = buffer.positions.length / 3
    for (let vertex = 0; vertex < localVertexCount; vertex += 1) {
      const sourcePosition = vertex * 3
      const targetPosition = positionOffset + sourcePosition
      positions[targetPosition] = buffer.positions[sourcePosition] + offsetX
      positions[targetPosition + 1] = buffer.positions[sourcePosition + 1]
      positions[targetPosition + 2] = buffer.positions[sourcePosition + 2] + offsetZ
    }
    normals.set(buffer.normals, positionOffset)
    ao.set(buffer.ao, vertexOffset)
    uvs.set(buffer.uvs, uvOffset)
    if (hasColors && buffer.colors.length > 0) colors.set(buffer.colors, positionOffset)
    for (let index = 0; index < buffer.indices.length; index += 1) {
      indices[indexOffset + index] = buffer.indices[index] + vertexOffset
    }
    for (const bucket of FORWARD_REFRACTION_INDEX_BUCKETS) {
      const sourceIndices = buffer.forwardIndices?.[bucket]
      const targetIndices = forwardIndices[bucket]
      if (!sourceIndices || !targetIndices) continue
      const targetOffset = forwardIndexOffsets[bucket]
      for (let index = 0; index < sourceIndices.length; index += 1) {
        targetIndices[targetOffset + index] = sourceIndices[index] + vertexOffset
      }
      forwardIndexOffsets[bucket] += sourceIndices.length
    }
    vertexOffset += localVertexCount
    positionOffset += buffer.positions.length
    uvOffset += buffer.uvs.length
    indexOffset += buffer.indices.length
  }

  return {
    positions,
    normals,
    uvs,
    ao,
    colors,
    indices,
    ...(Object.keys(forwardIndices).length > 0 ? { forwardIndices } : {}),
  }
}

/**
 * Render storage for chunks. Before startup finalization it uses individual
 * meshes so worker results can arrive independently. Once the complete initial
 * world is known, source buffers remain authoritative while the scene receives
 * up to three 1x1 chunk region meshes. A later edit rebuilds its one affected region.
 */
export class ChunkRenderer extends EventEmitter<ChunkRendererEvents> {
  private readonly scene: THREE.Scene
  private readonly materialOpaque: THREE.Material
  private readonly materialCutout: THREE.Material
  private readonly materialTransparent: THREE.Material
  private readonly forwardRefractionParticipants?: ForwardRefractionParticipantRegistry
  private readonly forwardRefractionReceiverMaterials?: ForwardRefractionReceiverMaterials
  private readonly registerSolidTerrainMesh?: (mesh: THREE.Mesh) => void
  private readonly unregisterSolidTerrainMesh?: (mesh: THREE.Mesh) => void
  private readonly chunkBuffers = new Map<ChunkKey, ChunkMeshResponse['payload']>()
  private readonly chunkMeshes = new Map<ChunkKey, THREE.Mesh>()
  private readonly chunkGroups = new Map<ChunkKey, THREE.Group>()
  private readonly chunkForwardMeshes = new Map<ChunkKey, THREE.Mesh[]>()
  private readonly regionMembers = new Map<string, Set<ChunkKey>>()
  private readonly regionGroups = new Map<string, THREE.Group>()
  private readonly regionMeshes = new Map<string, RegionMeshes>()
  private readonly regionForwardMeshes = new Map<string, THREE.Mesh[]>()
  private blockWaterIndexCount = 0
  private regionsFinalized = false

  constructor(
    scene: THREE.Scene,
    materials: { opaque: THREE.Material; cutout?: THREE.Material; transparent: THREE.Material },
    options: {
      forwardRefractionParticipants?: ForwardRefractionParticipantRegistry
      forwardRefractionReceiverMaterials?: ForwardRefractionReceiverMaterials
      registerSolidTerrainMesh?: (mesh: THREE.Mesh) => void
      unregisterSolidTerrainMesh?: (mesh: THREE.Mesh) => void
    } = {},
  ) {
    super()
    this.scene = scene
    this.materialOpaque = materials.opaque
    this.materialCutout = materials.cutout ?? materials.opaque
    this.materialTransparent = materials.transparent
    this.forwardRefractionParticipants = options.forwardRefractionParticipants
    this.forwardRefractionReceiverMaterials = options.forwardRefractionReceiverMaterials
    this.registerSolidTerrainMesh = options.registerSolidTerrainMesh
    this.unregisterSolidTerrainMesh = options.unregisterSolidTerrainMesh
  }

  /** Handle chunk mesh data from the mesher worker. */
  handleChunkMesh(response: ChunkMeshResponse): void {
    const { key, payload } = response
    if (
      !hasVertices(payload.opaque) &&
      !hasVertices(payload.cutout) &&
      !hasVertices(payload.transparent)
    ) {
      this.removeChunkMesh(key)
      return
    }

    const wasLoaded = this.chunkBuffers.has(key)
    const previousBuffers = this.chunkBuffers.get(key)
    if (previousBuffers) this.blockWaterIndexCount -= previousBuffers.transparent.indices.length
    this.chunkBuffers.set(key, payload)
    this.blockWaterIndexCount += payload.transparent.indices.length
    if (this.regionsFinalized) {
      this.addRegionMember(key)
      this.rebuildRegion(getStaticRegionKey(key))
      const mesh = this.chunkMeshes.get(key)
      if (mesh) this.emit(wasLoaded ? 'MESH_UPDATED' : 'MESH_CREATED', { key, mesh })
      return
    }

    this.updateIndividualChunk(key, payload)
    const mesh = this.chunkMeshes.get(key)
    if (mesh) this.emit(wasLoaded ? 'MESH_UPDATED' : 'MESH_CREATED', { key, mesh })
  }

  /**
   * Switch the complete initial world from independently arriving chunks to
   * static 1x1 region meshes. This is intentionally called once, after startup
   * readiness, so the authoritative per-chunk buffers remain available for
   * edits and no partial region is treated as immutable.
   */
  finalizeStaticRegions(): void {
    if (this.regionsFinalized) return
    this.regionsFinalized = true

    for (const [key, group] of this.chunkGroups) {
      this.scene.remove(group)
      this.disposeGroupMeshes(group)
      this.chunkForwardMeshes.delete(key)
      this.chunkGroups.delete(key)
    }
    this.chunkMeshes.clear()
    this.regionMembers.clear()
    for (const key of this.chunkBuffers.keys()) this.addRegionMember(key)
    for (const regionKey of this.regionMembers.keys()) this.rebuildRegion(regionKey)
  }

  /** Remove the render storage for one chunk. */
  removeChunkMesh(key: ChunkKey): void {
    const previousBuffers = this.chunkBuffers.get(key)
    if (!previousBuffers) return
    this.chunkBuffers.delete(key)
    this.blockWaterIndexCount -= previousBuffers.transparent.indices.length

    const previousMesh = this.chunkMeshes.get(key)
    this.chunkMeshes.delete(key)
    if (this.regionsFinalized) {
      const regionKey = getStaticRegionKey(key)
      const members = this.regionMembers.get(regionKey)
      members?.delete(key)
      if (members && members.size === 0) this.regionMembers.delete(regionKey)
      this.rebuildRegion(regionKey)
    } else {
      const group = this.chunkGroups.get(key)
      if (group) {
        this.scene.remove(group)
        this.disposeGroupMeshes(group)
        this.chunkForwardMeshes.delete(key)
        this.chunkGroups.delete(key)
      }
    }
    if (previousMesh) this.emit('MESH_REMOVED', { key })
  }

  getChunkMesh(key: ChunkKey): THREE.Mesh | undefined {
    return this.chunkMeshes.get(key)
  }

  getLoadedChunkKeys(): ChunkKey[] {
    return Array.from(this.chunkBuffers.keys())
  }

  /** Number of authoritative chunk results retained by the renderer. */
  getLoadedMeshCount(): number {
    return this.chunkBuffers.size
  }

  /** Whether any authoritative chunk currently contains legacy block-water faces. */
  hasBlockWaterGeometry(): boolean {
    return this.blockWaterIndexCount > 0
  }

  /** Number of actual scene draw meshes after optional region compilation. */
  getRenderedMeshCount(): number {
    if (!this.regionsFinalized) return this.chunkMeshes.size
    let count = 0
    for (const meshes of this.regionMeshes.values()) {
      if (meshes.opaque) count += 1
      if (meshes.cutout) count += 1
      if (meshes.transparent) count += 1
    }
    return count
  }

  clear(): void {
    for (const key of Array.from(this.chunkBuffers.keys())) this.removeChunkMesh(key)
  }

  destroy(): void {
    this.clear()
    for (const [regionKey, group] of this.regionGroups) {
      this.scene.remove(group)
      const meshes = this.regionMeshes.get(regionKey)
      if (meshes) {
        for (const mesh of [meshes.opaque, meshes.cutout, meshes.transparent]) {
          if (mesh) this.disposeMesh(mesh)
        }
      }
      const forwardMeshes = this.regionForwardMeshes.get(regionKey) ?? []
      for (const mesh of forwardMeshes) this.disposeMesh(mesh)
      group.clear()
      this.regionForwardMeshes.delete(regionKey)
      this.regionGroups.delete(regionKey)
    }
    this.regionMeshes.clear()
    this.regionMembers.clear()
    this.chunkMeshes.clear()
    this.chunkBuffers.clear()
    this.blockWaterIndexCount = 0
  }

  private updateIndividualChunk(
    key: ChunkKey,
    payload: ChunkMeshResponse['payload'],
  ): void {
    let group = this.chunkGroups.get(key)
    if (!group) {
      group = new THREE.Group()
      group.name = `Chunk:${key}`
      this.chunkGroups.set(key, group)
      this.scene.add(group)
    }

    const existingOpaque = group.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.material === this.materialOpaque,
    )
    const existingCutout = group.children.find(
      (child): child is THREE.Mesh => child !== existingOpaque &&
        child instanceof THREE.Mesh && child.material === this.materialCutout,
    )
    const existingTransparent = group.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.material === this.materialTransparent,
    )
    const previousForwardMeshes = this.chunkForwardMeshes.get(key) ?? []
    this.chunkForwardMeshes.delete(key)
    for (const mesh of previousForwardMeshes) this.disposeMesh(mesh)
    group.clear()
    const reused = new Set<THREE.Mesh>()
    const opaqueMesh = this.upsertMesh(payload.opaque, existingOpaque, this.materialOpaque, false, true, reused)
    const cutoutMesh = this.upsertMesh(payload.cutout, existingCutout, this.materialCutout, false, false, reused)
    const transparentMesh = this.upsertMesh(payload.transparent, existingTransparent, this.materialTransparent, true, false, reused)
    for (const oldMesh of [existingOpaque, existingCutout, existingTransparent]) {
      if (oldMesh && !reused.has(oldMesh)) this.disposeMesh(oldMesh)
    }

    if (!opaqueMesh && !cutoutMesh && !transparentMesh) {
      this.removeChunkMesh(key)
      return
    }

    const { cx, cy, cz } = parseChunkKey(key)
    group.position.set(cx * CHUNK_SIZE.x, cy * CHUNK_SIZE.y, cz * CHUNK_SIZE.z)
    if (opaqueMesh) group.add(opaqueMesh)
    if (cutoutMesh) group.add(cutoutMesh)
    if (transparentMesh) group.add(transparentMesh)
    const forwardMeshes = [
      ...this.createForwardMeshes(payload.opaque, this.materialOpaque),
      ...this.createForwardMeshes(payload.cutout, this.materialCutout),
    ]
    for (const mesh of forwardMeshes) group.add(mesh)
    this.chunkForwardMeshes.set(key, forwardMeshes)
    this.chunkMeshes.set(key, opaqueMesh ?? cutoutMesh ?? transparentMesh!)
  }

  private addRegionMember(key: ChunkKey): void {
    const regionKey = getStaticRegionKey(key)
    const members = this.regionMembers.get(regionKey)
    if (members) members.add(key)
    else this.regionMembers.set(regionKey, new Set([key]))
  }

  private rebuildRegion(regionKey: string): void {
    const members = this.regionMembers.get(regionKey)
    const entries = members
      ? Array.from(members).flatMap((key) => {
        const buffers = this.chunkBuffers.get(key)
        if (!buffers) return []
        const { cx, cz } = parseChunkKey(key)
        const [regionX, , regionZ] = regionKey.split(',').map(Number)
        return [{
          buffers,
          offsetX: (cx - regionX * STATIC_REGION_CHUNK_SIDE) * CHUNK_SIZE.x,
          offsetZ: (cz - regionZ * STATIC_REGION_CHUNK_SIDE) * CHUNK_SIZE.z,
        }]
      })
      : []

    if (entries.length === 0) {
      this.removeRegion(regionKey)
      return
    }

    let group = this.regionGroups.get(regionKey)
    if (!group) {
      group = new THREE.Group()
      group.name = `ChunkRegion:${regionKey}`
      this.regionGroups.set(regionKey, group)
      this.scene.add(group)
    }
    const previous = this.regionMeshes.get(regionKey)
    const previousOpaque = previous?.opaque ?? null
    const previousCutout = previous?.cutout ?? null
    const previousTransparent = previous?.transparent ?? null
    const mergedOpaque = mergeBuffers(entries.map(({ buffers, offsetX, offsetZ }) => ({
      buffer: buffers.opaque,
      offsetX,
      offsetZ,
    })))
    const mergedCutout = mergeBuffers(entries.map(({ buffers, offsetX, offsetZ }) => ({
      buffer: buffers.cutout,
      offsetX,
      offsetZ,
    })))
    const mergedTransparent = mergeBuffers(entries.map(({ buffers, offsetX, offsetZ }) => ({
      buffer: buffers.transparent,
      offsetX,
      offsetZ,
    })))
    const previousForwardMeshes = this.regionForwardMeshes.get(regionKey) ?? []
    this.regionForwardMeshes.delete(regionKey)
    for (const mesh of previousForwardMeshes) this.disposeMesh(mesh)
    group.clear()
    const reused = new Set<THREE.Mesh>()
    const opaque = this.upsertMesh(
      mergedOpaque,
      previousOpaque,
      this.materialOpaque,
      false,
      true,
      reused,
    )
    const cutout = this.upsertMesh(
      mergedCutout,
      previousCutout,
      this.materialCutout,
      false,
      false,
      reused,
    )
    const transparent = this.upsertMesh(
      mergedTransparent,
      previousTransparent,
      this.materialTransparent,
      true,
      false,
      reused,
    )
    for (const oldMesh of [previousOpaque, previousCutout, previousTransparent]) {
      if (oldMesh && !reused.has(oldMesh)) this.disposeMesh(oldMesh)
    }

    const [regionX, regionY, regionZ] = regionKey.split(',').map(Number)
    group.position.set(
      regionX * STATIC_REGION_CHUNK_SIDE * CHUNK_SIZE.x,
      regionY * CHUNK_SIZE.y,
      regionZ * STATIC_REGION_CHUNK_SIDE * CHUNK_SIZE.z,
    )
    if (opaque) group.add(opaque)
    if (cutout) group.add(cutout)
    if (transparent) group.add(transparent)
    const forwardMeshes = [
      ...this.createForwardMeshes(mergedOpaque, this.materialOpaque),
      ...this.createForwardMeshes(mergedCutout, this.materialCutout),
    ]
    for (const mesh of forwardMeshes) group.add(mesh)
    this.regionForwardMeshes.set(regionKey, forwardMeshes)
    if (!opaque && !cutout && !transparent) {
      this.removeRegion(regionKey)
      return
    }
    this.regionMeshes.set(regionKey, { opaque, cutout, transparent })
    for (const key of members ?? []) {
      const buffers = this.chunkBuffers.get(key)
      const primary = buffers && hasVertices(buffers.opaque)
        ? opaque ?? cutout ?? transparent
        : buffers && hasVertices(buffers.cutout)
          ? cutout ?? opaque ?? transparent
          : transparent ?? opaque ?? cutout
      if (primary) this.chunkMeshes.set(key, primary)
    }
  }

  private removeRegion(regionKey: string): void {
    const group = this.regionGroups.get(regionKey)
    if (group) this.scene.remove(group)
    const meshes = this.regionMeshes.get(regionKey)
    if (meshes) {
      for (const mesh of [meshes.opaque, meshes.cutout, meshes.transparent]) {
        if (mesh) this.disposeMesh(mesh)
      }
    }
    for (const mesh of this.regionForwardMeshes.get(regionKey) ?? []) this.disposeMesh(mesh)
    group?.clear()
    this.regionGroups.delete(regionKey)
    this.regionMeshes.delete(regionKey)
    this.regionForwardMeshes.delete(regionKey)
    for (const key of this.regionMembers.get(regionKey) ?? []) this.chunkMeshes.delete(key)
  }

  private upsertMesh(
    buffer: MeshBuffers | null,
    existing: THREE.Mesh | null | undefined,
    material: THREE.Material,
    transparent: boolean,
    solidTerrain: boolean,
    reused: Set<THREE.Mesh>,
  ): THREE.Mesh | null {
    if (!buffer || !hasVertices(buffer)) return null
    const mesh = existing ?? new THREE.Mesh(new THREE.BufferGeometry(), material)
    reused.add(mesh)
    const geometry = mesh.geometry as THREE.BufferGeometry

    const ensureAttribute = (name: string, itemSize: number, array: Float32Array): void => {
      const current = geometry.getAttribute(name) as THREE.BufferAttribute | undefined
      if (current && current.array.length === array.length && current.array.constructor === array.constructor) {
        current.set(array, 0)
        current.needsUpdate = true
      } else {
        geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize))
      }
    }
    ensureAttribute('position', 3, buffer.positions)
    geometry.boundingSphere = null
    geometry.boundingBox = null
    ensureAttribute('normal', 3, buffer.normals)
    ensureAttribute('uv', 2, buffer.uvs)
    ensureAttribute('ao', 1, buffer.ao)
    if (buffer.colors.length > 0) ensureAttribute('color', 3, buffer.colors)
    else geometry.deleteAttribute('color')

    const currentIndex = geometry.getIndex()
    if (
      currentIndex &&
      currentIndex.array.length === buffer.indices.length &&
      currentIndex.array.constructor === buffer.indices.constructor
    ) {
      currentIndex.set(buffer.indices, 0)
      currentIndex.needsUpdate = true
    } else {
      geometry.setIndex(new THREE.BufferAttribute(buffer.indices, 1))
    }
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    mesh.position.set(0, 0, 0)
    mesh.castShadow = false
    mesh.receiveShadow = false
    if (transparent) mesh.renderOrder = 2
    if (solidTerrain) this.registerSolidTerrainMesh?.(mesh)
    // Dedicated receiver meshes use geometry-only shaders below. Keep the
    // visual terrain out of the forward registry so the expensive full
    // material branch is not executed in either forward-refraction raster.
    if (!this.forwardRefractionReceiverMaterials || !this.forwardRefractionParticipants) {
      this.forwardRefractionParticipants?.register(mesh)
    }
    return mesh
  }

  private createForwardMeshes(buffer: MeshBuffers | null, colorMaterial: THREE.Material): THREE.Mesh[] {
    if (
      !buffer ||
      !this.forwardRefractionReceiverMaterials ||
      !this.forwardRefractionParticipants
    ) return []
    const meshes: THREE.Mesh[] = []
    const colors = buffer.colors.length > 0
      ? buffer.colors
      : new Float32Array(buffer.positions.length)
    if (buffer.colors.length === 0) colors.fill(1)
    const sharedPosition = new THREE.BufferAttribute(buffer.positions, 3)
    const sharedNormal = new THREE.BufferAttribute(buffer.normals, 3)
    const sharedUv = new THREE.BufferAttribute(buffer.uvs, 2)
    const sharedAo = new THREE.BufferAttribute(buffer.ao, 1)
    const sharedColor = new THREE.BufferAttribute(colors, 3)
    for (const bucket of FORWARD_REFRACTION_INDEX_BUCKETS) {
      const indices = buffer.forwardIndices?.[bucket]
      if (!indices || indices.length === 0) continue
      const cutout = bucket.endsWith('Cutout')
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', sharedPosition)
      // The receiver shader only consumes position (and UV for a cutout), but
      // the same source mesh switches to the full BlockMaterial for the color
      // draw. Keep that second material's required attributes on the shared
      // geometry so the optimization cannot turn refracted terrain black or
      // unlit when it reaches the radiance target.
      geometry.setAttribute('normal', sharedNormal)
      geometry.setAttribute('uv', sharedUv)
      geometry.setAttribute('ao', sharedAo)
      geometry.setAttribute('color', sharedColor)
      geometry.setIndex(new THREE.BufferAttribute(indices, 1))
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(
        geometry,
        cutout
          ? this.forwardRefractionReceiverMaterials.cutout
          : this.forwardRefractionReceiverMaterials.opaque,
      )
      mesh.name = `ForwardRefraction:${bucket}`
      mesh.layers.set(FORWARD_REFRACTION_LAYER)
      mesh.frustumCulled = true
      mesh.castShadow = false
      mesh.receiveShadow = false
      this.forwardRefractionParticipants?.register(mesh, {
        forwardOnly: true,
        medium: getForwardRefractionMediumForBucket(bucket),
        receiverMaterial: cutout
          ? this.forwardRefractionReceiverMaterials.cutout
          : this.forwardRefractionReceiverMaterials.opaque,
        colorMaterial,
      })
      meshes.push(mesh)
    }
    return meshes
  }

  private disposeMesh(mesh: THREE.Mesh): void {
    this.unregisterSolidTerrainMesh?.(mesh)
    this.forwardRefractionParticipants?.unregister(mesh)
    mesh.geometry.dispose()
  }

  private disposeGroupMeshes(group: THREE.Group): void {
    for (const child of group.children) {
      if (child instanceof THREE.Mesh) this.disposeMesh(child)
    }
    group.clear()
  }
}
