import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYER } from '../src/config/constants';
import PlayerCharacter from '../src/engine/render/PlayerCharacter';
import type { InputSystem } from '../src/engine/systems/Input';
import type { PlayerController, PlayerMovementState } from '../src/engine/systems/PlayerController';

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
});
