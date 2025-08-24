/**
 * Module: engine/systems/Input
 * Purpose: Handle pointer lock and mouse look (yaw/pitch) for first-person camera
 * Callers: Engine creates an instance and calls update() each frame; destroyed on stop()
 * Invariants: No React imports; only interacts with provided canvas and camera
 */

import * as THREE from 'three';

export class InputSystem {
  private canvas: HTMLCanvasElement;
  private camera: THREE.PerspectiveCamera;
  private isPointerLocked: boolean = false;
  private readonly mouseSensitivity: number = 0.002;

  // Yaw (rotate around Y axis) and Pitch (rotate around X axis) in radians
  private yawRadians: number = 0;
  private pitchRadians: number = 0;

  // Event handler references for proper removal
  private onPointerLockChangeRef: () => void;
  private onMouseMoveRef: (e: MouseEvent) => void;
  private onKeyDownRef: (e: KeyboardEvent) => void;
  private onKeyUpRef: (e: KeyboardEvent) => void;
  private onMouseDownRef: (e: MouseEvent) => void;

  // Keyboard state
  private moveForward: boolean = false;
  private moveBackward: boolean = false;
  private moveLeft: boolean = false;
  private moveRight: boolean = false;
  private sprint: boolean = false;
  private jumpQueued: boolean = false;
  private leftClickQueued: boolean = false;
  private rightClickQueued: boolean = false;
  private numSlotQueued: number | null = null;
  private pauseToggleQueued: boolean = false;

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera) {
    this.canvas = canvas;
    this.camera = camera;

    // FPS-style rotation order
    this.camera.rotation.order = 'YXZ';

    // Bind handlers
    this.onPointerLockChangeRef = this.onPointerLockChange.bind(this);
    this.onMouseMoveRef = this.onMouseMove.bind(this);
    this.onKeyDownRef = this.onKeyDown.bind(this);
    this.onKeyUpRef = this.onKeyUp.bind(this);
    this.onMouseDownRef = this.onMouseDown.bind(this);

    // Register listeners
    document.addEventListener('pointerlockchange', this.onPointerLockChangeRef);
    window.addEventListener('mousemove', this.onMouseMoveRef);
    window.addEventListener('keydown', this.onKeyDownRef);
    window.addEventListener('keyup', this.onKeyUpRef);
    window.addEventListener('mousedown', this.onMouseDownRef);
  }

  /**
   * Apply current yaw/pitch to the camera each frame
   */
  update(): void {
    // Clamp pitch to avoid flipping (±89 degrees)
    const maxPitch = THREE.MathUtils.degToRad(89);
    if (this.pitchRadians > maxPitch) this.pitchRadians = maxPitch;
    if (this.pitchRadians < -maxPitch) this.pitchRadians = -maxPitch;

    // Wrap yaw to [-PI, PI] range for numerical stability
    this.yawRadians = THREE.MathUtils.euclideanModulo(this.yawRadians + Math.PI, Math.PI * 2) - Math.PI;

    this.camera.rotation.y = this.yawRadians;
    this.camera.rotation.x = this.pitchRadians;
  }

  /**
   * Get current yaw/pitch in radians (for debug or other systems)
   */
  getOrientation(): { yaw: number; pitch: number } {
    return { yaw: this.yawRadians, pitch: this.pitchRadians };
  }

  /**
   * Clean up listeners
   */
  destroy(): void {
    document.removeEventListener('pointerlockchange', this.onPointerLockChangeRef);
    window.removeEventListener('mousemove', this.onMouseMoveRef);
    window.removeEventListener('keydown', this.onKeyDownRef);
    window.removeEventListener('keyup', this.onKeyUpRef);
    window.removeEventListener('mousedown', this.onMouseDownRef);
  }

  private onPointerLockChange(): void {
    this.isPointerLocked = document.pointerLockElement === this.canvas;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isPointerLocked) return;

    const deltaX = e.movementX || 0;
    const deltaY = e.movementY || 0;

    this.yawRadians -= deltaX * this.mouseSensitivity;
    this.pitchRadians -= deltaY * this.mouseSensitivity;
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.isPointerLocked) return;
    if (e.button === 0) {
      this.leftClickQueued = true;
    } else if (e.button === 2) {
      this.rightClickQueued = true;
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.moveForward = true; break;
      case 'KeyS':
      case 'ArrowDown':
        this.moveBackward = true; break;
      case 'KeyA':
      case 'ArrowLeft':
        this.moveLeft = true; break;
      case 'KeyD':
      case 'ArrowRight':
        this.moveRight = true; break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.sprint = true; break;
      case 'Space':
        this.jumpQueued = true; break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
      case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9':
        this.numSlotQueued = parseInt(e.code.slice(-1), 10) - 1; break;
      case 'KeyP':
        this.pauseToggleQueued = true; break;
      default:
        break;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.moveForward = false; break;
      case 'KeyS':
      case 'ArrowDown':
        this.moveBackward = false; break;
      case 'KeyA':
      case 'ArrowLeft':
        this.moveLeft = false; break;
      case 'KeyD':
      case 'ArrowRight':
        this.moveRight = false; break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.sprint = false; break;
      case 'Space':
        // Do not unset jumpQueued here; it's consumed by controller to allow edge-trigger
        break;
      default:
        break;
    }
  }

  /**
   * Get current movement input in local camera space (x,z), normalized to length ≤ 1
   */
  getMoveInput(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (this.moveForward) z += 1;
    if (this.moveBackward) z -= 1;
    if (this.moveLeft) x -= 1;
    if (this.moveRight) x += 1;
    const len = Math.hypot(x, z);
    if (len > 0) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  isSprinting(): boolean {
    return this.sprint;
  }

  /**
   * Edge-triggered jump request: returns true once, then clears the flag
   */
  consumeJumpRequested(): boolean {
    if (this.jumpQueued) {
      this.jumpQueued = false;
      return true;
    }
    return false;
  }

  /** Edge-triggered left click */
  consumeLeftClick(): boolean {
    if (this.leftClickQueued) {
      this.leftClickQueued = false;
      return true;
    }
    return false;
  }

  /** Edge-triggered right click */
  consumeRightClick(): boolean {
    if (this.rightClickQueued) {
      this.rightClickQueued = false;
      return true;
    }
    return false;
  }

  /** Edge-triggered number slot 0..8, or null if none queued */
  consumeSelectedSlot(): number | null {
    const v = this.numSlotQueued;
    this.numSlotQueued = null;
    return v;
  }

  /** Edge-triggered pause toggle */
  consumePauseToggle(): boolean {
    if (this.pauseToggleQueued) {
      this.pauseToggleQueued = false;
      return true;
    }
    return false;
  }
}


