import type * as THREE from 'three'
import { WATER_LEVEL } from '../world/TerrainGenerator'
import { getBlockIdByName } from '../world/blocks/BlockRegistry'
import type { World } from '../world/World'
import type { InputSystem } from '../systems/Input'
import type { PlayerController } from '../systems/PlayerController'

import footstepUrl from '../../assets/sounds/sound_effects/footstep.mp3'
import waterStepUrl from '../../assets/sounds/sound_effects/water_step.mp3'
import underwaterUrl from '../../assets/sounds/sound_effects/underwater.mp3'
import blockUrl from '../../assets/sounds/sound_effects/block.mp3'
import oceanUrl from '../../assets/sounds/sound_effects/ocean.mp3'

export const CAMERA_AUDIO_SUBMERSION_THRESHOLD = 0.5
export const CAMERA_AUDIO_SAMPLE_HEIGHT = 0.4
export const OCEAN_AUDIO_REFERENCE_DISTANCE = 12
export const OCEAN_AUDIO_MAX_DISTANCE = 96
export const WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS = [1.28, 2.73, 4.07, 5.25] as const
// Kept for compatibility with callers/tests that reference the old first-cutoff constant.
export const WATER_STEP_INACTIVITY_CUTOFF_SECONDS = WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[0]

/**
 * Treat a small vertical camera envelope as the audio listener volume. At the
 * 50% threshold, the waterline passes through the envelope midpoint, so the
 * switch happens at the active camera's water surface rather than at the
 * player's physics head position.
 */
export function getCameraWaterSubmersion(
  cameraY: number,
  surfaceY: number = WATER_LEVEL + 1.0,
): number {
  const upperEdge = surfaceY + CAMERA_AUDIO_SAMPLE_HEIGHT / 2
  return Math.max(
    0,
    Math.min(1, (upperEdge - cameraY) / CAMERA_AUDIO_SAMPLE_HEIGHT),
  )
}

/**
 * Convert the shortest sampled distance to an ocean shore into an audio gain.
 * Sound intensity follows the inverse-square law, so a reference distance of
 * 12 blocks is full-strength and the intensity falls as (r / d)^2. Real-world
 * propagation never reaches mathematical zero, but a game needs a finite
 * audibility boundary; the last quarter of the configured range is therefore
 * a smooth cutoff that reaches exactly zero at the boundary.
 */
export function getInverseSquareSoundAttenuation(
  distance: number,
  referenceDistance: number = OCEAN_AUDIO_REFERENCE_DISTANCE,
  maxDistance: number = OCEAN_AUDIO_MAX_DISTANCE,
): number {
  if (!Number.isFinite(distance) || !Number.isFinite(referenceDistance) || !Number.isFinite(maxDistance)) return 0
  const reference = Math.max(0.001, referenceDistance)
  const maximum = Math.max(reference, maxDistance)
  if (distance >= maximum) return 0
  const effectiveDistance = Math.max(0, distance)
  const intensity = Math.min(1, (reference / Math.max(reference, effectiveDistance)) ** 2)
  const fadeStart = maximum * 0.75
  const fadeT = Math.max(0, Math.min(1, (distance - fadeStart) / Math.max(0.001, maximum - fadeStart)))
  const cutoff = 1 - fadeT * fadeT
  return Math.max(0, Math.min(1, intensity * cutoff))
}

function makeLoopingAudio(src: string, volume: number): HTMLAudioElement {
  const a = new Audio(src)
  a.loop = true
  a.volume = volume
  a.preload = 'auto'
  return a
}

// One-shot looper: chains short clips back-to-back while desired=true.
// When desired=false, it does NOT pause the current clip; it lets it finish.
class OneShotLooper {
  private src: string
  private desired: boolean = false
  private current: HTMLAudioElement | null = null
  private vol: number = 1

  constructor(src: string, volume: number) {
    this.src = src
    this.vol = volume
  }

  setVolume(v: number) {
    this.vol = Math.max(0, Math.min(1, v))
    if (this.current) this.current.volume = this.vol
  }

  setDesired(play: boolean) {
    const was = this.desired
    this.desired = play
    if (play && !was) this.ensurePlaying()
  }

  private ensurePlaying() {
    if (!this.desired) return
    // If a clip is currently playing, do nothing; onended will chain next
    if (this.current && !this.current.paused && !this.current.ended) return
    const a = new Audio(this.src)
    a.preload = 'auto'
    a.loop = false
    a.volume = this.vol
    a.onended = () => {
      this.current = null
      if (this.desired) this.ensurePlaying()
    }
    this.current = a
    void a.play().catch(() => { /* ignore */ })
  }

  // Opportunistic tick to start playback if needed (safe to call every frame)
  tick() {
    if (this.desired) this.ensurePlaying()
  }

  // For cleanup only: immediately stop any current playback
  stopImmediate() {
    this.desired = false
    if (this.current) {
      try { this.current.pause() } catch { /* Ignore pause errors */ }
      this.current = null
    }
  }
}

export class SoundEffects {
  private world: World
  private input: InputSystem
  private player: PlayerController
  private camera: THREE.PerspectiveCamera

  private lastX: number
  private lastY: number
  private lastZ: number
  private lastGrounded: boolean = false
  private lastTouchingWaterSurface: boolean = false

  private sfxVolume: number = 0.7

  private footLoop = new OneShotLooper(footstepUrl, this.sfxVolume)
  private underLoop = makeLoopingAudio(underwaterUrl, this.sfxVolume * 0.8)
  private oceanLoop = makeLoopingAudio(oceanUrl, this.sfxVolume * 0.6)

  private waterStepClip: HTMLAudioElement | null = null
  private waterStepTriggerActive = false
  private waterStepCutoffTimer: ReturnType<typeof setTimeout> | null = null
  private waterStepCutoffTargetSeconds: number | null = null

  // Ocean proximity sampling (to control ocean volume by distance to sea)
  private oceanSampleTimer = 0
  private oceanProximity = 0 // 0..1 (1=loudest at shore/open sea)
  private oceanVolCurrent = 0 // smoothed volume
  private readonly waterId: number = getBlockIdByName('water') ?? 5

  constructor(world: World, input: InputSystem, player: PlayerController, camera: THREE.PerspectiveCamera) {
    this.world = world
    this.input = input
    this.player = player
    this.camera = camera
    const position = player.getEyePosition()
    this.lastX = position.x
    this.lastY = position.y
    this.lastZ = position.z
  }

  setVolume(v: number) {
    const vol = Math.max(0, Math.min(1, v))
    this.sfxVolume = vol
    this.footLoop.setVolume(vol)
    if (this.waterStepClip) this.waterStepClip.volume = vol
    this.underLoop.volume = Math.max(0, Math.min(1, vol * 0.8))
    // Base ocean loudness scales with SFX volume; proximity is applied per-frame
    this.oceanLoop.volume = Math.max(0, Math.min(1, vol * 0.6))
  }

  getVolume(): number { return this.sfxVolume }

  private primedOnce = false
  tryUnlockOnUserGesture() {
    if (this.primedOnce) return
    this.primedOnce = true
    // Attempt brief play/pause to satisfy autoplay rules without disturbing active loops
    const attemptSrc = (src: string) => {
      try {
        const a = new Audio(src)
        a.preload = 'auto'
        a.muted = true
        a.play().then(() => {
          a.pause(); a.currentTime = 0; a.muted = false
        }).catch(() => { /* ignore */ })
      } catch { /* ignore */ }
    }
    attemptSrc(footstepUrl)
    attemptSrc(waterStepUrl)
    // Prime underwater and ocean using temporary elements so we don't reset live loops
    attemptSrc(underwaterUrl)
    attemptSrc(oceanUrl)
  }

  private setLoopPlaying(a: HTMLAudioElement, shouldPlay: boolean) {
    if (shouldPlay) {
      if (a.paused) void a.play().catch(() => {})
    } else {
      if (!a.paused) a.pause()
    }
  }

  private playOneShot(src: string, volume: number) {
    try {
      const a = new Audio(src)
      a.volume = Math.max(0, Math.min(1, volume))
      a.play().catch(() => {})
    } catch {
      // ignore
    }
  }

  /**
   * Water steps are a serialized one-shot stream. While the trigger remains
   * active, repeated updates leave the current sample alone and the ended
   * callback starts the next sample. When the trigger becomes inactive, finish
   * the gulp that is currently in progress, then stop at its authored boundary.
   * If inactivity begins after the final authored boundary, let the clip reach
   * its natural end.
   */
  private startWaterStepIfIdle(): void {
    const current = this.waterStepClip
    if (current && !current.paused && !current.ended) return

    try {
      const audio = new Audio(waterStepUrl)
      audio.preload = 'auto'
      audio.loop = false
      audio.volume = this.sfxVolume
      audio.ontimeupdate = () => this.stopWaterStepAtInactivityBoundary(audio)
      audio.onended = () => {
        if (this.waterStepClip !== audio) return
        this.clearWaterStepCutoffTimer()
        this.waterStepCutoffTargetSeconds = null
        this.waterStepClip = null
        if (this.waterStepTriggerActive) this.startWaterStepIfIdle()
      }
      this.waterStepClip = audio
      void audio.play().catch(() => {
        if (this.waterStepClip === audio) {
          this.clearWaterStepCutoffTimer()
          this.waterStepCutoffTargetSeconds = null
          this.waterStepClip = null
        }
      })
    } catch {
      // Ignore unavailable audio devices and autoplay failures.
    }
  }

  private setWaterStepTriggerActive(active: boolean): void {
    const wasActive = this.waterStepTriggerActive
    this.waterStepTriggerActive = active

    if (active) {
      // Reactivation during a gulp's inactivity grace period resumes ownership
      // of the same clip. Never restart/reset a clip that is already playing.
      this.clearWaterStepCutoffTimer()
      this.waterStepCutoffTargetSeconds = null
      if (!wasActive || !this.waterStepClip) this.startWaterStepIfIdle()
      return
    }

    // Snapshot the next authored gulp boundary only on the active -> inactive
    // edge. Repeated inactive frames must not advance the target to a later gulp.
    if (wasActive) this.armWaterStepInactivityBoundary()
  }

  private armWaterStepInactivityBoundary(): void {
    this.clearWaterStepCutoffTimer()
    const audio = this.waterStepClip
    if (!audio) {
      this.waterStepCutoffTargetSeconds = null
      return
    }

    this.waterStepCutoffTargetSeconds = null
    for (const stopPoint of WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS) {
      if (audio.currentTime <= stopPoint) {
        this.waterStepCutoffTargetSeconds = stopPoint
        break
      }
    }

    // Past 5.25 s, the next valid stopping point is the file's natural end.
    if (this.waterStepCutoffTargetSeconds === null) return
    this.stopWaterStepAtInactivityBoundary(audio)
  }

  private stopWaterStepAtInactivityBoundary(audio = this.waterStepClip): void {
    if (!audio || this.waterStepTriggerActive) return
    if (this.waterStepClip !== audio) return

    const stopAt = this.waterStepCutoffTargetSeconds
    if (stopAt === null) return

    if (audio.currentTime >= stopAt) {
      this.stopWaterStepImmediately()
      return
    }

    if (this.waterStepCutoffTimer !== null) return
    const remainingMs = Math.max(1, (stopAt - audio.currentTime) * 1000)
    this.waterStepCutoffTimer = setTimeout(() => {
      this.waterStepCutoffTimer = null
      this.stopWaterStepAtInactivityBoundary(audio)
    }, remainingMs)
  }

  private clearWaterStepCutoffTimer(): void {
    if (this.waterStepCutoffTimer === null) return
    clearTimeout(this.waterStepCutoffTimer)
    this.waterStepCutoffTimer = null
  }

  private stopWaterStepImmediately(): void {
    const current = this.waterStepClip
    this.clearWaterStepCutoffTimer()
    this.waterStepCutoffTargetSeconds = null
    this.waterStepClip = null
    if (!current) return
    current.onended = null
    current.ontimeupdate = null
    try {
      current.pause()
    } catch { /* Ignore stop errors */ }
  }

  // Public one-shots for interactions (both use the same block sound)
  playBreak(): void { this.playOneShot(blockUrl, this.sfxVolume) }
  playPlace(): void { this.playOneShot(blockUrl, this.sfxVolume) }

  update(dtSeconds: number, paused: boolean, inGame: boolean) {
    if (paused || !inGame) {
      // Stop requesting new footstep clips; let the current clip finish.
      this.footLoop.setDesired(false)
      // Underwater is allowed to terminate immediately
      this.setLoopPlaying(this.underLoop, false)
      // Ocean follows same pause logic as BG music: pause when game paused/not in game
      this.setLoopPlaying(this.oceanLoop, false)
      // Update previous markers but do not trigger landing while paused
      const position = this.player.getEyePosition()
      this.lastX = position.x
      this.lastY = position.y
      this.lastZ = position.z
      this.lastGrounded = this.player.isGrounded()
      this.lastTouchingWaterSurface = this.isTouchingWaterSurface()
      this.setWaterStepTriggerActive(false)
      return
    }

    // Movement magnitude on XZ
    const position = this.player.getEyePosition()
    const dx = position.x - this.lastX
    const dz = position.z - this.lastZ
    const dy = position.y - this.lastY
    const speedXZ = dtSeconds > 0 ? Math.hypot(dx, dz) / dtSeconds : 0

    const grounded = this.player.isGrounded()

    // Keep surface contact separate from the authoritative swim state. A
    // player can pass below the one-block surface layer while still being in
    // the same water body; combining both avoids a false "exit" splash.
    const touchingWaterSurface = this.isTouchingWaterSurface()
    const playerUnderWater = this.player.isUnderwater?.() ?? false
    const touchingWater = touchingWaterSurface || playerUnderWater

    // The audio listener is the active gameplay camera. This intentionally
    // differs from the player's physics swim state so third-person audio
    // follows the orbit camera as well as first-person camera movement.
    const isUnderWater = this.isCameraUnderwater()

    // Footstep loop when grounded and moving on solid, not touching water and not underwater
    const inputVec = this.input.getMoveInput?.() || { x: 0, z: 0 }
    const inputMoving = Math.hypot(inputVec.x, inputVec.z) > 0.05
    const movingOnGround = grounded && (speedXZ > 0.2 || inputMoving)

    // Sustained water-step audio is owned only by intentional movement input
    // while the character actually intersects the surface. Vertical movement is
    // deliberately NOT treated as a continuous action: frame-to-frame dy can
    // contain landing/collision corrections that otherwise create false
    // inactive -> active retriggers and start a fresh clip tail.
    //
    // Jumps are represented as one-frame surface-contact events instead:
    // - leaving the surface while moving upward = jump/takeoff from water
    // - entering the surface while moving downward = landing/jump into water
    const jumpedOffWaterSurface =
      this.lastTouchingWaterSurface && !touchingWaterSurface && dy > 0.02
    const landedOnWaterSurface =
      !this.lastTouchingWaterSurface && touchingWaterSurface && dy < -0.02
    const verticalWaterContactAction = jumpedOffWaterSurface || landedOnWaterSurface

    const sustainedWaterStepAction = touchingWaterSurface && inputMoving
    const waterStepActionActive =
      !playerUnderWater && (sustainedWaterStepAction || verticalWaterContactAction)
    this.setWaterStepTriggerActive(waterStepActionActive)

    // Precedence: underwater > water step > footstep. The water-step trigger
    // is evaluated before this branch so deactivation can arm the next gulp boundary.
    if (isUnderWater) {
      // Start underwater loop immediately; stop requesting new footstep clips.
      this.setLoopPlaying(this.underLoop, true)
      this.footLoop.setDesired(false)
    } else if (waterStepActionActive) {
      this.setLoopPlaying(this.underLoop, false)
      this.footLoop.setDesired(false)
    } else if (movingOnGround) {
      this.setLoopPlaying(this.underLoop, false)
      this.footLoop.setDesired(true)
    } else {
      this.setLoopPlaying(this.underLoop, false)
      this.footLoop.setDesired(false)
    }

    // Allow the footstep looper to start the next clip if needed.
    this.footLoop.tick()

    // Continuous ocean ambience: always present while in-game and not paused.
    // Volume scales with proximity to water at surface level, and dims underwater.
    this.setLoopPlaying(this.oceanLoop, true)
    this.updateOceanVolume(dtSeconds, isUnderWater)

    // Landing one-shot: transition false->true with downward motion
    if (!this.lastGrounded && grounded && dy < -0.02 && !isUnderWater && !touchingWater) {
      this.playOneShot(footstepUrl, this.sfxVolume)
    }

    this.lastX = position.x
    this.lastY = position.y
    this.lastZ = position.z
    this.lastGrounded = grounded
    this.lastTouchingWaterSurface = touchingWaterSurface
  }

  // Compute and set ocean loop volume based on proximity to sea
  private updateOceanVolume(dtSeconds: number, isUnderWater: boolean) {
    // Resample proximity at a modest rate to reduce CPU
    this.oceanSampleTimer -= dtSeconds
    if (this.oceanSampleTimer <= 0) {
      this.oceanSampleTimer = 0.25 // seconds
      this.oceanProximity = this.sampleOceanProximity()
    }

    // Target base volume from SFX volume and proximity
    const base = Math.max(0, Math.min(1, this.sfxVolume * 0.6))
    let target = base * this.oceanProximity
    // Dim when underwater so the dedicated underwater loop dominates
    if (isUnderWater) target *= 0.35

    // Smooth for stability (simple critically-damped low-pass)
    const smooth = 1 - Math.pow(0.001, dtSeconds) // ~fast attack, smooth decay
    if (target <= 0) this.oceanVolCurrent = 0
    else this.oceanVolCurrent += (target - this.oceanVolCurrent) * smooth
    this.oceanLoop.volume = Math.max(0, Math.min(1, this.oceanVolCurrent))
  }

  // Ray-sample around the player to estimate distance to ocean surface
  private sampleOceanProximity(): number {
    const position = this.player.getEyePosition()
    const px = position.x
    const pz = position.z

    // Cast rays in multiple directions, stepping outward until we find WATER at surface level
    // and verify it corresponds to the surrounding ocean (not an inland lake)
    const maxDistance = OCEAN_AUDIO_MAX_DISTANCE
    const step = 1.0
    const directions = 36
    const oceanCheckRange = 48 // additional distance after first hit that should remain mostly water
    const oceanCheckStep = 1.0
    const oceanContinuityThreshold = 0.7 // fraction of samples that must be water to count as ocean

    let minOceanHit = maxDistance

    for (let i = 0; i < directions; i++) {
      const ang = (i / directions) * Math.PI * 2
      const dirx = Math.cos(ang)
      const dirz = Math.sin(ang)
      // First, find the nearest surface water along this ray
      let firstWaterDist: number | null = null
      for (let d = step; d <= maxDistance; d += step) {
        const x = Math.floor(px + dirx * d)
        const z = Math.floor(pz + dirz * d)
        const id = this.world.getBlock(x, WATER_LEVEL, z)
        if (id === this.waterId) { firstWaterDist = d; break }
      }
      if (firstWaterDist === null) continue

      // Now, verify continuity of water beyond that point to distinguish open ocean from small lakes
      let samples = 0
      let waterSamples = 0
      for (let d = firstWaterDist; d <= Math.min(firstWaterDist + oceanCheckRange, maxDistance); d += oceanCheckStep) {
        const x = Math.floor(px + dirx * d)
        const z = Math.floor(pz + dirz * d)
        const id = this.world.getBlock(x, WATER_LEVEL, z)
        samples++
        if (id === this.waterId) waterSamples++
      }
      const frac = samples > 0 ? (waterSamples / samples) : 0
      const isOcean = frac >= oceanContinuityThreshold
      if (isOcean && firstWaterDist < minOceanHit) minOceanHit = firstWaterDist
    }

    if (!Number.isFinite(minOceanHit)) return 0
    return getInverseSquareSoundAttenuation(minOceanHit)
  }

  private isTouchingWaterSurface(): boolean {
    // Player AABB
    const eyeHeight = this.player.getEyeHeight()
    const halfWidth = this.player.getWidth() / 2
    const position = this.player.getEyePosition()
    const baseY = position.y - eyeHeight
    const minX = position.x - halfWidth
    const maxX = position.x + halfWidth
    const minZ = position.z - halfWidth
    const maxZ = position.z + halfWidth
    const minY = baseY
    const maxY = baseY + this.player.getHeight()

    // Y-slab intersection with water surface layer [WATER_LEVEL, WATER_LEVEL+1)
    if (maxY <= WATER_LEVEL || minY >= WATER_LEVEL + 1) return false

    const ix0 = Math.floor(minX)
    const ix1 = Math.floor(maxX)
    const iz0 = Math.floor(minZ)
    const iz1 = Math.floor(maxZ)

    for (let z = iz0; z <= iz1; z++) {
      for (let x = ix0; x <= ix1; x++) {
        const id = this.world.getBlock(x, WATER_LEVEL, z)
        if (id === this.waterId) return true
      }
    }
    return false
  }

  private isCameraUnderwater(): boolean {
    return getCameraWaterSubmersion(this.camera.position.y) >= CAMERA_AUDIO_SUBMERSION_THRESHOLD
  }

  dispose() {
    // Stop and release references
    try { this.footLoop.stopImmediate() } catch { /* Ignore stop errors */ }
    this.stopWaterStepImmediately()
    try { this.underLoop.pause() } catch { /* Ignore pause errors */ }
    try { this.oceanLoop.pause() } catch { /* Ignore pause errors */ }
  }
}
