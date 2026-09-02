/**
 * Module: engine/render/PlayerCharacter
 * Purpose: The complete procedural player from ref/character.html, including
 * its authored textures, rig, animation mapping, view modes, and exact OBB
 * caster data used by the screen-space sun visibility pass.
 * Callers: Engine owns one instance and updates it after player physics.
 */

import * as THREE from 'three';
import {
  enableMeshStandardForwardRefraction,
  type ForwardRefractionParticipantRegistry,
} from './water/ForwardRefraction';
import { PLAYER, SWING_CYCLE_SECONDS } from '../../config/constants';
import type { InputSystem } from '../systems/Input';
import type { PlayerController, PlayerMovementState } from '../systems/PlayerController';
import { constrainCameraToSolidVoxels } from '../utils/cameraCollision';
import type { CharacterShadowBox } from './lighting/CharacterShadowBox';
import {
  DEFAULT_PLAYER_CHARACTER,
  normalizePlayerCharacter,
  type PlayerCharacterId,
} from '../../shared/playerCharacters';
import {
  createPlayerCharacterRig,
  type PlayerCharacterRig,
  type PlayerCharacterRigBuildContext,
} from './playerCharacterRigs';
import { CharacterSwitchVFX } from './CharacterSwitchVFX';

import swingSfxUrl from '../../assets/sounds/sound_effects/swing.mp3';

const MAX_HEAD_TURN = THREE.MathUtils.degToRad(65);

const LEG_LENGTH = 0.75;
const LEG_PIVOT_Y = 0.65;
const HEAD_PIVOT_Y = 1.4;

const CFG = {
  // A leg box is centered half its length below the hip pivot, so its static
  // bottom is pivotY - length. Lift the visual root by the derived amount so
  // the actual foot bottom coincides with the controller's collision AABB
  // base. Keeping this derived from the rig datum prevents a second hidden
  // feet offset if the leg proportions change later.
  visualFeetLift: LEG_LENGTH - LEG_PIVOT_Y,
  cameraDistance: 3.8,
  // A small shoulder offset keeps the centered reticle on world space while
  // preserving the reference orbit distance and character readability.
  thirdPersonShoulderOffset: 0.8,
  thirdPersonAimDistance: 8,
  cameraCollisionRadius: 0.2,
  cameraCollisionPadding: 0.04,
  // The first-person camera is a smaller physical volume than the orbit
  // camera. It still needs a small swept footprint so the eye cannot enter a
  // voxel when the character's forward-facing eye anchor reaches a wall.
  firstPersonCameraCollisionRadius: 0.04,
  firstPersonCameraCollisionPadding: 0.02,
  // Rotating the upright rig into its horizontal swim pose moves the arms,
  // legs, and held tool below the character root. Lift the posed body so its
  // lowest rendered point remains on the physics collider's feet plane.
  swimBodyLift: 0.55,
  swingDuration: SWING_CYCLE_SECONDS,
} as const;

interface PlayerMaterialRecord {
  material: THREE.MeshStandardMaterial;
  baseColor: THREE.Color;
  baseEmissive: THREE.Color;
  baseEmissiveIntensity: number;
}

interface PlayerRigPose {
  bodyPosition: THREE.Vector3;
  bodyRotation: THREE.Euler;
  headRotation: THREE.Euler;
  leftArmRotation: THREE.Euler;
  rightArmRotation: THREE.Euler;
  leftLegRotation: THREE.Euler;
  rightLegRotation: THREE.Euler;
}

export class PlayerCharacter {
  private playerRoot: THREE.Object3D | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private input: InputSystem | null = null;
  private controller: PlayerController | null = null;

  // Reference rig nodes.
  private readonly character = new THREE.Group();
  private readonly switchVfx = new CharacterSwitchVFX();
  private rig!: PlayerCharacterRig;
  private body!: THREE.Group;
  private headPivot!: THREE.Group;
  private eyeAnchor!: THREE.Object3D;
  private hairBand!: THREE.Object3D;
  private headMesh!: THREE.Mesh;
  private leftArm!: THREE.Group;
  private rightArm!: THREE.Group;
  private leftLeg!: THREE.Group;
  private rightLeg!: THREE.Group;

  private readonly ownedTextures: THREE.Texture[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly materialRecords: PlayerMaterialRecord[] = [];
  private readonly shadowMeshes: THREE.Mesh[] = [];
  private readonly shadowBoxes: CharacterShadowBox[] = [];
  private readonly forwardRefractionParticipants?: ForwardRefractionParticipantRegistry;

  private isFirstPerson = false;
  private bodyYaw = PLAYER.initialYaw;
  private forcedFacingYaw = PLAYER.initialYaw;
  private forcedFacingTime = 0;
  private walkTimer = 0;
  private swimTimer = 0;
  private elapsedTime = 0;
  private swingActive = false;
  private swingTime = 0;
  private snapCameraOnNextUpdate = false;
  private swingAudio: HTMLAudioElement | null = null;
  private currentCharacter: PlayerCharacterId;

  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchDirection = new THREE.Vector3();
  private readonly scratchTarget = new THREE.Vector3();
  private readonly scratchCameraCandidate = new THREE.Vector3();
  private readonly scratchFeetPosition = new THREE.Vector3();
  private readonly scratchAmbient = new THREE.Color();
  private readonly scratchAmbientContribution = new THREE.Color();
  private readonly scratchBaseEmission = new THREE.Color();
  private readonly scratchStarContribution = new THREE.Color();
  private readonly scratchStarAmbient = new THREE.Color(0.02, 0.025, 0.04);

  constructor(
    characterId: PlayerCharacterId = DEFAULT_PLAYER_CHARACTER,
    options: { forwardRefractionParticipants?: ForwardRefractionParticipantRegistry } = {},
  ) {
    this.character.name = 'PlayerCharacter.Root';
    this.forwardRefractionParticipants = options.forwardRefractionParticipants;
    this.currentCharacter = normalizePlayerCharacter(characterId);
    this.buildRig(this.currentCharacter);
    this.attachSwitchVfxToBody();
    this.setFirstPerson(false);
    this.character.updateMatrixWorld(true);
    this.switchVfx.setTarget(this.body);
  }

  private buildRig(characterId: PlayerCharacterId): void {
    const context: PlayerCharacterRigBuildContext = {
      eyeAnchorY: PLAYER.eyeHeight - CFG.visualFeetLift - HEAD_PIVOT_Y,
      createTexturedMaterial: (texture, options) => this.createTexturedMaterial(texture, options),
      createMaterial: (options) => this.createMaterial(options),
      createMesh: (geometry, material, name) => this.createMesh(geometry, material, name),
      createPickaxe: () => this.createPickaxe(),
    };
    this.rig = createPlayerCharacterRig(characterId, context);
    this.body = this.rig.body;
    this.headPivot = this.rig.headPivot;
    this.eyeAnchor = this.rig.eyeAnchor;
    this.headMesh = this.rig.headMesh;
    this.hairBand = this.rig.hairBand;
    this.leftArm = this.rig.leftArm;
    this.rightArm = this.rig.rightArm;
    this.leftLeg = this.rig.leftLeg;
    this.rightLeg = this.rig.rightLeg;
    this.character.add(this.body);
    this.registerShadowMeshes();
  }

  private registerShadowMeshes(): void {
    this.character.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox;
      if (!bounds) return;
      this.shadowMeshes.push(object);
      this.forwardRefractionParticipants?.register(object);
      this.shadowBoxes.push({
        inverseMatrix: new THREE.Matrix4(),
        center: bounds.getCenter(new THREE.Vector3()),
        halfSize: bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5),
      });
    });
  }

  init(playerRoot: THREE.Object3D, camera: THREE.PerspectiveCamera, input: InputSystem): void {
    this.playerRoot = playerRoot;
    this.camera = camera;
    this.input = input;
    this.input.setMovementYawOffset?.(this.isFirstPerson ? 0 : Math.PI);
    playerRoot.add(this.character);
  }

  setController(controller: PlayerController): void {
    this.controller = controller;
  }

  /** Replace only the authored appearance while retaining the live pose. */
  setCharacter(characterId: PlayerCharacterId): void {
    const nextCharacter = normalizePlayerCharacter(characterId);
    if (nextCharacter === this.currentCharacter) return;

    const pose: PlayerRigPose = {
      bodyPosition: this.body.position.clone(),
      bodyRotation: this.body.rotation.clone(),
      headRotation: this.headPivot.rotation.clone(),
      leftArmRotation: this.leftArm.rotation.clone(),
      rightArmRotation: this.rightArm.rotation.clone(),
      leftLegRotation: this.leftLeg.rotation.clone(),
      rightLegRotation: this.rightLeg.rotation.clone(),
    };

    this.disposeRig();
    this.currentCharacter = nextCharacter;
    this.buildRig(nextCharacter);
    this.body.position.copy(pose.bodyPosition);
    this.body.rotation.copy(pose.bodyRotation);
    this.headPivot.rotation.copy(pose.headRotation);
    this.leftArm.rotation.copy(pose.leftArmRotation);
    this.rightArm.rotation.copy(pose.rightArmRotation);
    this.leftLeg.rotation.copy(pose.leftLegRotation);
    this.rightLeg.rotation.copy(pose.rightLegRotation);
    this.setFirstPerson(this.isFirstPerson);
    this.attachSwitchVfxToBody();
    this.character.updateMatrixWorld(true);
    this.switchVfx.setTarget(this.body);
    this.switchVfx.trigger();
  }

  getCharacter(): PlayerCharacterId {
    return this.currentCharacter;
  }

  setSwitchVfxVolume(volume: number): void {
    this.switchVfx.setVolume(volume);
  }

  /** Advance the character-local switch effect independently of pause state. */
  updateSwitchVfx(deltaSeconds: number): void {
    this.switchVfx.update(deltaSeconds);
  }

  setFirstPerson(value: boolean): void {
    const viewChanged = this.isFirstPerson !== value;
    this.isFirstPerson = value;
    this.input?.setMovementYawOffset?.(value ? 0 : Math.PI);
    if (viewChanged) {
      // First-person looks along the character's current heading. Third-person
      // retains its existing orbit convention (`orbitYaw = lookYaw + PI`), so
      // seed its look yaw half a turn back to put the camera behind the body.
      this.input?.setLookOrientation?.(value ? this.bodyYaw : this.bodyYaw - Math.PI);
      if (!value) this.snapCameraOnNextUpdate = true;
    }
    // Only the geometry surrounding the eye is hidden. The real arms,
    // pickaxe, torso, backpack, and legs remain part of the rig in FPS view.
    this.headMesh.visible = !value;
    this.hairBand.visible = !value;
  }

  toggleView(): void {
    this.setFirstPerson(!this.isFirstPerson);
  }

  isFirstPersonView(): boolean {
    return this.isFirstPerson;
  }

  /** Return live oriented boxes for the deterministic character caster. */
  getShadowBoxes(): ReadonlyArray<CharacterShadowBox> {
    this.character.updateMatrixWorld(true);
    for (let index = 0; index < this.shadowMeshes.length; index += 1) {
      const mesh = this.shadowMeshes[index];
      const box = this.shadowBoxes[index];
      if (!mesh || !box) continue;
      box.inverseMatrix.copy(mesh.matrixWorld).invert();
    }
    return this.shadowBoxes;
  }

  /**
   * Update the rig from physics and, unless explicitly disabled for a
   * diagnostic camera, write the active first-/third-person camera pose.
   */
  update(dt: number, updateCamera = true, snapCamera = false): void {
    if (!this.playerRoot || !this.camera || !this.input || !this.controller) return;

    const state = this.controller.getMovementState();
    this.elapsedTime += dt;
    this.forcedFacingTime = Math.max(0, this.forcedFacingTime - dt);

    this.controller.getFeetPosition(this.scratchPosition);
    // getFeetPosition() is the bottom of the physics AABB. The authored rig's
    // leg geometry extends 0.10 below its root, so lift only the visual rig;
    // the eye anchor is counter-offset above to preserve the physical camera.
    this.character.position.set(
      this.scratchPosition.x,
      this.scratchPosition.y + CFG.visualFeetLift,
      this.scratchPosition.z,
    );
    this.updateFacing(dt, state);
    this.applyAnimation(dt, state);

    this.character.updateMatrixWorld(true);
    if (updateCamera) {
      const shouldSnapCamera = snapCamera || this.snapCameraOnNextUpdate;
      this.snapCameraOnNextUpdate = false;
      this.updateCamera(dt, shouldSnapCamera);
    }
    this.character.updateMatrixWorld(true);
  }

  /** Force the third-person body toward a world-space horizontal action. */
  faceTowards(direction: THREE.Vector3): void {
    if (this.isFirstPerson || direction.lengthSq() < 1e-6) return;
    this.forcedFacingYaw = Math.atan2(-direction.x, -direction.z);
    this.bodyYaw = this.forcedFacingYaw;
    this.character.rotation.y = this.bodyYaw;
    this.forcedFacingTime = CFG.swingDuration + 0.18;
  }

  onPrimaryClick(): void {
    this.tryStartSwing();
  }

  onSecondaryClick(): void {
    this.tryStartSwing();
  }

  isSwingActive(): boolean {
    return this.swingActive;
  }

  /**
   * Apply the same atmosphere-derived ambient floor used by terrain. Native
   * Three.js lights still provide direct sun illumination; this floor keeps
   * the MeshStandard character readable when sunrise direct light is near 0.
   */
  setLighting(skyAmbient: THREE.Color, starLight = 0): void {
    this.scratchStarContribution.copy(this.scratchStarAmbient).multiplyScalar(0.35 * THREE.MathUtils.clamp(starLight, 0, 1));
    this.scratchAmbient.copy(skyAmbient).add(this.scratchStarContribution);
    for (const record of this.materialRecords) {
      this.scratchBaseEmission.copy(record.baseEmissive).multiplyScalar(record.baseEmissiveIntensity);
      this.scratchAmbientContribution.copy(this.scratchAmbient).multiply(record.baseColor);
      record.material.emissive.copy(this.scratchBaseEmission).add(this.scratchAmbientContribution);
      record.material.emissiveIntensity = 1;
    }
  }

  dispose(): void {
    try { this.swingAudio?.pause(); } catch { /* ignore */ }
    this.swingAudio = null;
    this.playerRoot?.remove(this.character);
    this.disposeRig();
    this.switchVfx.dispose();
  }

  private disposeRig(): void {
    this.switchVfx.object.removeFromParent();
    this.character.remove(this.body);
    for (const mesh of this.shadowMeshes) this.forwardRefractionParticipants?.unregister(mesh);
    const geometries = new Set<THREE.BufferGeometry>();
    this.body.traverse((object) => {
      if (object instanceof THREE.Mesh) geometries.add(object.geometry);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    for (const texture of this.ownedTextures) texture.dispose();
    this.ownedMaterials.length = 0;
    this.ownedTextures.length = 0;
    this.materialRecords.length = 0;
    this.shadowMeshes.length = 0;
    this.shadowBoxes.length = 0;
  }

  private attachSwitchVfxToBody(): void {
    this.switchVfx.object.removeFromParent();
    this.body.add(this.switchVfx.object);
  }

  private updateFacing(dt: number, state: PlayerMovementState): void {
    const input = this.input;
    if (!input) return;
    const { yaw, pitch } = input.getOrientation();

    if (this.isFirstPerson) {
      if (state.isMoving) {
        // Movement owns the first-person body heading. Apply it without a
        // turn blend so W/A/S/D immediately rotates the rig toward its actual
        // world-space travel direction while the camera keeps its look yaw.
        this.bodyYaw = Math.atan2(-state.moveDirection.x, -state.moveDirection.z);
      }
      let lookDiff = shortestAngle(yaw - this.bodyYaw);
      if (!state.isMoving && Math.abs(lookDiff) > MAX_HEAD_TURN) {
        const excess = lookDiff > 0 ? lookDiff - MAX_HEAD_TURN : lookDiff + MAX_HEAD_TURN;
        this.bodyYaw += excess * Math.min(1, dt * 10);
        lookDiff = shortestAngle(yaw - this.bodyYaw);
      }
      this.headPivot.rotation.y = THREE.MathUtils.clamp(lookDiff, -MAX_HEAD_TURN, MAX_HEAD_TURN);
      this.headPivot.rotation.x = -pitch;
    } else {
      let targetYaw = this.bodyYaw;
      if (this.forcedFacingTime > 0) {
        targetYaw = this.forcedFacingYaw;
      } else if (state.isMoving) {
        targetYaw = Math.atan2(-state.moveDirection.x, -state.moveDirection.z);
      }
      const angleDiff = shortestAngle(targetYaw - this.bodyYaw);
      this.bodyYaw += angleDiff * Math.min(1, dt * 12);
      this.headPivot.rotation.y = THREE.MathUtils.lerp(this.headPivot.rotation.y, 0, Math.min(1, dt * 12));
      this.headPivot.rotation.x = THREE.MathUtils.lerp(this.headPivot.rotation.x, 0, Math.min(1, dt * 12));
    }

    this.character.rotation.set(0, this.bodyYaw, 0);
  }

  private applyAnimation(dt: number, state: PlayerMovementState): void {
    if (state.isUnderwater) {
      this.swimTimer += dt * (state.isMoving ? 8 : 3);
      const swimPitch = state.isMoving ? -Math.PI / 2.05 : 0.2;
      const swimPoseAlpha = Math.min(1, dt * 8);
      this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, swimPitch, swimPoseAlpha);
      this.body.position.y = THREE.MathUtils.lerp(this.body.position.y, CFG.swimBodyLift, swimPoseAlpha);
      this.leftArm.rotation.x = -Math.PI / 3 + Math.sin(this.swimTimer) * 0.9;
      this.leftArm.rotation.z = -0.3;
      if (!this.swingActive) {
        this.rightArm.rotation.x = -Math.PI / 3 + Math.sin(this.swimTimer + Math.PI) * 0.9;
        this.rightArm.rotation.z = 0.3;
        this.rightArm.rotation.y = 0;
      }
      this.leftLeg.rotation.x = Math.sin(this.swimTimer * 1.6) * 0.4;
      this.rightLeg.rotation.x = -Math.sin(this.swimTimer * 1.6) * 0.4;
    } else {
      const landPoseAlpha = Math.min(1, dt * 10);
      this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, 0, landPoseAlpha);
      this.body.position.y = THREE.MathUtils.lerp(this.body.position.y, 0, landPoseAlpha);

      if (state.isMoving && state.isGrounded) {
        this.walkTimer += dt * (state.isSprinting ? 14 : 9);
        const legAngle = Math.sin(this.walkTimer) * (state.isSprinting ? 0.9 : 0.65);
        this.leftLeg.rotation.x = legAngle;
        this.rightLeg.rotation.x = -legAngle;
        this.leftArm.rotation.x = -legAngle * 0.8;
        this.leftArm.rotation.z = 0.05;
        if (!this.swingActive) {
          this.rightArm.rotation.x = legAngle * 0.8;
          this.rightArm.rotation.y = 0;
          this.rightArm.rotation.z = -0.05;
        }
        this.body.position.y = Math.abs(Math.sin(this.walkTimer)) * 0.08;
      } else if (!state.isGrounded) {
        this.leftLeg.rotation.x = -0.4;
        this.rightLeg.rotation.x = 0.2;
        this.leftArm.rotation.x = -0.5;
        if (!this.swingActive) {
          this.rightArm.rotation.x = -0.5;
          this.rightArm.rotation.y = 0;
          this.rightArm.rotation.z = 0;
        }
      } else {
        const idleTime = this.elapsedTime * 2.2;
        this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, Math.min(1, dt * 8));
        this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, Math.min(1, dt * 8));
        this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, Math.min(1, dt * 8));
        this.leftArm.rotation.z = 0.08 + Math.sin(idleTime) * 0.03;
        if (!this.swingActive) {
          this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0, Math.min(1, dt * 8));
          this.rightArm.rotation.y = 0;
          this.rightArm.rotation.z = -0.08 - Math.sin(idleTime) * 0.03;
        }
        this.body.position.y = Math.sin(idleTime) * 0.015;
      }
    }

    this.updateSwing(dt);
    if (this.swingActive) {
      const progress = THREE.MathUtils.clamp(this.swingTime / CFG.swingDuration, 0, 1);
      const strike = Math.sin(progress * Math.PI);
      this.rightArm.rotation.x = -Math.PI / 2.8 - strike * 1.5;
      this.rightArm.rotation.y = -strike * 0.35;
      this.rightArm.rotation.z = -strike * 0.2;
    }
  }

  private updateSwing(dt: number): void {
    if (!this.swingActive) return;
    this.swingTime += dt;
    if (this.swingTime >= CFG.swingDuration) {
      this.swingActive = false;
      this.swingTime = 0;
    }
  }

  private tryStartSwing(): void {
    if (this.swingActive) return;
    this.swingActive = true;
    this.swingTime = 0;
    try {
      if (!this.swingAudio) {
        this.swingAudio = new Audio(swingSfxUrl);
        this.swingAudio.preload = 'auto';
      }
      this.swingAudio.pause();
      this.swingAudio.currentTime = 0;
      void this.swingAudio.play().catch(() => { /* autoplay may be blocked */ });
    } catch {
      // Audio is optional; animation must remain independent of it.
    }
  }

  private updateCamera(dt: number, snap = false): void {
    const camera = this.camera;
    if (!camera) return;
    this.headPivot.getWorldPosition(this.scratchTarget);
    this.eyeAnchor.getWorldPosition(this.scratchPosition);

    const { yaw, pitch } = this.input?.getOrientation() ?? { yaw: 0, pitch: 0 };
    if (this.isFirstPerson) {
      this.scratchDirection.set(
        -Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      ).normalize();

      // The controller eye is the collision-safe physical origin. Sweep the
      // rig's anatomical eye anchor toward its authored slightly-forward
      // position so head turns and the face offset cannot put the camera in a
      // solid terrain voxel.
      if (this.controller) {
        this.controller.getEyePosition(this.scratchTarget);
        this.scratchCameraCandidate.copy(this.scratchPosition);
        constrainCameraToSolidVoxels(
          this.controller.getWorld(),
          this.scratchTarget,
          this.scratchCameraCandidate,
          CFG.firstPersonCameraCollisionRadius,
          CFG.firstPersonCameraCollisionPadding,
        );
        camera.position.copy(this.scratchCameraCandidate);
      } else {
        camera.position.copy(this.scratchPosition);
      }

      this.scratchTarget.copy(camera.position).add(this.scratchDirection);
      camera.lookAt(this.scratchTarget);
      camera.updateMatrixWorld(true);
      return;
    }

    // Do not use the animated head pivot as the third-person orbit origin.
    // In the horizontal swim pose that pivot is intentionally forward of the
    // physics root. The physical eye is a stable, collision-cleared anchor;
    // using a lower feet-relative point can put the camera sphere inside the
    // top voxel of a seabed block before the sweep even starts.
    if (this.controller) {
      this.controller.getEyePosition(this.scratchTarget);
    } else {
      this.scratchTarget.y += 0.30;
    }
    const camDistance = CFG.cameraDistance;
    const cosPitch = Math.cos(pitch);
    // Start the orbit on the character's front side. The player heading is
    // intentionally kept in the shared input yaw so movement and mouse-look
    // remain unchanged; only the third-person orbit is rotated 180 degrees.
    const orbitYaw = yaw + Math.PI;
    const desiredCamera = this.scratchDirection.set(
      Math.sin(orbitYaw) * cosPitch * camDistance,
      -Math.sin(pitch) * camDistance,
      Math.cos(orbitYaw) * cosPitch * camDistance,
    ).add(this.scratchTarget);
    // Shift the orbit laterally into an over-shoulder composition. With the
    // body centered exactly under a target-at-head camera, the reticle points
    // at the character rather than giving the player a useful world aim point.
    desiredCamera.x += Math.cos(orbitYaw) * CFG.thirdPersonShoulderOffset;
    desiredCamera.z -= Math.sin(orbitYaw) * CFG.thirdPersonShoulderOffset;
    // Match the reference's responsive orbit follow with a frame-rate
    // independent equivalent of its per-frame 0.4 interpolation.
    const alpha = snap ? 1 : 1 - Math.exp(-30 * Math.max(0, Math.min(0.1, dt)));
    this.scratchCameraCandidate.copy(camera.position).lerp(desiredCamera, alpha);
    if (this.controller) {
      // Keep the orbit center above the character's terrain-contact plane,
      // including when the camera extends past a cliff into otherwise empty
      // air. The voxel sweep below handles raised terrain and overhangs.
      const minimumCameraY = this.controller.getFeetPosition(this.scratchFeetPosition).y
        + CFG.cameraCollisionRadius
        + CFG.cameraCollisionPadding;
      constrainCameraToSolidVoxels(
        this.controller.getWorld(),
        this.scratchTarget,
        this.scratchCameraCandidate,
        CFG.cameraCollisionRadius,
        CFG.cameraCollisionPadding,
        minimumCameraY,
      );
    }
    // Collision is a hard post-follow constraint. Copy the constrained pose
    // directly so smoothing can never leave the camera under terrain for a
    // frame while recovering from an invalid orbit position.
    camera.position.copy(this.scratchCameraCandidate);
    this.scratchDirection.set(
      -Math.sin(orbitYaw) * cosPitch,
      Math.sin(pitch),
      -Math.cos(orbitYaw) * cosPitch,
    ).normalize();
    this.scratchTarget.addScaledVector(this.scratchDirection, CFG.thirdPersonAimDistance);
    camera.lookAt(this.scratchTarget);
    camera.updateMatrixWorld(true);
  }

  private createTexturedMaterial(
    texture: THREE.Texture,
    options: THREE.MeshStandardMaterialParameters = {},
  ): THREE.MeshStandardMaterial {
    this.ownedTextures.push(texture);
    const material = this.createMaterial({ roughness: 0.8, ...options, map: texture });
    // Reuse the authored albedo as an emissive map for the atmosphere floor;
    // the map is only an indirect-light fallback, not a second visible layer.
    material.emissiveMap = texture;
    material.needsUpdate = true;
    return material;
  }

  private createMaterial(options: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial(options);
    enableMeshStandardForwardRefraction(material);
    this.ownedMaterials.push(material);
    this.materialRecords.push({
      material,
      baseColor: material.color.clone(),
      baseEmissive: material.emissive.clone(),
      baseEmissiveIntensity: material.emissiveIntensity,
    });
    return material;
  }

  private createMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    name: string,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createPickaxe(): THREE.Group {
    const pickaxe = new THREE.Group();
    pickaxe.name = 'Pickaxe';
    const woodMat = this.createMaterial({ color: 0x4a2e18, roughness: 0.9 });
    const goldMat = this.createMaterial({ color: 0xf59e0b, metalness: 0.7, roughness: 0.3 });
    const diamondMat = this.createMaterial({
      color: 0x00f0ff,
      emissive: 0x0099bb,
      emissiveIntensity: 0.5,
      roughness: 0.2,
    });

    const addPart = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string, position: THREE.Vector3): void => {
      const mesh = this.createMesh(geometry, material, name);
      mesh.position.copy(position);
      pickaxe.add(mesh);
    };
    addPart(new THREE.BoxGeometry(0.045, 0.9, 0.045), woodMat, 'PickaxeHandle', new THREE.Vector3(0, 0.22, 0));
    addPart(new THREE.BoxGeometry(0.055, 0.2, 0.055), goldMat, 'PickaxeGrip', new THREE.Vector3(0, 0.05, 0));
    addPart(new THREE.BoxGeometry(0.065, 0.08, 0.065), goldMat, 'PickaxeHeadMount', new THREE.Vector3(0, 0.62, 0));
    addPart(new THREE.BoxGeometry(0.06, 0.065, 0.12), diamondMat, 'PickaxeCenterHead', new THREE.Vector3(0, 0.64, 0));
    addPart(new THREE.BoxGeometry(0.055, 0.06, 0.1), diamondMat, 'PickaxeFrontStep', new THREE.Vector3(0, 0.60, 0.1));
    addPart(new THREE.BoxGeometry(0.05, 0.055, 0.1), diamondMat, 'PickaxeFrontTip', new THREE.Vector3(0, 0.53, 0.18));
    addPart(new THREE.BoxGeometry(0.055, 0.06, 0.1), diamondMat, 'PickaxeBackStep', new THREE.Vector3(0, 0.60, -0.1));
    addPart(new THREE.BoxGeometry(0.05, 0.055, 0.1), diamondMat, 'PickaxeBackTip', new THREE.Vector3(0, 0.53, -0.18));
    return pickaxe;
  }
}

function shortestAngle(angle: number): number {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
}

export default PlayerCharacter;
