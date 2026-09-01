import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYER } from '../src/config/constants';
import { InputSystem } from '../src/engine/systems/Input';

type TestListener = (event: unknown) => void;

interface TestEventTarget {
  pointerLockElement: HTMLCanvasElement | null;
  addEventListener: (type: string, listener: TestListener) => void;
  removeEventListener: (type: string, listener: TestListener) => void;
  dispatch: (type: string, event: unknown) => void;
}

function createEventTarget(): TestEventTarget {
  const listeners = new Map<string, Set<TestListener>>();
  return {
    pointerLockElement: null,
    addEventListener(type, listener) {
      const handlers = listeners.get(type) ?? new Set<TestListener>();
      handlers.add(listener);
      listeners.set(type, handlers);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

describe('InputSystem boot gating', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ignores pointer-lock mouse and keyboard input until enabled', () => {
    const documentTarget = createEventTarget();
    const windowTarget = createEventTarget();
    const canvas = {} as HTMLCanvasElement;
    documentTarget.pointerLockElement = canvas;
    vi.stubGlobal('document', documentTarget as unknown as Document);
    vi.stubGlobal('window', windowTarget as unknown as Window);

    const input = new InputSystem(canvas, new THREE.PerspectiveCamera());
    windowTarget.dispatch('mousemove', { movementX: 100, movementY: 50 });
    windowTarget.dispatch('keydown', { code: 'KeyW', repeat: false });

    expect(input.getOrientation()).toEqual({ yaw: PLAYER.initialYaw, pitch: 0 });
    expect(input.getMoveInput()).toEqual({ x: 0, z: 0 });

    input.setEnabled(true);
    windowTarget.dispatch('mousemove', { movementX: 10, movementY: 5 });

    expect(input.getOrientation().yaw).toBeCloseTo(PLAYER.initialYaw - 0.022, 8);
    expect(input.getOrientation().pitch).toBeCloseTo(-0.011, 8);

    input.destroy();
  });
});
