/**
 * Module: engine/systems/PlayerController
 * Purpose: First-person movement with gravity and AABB collisions against voxel world
 * Callers: Engine constructs and updates this each frame; destroyed on stop()
 * Invariants: No React; queries solidity via World.isBlockSolid; camera at eye height
 */

import * as THREE from 'three';
import { PLAYER } from '../../config/constants';
import type { World } from '../world/World';
import { InputSystem } from './Input';

export class PlayerController {
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private input: InputSystem;

  private velocityY: number = 0;
  private grounded: boolean = false;

  // Visual smoothing for instantaneous vertical steps
  private renderYOffsetY: number = 0;
  private elevationTween = {
    from: 0,
    elapsed: 0,
    duration: 0,
    active: false,
  };

  // AABB dimensions
  private readonly width: number = PLAYER.width;
  private readonly height: number = PLAYER.height;
  private readonly halfWidth: number = this.width / 2;
  private readonly eyeHeight: number = Math.min(PLAYER.height * 0.9, PLAYER.height - 0.1);

  // Movement
  private readonly walkSpeed: number = PLAYER.speed.walk; // blocks/sec
  private readonly sprintSpeed: number = PLAYER.speed.sprint; // blocks/sec
  private readonly gravity: number = PLAYER.gravity; // blocks/sec^2 (negative)
  private readonly jumpImpulse: number = PLAYER.jump; // blocks/sec

  // Small epsilon to avoid sticking
  private static readonly EPS = 1e-5;

  // Optional world bounds (in world units). Inclusive min, exclusive max for center point.
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  constructor(camera: THREE.PerspectiveCamera, world: World, input: InputSystem, bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.camera = camera;
    this.world = world;
    this.input = input;
    if (bounds) this.bounds = bounds;

    // Ensure camera uses FPS-friendly rotation order
    this.camera.rotation.order = 'YXZ';
  }

  /** Update controller each frame */
  update(deltaSeconds: number): void {
    // Remove last frame's visual offset so physics uses true position
    if (this.renderYOffsetY !== 0) {
      this.camera.position.y -= this.renderYOffsetY;
      this.renderYOffsetY = 0;
    }
    // Jump edge-trigger: only if grounded
    if (this.input.consumeJumpRequested() && this.grounded) {
      this.velocityY = this.jumpImpulse;
      this.grounded = false;
    }

    // Compute intended horizontal displacement from input in camera-yaw space
    const inputXZ = this.input.getMoveInput();
    const speed = this.input.isSprinting() ? this.sprintSpeed : this.walkSpeed;

    // Derive forward/right on XZ plane from camera yaw only
    const yaw = this.camera.rotation.y;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    const moveDirX = rightX * inputXZ.x + forwardX * inputXZ.z;
    const moveDirZ = rightZ * inputXZ.x + forwardZ * inputXZ.z;

    const moveLen = Math.hypot(moveDirX, moveDirZ);
    const normX = moveLen > 0 ? moveDirX / moveLen : 0;
    const normZ = moveLen > 0 ? moveDirZ / moveLen : 0;

    const dx = normX * speed * deltaSeconds;
    const dz = normZ * speed * deltaSeconds;

    // Apply gravity
    this.velocityY += this.gravity * deltaSeconds;
    const dy = this.velocityY * deltaSeconds;

    // Axis-separated sweep: resolve X, then Z, then Y
    this.resolveAxis('x', dx);
    this.resolveAxis('z', dz);
    const hitY = this.resolveAxis('y', dy);

    // Grounded logic: if moving down and collided, we are grounded
    if (dy < 0 && hitY) {
      this.grounded = true;
      this.velocityY = 0;
    } else if (dy !== 0) {
      this.grounded = false;
    }

    // Temporary safety clamp: prevent falling below y=0 if no terrain loaded
    const baseY = this.getBaseY();
    if (baseY < 0) {
      const deltaClamp = -baseY;
      this.camera.position.y += deltaClamp;
      this.velocityY = 0;
      this.grounded = true;
    }

    // Apply post-physics elevation tween (visual only)
    this.applyElevationTween(deltaSeconds);
  }

  /**
   * Attempt to move along one axis and resolve collisions.
   * Returns true if a collision occurred on this axis.
   */
  private resolveAxis(axis: 'x' | 'y' | 'z', delta: number): boolean {
    if (delta === 0) return false;

    // Compute proposed position
    const pos = this.camera.position;
    const nextX = axis === 'x' ? pos.x + delta : pos.x;
    const nextY = axis === 'y' ? pos.y + delta : pos.y;
    const nextZ = axis === 'z' ? pos.z + delta : pos.z;

    // Compute AABB for proposed position
    const minX = nextX - this.halfWidth;
    const maxX = nextX + this.halfWidth;
    const minY = this.getBaseY(nextY);
    const maxY = minY + this.height;
    const minZ = nextZ - this.halfWidth;
    const maxZ = nextZ + this.halfWidth;

    // Enforce world bounds (X/Z only) by clamping proposed center before collision test
    if (this.bounds && (axis === 'x' || axis === 'z')) {
      const hw = this.halfWidth + PlayerController.EPS;
      if (axis === 'x') {
        const min = this.bounds.minX + hw;
        const max = this.bounds.maxX - hw;
        if (nextX < min) {
          this.camera.position.x = min;
          return true;
        }
        if (nextX > max) {
          this.camera.position.x = max;
          return true;
        }
      } else if (axis === 'z') {
        const min = this.bounds.minZ + hw;
        const max = this.bounds.maxZ - hw;
        if (nextZ < min) {
          this.camera.position.z = min;
          return true;
        }
        if (nextZ > max) {
          this.camera.position.z = max;
          return true;
        }
      }
    }

    if (!this.aabbIntersectsSolid(minX, minY, minZ, maxX, maxY, maxZ)) {
      // No collision; apply movement
      pos.set(nextX, nextY, nextZ);
      return false;
    }

    // Collision: snap to boundary
    const sign = Math.sign(delta);
    switch (axis) {
      case 'x': {
        if (sign > 0) {
          // Moving +X, collide against the block whose minX we hit
          const probeMaxX = Math.floor(maxX);
          const clampX = probeMaxX - this.halfWidth - PlayerController.EPS;
          pos.x = clampX;
        } else {
          // Moving -X, collide against the block's maxX (blockX+1)
          const probeMinX = Math.floor(minX);
          const clampX = probeMinX + 1 + this.halfWidth + PlayerController.EPS;
          pos.x = clampX;
        }
        return true;
      }
      case 'z': {
        if (sign > 0) {
          const probeMaxZ = Math.floor(maxZ);
          const clampZ = probeMaxZ - this.halfWidth - PlayerController.EPS;
          pos.z = clampZ;
        } else {
          const probeMinZ = Math.floor(minZ);
          const clampZ = probeMinZ + 1 + this.halfWidth + PlayerController.EPS;
          pos.z = clampZ;
        }
        return true;
      }
      case 'y': {
        if (sign > 0) {
          // Moving up: clamp top to block minY
          const probeMaxY = Math.floor(maxY);
          const clampYTop = probeMaxY - this.height - PlayerController.EPS;
          pos.y = clampYTop + this.eyeHeight; // convert base->camera
        } else {
          // Moving down: clamp bottom to block maxY (blockY+1)
          const probeMinY = Math.floor(minY);
          const clampYBase = probeMinY + 1 + PlayerController.EPS;
          // camera.y = base + eyeHeight
          pos.y = clampYBase + this.eyeHeight;
        }
        return true;
      }
    }
  }

  /** Camera base Y helper: returns y of feet (AABB minY) */
  private getBaseY(cameraY: number = this.camera.position.y): number {
    return cameraY - this.eyeHeight;
  }

  /** Start a short visual tween from previous level to new level for smooth stepping */
  startElevationTween(height: number, duration: number = 0.12): void {
    // Height is how much we instantly stepped up in physics.
    // Render offset starts at -height (old level) and eases to 0 (new level).
    this.elevationTween.from = -height;
    this.elevationTween.elapsed = 0;
    this.elevationTween.duration = Math.max(0.06, duration);
    this.elevationTween.active = true;
  }

  private applyElevationTween(dt: number): void {
    if (!this.elevationTween.active) return;
    this.elevationTween.elapsed += dt;
    const t = Math.min(1, this.elevationTween.elapsed / this.elevationTween.duration);
    // Ease-out cubic for smooth settle
    const easeOutCubic = (u: number) => 1 - Math.pow(1 - u, 3);
    const eased = easeOutCubic(t);
    const currentOffset = this.elevationTween.from * (1 - eased); // from -> 0
    this.renderYOffsetY = currentOffset;
    this.camera.position.y += this.renderYOffsetY;
    if (t >= 1) {
      this.elevationTween.active = false;
      this.renderYOffsetY = 0;
    }
  }

  /**
   * Check if AABB intersects any solid voxel in the world
   */
  private aabbIntersectsSolid(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const ix0 = Math.floor(minX);
    const iy0 = Math.floor(minY);
    const iz0 = Math.floor(minZ);
    const ix1 = Math.floor(maxX);
    const iy1 = Math.floor(maxY);
    const iz1 = Math.floor(maxZ);

    for (let y = iy0; y <= iy1; y++) {
      for (let z = iz0; z <= iz1; z++) {
        for (let x = ix0; x <= ix1; x++) {
          if (this.world.isBlockSolid(x, y, z)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /** Public getter for grounded state */
  isGrounded(): boolean {
    return this.grounded;
  }

  /** Update or clear world bounds */
  setBounds(bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null): void {
    this.bounds = bounds;
  }
}

