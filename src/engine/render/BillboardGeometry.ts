import * as THREE from 'three'

/**
 * Build the crossed billboard used by decorative plants.
 *
 * The local footprint is centered on (0.5, 0.5), matching a voxel cell. The
 * instance transform can therefore preserve the center while applying scale
 * or yaw, and the two planes provide coverage from every horizontal view.
 * Optional vertical segmentation gives rooted vegetation a real hinge chain
 * for smooth wind deformation without changing the crossed-card silhouette.
 */
export function createXBillboardGeometry(width: number, height: number, segments = 1): THREE.BufferGeometry {
  const halfWidth = width / 2
  const verticalSegments = Math.max(1, Math.floor(segments))
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  // Plane A: spans X, fixed at the cell's center Z.
  const planeABase = positions.length / 3
  for (let segment = 0; segment <= verticalSegments; segment += 1) {
    const t = segment / verticalSegments
    const y = t * height
    positions.push(
      0.5 - halfWidth, y, 0.5,
      0.5 + halfWidth, y, 0.5,
    )
    uvs.push(0, 1 - t, 1, 1 - t)
  }
  for (let segment = 0; segment < verticalSegments; segment += 1) {
    const row = planeABase + segment * 2
    indices.push(row, row + 1, row + 3, row, row + 3, row + 2)
  }

  // Plane B: spans Z, fixed at the cell's center X (a 90 degree cross).
  const planeBBase = positions.length / 3
  for (let segment = 0; segment <= verticalSegments; segment += 1) {
    const t = segment / verticalSegments
    const y = t * height
    positions.push(
      0.5, y, 0.5 - halfWidth,
      0.5, y, 0.5 + halfWidth,
    )
    uvs.push(0, 1 - t, 1, 1 - t)
  }
  for (let segment = 0; segment < verticalSegments; segment += 1) {
    const row = planeBBase + segment * 2
    indices.push(row, row + 1, row + 3, row, row + 3, row + 2)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  // Decorative plant materials use the same constant tint/AO input as the
  // existing grass billboard path.
  const colors = new Float32Array((positions.length / 3) * 3)
  colors.fill(1)
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
