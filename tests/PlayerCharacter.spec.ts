import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYER } from '../src/config/constants';
import PlayerCharacter from '../src/engine/render/PlayerCharacter';
import type { InputSystem } from '../src/engine/systems/Input';
import type { PlayerController, PlayerMovementState } from '../src/engine/systems/PlayerController';
import type { World } from '../src/engine/world/World';

function installCanvasStub(): void {
  vi.stubGlobal('document', {
    createElement: (tagName: string) => {
      if (tagName !== 'canvas') throw new Error(`Unexpected element requested: ${tagName}`);
      const context = {
        fillStyle: '',
        fillRect: () => undefined,
        getImageData: (_x: number, _y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData: () => undefined,
      } as unknown as CanvasRenderingContext2D;
      return {
        width: 0,
        height: 0,
        getContext: () => context,
      } as unknown as HTMLCanvasElement;
    },
  });
}

function createIdleState(): PlayerMovementState {
  return {
    isMoving: false,
    isSprinting: false,
    isGrounded: true,
    isUnderwater: false,
    moveDirection: new THREE.Vector3(),
  };
}

function createSwimmingState(): PlayerMovementState {
  return {
    isMoving: true,
    isSprinting: false,
    isGrounded: false,
    isUnderwater: true,
    moveDirection: new THREE.Vector3(0, 0, -1),
  };
}

describe('player character feet alignment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('places the lowest leg geometry on the controller feet and preserves eye height', () => {
    installCanvasStub();

    const player = new PlayerCharacter();
    const playerRoot = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    const input = {
      getOrientation: () => ({ yaw: 0, pitch: 0 }),
    } as unknown as InputSystem;
    const feetY = 3.25;
    const controller = {
      getFeetPosition: (target = new THREE.Vector3()) => target.set(4, feetY, -2),
      getMovementState: () => createIdleState(),
    } as unknown as PlayerController;

    player.init(playerRoot, camera, input);
    player.setController(controller);
    player.update(0, false);

    const visualRoot = (player as unknown as { character: THREE.Group }).character;
    const leftLeg = visualRoot.getObjectByName('LeftLegMesh');
    expect(leftLeg).toBeInstanceOf(THREE.Mesh);
    visualRoot.updateMatrixWorld(true);
    const legBounds = new THREE.Box3().setFromObject(leftLeg as THREE.Mesh, true);
    expect(legBounds.min.y).toBeCloseTo(feetY, 6);

    const eyeAnchor = visualRoot.getObjectByName('EyeAnchor');
    expect(eyeAnchor).toBeTruthy();
    const eyePosition = (eyeAnchor as THREE.Object3D).getWorldPosition(new THREE.Vector3());
    expect(eyePosition.y).toBeCloseTo(feetY + PLAYER.eyeHeight, 6);

    player.dispose();
  });

  it('keeps the horizontal swim pose above the collider feet plane', () => {
    installCanvasStub();

    const player = new PlayerCharacter();
    const playerRoot = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    const input = {
      getOrientation: () => ({ yaw: 0, pitch: -Math.PI / 2 }),
    } as unknown as InputSystem;
    const feetY = 21;
    const controller = {
      getFeetPosition: (target = new THREE.Vector3()) => target.set(4, feetY, -2),
      getMovementState: () => createSwimmingState(),
    } as unknown as PlayerController;

    player.init(playerRoot, camera, input);
    player.setController(controller);
    for (let frame = 0; frame < 120; frame += 1) player.update(1 / 60, false);

    const visualRoot = (player as unknown as { character: THREE.Group }).character;
    visualRoot.updateMatrixWorld(true);
    const visualBounds = new THREE.Box3().setFromObject(visualRoot, true);
    expect(visualBounds.min.y).toBeGreaterThanOrEqual(feetY - 1e-5);

    player.dispose();
  });

  it('keeps the third-person orbit outside a wall when the swim head leads the root', () => {
    installCanvasStub();

    const player = new PlayerCharacter();
    const playerRoot = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 22, -2);
    const input = {
      getOrientation: () => ({ yaw: 0, pitch: 0 }),
    } as unknown as InputSystem;
    const world = {
      isBlockSolid: (_x: number, y: number, z: number) => y === 21 && z === -2,
    } as unknown as World;
    const controller = {
      getFeetPosition: (target = new THREE.Vector3()) => target.set(0, 21, 0),
      getEyePosition: (target = new THREE.Vector3()) => target.set(0, 22.7, 0),
      getMovementState: () => createSwimmingState(),
      getWorld: () => world,
    } as unknown as PlayerController;

    player.init(playerRoot, camera, input);
    player.setController(controller);
    player.update(1 / 60);

    // The old head-pivot orbit began inside the wall. The collision-root
    // pivot must pull the camera back before it can enter the voxel.
    expect(camera.position.z).toBeGreaterThan(-0.9);

    player.dispose();
  });
});
