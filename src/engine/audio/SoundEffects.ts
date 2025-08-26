import type * as THREE from 'three'
import { PLAYER } from '../../config/constants'
import { WATER_LEVEL } from '../world/TerrainGenerator'
import type { World } from '../world/World'
import type { InputSystem } from '../systems/Input'
import type { PlayerController } from '../systems/PlayerController'

import footstepUrl from '../../assets/sounds/sound_effects/footstep.mp3'
import waterStepUrl from '../../assets/sounds/sound_effects/water_step.mp3'
import underwaterUrl from '../../assets/sounds/sound_effects/underwater.mp3'
import blockUrl from '../../assets/sounds/sound_effects/block.mp3'

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
      try { this.current.pause() } catch {}
      this.current = null
    }
  }
}

export class SoundEffects {
  private world: World
  private camera: THREE.PerspectiveCamera
  private input: InputSystem
  private player: PlayerController

  private lastX: number
  private lastY: number
  private lastZ: number
  private lastGrounded: boolean = false

  private sfxVolume: number = 0.7

  private footLoop = new OneShotLooper(footstepUrl, this.sfxVolume)
  private waterLoop = new OneShotLooper(waterStepUrl, this.sfxVolume)
  private underLoop = makeLoopingAudio(underwaterUrl, this.sfxVolume * 0.8)

  constructor(world: World, camera: THREE.PerspectiveCamera, input: InputSystem, player: PlayerController) {
    this.world = world
    this.camera = camera
    this.input = input
    this.player = player
    this.lastX = camera.position.x
    this.lastY = camera.position.y
    this.lastZ = camera.position.z
  }

  setVolume(v: number) {
    const vol = Math.max(0, Math.min(1, v))
    this.sfxVolume = vol
    this.footLoop.setVolume(vol)
    this.waterLoop.setVolume(vol)
    this.underLoop.volume = Math.max(0, Math.min(1, vol * 0.8))
  }

  getVolume(): number { return this.sfxVolume }

  tryUnlockOnUserGesture() {
    // Attempt brief play/pause to satisfy autoplay rules
    const attemptSrc = (src: string) => {
      const a = new Audio(src)
      a.muted = true
      a.play().then(() => {
        a.pause(); a.currentTime = 0; a.muted = false
      }).catch(() => { /* ignore */ })
    }
    attemptSrc(footstepUrl)
    attemptSrc(waterStepUrl)
    // Underwater loop can use the element
    const u = this.underLoop
    u.muted = true
    u.play().then(() => { u.pause(); u.currentTime = 0; u.muted = false }).catch(() => { /* ignore */ })
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

  // Public one-shots for interactions (both use the same block sound)
  playBreak(): void { this.playOneShot(blockUrl, this.sfxVolume) }
  playPlace(): void { this.playOneShot(blockUrl, this.sfxVolume) }

  update(dtSeconds: number, paused: boolean, inGame: boolean) {
    if (paused || !inGame) {
      // Stop requesting new foot/water clips; let last ones finish.
      this.footLoop.setDesired(false)
      this.waterLoop.setDesired(false)
      // Underwater is allowed to terminate immediately
      this.setLoopPlaying(this.underLoop, false)
      // Update previous markers but do not trigger landing while paused
      this.lastX = this.camera.position.x
      this.lastY = this.camera.position.y
      this.lastZ = this.camera.position.z
      this.lastGrounded = this.player.isGrounded()
      return
    }

    // Movement magnitude on XZ
    const dx = this.camera.position.x - this.lastX
    const dz = this.camera.position.z - this.lastZ
    const dy = this.camera.position.y - this.lastY
    const speedXZ = dtSeconds > 0 ? Math.hypot(dx, dz) / dtSeconds : 0

    const grounded = this.player.isGrounded()

    // Determine if touching water surface blocks
    const touchingWater = this.isTouchingWaterSurface()

    // Determine underwater state: camera below water surface plane
    const isUnderWater = (this.camera.position.y < WATER_LEVEL)

    // Footstep loop when grounded and moving on solid, not touching water and not underwater
    const inputVec = this.input.getMoveInput?.() || { x: 0, z: 0 }
    const inputMoving = Math.hypot(inputVec.x, inputVec.z) > 0.05
    const movingOnGround = grounded && (speedXZ > 0.2 || inputMoving)

    // Precedence: underwater > water step > footstep
    if (isUnderWater) {
      // Start underwater loop immediately; stop requesting new foot/water clips (let last ones finish)
      this.setLoopPlaying(this.underLoop, true)
      this.waterLoop.setDesired(false)
      this.footLoop.setDesired(false)
    } else if (touchingWater && (speedXZ > 0.1 || inputMoving)) {
      this.setLoopPlaying(this.underLoop, false)
      this.waterLoop.setDesired(true)
      this.footLoop.setDesired(false)
    } else if (movingOnGround) {
      this.setLoopPlaying(this.underLoop, false)
      this.waterLoop.setDesired(false)
      this.footLoop.setDesired(true)
    } else {
      this.setLoopPlaying(this.underLoop, false)
      this.waterLoop.setDesired(false)
      this.footLoop.setDesired(false)
    }

    // Allow one-shot loopers to start the next clip if needed
    this.footLoop.tick()
    this.waterLoop.tick()

    // Landing one-shot: transition false->true with downward motion
    if (!this.lastGrounded && grounded && dy < -0.02 && !isUnderWater && !touchingWater) {
      this.playOneShot(footstepUrl, this.sfxVolume)
    }

    this.lastX = this.camera.position.x
    this.lastY = this.camera.position.y
    this.lastZ = this.camera.position.z
    this.lastGrounded = grounded
  }

  private isTouchingWaterSurface(): boolean {
    // Player AABB
    const eyeHeight = Math.min(PLAYER.height * 0.9, PLAYER.height - 0.1)
    const halfWidth = PLAYER.width / 2
    const baseY = this.camera.position.y - eyeHeight
    const minX = this.camera.position.x - halfWidth
    const maxX = this.camera.position.x + halfWidth
    const minZ = this.camera.position.z - halfWidth
    const maxZ = this.camera.position.z + halfWidth
    const minY = baseY
    const maxY = baseY + PLAYER.height

    // Y-slab intersection with water surface layer [WATER_LEVEL, WATER_LEVEL+1)
    if (maxY <= WATER_LEVEL || minY >= WATER_LEVEL + 1) return false

    const ix0 = Math.floor(minX)
    const ix1 = Math.floor(maxX)
    const iz0 = Math.floor(minZ)
    const iz1 = Math.floor(maxZ)

    // Water block id is 5 in default registry; but check by name if needed
    const WATER_ID = 5
    for (let z = iz0; z <= iz1; z++) {
      for (let x = ix0; x <= ix1; x++) {
        const id = this.world.getBlock(x, WATER_LEVEL, z)
        if (id === WATER_ID) return true
      }
    }
    return false
  }

  dispose() {
    // Stop and release references
    try { this.footLoop.stopImmediate() } catch {}
    try { this.waterLoop.stopImmediate() } catch {}
    try { this.underLoop.pause() } catch {}
  }
}
