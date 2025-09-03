import * as THREE from 'three'
import type { World } from '../world/World'
import type { ChunkKey } from '../../types/index'
import { CHUNK_SIZE } from '../../config/constants'
import treeLeavesTexture from '../../assets/textures/tree_leaves.png'

/**
 * GrassBillboardSystem
 * Renders decorative grass tufts (non-cube) as crossed billboards using instancing.
 * Data source: cells with block id/name 'grass_tuft' in chunk voxel data.
 */
export class GrassBillboardSystem {
  private scene: THREE.Scene
  private material: THREE.MeshLambertMaterial
  private geometry: THREE.BufferGeometry
  private groups = new Map<ChunkKey, THREE.Group>()

  private grassTuftId: number

  constructor(scene: THREE.Scene, world: World, grassTuftId: number) {
    this.scene = scene
    this.grassTuftId = grassTuftId

    this.material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.5,
    })
    // Try to load a sprite texture; fall back to tree leaves if missing
    const loader = new THREE.TextureLoader()
    loader.load(
      '/assets/textures/grass_billboard.png',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.magFilter = THREE.NearestFilter
        tex.minFilter = THREE.NearestFilter
        this.material.map = tex
        this.material.needsUpdate = true
      },
      undefined,
      // onError → use bundled leaf texture as fallback
      () => {
        const fb = new THREE.TextureLoader().load(treeLeavesTexture as unknown as string)
        fb.colorSpace = THREE.SRGBColorSpace
        fb.magFilter = THREE.NearestFilter
        fb.minFilter = THREE.NearestFilter
        this.material.map = fb
        this.material.needsUpdate = true
      }
    )

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
    this.material.map?.dispose?.()
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
    geom.setIndex(indices)
    geom.computeVertexNormals()
    return geom
  }
}
