import * as THREE from 'three';

/**
 * One oriented box from the procedural player rig, expressed for the
 * screen-space voxel sun-shadow pass.
 */
export interface CharacterShadowBox {
  inverseMatrix: THREE.Matrix4;
  center: THREE.Vector3;
  halfSize: THREE.Vector3;
}
