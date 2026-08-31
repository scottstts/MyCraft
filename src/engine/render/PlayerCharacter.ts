/**
 * Module: engine/render/PlayerCharacter
 * Purpose: The complete procedural player from ref/character.html, including
 * its authored textures, rig, animation mapping, view modes, and exact OBB
 * caster data used by the screen-space sun visibility pass.
 * Callers: Engine owns one instance and updates it after player physics.
 */

import * as THREE from 'three';
import { PLAYER, SWING_CYCLE_SECONDS } from '../../config/constants';
import type { InputSystem } from '../systems/Input';
import type { PlayerController, PlayerMovementState } from '../systems/PlayerController';
import { constrainCameraToSolidVoxels } from '../utils/cameraCollision';
import type { CharacterShadowBox } from './lighting/CharacterShadowBox';

import swingSfxUrl from '../../assets/sounds/sound_effects/swing.mp3';

const MAX_HEAD_TURN = THREE.MathUtils.degToRad(65);

const LEG_LENGTH = 0.75;
const LEG_PIVOT_Y = 0.65;
const HEAD_PIVOT_Y = 1.4;

/** Deterministic equivalent of the reference's pixel-texture generator. */
const TextureGen = {
  state: 0x4d594352,

  nextRandom(): number {
    // Mulberry32 keeps the authored pixel noise stable across reloads.
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },

  createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },

  createPixelTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  },

  addNoise(ctx: CanvasRenderingContext2D, width: number, height: number, factor = 0.08): void {
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (this.nextRandom() - 0.5) * factor * 255;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
    ctx.putImageData(image, 0, 0);
  },

  context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Player character textures require a 2D canvas context');
    return context;
  },

  createFaceTexture(): THREE.CanvasTexture {
    const canvas = this.createCanvas(16, 16);
    const ctx = this.context(canvas);
    ctx.fillStyle = '#d49b74';
    ctx.fillRect(0, 0, 16, 16);
    // Hair
    ctx.fillStyle = '#2b1d16';
    ctx.fillRect(0, 0, 16, 4);
    ctx.fillRect(0, 4, 2, 4);
    ctx.fillRect(14, 4, 2, 4);
    // Left eye
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(3, 6, 3, 2);
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(4, 6, 2, 2);
    // Glowing cyber lens
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(10, 5, 4, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(11, 6, 2, 2);
    // Nose and beard
    ctx.fillStyle = '#b57954';
    ctx.fillRect(7, 8, 2, 2);
    ctx.fillStyle = '#533624';
    ctx.fillRect(5, 11, 6, 1);
    ctx.fillRect(6, 12, 4, 2);
    this.addNoise(ctx, 16, 16, 0.04);
    return this.createPixelTexture(canvas);
  },

  createHairTexture(): THREE.CanvasTexture {
    const canvas = this.createCanvas(16, 16);
    const ctx = this.context(canvas);
    ctx.fillStyle = '#2b1d16';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#3a271e';
    ctx.fillRect(2, 2, 6, 6);
    ctx.fillRect(9, 8, 5, 5);
    this.addNoise(ctx, 16, 16, 0.06);
    return this.createPixelTexture(canvas);
  },

  createTorsoTexture(): THREE.CanvasTexture {
    const canvas = this.createCanvas(16, 24);
    const ctx = this.context(canvas);
    // Navy gambeson
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 16, 24);
    // Leather harness
    ctx.fillStyle = '#5c3a21';
    ctx.fillRect(0, 0, 16, 4);
    ctx.fillRect(2, 4, 3, 16);
    ctx.fillRect(11, 4, 3, 16);
    ctx.fillRect(0, 16, 16, 4);
    // Glowing medallion
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(6, 8, 4, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(7, 9, 2, 2);
    this.addNoise(ctx, 16, 24, 0.05);
    return this.createPixelTexture(canvas);
  },

  createArmTexture(): THREE.CanvasTexture {
    const canvas = this.createCanvas(8, 24);
    const ctx = this.context(canvas);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 8, 6);
    ctx.fillStyle = '#d49b74';
    ctx.fillRect(0, 6, 8, 6);
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, 12, 8, 8);
    ctx.fillStyle = '#1e1b18';
    ctx.fillRect(0, 20, 8, 4);
    this.addNoise(ctx, 8, 24, 0.05);
    return this.createPixelTexture(canvas);
  },

  createPantsTexture(): THREE.CanvasTexture {
    const canvas = this.createCanvas(8, 24);
    const ctx = this.context(canvas);
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, 8, 14);
    ctx.fillStyle = '#475569';
    ctx.fillRect(1, 6, 6, 4);
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(0, 14, 8, 10);
    this.addNoise(ctx, 8, 24, 0.06);
    return this.createPixelTexture(canvas);
  },
};

const CFG = {
  torso: { width: 0.5, depth: 0.25, height: 0.75 },
  arm: { width: 0.25, depth: 0.25, length: 0.75 },
  leg: { width: 0.25, depth: 0.25, length: LEG_LENGTH, pivotY: LEG_PIVOT_Y },
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

export class PlayerCharacter {
  private playerRoot: THREE.Object3D | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private input: InputSystem | null = null;
  private controller: PlayerController | null = null;

  // Reference rig nodes.
  private readonly character = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly eyeAnchor = new THREE.Object3D();
  private readonly torsoMesh: THREE.Mesh;
  private readonly hairBand: THREE.Mesh;
  private readonly headMesh: THREE.Mesh;
  private readonly backpack: THREE.Mesh;
  private readonly leftArm: THREE.Group;
  private readonly leftArmMesh: THREE.Mesh;
  private readonly rightArm: THREE.Group;
  private readonly rightArmMesh: THREE.Mesh;
  private readonly leftLeg: THREE.Group;
  private readonly rightLeg: THREE.Group;
  private readonly pickaxe: THREE.Group;

  private readonly ownedTextures: THREE.Texture[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly materialRecords: PlayerMaterialRecord[] = [];
  private readonly shadowMeshes: THREE.Mesh[] = [];
  private readonly shadowBoxes: CharacterShadowBox[] = [];

  private isFirstPerson = false;
  private bodyYaw = PLAYER.initialYaw;
  private forcedFacingYaw = PLAYER.initialYaw;
  private forcedFacingTime = 0;
  private walkTimer = 0;
  private swimTimer = 0;
  private elapsedTime = 0;
  private swingActive = false;
  private swingTime = 0;
  private swingAudio: HTMLAudioElement | null = null;

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

  constructor() {
    const hairMat = this.createTexturedMaterial(TextureGen.createHairTexture());
    const faceMat = this.createTexturedMaterial(TextureGen.createFaceTexture());
    const torsoMat = this.createTexturedMaterial(TextureGen.createTorsoTexture());
    const armMat = this.createTexturedMaterial(TextureGen.createArmTexture());
    const pantsMat = this.createTexturedMaterial(TextureGen.createPantsTexture());
    const leatherMat = this.createMaterial({ color: 0x3e2723, roughness: 0.8 });
    const armorMat = this.createMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.4 });
    // The pauldron intentionally wraps the arm, but its outer shell must own
    // the overlapping depth samples or the arm/armor boundary will shimmer.
    armorMat.polygonOffset = true;
    armorMat.polygonOffsetFactor = -1;
    armorMat.polygonOffsetUnits = -1;

    this.character.name = 'PlayerCharacter.Root';
    this.body.name = 'PlayerCharacter.Body';
    this.body.rotation.y = Math.PI;

    this.headMesh = this.createMesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      [hairMat, hairMat, hairMat, hairMat, faceMat, hairMat],
      'HeadMesh',
    );
    this.headMesh.position.y = 0.25;
    this.headPivot.name = 'HeadPivot';
    this.headPivot.position.set(0, HEAD_PIVOT_Y, 0);
    this.headPivot.add(this.headMesh);

    this.hairBand = this.createMesh(
      new THREE.BoxGeometry(0.53, 0.15, 0.53),
      leatherMat,
      'HairBand',
    );
    this.hairBand.position.y = 0.35;
    this.headPivot.add(this.hairBand);

    // The eye is exactly the physical reference anchor: just beyond the
    // authored +Z face, which becomes gameplay -Z after the body correction.
    this.eyeAnchor.name = 'EyeAnchor';
    // The visual root is lifted to align the leg bottoms with the physics
    // base. Counter-offset the eye anchor so first-person camera height stays
    // exactly at the controller's physical eye position.
    this.eyeAnchor.position.set(
      0,
      PLAYER.eyeHeight - CFG.visualFeetLift - HEAD_PIVOT_Y,
      0.26,
    );
    this.headPivot.add(this.eyeAnchor);

    this.torsoMesh = this.createMesh(
      new THREE.BoxGeometry(CFG.torso.width, CFG.torso.height, CFG.torso.depth),
      torsoMat,
      'TorsoMesh',
    );
    this.torsoMesh.position.set(0, 1.025, 0);

    this.backpack = this.createMesh(
      new THREE.BoxGeometry(0.38, 0.45, 0.15),
      leatherMat,
      'Backpack',
    );
    this.backpack.position.set(0, 1.05, -0.19);

    this.leftArmMesh = this.createMesh(
      new THREE.BoxGeometry(CFG.arm.width, CFG.arm.length, CFG.arm.depth),
      armMat,
      'LeftArmMesh',
    );
    this.leftArmMesh.position.y = -0.275;
    const leftPauldron = this.createMesh(
      new THREE.BoxGeometry(0.29, 0.2, 0.29),
      armorMat,
      'LeftPauldron',
    );
    leftPauldron.position.set(-0.02, 0.02, 0);
    this.leftArmMesh.add(leftPauldron);
    this.leftArm = new THREE.Group();
    this.leftArm.name = 'LeftArmPivot';
    // These lateral positions intentionally match ref/character.html; the
    // body's single 180° correction preserves anatomical left/right sides.
    this.leftArm.position.set(0.375, 1.35, 0);
    this.leftArm.add(this.leftArmMesh);

    this.rightArmMesh = this.createMesh(
      new THREE.BoxGeometry(CFG.arm.width, CFG.arm.length, CFG.arm.depth),
      armMat,
      'RightArmMesh',
    );
    this.rightArmMesh.position.y = -0.275;
    this.pickaxe = this.createPickaxe();
    this.pickaxe.position.set(0, -0.28, 0.1);
    this.pickaxe.rotation.x = THREE.MathUtils.degToRad(30);
    this.rightArmMesh.add(this.pickaxe);
    this.rightArm = new THREE.Group();
    this.rightArm.name = 'RightArmPivot';
    this.rightArm.position.set(-0.375, 1.35, 0);
    this.rightArm.add(this.rightArmMesh);

    this.leftLeg = new THREE.Group();
    this.leftLeg.name = 'LeftLegPivot';
    this.leftLeg.position.set(0.13, CFG.leg.pivotY, 0);
    this.leftLeg.add(this.createMesh(
      new THREE.BoxGeometry(CFG.leg.width, CFG.leg.length, CFG.leg.depth),
      pantsMat,
      'LeftLegMesh',
    ));
    const leftLegMesh = this.leftLeg.children[0] as THREE.Mesh;
    leftLegMesh.position.y = -CFG.leg.length / 2;

    this.rightLeg = new THREE.Group();
    this.rightLeg.name = 'RightLegPivot';
    this.rightLeg.position.set(-0.13, CFG.leg.pivotY, 0);
    this.rightLeg.add(this.createMesh(
      new THREE.BoxGeometry(CFG.leg.width, CFG.leg.length, CFG.leg.depth),
      pantsMat,
      'RightLegMesh',
    ));
    const rightLegMesh = this.rightLeg.children[0] as THREE.Mesh;
    rightLegMesh.position.y = -CFG.leg.length / 2;

    this.body.add(
      this.headPivot,
      this.torsoMesh,
      this.backpack,
      this.leftArm,
      this.rightArm,
      this.leftLeg,
      this.rightLeg,
    );
    this.character.add(this.body);

    this.character.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox;
      if (!bounds) return;
      this.shadowMeshes.push(object);
      this.shadowBoxes.push({
        inverseMatrix: new THREE.Matrix4(),
        center: bounds.getCenter(new THREE.Vector3()),
        halfSize: bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5),
      });
    });

    this.setFirstPerson(false);
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

  setFirstPerson(value: boolean): void {
    this.isFirstPerson = value;
    this.input?.setMovementYawOffset?.(value ? 0 : Math.PI);
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
    if (updateCamera) this.updateCamera(dt, snapCamera);
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
    const geometries = new Set<THREE.BufferGeometry>();
    this.character.traverse((object) => {
      if (object instanceof THREE.Mesh) geometries.add(object.geometry);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    for (const texture of this.ownedTextures) texture.dispose();
    this.shadowMeshes.length = 0;
    this.shadowBoxes.length = 0;
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
      camera.position.copy(this.scratchPosition);
      this.scratchDirection.set(
        -Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      ).normalize();
      camera.lookAt(camera.position.clone().add(this.scratchDirection));
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

  private createTexturedMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
    this.ownedTextures.push(texture);
    const material = this.createMaterial({ map: texture, roughness: 0.8 });
    // Reuse the authored albedo as an emissive map for the atmosphere floor;
    // the map is only an indirect-light fallback, not a second visible layer.
    material.emissiveMap = texture;
    material.needsUpdate = true;
    return material;
  }

  private createMaterial(options: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial(options);
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
