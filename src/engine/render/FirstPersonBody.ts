/**
 * Module: engine/render/FirstPersonBody
 * Purpose: Lightweight in-world first-person body rig (right arm, legs, torso) with procedural animation.
 * Public API:
 *  - init(playerRoot, camera)
 *  - update(dt)
 *  - onPrimaryClick() / onSecondaryClick()
 *  - onMovementInputStart(keys) / onMovementInputEnd(keys)
 *  - dispose()
 *
 * Notes:
 *  - Renders inside the main scene; no physics; fully occludable by world geometry.
 *  - Camera is treated as the eyes; Neck is synced to camera pose (no head mesh). 
 *  - Swings are NOT queued; a click only triggers a swing if idle.
 *    Rapid clicks do not speed up or queue animations or audio. When clicks stop,
 *    the current swing finishes returning to idle and then stops.
 */

import * as THREE from 'three'
import { SWING_CYCLE_SECONDS } from '../../config/constants'

import armTexUrl from '../../assets/textures/arm.png'
import legTexUrl from '../../assets/textures/leg.png'
import torsoTexUrl from '../../assets/textures/torso.png'
import swingSfxUrl from '../../assets/sounds/sound_effects/swing.mp3'

// Keep numeric constants local to this module for tuning.
// These are deliberately simple and Minecraft-like in proportion.
const CFG = {
  // Proportions
  torso: { width: 0.32, depth: 0.22, height: 0.70 }, // narrower to avoid blocking view
  spineLen: 0.52, // pelvis -> chest
  neckLen: 0.12,  // chest -> neck
  shoulderOffsetX: 0.26, // right shoulder lateral from spine
  shoulderOffsetZ: -0.10, // slight back so arm sits to the side
  torsoBackOffset: 0.24, // push torso behind camera so it's not visible at neutral angles
  arm: {
    upperLen: 0.36,  // shorter upper arm
    lowerLen: 0.34,  // shorter lower arm  
    handLen: 0.14,   // shorter hand
    thickness: 0.08, // much thinner
  },
  leg: {
    thighLen: 0.48,
    shinLen: 0.48,
    footLen: 0.20, // forward extent purely visual; foot height is small
    thickness: 0.18,
    footHeight: 0.08,
    hipOffsetX: 0.10,
  },
  // Camera positioning relative to neck to avoid self-occlusion
  cameraForwardOffset: 0.02, // push neck slightly behind camera forward to minimize near-plane clipping
  cameraUpOffset: -0.02,
  // Animation tuning
  locomotion: {
    freqWalk: 2.4, // Hz at moderate speed
    freqRun: 3.6,  // Hz at sprint
    ampThigh: THREE.MathUtils.degToRad(26),
    ampShin: THREE.MathUtils.degToRad(22),
    ampFoot: THREE.MathUtils.degToRad(10),
    torsoYaw: THREE.MathUtils.degToRad(6),
    torsoRoll: THREE.MathUtils.degToRad(4),
    torsoBob: 0.02,
    startStopDamping: 12.0, // lerp rate to engage/disengage locomotion
  },
  idle: {
    // Base raised pose like Minecraft
    baseShoulderPitch: THREE.MathUtils.degToRad(-65), // forward/upward at 15 degrees (reduced by 20)
    baseShoulderYaw: THREE.MathUtils.degToRad(-25),   // tilt inward toward center by 25 degrees
    baseShoulderRoll: THREE.MathUtils.degToRad(12),   // tilt up to the right
    forearmLag: THREE.MathUtils.degToRad(8),
    bobSpeed: 1.8,
  },
  swing: {
    // Fractions of the shared cycle for down and return
    duration: SWING_CYCLE_SECONDS * 0.55, // seconds for down/forward strike
    returnDuration: SWING_CYCLE_SECONDS * 0.45, // return to idle
    amplitudePitch: THREE.MathUtils.degToRad(78),
    amplitudeYawAlt: THREE.MathUtils.degToRad(10), // additional yaw for RMB vs LMB
    easeIn: 3.0,  // cubic-ish
    easeOut: 3.0,
  },
  legVisibilityPitchDeg: 35, // legs visible when looking down beyond this pitch
  // Optional obstacle damping
  obstacleProbe: {
    enabled: true,
    distance: 0.8,
    minDistance: 0.25,
    dampingAtMin: 0.25,
  },
} as const

type SwingKind = 'LMB' | 'RMB'

export class FirstPersonBody {
  private playerRoot: THREE.Object3D | null = null
  private camera: THREE.PerspectiveCamera | null = null

  // Rig nodes
  private root: THREE.Group
  private pelvis: THREE.Group
  private spine: THREE.Group
  private chest: THREE.Group
  private neck: THREE.Group
  // Right arm (single segment)
  private armAnchor: THREE.Group
  private rArm: THREE.Group
  // Left arm (single segment)
  private lArmAnchor: THREE.Group
  private lArm: THREE.Group
  // Legs (single segments)
  private lLeg: THREE.Group
  private rLeg: THREE.Group
  // Torso mesh
  private torsoMesh: THREE.Mesh

  // Materials and textures (use lit PBR for natural shading)
  private armMat: THREE.MeshStandardMaterial
  private legMat: THREE.MeshStandardMaterial
  private torsoMat: THREE.MeshStandardMaterial

  // Animation state
  private locomotionBlend: number = 0 // 0..1 engage factor
  private locomotionPhase: number = 0
  // Estimated XZ speed (used only for idle scale); not stored
  private movingFlag: boolean = false
  private lastCamX = 0
  // Only need XZ for speed; Y retained for completeness not required
  private lastCamZ = 0
  // Arm idle jiggle
  private idleTime = 0

  // Swing state (no queueing)
  private swingActive: boolean = false
  private swingTime: number = 0
  private swingReturning: boolean = false
  private swingKind: SwingKind = 'LMB'
  private swingAudio: HTMLAudioElement | null = null

  // Scratch objects (avoid per-frame allocs)
  private _v3a = new THREE.Vector3()

  constructor() {
    // Load textures and materials
    const mkTex = (url: string) => {
      const tex = new THREE.TextureLoader().load(url)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      tex.wrapS = THREE.ClampToEdgeWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      return tex
    }
    const armTex = mkTex(armTexUrl)
    const legTex = mkTex(legTexUrl)
    const torsoTex = mkTex(torsoTexUrl)

    // Use MeshStandardMaterial for proper scene lighting and environment
    const mkBodyMat = (map: THREE.Texture) => new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      alphaTest: 0.5,     // cut out fully transparent texels cleanly
      roughness: 0.9,     // matte, fabric-like
      metalness: 0.0,     // non-metal
      envMapIntensity: 0.25, // subtle ambient from scene.environment
      dithering: true,    // reduce banding on smooth gradients
    })
    this.armMat = mkBodyMat(armTex)
    this.legMat = mkBodyMat(legTex)
    this.torsoMat = mkBodyMat(torsoTex)

    // Build hierarchy
    this.root = new THREE.Group()
    this.root.name = 'FPBody.Root'
    this.pelvis = new THREE.Group(); this.pelvis.name = 'Pelvis'
    this.spine = new THREE.Group(); this.spine.name = 'Spine'
    this.chest = new THREE.Group(); this.chest.name = 'Chest'
    this.neck = new THREE.Group(); this.neck.name = 'Neck'

    // Right arm chain
    this.armAnchor = new THREE.Group(); this.armAnchor.name = 'ArmAnchor'
    this.rArm = new THREE.Group(); this.rArm.name = 'RArm'
    // Left arm chain
    this.lArmAnchor = new THREE.Group(); this.lArmAnchor.name = 'LArmAnchor'
    this.lArm = new THREE.Group(); this.lArm.name = 'LArm'

    // Legs
    this.lLeg = new THREE.Group(); this.lLeg.name = 'LLeg'
    this.rLeg = new THREE.Group(); this.rLeg.name = 'RLeg'

    // Assemble hierarchy
    this.root.add(this.pelvis)
    this.pelvis.add(this.spine)
    this.spine.position.y = CFG.spineLen
    this.spine.add(this.chest)
    this.chest.position.y = 0 // chest pivot at top of torso height; torso mesh will be centered later
    this.chest.add(this.neck)
    this.neck.position.y = CFG.neckLen

    // Torso mesh attached to chest (covers spine->chest segment)
    this.torsoMesh = this.createBoxMesh(CFG.torso.width, CFG.torso.height, CFG.torso.depth, this.torsoMat)
    this.torsoMesh.name = 'TorsoMesh'
    // Center torso around chest/spine area: top near neck, bottom near pelvis
    this.torsoMesh.position.set(0, -CFG.torso.height * 0.5, 0)
    this.chest.add(this.torsoMesh)

    // Right arm: shoulder attaches to chest at actual shoulder point (no camera sync)
    this.chest.add(this.armAnchor)
    // Position anchor at right shoulder of torso (adjustable)
    this.armAnchor.position.set(CFG.shoulderOffsetX + 0.2, -0.4, 0.4)
    this.armAnchor.add(this.rArm)
    // Build arm body (upper+lower) + separate shorter hand tip
    const armBodyLen = CFG.arm.upperLen + CFG.arm.lowerLen
    const rArmBodyMesh = this.createSegmentMesh(CFG.arm.thickness, armBodyLen, CFG.arm.thickness, this.armMat)
    rArmBodyMesh.position.set(0, armBodyLen, 0)
    rArmBodyMesh.rotation.z = Math.PI
    this.rArm.add(rArmBodyMesh)
    
    // Shorter hand tip mesh
    const shortHandLen = CFG.arm.handLen * 0.4  // Make hand 60% shorter
    const rHandMesh = this.createSegmentMesh(CFG.arm.thickness * 0.9, shortHandLen, CFG.arm.thickness * 0.9, this.armMat)
    rHandMesh.position.set(0, armBodyLen + shortHandLen, 0)
    rHandMesh.rotation.z = Math.PI
    this.rArm.add(rHandMesh)
    
    // Left arm: mirror of right arm at left shoulder, idle straight down, swings during locomotion
    this.chest.add(this.lArmAnchor)
    // Place left arm at mirrored shoulder location relative to right arm
    this.lArmAnchor.position.set(-(CFG.shoulderOffsetX + 0.2), 0.2, 0.2)
    this.lArmAnchor.add(this.lArm)
    const lArmBodyMesh = this.createSegmentMesh(CFG.arm.thickness, armBodyLen, CFG.arm.thickness, this.armMat)
    lArmBodyMesh.position.set(0, armBodyLen, 0)
    lArmBodyMesh.rotation.z = Math.PI
    this.lArm.add(lArmBodyMesh)
    const lHandMesh = this.createSegmentMesh(CFG.arm.thickness * 0.9, shortHandLen, CFG.arm.thickness * 0.9, this.armMat)
    lHandMesh.position.set(0, armBodyLen + shortHandLen, 0)
    lHandMesh.rotation.z = Math.PI
    this.lArm.add(lHandMesh)

    // Legs: single segment each, attach to pelvis with lateral offsets
    this.pelvis.add(this.lLeg)
    this.pelvis.add(this.rLeg)
    this.lLeg.position.set(-CFG.leg.hipOffsetX, 0, 0)
    this.rLeg.position.set(CFG.leg.hipOffsetX, 0, 0)
    const legLen = CFG.leg.thighLen + CFG.leg.shinLen
    const lLegMesh = this.createSegmentMesh(CFG.leg.thickness, legLen, CFG.leg.thickness, this.legMat)
    lLegMesh.position.set(0, -legLen * 0.5, 0)
    this.lLeg.add(lLegMesh)
    const rLegMesh = this.createSegmentMesh(CFG.leg.thickness, legLen, CFG.leg.thickness, this.legMat)
    rLegMesh.position.set(0, -legLen * 0.5, 0)
    this.rLeg.add(rLegMesh)
  }

  /** Initialize and attach to player root; neck synced to camera each frame. */
  init(playerRoot: THREE.Object3D, camera: THREE.PerspectiveCamera): void {
    this.playerRoot = playerRoot
    this.camera = camera
    this.playerRoot.add(this.root)
    // Cache initial camera position for speed estimation
    this.lastCamX = camera.position.x
    this.lastCamZ = camera.position.z
  }

  /** Update procedural animation and sync transforms. */
  update(dt: number): void {
    if (!this.camera || !this.playerRoot) return

    // Determine locomotion speed (XZ) from camera displacement (needs cam reference)
    const cam = this.camera
    const dx = cam.position.x - this.lastCamX
    const dz = cam.position.z - this.lastCamZ
    const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0
    // Blend factor rises when moving, falls when stopped
    const targetBlend = this.movingFlag && speed > 0.05 ? 1 : 0
    const k = 1 - Math.pow(0.001, dt * CFG.locomotion.startStopDamping)
    this.locomotionBlend += (targetBlend - this.locomotionBlend) * k
    // Advance locomotion phase scaled by speed between walk/run
    const freq = THREE.MathUtils.lerp(CFG.locomotion.freqWalk, CFG.locomotion.freqRun, Math.min(1, speed / 5))
    this.locomotionPhase += dt * freq * Math.PI * 2 * this.locomotionBlend

    // Torso counter-motion (yaw/roll) and bob
    const legPhase = this.locomotionPhase
    const torsoYaw = Math.sin(legPhase) * CFG.locomotion.torsoYaw * this.locomotionBlend
    const torsoRoll = Math.sin(legPhase * 2) * CFG.locomotion.torsoRoll * this.locomotionBlend
    const torsoBob = (Math.sin(legPhase * 2) * 0.5 + 0.5) * CFG.locomotion.torsoBob * this.locomotionBlend

    // Sync player root to camera yaw and hips position.
    // Hips are below camera by (spine + neck + current bob), so the root sits at hips level.
    // Keep the rig centered on player's capsule origin (XZ follows camera).
    const yaw = cam.rotation.y
    this.root.rotation.set(0, 0, 0)
    this.playerRoot.position.set(cam.position.x, cam.position.y - (CFG.spineLen + CFG.neckLen + torsoBob), cam.position.z)
    this.playerRoot.rotation.set(0, yaw, 0)

    // Neck: follow pitch; small forward/up offsets to reduce near-plane clipping
    const pitch = cam.rotation.x
    this.neck.position.y = CFG.neckLen
    this.neck.rotation.set(pitch, 0, 0)
    // Move whole body (pelvis+legs+torso) back toward camera so body isn't ahead of head
    this.pelvis.position.set(0, 0, CFG.torsoBackOffset)
    // Keep chest centered on pelvis; torso box is already narrow
    this.chest.position.set(0, 0, 0)

    // After root sync, apply torsion and bob to spine/chest
    this.spine.position.y = CFG.spineLen + torsoBob
    this.chest.rotation.set(0, torsoYaw, torsoRoll)

    // Legs: gait cycle (opposed) using single-segment legs
    this.applyLegs(legPhase, this.locomotionBlend)

    // Right arm idle motion
    this.idleTime += dt
    const idle = this.computeArmIdle(speed)

    // Swing overlay: advance and apply additive to right arm
    this.updateSwing(dt)

    // Combine idle + swing overlay for right arm (single segment)
    const swingRot = this.getCurrentSwingRot()
    this.rArm.rotation.set(
      idle.shoulderPitch + swingRot.pitch,
      idle.shoulderYaw + swingRot.yaw,
      idle.shoulderRoll
    )

    // Left arm locomotion swing: idle straight down; swing when moving; subtle bob jitter
    {
      const moveScale = THREE.MathUtils.clamp(this.locomotionBlend * (0.5 + 0.1 * speed), 0, 1)
      const bob = Math.sin(this.idleTime * CFG.idle.bobSpeed * (1 + 0.5 * moveScale))
      const swingAmp = THREE.MathUtils.degToRad(22) * this.locomotionBlend
      // Oppose left leg for natural gait (arms/legs counter-phase)
      const swing = Math.sin(legPhase) * swingAmp
      const swayYaw = -Math.sin(legPhase) * THREE.MathUtils.degToRad(3) * this.locomotionBlend
      const jitterPitch = bob * 0.035 * this.locomotionBlend
      const jitterRoll = bob * 0.025 * this.locomotionBlend
      const baseYaw = THREE.MathUtils.degToRad(35) * this.locomotionBlend // slight inward when moving; none when idle
      this.lArm.rotation.set(
        -(THREE.MathUtils.degToRad(165) + swing + jitterPitch), // Point straight down when idle
        (baseYaw + swayYaw),       // Opposite-day yaw
        -(0 + jitterRoll)          // Opposite-day roll
      )
    }

    // Leg visibility based on pitch
    const pitchDeg = THREE.MathUtils.radToDeg(pitch)
    const showLegs = pitchDeg <= -CFG.legVisibilityPitchDeg || (this.movingFlag && this.locomotionBlend > 0.4)
    this.setLegsVisible(showLegs)

    // Update cached camera position
    this.lastCamX = cam.position.x
    this.lastCamZ = cam.position.z
    // No audio queue to drive; audio plays only at swing start
  }

  /** Try to start a primary-click swing (if idle) */
  onPrimaryClick(): void { this.tryStartSwing('LMB') }
  /** Try to start a secondary-click swing (if idle) */
  onSecondaryClick(): void { this.tryStartSwing('RMB') }

  /** Query: is the swing currently active (down or returning)? */
  isSwingActive(): boolean { return this.swingActive }

  /** Movement input edge notifications; optional since update() derives motion from camera speed. */
  onMovementInputStart(): void { this.movingFlag = true }
  onMovementInputEnd(): void { this.movingFlag = false }

  /** Cleanup */
  dispose(): void {
    // Stop any playing swing audio
    try { this.swingAudio?.pause() } catch { /* ignore */ }
    this.swingAudio = null
    // Remove rig from root
    try { this.playerRoot?.remove(this.root) } catch { /* ignore */ }
  }

  // --- Internals ---

  private createBoxMesh(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d)
    // UVs are default per-face; textures are upright; nearest sampling keeps pixel crisp.
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = false
    mesh.receiveShadow = false
    return mesh
  }

  private createSegmentMesh(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
    // Segment pivot at the TOP; mesh geometry centered, we will offset mesh under its group parent.
    const mesh = this.createBoxMesh(w, h, d, mat)
    return mesh
  }

  private applyLegs(phase: number, blend: number): void {
    // Single segment legs: rotate at hip only, oppose phase
    const legA = Math.sin(phase) * CFG.locomotion.ampThigh * blend
    const legB = Math.sin(phase + Math.PI) * CFG.locomotion.ampThigh * blend
    this.lLeg.rotation.set(legA, 0, 0)
    this.rLeg.rotation.set(legB, 0, 0)
  }

  private computeArmIdle(speed: number): { shoulderPitch: number; shoulderYaw: number; shoulderRoll: number; forearmPitch: number } {
    // Base raised pose (constant relative to camera) with subtle bob
    const t = this.idleTime
    const moveScale = THREE.MathUtils.clamp(this.locomotionBlend * (0.5 + 0.1 * speed), 0, 1)
    const bob = Math.sin(t * CFG.idle.bobSpeed * (1 + 0.5 * moveScale))
    const shoulderPitch = CFG.idle.baseShoulderPitch + bob * 0.06
    const shoulderYaw = CFG.idle.baseShoulderYaw + bob * 0.02
    const shoulderRoll = CFG.idle.baseShoulderRoll + bob * 0.03
    // Forearm lags slightly behind shoulder pitch
    const forearmPitch = shoulderPitch * 0.35 - 0.04
    return { shoulderPitch, shoulderYaw, shoulderRoll, forearmPitch }
  }

  private tryStartSwing(kind: SwingKind): void {
    // Do not queue; only start if currently idle
    if (this.swingActive) return
    this.swingKind = kind
    this.swingActive = true
    this.swingReturning = false
    this.swingTime = 0
    // Play one swing sound, no queue/overlap
    try {
      if (!this.swingAudio) {
        this.swingAudio = new Audio(swingSfxUrl)
        this.swingAudio.loop = false
        this.swingAudio.preload = 'auto'
      }
      // Restart sound from start for each swing
      try { this.swingAudio.pause() } catch { /* ignore */ }
      try { this.swingAudio.currentTime = 0 } catch { /* ignore */ }
      void this.swingAudio.play().catch(() => { /* ignore autoplay errors */ })
    } catch { /* ignore */ }
  }

  private updateSwing(dt: number): void {
    if (!this.swingActive) return

    const dur = this.swingReturning ? CFG.swing.returnDuration : CFG.swing.duration
    this.swingTime += dt
    if (this.swingTime >= dur) {
      if (!this.swingReturning) {
        // Start return
        this.swingReturning = true
        this.swingTime = 0
      } else {
        // Finish swing
        this.swingActive = false
        this.swingReturning = false
        this.swingTime = 0
      }
    }
  }

  private getCurrentSwingRot(): { pitch: number; yaw: number } {
    if (!this.swingActive) return { pitch: 0, yaw: 0 }
    const t = THREE.MathUtils.clamp(this.swingTime / (this.swingReturning ? CFG.swing.returnDuration : CFG.swing.duration), 0, 1)
    const easeIn = (x: number) => Math.pow(x, CFG.swing.easeIn)
    const easeOut = (x: number) => 1 - Math.pow(1 - x, CFG.swing.easeOut)
    // Downward strike amount from raised pose (negative pitch = downward)
    const downwardAmp = CFG.swing.amplitudePitch * 0.8
    // Optional obstacle damping
    const damp = this.estimateObstacleDamping()
    const a = -downwardAmp * damp  // Negative for downward motion
    if (!this.swingReturning) {
      const s = easeOut(t)
      return { pitch: a * s, yaw: (this.swingKind === 'RMB' ? CFG.swing.amplitudeYawAlt : 0) * s }
    } else {
      const s = easeIn(1 - t)
      return { pitch: a * s, yaw: (this.swingKind === 'RMB' ? CFG.swing.amplitudeYawAlt : 0) * s }
    }
  }

  private estimateObstacleDamping(): number {
    if (!CFG.obstacleProbe.enabled || !this.camera) return 1
    const cam = this.camera
    // Approximate using camera forward vector and world depth to nearest block via depth buffer is not available here.
    // Instead, use a simple parametric falloff with a fixed distance probe if desired.
    // Placeholder: If near plane distance is small, we simply keep full amplitude.
    // To implement precise damping, this could query a shared raycast. For now, apply gentle constant damping if pitch is down.
    const fwd = this._v3a
    cam.getWorldDirection(fwd)
    // Forward distance is unknown; return 1 (no damping). Keeping hook for future.
    return 1
  }

  private setLegsVisible(v: boolean): void {
    this.lLeg.visible = v;
    this.rLeg.visible = v;
  }
}

export default FirstPersonBody
