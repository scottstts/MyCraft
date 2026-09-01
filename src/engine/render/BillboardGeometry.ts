import * as THREE from 'three'

/**
 * Build the crossed billboard used by decorative plants.
 *
 * The local footprint is centered on (0.5, 0.5), matching a voxel cell. The
 * instance transform can therefore preserve the center while applying scale
 * or yaw, and the two planes provide coverage from every horizontal view.
 */
export function createXBillboardGeometry(width: number, height: number): THREE.BufferGeometry {
  const halfWidth = width / 2
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  // Plane A: spans X, fixed at the cell's center Z.
  positions.push(
    0.5 - halfWidth, 0, 0.5,
    0.5 + halfWidth, 0, 0.5,
    0.5 + halfWidth, height, 0.5,
    0.5 - halfWidth, height, 0.5,
  )
  uvs.push(0, 1, 1, 1, 1, 0, 0, 0)
  indices.push(0, 1, 2, 0, 2, 3)

  // Plane B: spans Z, fixed at the cell's center X (a 90 degree cross).
  positions.push(
    0.5, 0, 0.5 - halfWidth,
    0.5, 0, 0.5 + halfWidth,
    0.5, height, 0.5 + halfWidth,
    0.5, height, 0.5 - halfWidth,
  )
  uvs.push(0, 1, 1, 1, 1, 0, 0, 0)
  indices.push(4, 5, 6, 4, 6, 7)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  // Decorative plant materials use the same constant tint/AO input as the
  // existing grass billboard path.
  const colors = new Float32Array(8 * 3)
  colors.fill(1)
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
