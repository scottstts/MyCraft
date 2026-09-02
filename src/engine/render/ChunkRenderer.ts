/**
 * ChunkRenderer - owns render buffers for authoritative chunks and compiles
 * immutable startup terrain into small static render regions.
 * Input: CHUNK_MESH events from ChunkPipeline
 * Output: one or two Three.js meshes per 2x2x1 chunk region
 */

import * as THREE from 'three'
import { EventEmitter } from '../utils/EventEmitter.js'
import type { ChunkKey, ChunkMeshResponse, MeshBuffers } from '../../types/workers.js'
import { CHUNK_SIZE } from '../../config/constants.js'
import type { ForwardRefractionParticipantRegistry } from './water/ForwardRefraction'

export interface ChunkRendererEvents extends Record<string, unknown> {
  MESH_CREATED: { key: ChunkKey; mesh: THREE.Mesh }
  MESH_UPDATED: { key: ChunkKey; mesh: THREE.Mesh }
  MESH_REMOVED: { key: ChunkKey }
}

export const STATIC_REGION_CHUNK_SIDE = 2

interface ChunkCoordinates {
  cx: number
  cy: number
  cz: number
}

interface RegionMeshes {
  opaque: THREE.Mesh | null
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

  let vertexOffset = 0
  let positionOffset = 0
  let uvOffset = 0
  let indexOffset = 0
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
    vertexOffset += localVertexCount
    positionOffset += buffer.positions.length
    uvOffset += buffer.uvs.length
    indexOffset += buffer.indices.length
  }

  return { positions, normals, uvs, ao, colors, indices }
}

/**
 * Render storage for chunks. Before startup finalization it uses individual
 * meshes so worker results can arrive independently. Once the complete initial
 * world is known, source buffers remain authoritative while the scene receives
 * only 2x2 chunk region meshes. A later edit rebuilds its one affected region.
 */
export class ChunkRenderer extends EventEmitter<ChunkRendererEvents> {
  private readonly scene: THREE.Scene
  private readonly materialOpaque: THREE.Material
  private readonly materialTransparent: THREE.Material
  private readonly forwardRefractionParticipants?: ForwardRefractionParticipantRegistry
  private readonly chunkBuffers = new Map<ChunkKey, { opaque: MeshBuffers; transparent: MeshBuffers }>()
  private readonly chunkMeshes = new Map<ChunkKey, THREE.Mesh>()
  private readonly chunkGroups = new Map<ChunkKey, THREE.Group>()
  private readonly regionMembers = new Map<string, Set<ChunkKey>>()
  private readonly regionGroups = new Map<string, THREE.Group>()
  private readonly regionMeshes = new Map<string, RegionMeshes>()
  private regionsFinalized = false

  constructor(
    scene: THREE.Scene,
    materials: { opaque: THREE.Material; transparent: THREE.Material },
    options: { forwardRefractionParticipants?: ForwardRefractionParticipantRegistry } = {},
  ) {
    super()
    this.scene = scene
    this.materialOpaque = materials.opaque
    this.materialTransparent = materials.transparent
    this.forwardRefractionParticipants = options.forwardRefractionParticipants
  }

  /** Handle chunk mesh data from the mesher worker. */
  handleChunkMesh(response: ChunkMeshResponse): void {
    const { key, payload } = response
    if (!hasVertices(payload.opaque) && !hasVertices(payload.transparent)) {
      this.removeChunkMesh(key)
      return
    }

    const wasLoaded = this.chunkBuffers.has(key)
    this.chunkBuffers.set(key, payload)
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
   * static 2x2 region meshes. This is intentionally called once, after startup
   * readiness, so the authoritative per-chunk buffers remain available for
   * edits and no partial region is treated as immutable.
   */
  finalizeStaticRegions(): void {
    if (this.regionsFinalized) return
    this.regionsFinalized = true

    for (const [key, group] of this.chunkGroups) {
      this.scene.remove(group)
      this.disposeGroupMeshes(group)
      this.chunkGroups.delete(key)
    }
    this.chunkMeshes.clear()
    this.regionMembers.clear()
    for (const key of this.chunkBuffers.keys()) this.addRegionMember(key)
    for (const regionKey of this.regionMembers.keys()) this.rebuildRegion(regionKey)
  }

  /** Remove the render storage for one chunk. */
  removeChunkMesh(key: ChunkKey): void {
    const hadBuffer = this.chunkBuffers.delete(key)
    if (!hadBuffer) return

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

  /** Number of actual scene draw meshes after optional region compilation. */
  getRenderedMeshCount(): number {
    if (!this.regionsFinalized) return this.chunkMeshes.size
    let count = 0
    for (const meshes of this.regionMeshes.values()) {
      if (meshes.opaque) count += 1
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
        for (const mesh of [meshes.opaque, meshes.transparent]) {
          if (!mesh) continue
          this.forwardRefractionParticipants?.unregister(mesh)
          mesh.geometry.dispose()
        }
      }
      this.regionGroups.delete(regionKey)
    }
    this.regionMeshes.clear()
    this.regionMembers.clear()
    this.chunkMeshes.clear()
    this.chunkBuffers.clear()
  }

  private updateIndividualChunk(
    key: ChunkKey,
    payload: { opaque: MeshBuffers; transparent: MeshBuffers },
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
    const existingTransparent = group.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.material === this.materialTransparent,
    )
    group.clear()
    const reused = new Set<THREE.Mesh>()
    const opaqueMesh = this.upsertMesh(payload.opaque, existingOpaque, this.materialOpaque, false, reused)
    const transparentMesh = this.upsertMesh(payload.transparent, existingTransparent, this.materialTransparent, true, reused)
    for (const oldMesh of [existingOpaque, existingTransparent]) {
      if (oldMesh && !reused.has(oldMesh)) this.disposeMesh(oldMesh)
    }

    if (!opaqueMesh && !transparentMesh) {
      this.removeChunkMesh(key)
      return
    }

    const { cx, cy, cz } = parseChunkKey(key)
    group.position.set(cx * CHUNK_SIZE.x, cy * CHUNK_SIZE.y, cz * CHUNK_SIZE.z)
    if (opaqueMesh) group.add(opaqueMesh)
    if (transparentMesh) group.add(transparentMesh)
    this.chunkMeshes.set(key, opaqueMesh ?? transparentMesh!)
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
    const previousTransparent = previous?.transparent ?? null
    group.clear()
    const reused = new Set<THREE.Mesh>()
    const opaque = this.upsertMesh(
      mergeBuffers(entries.map(({ buffers, offsetX, offsetZ }) => ({ buffer: buffers.opaque, offsetX, offsetZ }))),
      previousOpaque,
      this.materialOpaque,
      false,
      reused,
    )
    const transparent = this.upsertMesh(
      mergeBuffers(entries.map(({ buffers, offsetX, offsetZ }) => ({ buffer: buffers.transparent, offsetX, offsetZ }))),
      previousTransparent,
      this.materialTransparent,
      true,
      reused,
    )
    for (const oldMesh of [previousOpaque, previousTransparent]) {
      if (oldMesh && !reused.has(oldMesh)) this.disposeMesh(oldMesh)
    }

    const [regionX, regionY, regionZ] = regionKey.split(',').map(Number)
    group.position.set(
      regionX * STATIC_REGION_CHUNK_SIDE * CHUNK_SIZE.x,
      regionY * CHUNK_SIZE.y,
      regionZ * STATIC_REGION_CHUNK_SIDE * CHUNK_SIZE.z,
    )
    if (opaque) group.add(opaque)
    if (transparent) group.add(transparent)
    if (!opaque && !transparent) {
      this.removeRegion(regionKey)
      return
    }
    this.regionMeshes.set(regionKey, { opaque, transparent })
    for (const key of members ?? []) {
      const buffers = this.chunkBuffers.get(key)
      const primary = buffers && hasVertices(buffers.opaque)
        ? opaque ?? transparent
        : transparent ?? opaque
      if (primary) this.chunkMeshes.set(key, primary)
    }
  }

  private removeRegion(regionKey: string): void {
    const group = this.regionGroups.get(regionKey)
    if (group) this.scene.remove(group)
    const meshes = this.regionMeshes.get(regionKey)
    if (meshes) {
      for (const mesh of [meshes.opaque, meshes.transparent]) {
        if (mesh) this.disposeMesh(mesh)
      }
    }
    group?.clear()
    this.regionGroups.delete(regionKey)
    this.regionMeshes.delete(regionKey)
    for (const key of this.regionMembers.get(regionKey) ?? []) this.chunkMeshes.delete(key)
  }

  private upsertMesh(
    buffer: MeshBuffers | null,
    existing: THREE.Mesh | null | undefined,
    material: THREE.Material,
    transparent: boolean,
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
    this.forwardRefractionParticipants?.register(mesh)
    return mesh
  }

  private disposeMesh(mesh: THREE.Mesh): void {
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
