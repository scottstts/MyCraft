import * as THREE from 'three'
import type { World } from '../world/World'
import type { ChunkKey } from '../../types/index'
import { CHUNK_SIZE } from '../../config/constants'
import grassLeavesTexture from '../../assets/textures/grass_leaves.png'
import { GrassMaterial } from './GrassMaterial'

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

    // Try to load the provided grass leaves texture with alpha.
    const loader = new THREE.TextureLoader()
    const tryPaths = ['/assets/textures/grass_leaves.png', '/assets/textures/grass_billboard.png']
    const loadPath = (i: number) => {
      if (i >= tryPaths.length) {
        const fb = new THREE.TextureLoader().load(grassLeavesTexture as unknown as string)
        fb.flipY = false
        fb.colorSpace = THREE.SRGBColorSpace
        fb.magFilter = THREE.NearestFilter
        fb.minFilter = THREE.NearestFilter
        this.material.setMap(fb)
        return
      }
      loader.load(
        tryPaths[i],
        (tex) => {
          tex.flipY = false
          tex.colorSpace = THREE.SRGBColorSpace
          tex.magFilter = THREE.NearestFilter
          tex.minFilter = THREE.NearestFilter
          tex.premultiplyAlpha = false
          this.material.setMap(tex)
        },
        undefined,
        () => loadPath(i + 1)
      )
    }
    loadPath(0)

    this.geometry = this.buildXBillboardGeometry(0.92, 0.90)

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

  private buildXBillboardGeometry(width: number, height: number): THREE.BufferGeometry {
    const hw = width / 2
    const h = height
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    // Plane A (aligned on X, centered at 0.5, spans in X)
    const aBase = 0
    positions.push(
      // bottom row
      0.5 - hw, 0, 0.5,  // 0
      0.5 + hw, 0, 0.5,  // 1
      // top row
      0.5 + hw, h, 0.5,  // 2
      0.5 - hw, h, 0.5,  // 3
    )
    uvs.push( 0,1, 1,1, 1,0, 0,0 )
    indices.push(aBase+0, aBase+1, aBase+2, aBase+0, aBase+2, aBase+3)

    // Plane B (aligned on Z, centered at 0.5, spans in Z)
    const bBase = 4
    positions.push(
      0.5, 0, 0.5 - hw, // 4
      0.5, 0, 0.5 + hw, // 5
      0.5, h, 0.5 + hw, // 6
      0.5, h, 0.5 - hw, // 7
    )
    uvs.push( 0,1, 1,1, 1,0, 0,0 )
    indices.push(bBase+0, bBase+1, bBase+2, bBase+0, bBase+2, bBase+3)

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    // Provide constant color=1 for BlockMaterial's AO/tint input
    const colors = new Float32Array(8 * 3); colors.fill(1)
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geom.setIndex(indices)
    geom.computeVertexNormals()
    return geom
  }

  // Lighting/Shadow sync API (called from Engine)
  setSunUniforms(dir: THREE.Vector3, color: THREE.Color): void { this.material.setSun(dir, color) }
  setDayNight(day: number, star: number): void { this.material.setDayNight(day, star) }
  updateShadowUniforms(): void { /* grass tufts don't receive cast/receive shadows */ }
  setCloudShadowUniforms(params: { enabled?: boolean; intensity?: number; altitude?: number; scale?: number; coverage?: number; density?: number; wind?: THREE.Vector2; }): void {
    this.material.setCloudShadowUniforms(params)
  }
}
