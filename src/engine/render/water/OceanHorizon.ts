import * as THREE from 'three'
import { WaterSurfaceMaterial } from './WaterSurfaceMaterial'

export interface OceanHorizonOptions {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  waterLevel: number
  farDistance: number
  color?: THREE.Color | number | string
  map?: THREE.Texture
  tileScale?: number
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

    const { minX, maxX, minZ, maxZ } = opts.bounds
    const y = opts.waterLevel + 1.0 - 0.001 // align to water surface height
    const pad = 0.0 // keep inner edges exact to avoid z-fighting with world
    const far = Math.max(opts.farDistance, 1)

    const bands: Array<{ x0:number,x1:number,z0:number,z1:number }> = [
      { x0: minX - far, x1: maxX + far, z0: minZ - far, z1: minZ + pad }, // North
      { x0: minX - far, x1: maxX + far, z0: maxZ - pad, z1: maxZ + far }, // South
      { x0: minX - far, x1: minX + pad, z0: minZ - far, z1: maxZ + far }, // West
      { x0: maxX - pad, x1: maxX + far, z0: minZ - far, z1: maxZ + far }, // East
    ]

    for (const b of bands) {
      const mesh = new THREE.Mesh(this.makeQuad(b.x0, b.z0, b.x1, b.z1, y), this.material)
      mesh.frustumCulled = true
      this.group.add(mesh)
    }

    scene.add(this.group)
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
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
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
  }
}
