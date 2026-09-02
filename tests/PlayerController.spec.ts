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

  it('clears a one-block wall at the maximum low-FPS simulation delta', () => {
    let jumpRequested = true;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0.5, 1 + PLAYER.eyeHeight, 0.5);
    const controller = new PlayerController(
      camera,
      createFlatWorldWithOneBlockWall(),
      createInput(() => {
        const requested = jumpRequested;
        jumpRequested = false;
        return requested;
      }),
    );

    for (let frame = 0; frame < 40; frame += 1) controller.update(0.1);

    expect(controller.getFeetPosition().x).toBeGreaterThan(2.3);
    expect(controller.getFeetPosition().y).toBeCloseTo(1, 3);
  });

  it('keeps a downward-swimming collider above a solid seabed', () => {
    const seabedTop = 21;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(12.5, 42, 12.5);
    const input = {
      getMoveInput: () => ({ x: 0, z: 1 }),
      getOrientation: () => ({ yaw: 0, pitch: -Math.PI / 2 }),
      isSprinting: () => true,
      consumeJumpRequested: () => false,
      isJumpHeld: () => false,
    } as unknown as InputSystem;
    const world = {
      getBlock: (_x: number, y: number) => y === 42 ? 5 : 0,
      isAirFlooded: () => false,
      isBlockSolid: (_x: number, y: number) => y <= seabedTop - 1,
    } as unknown as World;
    const controller = new PlayerController(camera, world, input);

    for (let frame = 0; frame < 600; frame += 1) controller.update(1 / 60);

    expect(controller.isUnderwater()).toBe(true);
    expect(controller.getFeetPosition().y).toBeCloseTo(seabedTop, 4);
  });

  it('keeps the leading head clear of a side wall while swimming', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(12.5, 35, 12.5);
    const input = {
      getMoveInput: () => ({ x: 0, z: 1 }),
      getOrientation: () => ({ yaw: 0, pitch: 0 }),
      isSprinting: () => false,
      consumeJumpRequested: () => false,
      isJumpHeld: () => false,
    } as unknown as InputSystem;
    const world = {
      getBlock: (_x: number, y: number) => y <= 42 ? 5 : 0,
      isAirFlooded: () => false,
      // The wall is ahead of the swimmer (movement is toward -Z). Its vertical
      // column intersects the horizontal body/head pose but not the upright
      // collider at the initial position.
      isBlockSolid: (_x: number, y: number, z: number) => y >= 30 && y <= 42 && z === 8,
    } as unknown as World;
    const controller = new PlayerController(camera, world, input);

    for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 60);

    expect(controller.isUnderwater()).toBe(true);
    // The head volume reaches about 2 blocks ahead of the root, so the root
    // must stop before the rendered head reaches the wall.
    expect(controller.getEyePosition().z).toBeGreaterThan(11.0);
  });

  it('enters swimming mode while moving off a solid shoreline', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(12.5, 42 + PLAYER.eyeHeight, 12.5);
    const input = {
      getMoveInput: () => ({ x: 0, z: 1 }),
      getOrientation: () => ({ yaw: 0, pitch: 0 }),
      isSprinting: () => false,
      consumeJumpRequested: () => false,
      isJumpHeld: () => false,
    } as unknown as InputSystem;
    const world = {
      getBlock: (_x: number, y: number, z: number) => y === 42 && z <= 10 ? 5 : 0,
      isAirFlooded: () => false,
      // Solid island shoreline behind z=11; its top is level with the
      // player's feet, and the water floor is well below.
      isBlockSolid: (_x: number, y: number, z: number) => (z >= 11 && y <= 41) || y <= 20,
    } as unknown as World;
    const controller = new PlayerController(camera, world, input);

    for (let frame = 0; frame < 240; frame += 1) controller.update(1 / 60);

    expect(controller.isUnderwater()).toBe(true);
    expect(controller.getEyePosition().z).toBeLessThan(10.5);
  });

  it('blocks against a trailing wall without teleporting vertically', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(12.5, 35, 12.5);
    const input = {
      getMoveInput: () => ({ x: 0, z: 1 }),
      getOrientation: () => ({ yaw: 0, pitch: 0 }),
      isSprinting: () => false,
      consumeJumpRequested: () => false,
      isJumpHeld: () => false,
    } as unknown as InputSystem;
    const world = {
      getBlock: (_x: number, y: number) => y <= 42 ? 5 : 0,
      isAirFlooded: () => false,
      // This wall is behind the swimmer's feet but still inside the long
      // horizontal swim pose. It must not trigger a vertical recovery jump.
      isBlockSolid: (_x: number, y: number, z: number) => (z === 12 && y >= 30 && y <= 42) || y <= 20,
    } as unknown as World;
    const controller = new PlayerController(camera, world, input);

    const initialFeetY = controller.getFeetPosition().y;
    controller.update(1 / 60);

    expect(controller.isUnderwater()).toBe(true);
    expect(controller.getFeetPosition().y).toBeLessThan(initialFeetY);
    expect(controller.getFeetPosition().y).toBeGreaterThan(initialFeetY - 0.1);
  });

  it('blocks the full swim pose at a diagonal voxel corner', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(12.5, 35, 12.5);
    const input = {
      getMoveInput: () => ({ x: 1, z: 1 }),
      getOrientation: () => ({ yaw: 0, pitch: 0 }),
      isSprinting: () => false,
      consumeJumpRequested: () => false,
      isJumpHeld: () => false,
    } as unknown as InputSystem;
    const world = {
      getBlock: (_x: number, y: number) => y <= 42 ? 5 : 0,
      isAirFlooded: () => false,
      // The swimmer approaches this block through its diagonal corner. A
      // separate X pass followed by a separate Z pass can cross the corner
      // without either pass seeing a face; the vector sweep must stop first.
      isBlockSolid: (x: number, y: number, z: number) => (
        y <= 20 || (x === 15 && z === 9 && y >= 20 && y <= 42)
      ),
    } as unknown as World;
    const controller = new PlayerController(camera, world, input);

    for (let frame = 0; frame < 240; frame += 1) controller.update(1 / 60);

    const eye = controller.getEyePosition();
    const diagonal = 1 / Math.sqrt(2);
    // The head box extends roughly 1.65 blocks forward and 0.35 blocks on
    // each projected axis. It must stop before both faces of the obstacle.
    const projectedHalfExtent = 0.35 * diagonal + 0.35 * diagonal;
    const headMaxX = eye.x + 1.65 * diagonal + projectedHalfExtent;
    const headMinZ = eye.z - 1.65 * diagonal - projectedHalfExtent;
    expect(headMaxX <= 15.001 || headMinZ >= 10 - 0.001).toBe(true);
  });
});
