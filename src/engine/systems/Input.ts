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

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera) {
    this.canvas = canvas;
    this.camera = camera;

    // FPS-style rotation order
    this.camera.rotation.order = 'YXZ';

    // Bind handlers
    this.onPointerLockChangeRef = this.onPointerLockChange.bind(this);
    this.onMouseMoveRef = this.onMouseMove.bind(this);

    // Register listeners
    document.addEventListener('pointerlockchange', this.onPointerLockChangeRef);
    window.addEventListener('mousemove', this.onMouseMoveRef);
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
}


