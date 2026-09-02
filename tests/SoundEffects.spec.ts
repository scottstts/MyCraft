import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CAMERA_AUDIO_SAMPLE_HEIGHT,
  CAMERA_AUDIO_SUBMERSION_THRESHOLD,
  getInverseSquareSoundAttenuation,
  OCEAN_AUDIO_MAX_DISTANCE,
  OCEAN_AUDIO_REFERENCE_DISTANCE,
  getCameraWaterSubmersion,
  SoundEffects,
} from '../src/engine/audio/SoundEffects';

describe('camera underwater audio threshold', () => {
  const surfaceY = 10;

  it('uses the camera waterline as the 50% switch point', () => {
    expect(getCameraWaterSubmersion(surfaceY + CAMERA_AUDIO_SAMPLE_HEIGHT, surfaceY)).toBe(0);
    expect(getCameraWaterSubmersion(surfaceY, surfaceY)).toBeCloseTo(CAMERA_AUDIO_SUBMERSION_THRESHOLD);
    expect(getCameraWaterSubmersion(surfaceY - CAMERA_AUDIO_SAMPLE_HEIGHT, surfaceY)).toBe(1);
  });

  it('clamps the camera envelope outside the water range', () => {
    expect(getCameraWaterSubmersion(surfaceY + 100, surfaceY)).toBe(0);
    expect(getCameraWaterSubmersion(surfaceY - 100, surfaceY)).toBe(1);
  });

  it('uses inverse-square intensity with a finite zero-gain boundary', () => {
    expect(getInverseSquareSoundAttenuation(0)).toBe(1);
    expect(getInverseSquareSoundAttenuation(OCEAN_AUDIO_REFERENCE_DISTANCE)).toBe(1);
    expect(getInverseSquareSoundAttenuation(OCEAN_AUDIO_REFERENCE_DISTANCE * 2)).toBeCloseTo(0.25);
    expect(getInverseSquareSoundAttenuation(OCEAN_AUDIO_MAX_DISTANCE)).toBe(0);
    expect(getInverseSquareSoundAttenuation(OCEAN_AUDIO_MAX_DISTANCE + 1)).toBe(0);
  });
});

describe('water-step events', () => {
  it('plays on both water transitions even without waiting for a cadence step', () => {
    const originalAudio = (globalThis as unknown as { Audio?: unknown }).Audio;
    const sources: string[] = [];
    const audioInstances: FakeAudio[] = [];

    class FakeAudio {
      paused = true;
      ended = false;
      loop = false;
      volume = 1;
      preload = 'auto';
      onended: (() => void) | null = null;

      constructor(public readonly src: string) {
        sources.push(src);
        audioInstances.push(this);
      }

      play(): Promise<void> {
        this.paused = false;
        return Promise.resolve();
      }

      pause(): void {
        this.paused = true;
      }
    }

    (globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;
    try {
      let inWater = false;
      let moving = true;
      const position = new THREE.Vector3(0, 43, 0);
      const world = {
        getBlock: () => inWater ? 5 : 0,
      } as never;
      const player = {
        getEyePosition: () => position,
        getEyeHeight: () => 1.8,
        getWidth: () => 0.6,
        getHeight: () => 1.8,
        isGrounded: () => true,
      } as never;
      const input = {
        getMoveInput: () => moving ? ({ x: 1, z: 0 }) : ({ x: 0, z: 0 }),
      } as never;
      const camera = new THREE.PerspectiveCamera();
      camera.position.y = 100;
      const effects = new SoundEffects(world, input, player, camera);

      effects.update(1 / 60, false, true);
      inWater = true;
      position.x = 0.2;
      effects.update(1 / 60, false, true);
      const firstWaterStep = audioInstances.find((audio) => audio.src.includes('water_step'));
      expect(firstWaterStep).toBeDefined();
      // A still-active clip owns the stream; cadence must not overlap it.
      position.x = 0.4;
      effects.update(1 / 60, false, true);
      expect(sources.filter((source) => source.includes('water_step'))).toHaveLength(1);
      // Stopping the trigger prevents chaining, but does not interrupt the
      // clip that is already audible.
      moving = false;
      effects.update(1 / 60, false, true);
      expect(firstWaterStep?.paused).toBe(false);
      // Only an ended clip may be replaced by the next transition.
      firstWaterStep?.onended?.();
      inWater = false;
      position.x = 0.4;
      effects.update(1 / 60, false, true);

      expect(sources.filter((source) => source.includes('water_step'))).toHaveLength(2);
      effects.dispose();
    } finally {
      if (originalAudio === undefined) delete (globalThis as unknown as { Audio?: unknown }).Audio;
      else (globalThis as unknown as { Audio: unknown }).Audio = originalAudio;
    }
  });
});
