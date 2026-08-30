/**
 * Module: engine/systems/PlayerController
 * Purpose: Camera-independent movement with gravity and AABB collisions against voxel world
 * Callers: Engine constructs and updates this each frame; destroyed on stop()
 * Invariants: No React; queries solidity via World.isBlockSolid; view cameras read this position
 */

import * as THREE from 'three';
import { PLAYER } from '../../config/constants';
import { WATER_LEVEL } from '../world/TerrainGenerator';
import { getBlockIdByName } from '../world/blocks/BlockRegistry';
import type { World } from '../world/World';
import { InputSystem } from './Input';

export interface PlayerMovementState {
  isMoving: boolean;
  isSprinting: boolean;
  isGrounded: boolean;
  isUnderwater: boolean;
  moveDirection: THREE.Vector3;
}

export class PlayerController {
  // The camera is retained only as the initial pose/source of the shared
  // look contract. Physics never writes to it; third-person orbit is free to
  // move the camera independently of this position.
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private input: InputSystem;
  private position = new THREE.Vector3(); // eye position used by the collision capsule
  // Feature flag: land step-up assist (disabled per request)
  private static readonly ENABLE_LAND_STEP_ASSIST = false;

  private velocityY: number = 0;
  // The engine constructs the controller from the terrain-grounded spawn eye
  // position, so the first gameplay frame must not recreate the old drop.
  private grounded: boolean = true;
  // Swim state
  private swimVelocity = new THREE.Vector3();
  // (no previous underwater flag retained)
  private underwater: boolean = false; // hysteresis-smoothed underwater state
  private stepCooldown: number = 0;    // seconds; prevents repeated step wiggle
  private emergeLiftRemaining: number = 0; // remaining vertical lift for smooth emerge
  private emergeNudgeDir = new THREE.Vector3();

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
  private readonly eyeHeight: number = PLAYER.eyeHeight;
  private readonly waterId: number = getBlockIdByName('water') ?? 5;

  // Movement
  private readonly walkSpeed: number = PLAYER.speed.walk; // blocks/sec
  private readonly sprintSpeed: number = PLAYER.speed.sprint; // blocks/sec
  private readonly gravity: number = PLAYER.gravity; // blocks/sec^2 (negative)
  private readonly jumpImpulse: number = PLAYER.jump; // blocks/sec

  // Small epsilon to avoid sticking
  private static readonly EPS = 1e-5;

  // Optional world bounds (in world units). Inclusive min, exclusive max for center point.
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  // Input-derived state consumed by the visual character and audio systems.
  private moving = false;
  private sprinting = false;
  private moveDirection = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, world: World, input: InputSystem, bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.camera = camera;
    this.world = world;
    this.input = input;
    this.position.copy(camera.position);
    if (bounds) this.bounds = bounds;

    // Ensure camera uses FPS-friendly rotation order
    this.camera.rotation.order = 'YXZ';
  }

  /** Update controller each frame */
  update(deltaSeconds: number): void {
    // Remove last frame's visual offset so physics uses true position
    if (this.renderYOffsetY !== 0) {
      this.position.y -= this.renderYOffsetY;
      this.renderYOffsetY = 0;
    }
    // Decay step cooldown
    if (this.stepCooldown > 0) this.stepCooldown = Math.max(0, this.stepCooldown - deltaSeconds);

    this.updateMovementInputState();

    // Determine underwater state: inside a water block OR inside flooded air volume connected to a water body
    const prevUnder = this.underwater;
    const headInWater = this.isHeadInsideWater();
    const headInFlood = this.isHeadInFloodedAir();
    const baseSubmerged = this.isBaseSubmerged();
    const surfaceY = WATER_LEVEL + 1.0 - 0.001;
    const headY = this.position.y + (this.height - this.eyeHeight);
    const hys = 0.3; // meters of hysteresis to avoid flicker and allow emerge assist
    if (this.underwater) {
      // Original exit rule: head clearly above surface -> leave swim mode
      if (headY > surfaceY + hys) this.underwater = false;
    } else {
      // Only enter swim mode if connected to water (block or flooded-air) AND head below surface band
      const connected = headInWater || headInFlood || baseSubmerged;
      if (connected && headY < surfaceY - hys) this.underwater = true;
    }
    const isUnderWater = this.underwater;

    if (isUnderWater) {
      // On enter water: clear vertical fall momentum and grounded flag
      if (!prevUnder) {
        this.velocityY = 0;
        this.grounded = false;
      }
      this.updateUnderwater(deltaSeconds);
      // Apply any active visual elevation tween (generally unused in water)
      this.applyElevationTween(deltaSeconds);
      return;
    }

    // Transitioned out of water: reset swim state gradually with momentum preservation
    if (prevUnder) {
      // Preserve upward carry if exiting while moving up
      this.velocityY = Math.max(this.velocityY, this.swimVelocity.y);
      // Gradually transfer horizontal swim momentum to prevent teleporting feel
      const swimHorizontalMagnitude = Math.hypot(this.swimVelocity.x, this.swimVelocity.z);
      if (swimHorizontalMagnitude > 0.5) {
        // Apply a forward boost in the direction of movement to smooth the transition
        const momentumBoost = Math.min(2.0, swimHorizontalMagnitude * 0.6);
        const swimDir = new THREE.Vector3(this.swimVelocity.x, 0, this.swimVelocity.z).normalize();
        this.position.add(swimDir.multiplyScalar(momentumBoost * deltaSeconds));
      }
      this.swimVelocity.set(0, 0, 0);
    }
    // Jump edge-trigger: only if grounded
    if (this.input.consumeJumpRequested() && this.grounded) {
      this.velocityY = this.jumpImpulse;
      this.grounded = false;
    }

    // Compute intended horizontal displacement from the shared look yaw. The
    // camera itself may now be in third-person orbit and have a different
    // world rotation, so it cannot be the movement source.
    const inputXZ = this.input.getMoveInput();
    const speed = this.input.isSprinting() ? this.sprintSpeed : this.walkSpeed;

    // Derive forward/right on XZ plane from input yaw only
    const yaw = this.input.getMovementYaw?.() ?? this.input.getOrientation().yaw;
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
    const landHitX = this.resolveAxis('x', dx);
    const landHitZ = this.resolveAxis('z', dz);
    // Land step-up assist is intentionally disabled. Water emerge logic remains below.
    if (PlayerController.ENABLE_LAND_STEP_ASSIST && (landHitX || landHitZ)) {
      const landInput = this.input.getMoveInput();
      const yaw = this.input.getMovementYaw?.() ?? this.input.getOrientation().yaw;
      const forwardX = -Math.sin(yaw);
      const forwardZ = -Math.cos(yaw);
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      const desX = rightX * landInput.x + forwardX * landInput.z;
      const desZ = rightZ * landInput.x + forwardZ * landInput.z;
      const desLen = Math.hypot(desX, desZ);
      if (this.stepCooldown <= 0 && desLen > 0.001) {
        const desiredDir = new THREE.Vector3(desX / desLen, 0, desZ / desLen);
        const candidates = [1.0, 0.75, 0.5, 0.25];
        const usedStep = this.tryStepUpMulti(candidates, desiredDir);
        if (usedStep > 0) {
          this.startElevationTween(usedStep);
          this.stepCooldown = 0.15;
        }
      }
    }
    const hitY = this.resolveAxis('y', dy);

    // Grounded logic: if moving down and collided, we are grounded
    if (dy < 0 && hitY) {
      this.grounded = true;
      this.velocityY = 0;
    } else if (dy !== 0) {
      this.grounded = false;
    }

    // Safety checks to prevent getting stuck in terrain
    const baseY = this.getBaseY();
    
    // Prevent falling below y=0 if no terrain loaded
    if (baseY < 0) {
      const deltaClamp = -baseY;
      this.position.y += deltaClamp;
      this.velocityY = 0;
      this.grounded = true;
    }
    
    // Additional safety: if player is inside solid blocks, push them up
    const pos = this.position;
    const minY = this.getBaseY();
    const maxY = minY + this.height;
    const minX = pos.x - this.halfWidth;
    const maxX = pos.x + this.halfWidth;
    const minZ = pos.z - this.halfWidth;
    const maxZ = pos.z + this.halfWidth;
    
    if (this.aabbIntersectsSolid(minX, minY, minZ, maxX, maxY, maxZ)) {
      // Player is stuck inside blocks, try to push them up
      let safeY = Math.floor(maxY) + 1;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        const testMinY = safeY - this.height;
        const testMaxY = safeY;
        
        if (!this.aabbIntersectsSolid(minX, testMinY, minZ, maxX, testMaxY, maxZ)) {
          // Found safe position
          this.position.y = safeY - this.height + this.eyeHeight;
          this.velocityY = 0;
          this.grounded = true;
          break;
        }
        
        safeY++;
        attempts++;
      }
    }

    // Apply post-physics elevation tween (visual only)
    this.applyElevationTween(deltaSeconds);
  }

  /** Underwater/swimming movement and physics */
  private updateUnderwater(dt: number): void {
    const swim = PLAYER.swim;

    // Read input in camera space
    const inputXZ = this.input.getMoveInput();
    const sprintMul = this.input.isSprinting() ? swim.sprintMultiplier : 1.0;

    // Shared look direction (with pitch) and horizontal right vector. This is
    // equivalent to the reference camera math and remains valid in orbit view.
    const { pitch } = this.input.getOrientation();
    const yaw = this.input.getMovementYaw?.() ?? this.input.getOrientation().yaw;
    const forward = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    ).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(forward, up).normalize(); // y=0 strafe basis

    // Desired movement direction from keys
    const desiredDir = new THREE.Vector3()
      .addScaledVector(right, inputXZ.x)
      .addScaledVector(forward, inputXZ.z);
    if (desiredDir.lengthSq() > 0) desiredDir.normalize();

    // Acceleration from input
    const accelMag = swim.accel * sprintMul;
    if (desiredDir.lengthSq() > 0) {
      this.swimVelocity.addScaledVector(desiredDir, accelMag * dt);
    }

    // Space held → add upward accel and surface attraction
    if (this.input.isJumpHeld()) {
      // Upward thrust
      this.swimVelocity.y += swim.verticalAccel * dt * sprintMul;
      // Snap toward surface (top of water block) when below it
      const surfaceY = WATER_LEVEL + 1.0 - 0.001;
      const below = surfaceY - this.position.y;
      if (below > 0) {
        this.swimVelocity.y += swim.surfaceSnapStrength * below * dt;
      }
    }

    // Gravity reduced in water + buoyancy/float near surface
    const waterGravity = this.gravity * swim.gravityScale; // negative
    this.swimVelocity.y += waterGravity * dt;
    // Floating spring: only slows sinking (no upward lift at rest). Measure depth to top surface
    const surfaceY2 = WATER_LEVEL + 1.0 - 0.001;
    const depth = surfaceY2 - this.position.y;
    if (depth > 0 && depth < swim.floatBand && this.swimVelocity.y < 0) {
      this.swimVelocity.y += swim.floatStrength * depth * dt;
    }
    // Idle sink bias: prevent exact hover near surface when no input
    const inputMag = Math.hypot(inputXZ.x, inputXZ.z);
    if (!this.input.isJumpHeld() && inputMag < 0.01) {
      this.swimVelocity.y -= Math.max(0, PLAYER.swim.sinkBias) * dt;
    }

    // Drag in water (applies to all components)
    const drag = Math.max(0, Math.min(10, swim.drag));
    const dragFactor = Math.max(0, 1 - drag * dt);
    this.swimVelocity.multiplyScalar(dragFactor);

    // Clamp max speed (separately clamp horizontal magnitude and vertical)
    const maxSpeed = swim.maxSpeed * sprintMul;
    const horizontal = new THREE.Vector3(this.swimVelocity.x, 0, this.swimVelocity.z);
    const hLen = horizontal.length();
    if (hLen > maxSpeed) {
      horizontal.multiplyScalar(maxSpeed / hLen);
      this.swimVelocity.x = horizontal.x;
      this.swimVelocity.z = horizontal.z;
    }
    // Reasonable vertical limit: match maxSpeed to feel cohesive
    this.swimVelocity.y = THREE.MathUtils.clamp(this.swimVelocity.y, -maxSpeed, maxSpeed);

    // Smooth emerge lift first (apply small vertical lift and micro-nudge before main X/Z)
    if (this.emergeLiftRemaining > 0) {
      const lift = Math.min(swim.emergeLiftSpeed * dt, this.emergeLiftRemaining);
      const prevY = this.position.y;
      this.resolveAxis('y', lift);
      const moved = this.position.y - prevY;
      this.emergeLiftRemaining -= Math.max(0, moved);
      // Micro forward nudge to clear shoreline
      const nudge = swim.emergeNudgeSpeed * dt;
      if (this.emergeNudgeDir.x !== 0 || this.emergeNudgeDir.z !== 0) {
        this.resolveAxis('x', this.emergeNudgeDir.x * nudge);
        this.resolveAxis('z', this.emergeNudgeDir.z * nudge);
      }
      if (this.emergeLiftRemaining <= 0) {
        this.emergeLiftRemaining = 0;
        this.emergeNudgeDir.set(0, 0, 0);
      }
    }

    // Integrate position with collisions against solids
    const dx = this.swimVelocity.x * dt;
    const dy = this.swimVelocity.y * dt;
    const dz = this.swimVelocity.z * dt;

    // Try horizontal movement; if blocked near the surface or with ground support, attempt a step-up
    const hitX = this.resolveAxis('x', dx);
    if (hitX) this.swimVelocity.x = 0;
    const hitZ = this.resolveAxis('z', dz);
    if (hitZ) this.swimVelocity.z = 0;

    const baseYNow = this.getBaseY();
    const surfaceY3 = WATER_LEVEL + 1.0 - 0.001;
    const nearSurface = (surfaceY3 - this.position.y) < (PLAYER.swim.floatBand + 0.75);
    const hasSupport = this.hasSolidGroundBelow();
    const hasInput = desiredDir.lengthSq() > 1e-6;
    // Enhanced conditions: also trigger when close to surface regardless of other factors to prevent getting stuck
    const veryNearSurface = Math.abs(surfaceY3 - this.position.y) < 0.5;
    if (this.emergeLiftRemaining <= 0 && this.stepCooldown <= 0 && (hasInput || this.input.isJumpHeld()) && (hitX || hitZ || hasSupport || veryNearSurface) && (nearSurface || this.input.isJumpHeld())) {
      // Plan a smooth emerge lift if clearance exists
      // Prefer to bring the feet to just above the water surface + 1 block to guarantee > 1 block clearance
      const toSurface = Math.max(0, surfaceY3 - baseYNow);
      const toSurfacePlusOne = Math.max(0, surfaceY3 + PLAYER.swim.stepOutHeadroom - baseYNow);
      // Allow larger emerge than land step, up to maxEmergeStepOut
      const primary = Math.min(PLAYER.swim.maxEmergeStepOut, Math.max(0.25, toSurfacePlusOne));
      // Fallback candidates include exactly toSurface (no extra headroom) and common step sizes
      const toSurfaceClamped = Math.min(PLAYER.swim.maxEmergeStepOut, Math.max(0.25, toSurface));
      const candidates = [primary, toSurfaceClamped, 1.25, 1.0, 0.75, 0.5, 0.25];
      let chosen = 0;
      for (const h of candidates) {
        if (this.canStepUpEmerge(h, desiredDir)) { chosen = h; break; }
      }
      if (chosen > 0) {
        this.emergeLiftRemaining = chosen;
        this.emergeNudgeDir.copy(desiredDir);
        this.startElevationTween(chosen);
        this.stepCooldown = 0.15;
      }
    }

    const hitY = this.resolveAxis('y', dy);
    if (hitY) this.swimVelocity.y = 0;

    // Underwater: grounded is conceptually false unless standing on floor with strong downward motion,
    // but audio and logic treat underwater separately, so keep grounded false for stability.
    this.grounded = false;

    // Safety checks similar to land: prevent extreme falls in unloaded areas
    const baseY = this.getBaseY();
    if (baseY < 0) {
      const deltaClamp = -baseY;
      this.position.y += deltaClamp;
      this.swimVelocity.y = Math.max(0, this.swimVelocity.y);
    }

    // If ended up intersecting solids (rare), push up
    const pos = this.position;
    const minY = this.getBaseY();
    const maxY = minY + this.height;
    const minX = pos.x - this.halfWidth;
    const maxX = pos.x + this.halfWidth;
    const minZ = pos.z - this.halfWidth;
    const maxZ = pos.z + this.halfWidth;
    if (this.aabbIntersectsSolid(minX, minY, minZ, maxX, maxY, maxZ)) {
      let safeY = Math.floor(maxY) + 1;
      let attempts = 0;
      const maxAttempts = 10;
      while (attempts < maxAttempts) {
        const testMinY = safeY - this.height;
        const testMaxY = safeY;
        if (!this.aabbIntersectsSolid(minX, testMinY, minZ, maxX, testMaxY, maxZ)) {
          this.position.y = safeY - this.height + this.eyeHeight;
          this.swimVelocity.y = 0;
          break;
        }
        safeY++;
        attempts++;
      }
    }
  }

  /**
   * Attempt to move along one axis and resolve collisions.
   * Returns true if a collision occurred on this axis.
   */
  private resolveAxis(axis: 'x' | 'y' | 'z', delta: number): boolean {
    if (delta === 0) return false;

    // Compute proposed position
    const pos = this.position;
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
          this.position.x = min;
          return true;
        }
        if (nextX > max) {
          this.position.x = max;
          return true;
        }
      } else if (axis === 'z') {
        const min = this.bounds.minZ + hw;
        const max = this.bounds.maxZ - hw;
        if (nextZ < min) {
          this.position.z = min;
          return true;
        }
        if (nextZ > max) {
          this.position.z = max;
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
  private getBaseY(positionY: number = this.position.y): number {
    return positionY - this.eyeHeight;
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

  /** Move the collision capsule upward for the under-player placement rule. */
  elevate(height: number, duration: number = 0.12): void {
    if (height <= 0) return;
    this.position.y += height;
    this.startElevationTween(height, duration);
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
    this.position.y += this.renderYOffsetY;
    if (t >= 1) {
      this.elevationTween.active = false;
      this.renderYOffsetY = 0;
    }
  }

  /** True if any sample point at player's head lies inside a water block */
  private isHeadInsideWater(): boolean {
    const pos = this.position;
    // Head Y: top of AABB (camera base + (height - eyeHeight)).
    const headY = pos.y + (this.height - this.eyeHeight);
    // If head is at or above the top of water plane, cannot be inside water block
    if (headY >= WATER_LEVEL + 1.0) return false;
    const y = Math.floor(headY);

    // Sample a small cross around the head within the player's horizontal footprint
    const r = Math.min(0.18, this.halfWidth * 0.9);
    const samples: Array<[number, number]> = [
      [0, 0],
      [ r,  0],
      [-r,  0],
      [ 0,  r],
      [ 0, -r],
    ];
    for (const [ox, oz] of samples) {
      const sx = Math.floor(pos.x + ox);
      const sz = Math.floor(pos.z + oz);
      if (this.world.getBlock(sx, y, sz) === this.waterId) return true;
    }
    return false;
  }

  /** True if any sample point at head is inside a flooded-air cell */
  private isHeadInFloodedAir(): boolean {
    const pos = this.position;
    const headY = pos.y + (this.height - this.eyeHeight);
    // Only consider when head is strictly below the top of the water plane
    if (headY >= WATER_LEVEL + 1.0) return false;
    const y = Math.floor(headY);
    const r = Math.min(0.18, this.halfWidth * 0.9);
    const samples: Array<[number, number]> = [
      [0, 0], [ r, 0], [-r, 0], [0, r], [0, -r]
    ];
    for (const [ox, oz] of samples) {
      const sx = Math.floor(pos.x + ox);
      const sz = Math.floor(pos.z + oz);
      if (this.world.isAirFlooded(sx, y, sz)) return true;
    }
    return false;
  }

  /** Feet/base submerged in water block or flooded-air volume */
  private isBaseSubmerged(): boolean {
    const pos = this.position;
    const baseY = this.getBaseY(pos.y) + 1e-3; // nudge up to avoid floor precision
    const y = Math.floor(baseY);
    if (y > WATER_LEVEL) return false;
    const r = Math.min(0.18, this.halfWidth * 0.9);
    const samples: Array<[number, number]> = [
      [0, 0], [ r, 0], [-r, 0], [0, r], [0, -r]
    ];
    for (const [ox, oz] of samples) {
      const sx = Math.floor(pos.x + ox);
      const sz = Math.floor(pos.z + oz);
      if (this.world.isAirFlooded(sx, y, sz)) return true;
      if (this.world.getBlock(sx, y, sz) === this.waterId) return true;
    }
    return false;
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

  /** Check if there is solid ground directly below player's footprint */
  private hasSolidGroundBelow(offset: number = 0.01): boolean {
    const pos = this.position;
    const half = this.halfWidth;
    const baseY = this.getBaseY(pos.y) - offset;
    const yBlock = Math.floor(baseY);
    const minX = Math.floor(pos.x - half);
    const maxX = Math.floor(pos.x + half);
    const minZ = Math.floor(pos.z - half);
    const maxZ = Math.floor(pos.z + half);
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (this.world.isBlockSolid(x, yBlock, z)) return true;
      }
    }
    return false;
  }

  /** Attempt a small upward step (≤1-1.25 blocks) if clearance and support exist.
   * Optionally considers a small forward pre-nudge for clearance tests to avoid the front-face blocking the step.
   */
  private tryStepUp(stepHeight: number, forwardDir?: THREE.Vector3): boolean {
    if (stepHeight <= 0) return false;
    const pos = this.position;
    const nextY = pos.y + stepHeight;
    // Use a small pre-nudge along desired direction when evaluating clearance,
    // so we test the position we'd occupy right after stepping.
    const preNudge = 0.08;
    const nx = forwardDir && forwardDir.lengthSq() > 1e-6 ? pos.x + forwardDir.x * preNudge : pos.x;
    const nz = forwardDir && forwardDir.lengthSq() > 1e-6 ? pos.z + forwardDir.z * preNudge : pos.z;
    const eps = PlayerController.EPS * 4;
    const minX = nx - this.halfWidth + eps;
    const maxX = nx + this.halfWidth - eps;
    const minZ = nz - this.halfWidth + eps;
    const maxZ = nz + this.halfWidth - eps;
    const minY = this.getBaseY(nextY) + eps;
    const maxY = minY + this.height - eps;
    // Require clearance at the new height
    if (this.aabbIntersectsSolid(minX, minY, minZ, maxX, maxY, maxZ)) return false;
    // Require some support just below new base so we don't step into mid-air
    const supportY = Math.floor(minY - 0.01);
    let hasSupport = false;
    for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
      for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
        if (this.world.isBlockSolid(x, supportY, z)) { hasSupport = true; break; }
      }
      if (hasSupport) break;
    }
    if (!hasSupport) return false;
    // Apply step
    this.position.y = nextY;
    return true;
  }

  // (legacy canStepUp removed; use canStepUpEmerge or tryStepUp as appropriate)

  /**
   * Like canStepUp, but when emerging from water we allow "support" to be either:
   * - A solid block directly below new base (normal), OR
   * - A solid block just ahead in the intended direction at/below the new base (shoreline lip),
   *   which lets us climb out even if the cell directly under our base is a water-surface block.
   */
  private canStepUpEmerge(stepHeight: number, forwardDir?: THREE.Vector3): boolean {
    if (stepHeight <= 0) return false;
    const pos = this.position;
    const nextY = pos.y + stepHeight;
    const preNudge = 0.08;
    const hasForward = !!forwardDir && forwardDir.lengthSq() > 1e-6;
    const nx = hasForward ? pos.x + (forwardDir as THREE.Vector3).x * preNudge : pos.x;
    const nz = hasForward ? pos.z + (forwardDir as THREE.Vector3).z * preNudge : pos.z;
    const eps = PlayerController.EPS * 4;
    const minX = nx - this.halfWidth + eps;
    const maxX = nx + this.halfWidth - eps;
    const minZ = nz - this.halfWidth + eps;
    const maxZ = nz + this.halfWidth - eps;
    const minY = this.getBaseY(nextY) + eps;
    const maxY = minY + this.height - eps;
    // Clearance at target height must be empty of solids
    if (this.aabbIntersectsSolid(minX, minY, minZ, maxX, maxY, maxZ)) return false;

    // Primary support check (normal land): any solid under new base footprint
    const supportY = Math.floor(minY - 0.01);
    let hasSolidSupport = false;
    for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
      for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
        if (this.world.isBlockSolid(x, supportY, z)) { hasSolidSupport = true; break; }
      }
      if (hasSolidSupport) break;
    }
    if (hasSolidSupport) return true;

    // Shoreline support: accept if there is solid slightly ahead at/below new base.
    // If no forward input, probe in 4 cardinal directions to find the nearest lip.
    const aheadDirs: THREE.Vector3[] = [];
    if (hasForward) {
      aheadDirs.push(forwardDir!.clone().setY(0).normalize());
    } else {
      aheadDirs.push(
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
      );
    }
    const aheadDist = 0.5; // sample half a block ahead
    for (const dir of aheadDirs) {
      const ax = nx + dir.x * aheadDist;
      const az = nz + dir.z * aheadDist;
      const ax0 = Math.floor(ax - this.halfWidth + eps);
      const ax1 = Math.floor(ax + this.halfWidth - eps);
      const az0 = Math.floor(az - this.halfWidth + eps);
      const az1 = Math.floor(az + this.halfWidth - eps);
      for (let y = supportY; y >= supportY - 1; y--) {
        for (let z = az0; z <= az1; z++) {
          for (let x = ax0; x <= ax1; x++) {
            if (this.world.isBlockSolid(x, y, z)) return true;
          }
        }
      }
    }

    return false;
  }

  /** Try multiple step heights and apply a small forward nudge to clear the lip */
  private tryStepUpMulti(heights: number[], desiredDir: THREE.Vector3): number {
    for (const h of heights) {
      if (this.tryStepUp(h, desiredDir)) {
        // Nudge forward slightly to get past the boundary
        const nudge = 0.08;
        if (desiredDir.x !== 0) this.resolveAxis('x', desiredDir.x * nudge);
        if (desiredDir.z !== 0) this.resolveAxis('z', desiredDir.z * nudge);
        return h;
      }
    }
    return 0;
  }

  /** Synchronize the independent physics position to a camera pose at setup. */
  syncPositionFromCamera(): void {
    this.position.copy(this.camera.position);
    this.renderYOffsetY = 0;
    this.elevationTween.active = false;
  }

  /** Current collision-capsule eye position. */
  getEyePosition(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.position);
  }

  /** Current collision-capsule feet/base position. */
  getFeetPosition(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.position).setY(this.position.y - this.eyeHeight);
  }

  getEyeHeight(): number { return this.eyeHeight; }
  getHeight(): number { return this.height; }
  getWidth(): number { return this.width; }

  /** Read-only world access for camera collision owned by the visual rig. */
  getWorld(): World { return this.world; }

  isUnderwater(): boolean { return this.underwater; }

  getMovementState(): PlayerMovementState {
    return {
      isMoving: this.moving,
      isSprinting: this.sprinting,
      isGrounded: this.grounded,
      isUnderwater: this.underwater,
      moveDirection: this.moveDirection.clone(),
    };
  }

  private updateMovementInputState(): void {
    const inputXZ = this.input.getMoveInput();
    const yaw = this.input.getMovementYaw?.() ?? this.input.getOrientation().yaw;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const moveX = rightX * inputXZ.x + forwardX * inputXZ.z;
    const moveZ = rightZ * inputXZ.x + forwardZ * inputXZ.z;
    const length = Math.hypot(moveX, moveZ);
    this.moving = length > 0.001;
    this.sprinting = this.input.isSprinting();
    this.moveDirection.set(
      length > 0 ? moveX / length : 0,
      0,
      length > 0 ? moveZ / length : 0,
    );
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
