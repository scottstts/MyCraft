import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config/constants';
import { PlayerController } from '../src/engine/systems/PlayerController';
import type { InputSystem } from '../src/engine/systems/Input';
import type { World } from '../src/engine/world/World';

function createInput(jumpRequested: () => boolean): InputSystem {
  return {
    getMoveInput: () => ({ x: 1, z: 0 }),
    getOrientation: () => ({ yaw: 0, pitch: 0 }),
    isSprinting: () => false,
    consumeJumpRequested: jumpRequested,
    isJumpHeld: () => false,
  } as unknown as InputSystem;
}

function createFlatWorldWithOneBlockWall(): World {
  return {
    getBlock: () => 0,
    isAirFlooded: () => false,
    isBlockSolid: (x: number, y: number) => y === 0 || (x === 1 && y === 1),
  } as unknown as World;
}

describe('player controller feet collision', () => {
  it('keeps the collider feet on the block top and clears a one-block wall', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0.5, 1 + PLAYER.eyeHeight, 0.5);
    const controller = new PlayerController(
      camera,
      createFlatWorldWithOneBlockWall(),
      createInput(() => false),
    );

    controller.update(1 / 60);
    expect(controller.getFeetPosition().y).toBeCloseTo(1, 4);
    expect(controller.isGrounded()).toBe(true);

    let jumpRequested = true;
    const jumpingController = new PlayerController(
      camera.clone(),
      createFlatWorldWithOneBlockWall(),
      createInput(() => {
        const requested = jumpRequested;
        jumpRequested = false;
        return requested;
      }),
    );
    for (let frame = 0; frame < 120; frame += 1) jumpingController.update(1 / 60);

    expect(jumpingController.getFeetPosition().x).toBeGreaterThan(2.3);
    expect(jumpingController.getFeetPosition().y).toBeCloseTo(1, 3);
  });
});
