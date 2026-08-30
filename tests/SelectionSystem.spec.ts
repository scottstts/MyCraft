import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SelectionSystem } from '../src/engine/systems/SelectionSystem';
import type { World } from '../src/engine/world/World';

function worldWithSolidCell(cell: { x: number; y: number; z: number }): World {
  return {
    getBlock: (x: number, y: number, z: number) =>
      x === cell.x && y === cell.y && z === cell.z ? 3 : 0,
    isBlockSolid: (x: number, y: number, z: number) =>
      x === cell.x && y === cell.y && z === cell.z,
  } as World;
}

describe('SelectionSystem center-reticle reach', () => {
  it('finds a third-person reticle hit beyond camera reach when it is within player reach', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0.5, 1.5, 4);
    camera.lookAt(0.5, 1.5, -4);
    camera.updateMatrixWorld(true);
    const playerEye = new THREE.Vector3(0.5, 1.5, 0);
    const system = new SelectionSystem(
      camera,
      worldWithSolidCell({ x: 0, y: 1, z: -4 }),
      new THREE.Scene(),
      undefined,
      (target) => target.copy(playerEye),
    );

    system.update();

    expect(system.getSelection()).toMatchObject({
      hit: true,
      hitCell: { x: 0, y: 1, z: -4 },
    });
    system.destroy();
  });

  it('rejects a reticle hit whose surface is outside player reach', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(4.5, 1.5, 2);
    camera.lookAt(4.5, 1.5, -8);
    camera.updateMatrixWorld(true);
    const playerEye = new THREE.Vector3(0.5, 1.5, 0);
    const system = new SelectionSystem(
      camera,
      worldWithSolidCell({ x: 4, y: 1, z: -5 }),
      new THREE.Scene(),
      undefined,
      (target) => target.copy(playerEye),
    );

    system.update();

    expect(system.getSelection().hit).toBe(false);
    system.destroy();
  });
});
