import * as THREE from 'three';

/**
 * One exact oriented box from the procedural player rig. The inverse matrix
 * transforms a world-space ray into the mesh's local geometry space.
 */
export interface CharacterShadowBox {
  inverseMatrix: THREE.Matrix4;
  center: THREE.Vector3;
  halfSize: THREE.Vector3;
}
