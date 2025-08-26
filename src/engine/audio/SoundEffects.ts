import type * as THREE from 'three'
import { PLAYER } from '../../config/constants'
import { WATER_LEVEL } from '../world/TerrainGenerator'
import type { World } from '../world/World'
import type { InputSystem } from '../systems/Input'
import type { PlayerController } from '../systems/PlayerController'

import footstepUrl from '../../assets/sounds/sound_effects/footstep.mp3'
import waterStepUrl from '../../assets/sounds/sound_effects/water_step.mp3'
import underwaterUrl from '../../assets/sounds/sound_effects/underwater.mp3'

function makeLoopingAudio(src: string, volume: number): HTMLAudioElement {
  const a = new Audio(src)
  a.loop = true
  a.volume = volume
  a.preload = 'auto'
  return a
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

  private footLoop = makeLoopingAudio(footstepUrl, this.sfxVolume)
  private waterLoop = makeLoopingAudio(waterStepUrl, this.sfxVolume)
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
    this.footLoop.volume = vol
    this.waterLoop.volume = vol
    this.underLoop.volume = Math.max(0, Math.min(1, vol * 0.8))
  }

  getVolume(): number { return this.sfxVolume }

  tryUnlockOnUserGesture() {
    // Attempt brief play/pause to satisfy autoplay rules
    const attempt = (a: HTMLAudioElement) => {
      a.muted = true
      a.play().then(() => {
        a.pause()
        a.currentTime = 0
        a.muted = false
      }).catch(() => { /* ignore */ })
    }
    attempt(this.footLoop)
    attempt(this.waterLoop)
    attempt(this.underLoop)
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

  update(dtSeconds: number, paused: boolean, inGame: boolean) {
    if (paused || !inGame) {
      // Pause all loops when game paused or not in control
      this.setLoopPlaying(this.footLoop, false)
      this.setLoopPlaying(this.waterLoop, false)
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
      this.setLoopPlaying(this.underLoop, true)
      this.setLoopPlaying(this.waterLoop, false)
      this.setLoopPlaying(this.footLoop, false)
    } else if (touchingWater && (speedXZ > 0.1 || inputMoving)) {
      this.setLoopPlaying(this.waterLoop, true)
      this.setLoopPlaying(this.underLoop, false)
      this.setLoopPlaying(this.footLoop, false)
    } else if (movingOnGround) {
      this.setLoopPlaying(this.footLoop, true)
      this.setLoopPlaying(this.waterLoop, false)
      this.setLoopPlaying(this.underLoop, false)
    } else {
      this.setLoopPlaying(this.footLoop, false)
      this.setLoopPlaying(this.waterLoop, false)
      this.setLoopPlaying(this.underLoop, false)
    }

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
    try { this.footLoop.pause() } catch {}
    try { this.waterLoop.pause() } catch {}
    try { this.underLoop.pause() } catch {}
  }
}

