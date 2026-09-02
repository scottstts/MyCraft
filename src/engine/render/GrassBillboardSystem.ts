import * as THREE from 'three'
import type { World } from '../world/World'
import type { ChunkKey } from '../../types/index'
import { CHUNK_SIZE } from '../../config/constants'
import grassLeavesTexture from '../../assets/textures/grass_leaves.png'
import { GrassMaterial } from './GrassMaterial'
import { createXBillboardGeometry } from './BillboardGeometry'

export const GRASS_TUFT_YAW_OFFSET = THREE.MathUtils.degToRad(45)

/**
 * GrassBillboardSystem
 * Renders decorative grass tufts (non-cube) as crossed billboards using instancing.
 * Data source: cells with block id/name 'grass_tuft' in chunk voxel data.
 */
export class GrassBillboardSystem {
  private scene: THREE.Scene
  private material: GrassMaterial
  private geometry: THREE.BufferGeometry
  private groups = new Map<ChunkKey, THREE.Group>()

  private grassTuftId: number

  constructor(scene: THREE.Scene, world: World, grassTuftId: number) {
    this.scene = scene
    this.grassTuftId = grassTuftId

    // Create placeholder texture for material init
    const ph = document.createElement('canvas'); ph.width = 1; ph.height = 1; const phCtx = ph.getContext('2d')!; phCtx.fillStyle = '#ffffff'; phCtx.fillRect(0,0,1,1);
    const placeholder = new THREE.CanvasTexture(ph); placeholder.colorSpace = THREE.SRGBColorSpace; placeholder.magFilter = THREE.NearestFilter; placeholder.minFilter = THREE.NearestFilter;

    this.material = new GrassMaterial(placeholder)

    // Load the grass leaves texture with alpha.
    const fb = new THREE.TextureLoader().load(grassLeavesTexture as unknown as string)
    fb.flipY = false
    fb.colorSpace = THREE.SRGBColorSpace
    fb.magFilter = THREE.NearestFilter
    fb.minFilter = THREE.NearestFilter
    this.material.setMap(fb)

    this.geometry = createXBillboardGeometry(0.92, 0.90)
    // Rotate around the voxel-cell center, not the chunk/group origin. This
    // keeps every tuft rooted in its original block while putting the crossed
    // planes at a 45-degree offset from the block axes.
    this.geometry.translate(-0.5, 0, -0.5)
    this.geometry.rotateY(GRASS_TUFT_YAW_OFFSET)
    this.geometry.translate(0.5, 0, 0.5)

    // Wire listeners
    world.on('CHUNK_ADDED', ({ key, chunk, coords }) => {
      this.rebuildForChunk(key, chunk.getData().voxels, coords.cx, coords.cy, coords.cz)
    })
    world.on('CHUNK_REMOVED', ({ key }) => this.removeChunk(key))
    world.on('BLOCK_CHANGED', ({ chunkKey }) => {
      const chunk = world.getChunkByKey(chunkKey)
      if (!chunk) { this.removeChunk(chunkKey); return }
      this.rebuildForChunk(chunkKey, chunk.getData().voxels, ...chunkKey.split(',').map(n => parseInt(n, 10)) as unknown as [number, number, number])
    })
  }

  destroy(): void {
    for (const key of Array.from(this.groups.keys())) this.removeChunk(key)
    this.geometry.dispose()
    try { const m = (this.material.uniforms as Record<string, { value: unknown }>).map?.value as THREE.Texture | undefined; m?.dispose?.(); } catch { /* ignore */ }
    this.material.dispose()
  }

  private removeChunk(key: ChunkKey): void {
    const g = this.groups.get(key)
    if (!g) return
    this.scene.remove(g)
    g.traverse(obj => {
      if (obj instanceof THREE.InstancedMesh) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose?.()
      }
    })
    this.groups.delete(key)
  }

  private rebuildForChunk(key: ChunkKey, voxels: Uint8Array, cx: number, cy: number, cz: number): void {
    // Remove previous
    this.removeChunk(key)

    // Collect instances (local coords)
    const instances: Array<{ lx:number; ly:number; lz:number }> = []
    for (let ly = 0; ly < CHUNK_SIZE.y; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE.z; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE.x; lx++) {
          const idx = ly * CHUNK_SIZE.x * CHUNK_SIZE.z + lz * CHUNK_SIZE.x + lx
          if (voxels[idx] === this.grassTuftId) instances.push({ lx, ly, lz })
        }
      }
    }
    if (!instances.length) return

    // Build instanced mesh
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, instances.length)
    // Native shadow-map casting stays disabled. Grass casting and the player
    // caster's receiver visibility remain in the voxel sun pass.
    mesh.castShadow = false
    mesh.receiveShadow = false
    // Draw after opaque blocks but before transparent water
    mesh.renderOrder = 1

    const tmp = new THREE.Matrix4()
    for (let i = 0; i < instances.length; i++) {
      const p = instances[i]
      tmp.makeTranslation(p.lx, p.ly, p.lz)
      mesh.setMatrixAt(i, tmp)
    }
    mesh.instanceMatrix.needsUpdate = true

    const group = new THREE.Group()
    group.add(mesh)
    group.position.set(cx * CHUNK_SIZE.x, cy * CHUNK_SIZE.y, cz * CHUNK_SIZE.z)
    this.scene.add(group)
    this.groups.set(key, group)
  }

  // Lighting sync API (called from Engine)
  setSunUniforms(dir: THREE.Vector3, color: THREE.Color): void { this.material.setSun(dir, color) }
  setDayNight(day: number, star: number): void { this.material.setDayNight(day, star) }
  setSkyAmbient(color: THREE.Color): void { this.material.setSkyAmbient(color) }
  getTexture(): THREE.Texture { return (this.material.uniforms.map as { value: THREE.Texture }).value }
  setVoxelShadowTexture(texture: THREE.Texture, width: number, height: number, enabled = true): void {
    this.material.setVoxelShadowTexture(texture, width, height, enabled)
  }
  setVoxelShadowDepthTexture(texture: THREE.Texture, near: number, far: number): void {
    this.material.setVoxelShadowDepthTexture(texture, near, far)
  }
}
