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
  WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS,
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

describe('water-step trigger', () => {
  it('serializes surface actions, finishes the current gulp on inactivity, and does not false-retrigger from dy', () => {
    const originalAudio = (globalThis as unknown as { Audio?: unknown }).Audio;
    const sources: string[] = [];
    const audioInstances: FakeAudio[] = [];

    class FakeAudio {
      paused = true;
      ended = false;
      loop = false;
      volume = 1;
      preload = 'auto';
      currentTime = 0;
      onended: (() => void) | null = null;
      ontimeupdate: (() => void) | null = null;

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

    const waterSteps = () => audioInstances.filter((audio) => audio.src.includes('water_step'));
    const waterStepCount = () => waterSteps().length;
    const tickAudioAt = (audio: FakeAudio, time: number) => {
      audio.currentTime = time;
      audio.ontimeupdate?.();
    };

    (globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;
    try {
      let inWater = false;
      let moving = false;
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
        isUnderwater: () => false,
      } as never;
      const input = {
        getMoveInput: () => moving ? ({ x: 1, z: 0 }) : ({ x: 0, z: 0 }),
      } as never;
      const camera = new THREE.PerspectiveCamera();
      camera.position.y = 100;
      const effects = new SoundEffects(world, input, player, camera);

      // Merely standing in surface water must stay silent.
      effects.update(1 / 60, false, true);
      inWater = true;
      effects.update(1 / 60, false, true);
      expect(waterStepCount()).toBe(0);

      // Intentional walking while touching the surface starts exactly one clip.
      moving = true;
      position.x = 0.2;
      effects.update(1 / 60, false, true);
      expect(waterStepCount()).toBe(1);
      const firstWaterStep = waterSteps()[0]!;

      position.x = 0.4;
      effects.update(1 / 60, false, true);
      expect(waterStepCount()).toBe(1);
      expect(firstWaterStep.paused).toBe(false);

      // Inactivity during gulp 1 snapshots 1.28 s as the stop point.
      tickAudioAt(firstWaterStep, 0.9);
      moving = false;
      effects.update(1 / 60, false, true);
      tickAudioAt(firstWaterStep, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[0] - 0.001);
      expect(firstWaterStep.paused).toBe(false);
      tickAudioAt(firstWaterStep, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[0]);
      expect(firstWaterStep.paused).toBe(true);

      // Start again. Inactivity after 1.28 s must finish gulp 2 at 2.73 s,
      // not fall back to the old hard-coded 1.28 s gate.
      moving = true;
      effects.update(1 / 60, false, true);
      expect(waterStepCount()).toBe(2);
      const secondWaterStep = waterSteps()[1]!;
      tickAudioAt(secondWaterStep, 1.8);
      moving = false;
      effects.update(1 / 60, false, true);
      tickAudioAt(secondWaterStep, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[1] - 0.001);
      expect(secondWaterStep.paused).toBe(false);
      tickAudioAt(secondWaterStep, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[1]);
      expect(secondWaterStep.paused).toBe(true);

      // Same rule for gulp 3 and gulp 4 boundaries.
      for (const [startTime, stopAt] of [
        [3.2, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[2]],
        [4.5, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[3]],
      ] as const) {
        moving = true;
        effects.update(1 / 60, false, true);
        const loopWaterSteps = waterSteps();
        const audio = loopWaterSteps[loopWaterSteps.length - 1]!;
        tickAudioAt(audio, startTime);
        moving = false;
        effects.update(1 / 60, false, true);
        tickAudioAt(audio, stopAt - 0.001);
        expect(audio.paused).toBe(false);
        tickAudioAt(audio, stopAt);
        expect(audio.paused).toBe(true);
      }

      // If inactivity begins after the final authored boundary, do not cut the
      // tail at 5.25 s. The next legal stop is the file's natural end.
      moving = true;
      effects.update(1 / 60, false, true);
      const finalGulpSteps = waterSteps();
      const finalGulpWaterStep = finalGulpSteps[finalGulpSteps.length - 1]!;
      tickAudioAt(finalGulpWaterStep, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[3] + 0.1);
      moving = false;
      effects.update(1 / 60, false, true);
      tickAudioAt(finalGulpWaterStep, 6.5);
      expect(finalGulpWaterStep.paused).toBe(false);
      const countBeforeNaturalEnd = waterStepCount();
      finalGulpWaterStep.ended = true;
      finalGulpWaterStep.onended?.();
      expect(waterStepCount()).toBe(countBeforeNaturalEnd);

      // Reactivating before a snapshotted boundary keeps ownership of the same
      // clip and cancels the pending stop; it must never restart from time zero.
      moving = true;
      effects.update(1 / 60, false, true);
      const reactivationSteps = waterSteps();
      const reactivatedWaterStep = reactivationSteps[reactivationSteps.length - 1]!;
      tickAudioAt(reactivatedWaterStep, 1.9);
      moving = false;
      effects.update(1 / 60, false, true); // arms 2.73 s
      expect(reactivatedWaterStep.paused).toBe(false);
      const countBeforeReactivation = waterStepCount();
      moving = true;
      effects.update(1 / 60, false, true);
      expect(waterStepCount()).toBe(countBeforeReactivation);
      tickAudioAt(reactivatedWaterStep, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[1] + 0.1);
      expect(reactivatedWaterStep.paused).toBe(false);

      // Continuous valid action still chains naturally at the real file end.
      const countBeforeChain = waterStepCount();
      reactivatedWaterStep.ended = true;
      reactivatedWaterStep.onended?.();
      expect(waterStepCount()).toBe(countBeforeChain + 1);
      const chainedSteps = waterSteps();
      const chainedWaterStep = chainedSteps[chainedSteps.length - 1]!;

      // Regression: vertical frame-to-frame motion while still touching water
      // must not act as an independent trigger. Once movement input stops, dy
      // corrections cannot start a new water-step clip/tail.
      tickAudioAt(chainedWaterStep, 0.7);
      moving = false;
      position.y = 43.15;
      effects.update(1 / 60, false, true);
      const countAfterInactivity = waterStepCount();
      position.y = 43.30;
      effects.update(1 / 60, false, true);
      position.y = 43.20;
      effects.update(1 / 60, false, true);
      expect(waterStepCount()).toBe(countAfterInactivity);
      tickAudioAt(chainedWaterStep, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[0]);
      expect(chainedWaterStep.paused).toBe(true);

      // A discrete takeoff from the water surface is still a valid action even
      // without walking input, but it should create only one serialized clip.
      position.y = 43;
      effects.update(1 / 60, false, true); // restore surface-contact baseline
      const countBeforeJump = waterStepCount();
      position.y = 45.2;
      effects.update(1 / 60, false, true);
      expect(waterStepCount()).toBe(countBeforeJump + 1);
      const jumpSteps = waterSteps();
      const jumpWaterStep = jumpSteps[jumpSteps.length - 1]!;
      effects.update(1 / 60, false, true); // event is one frame only -> inactivity
      expect(waterStepCount()).toBe(countBeforeJump + 1);
      tickAudioAt(jumpWaterStep, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[0]);
      expect(jumpWaterStep.paused).toBe(true);

      // Falling back into the surface is another discrete contact action.
      const countBeforeLanding = waterStepCount();
      position.y = 43;
      effects.update(1 / 60, false, true);
      expect(waterStepCount()).toBe(countBeforeLanding + 1);
      const landingSteps = waterSteps();
      const landingWaterStep = landingSteps[landingSteps.length - 1]!;
      effects.update(1 / 60, false, true);
      tickAudioAt(landingWaterStep, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[0]);
      expect(landingWaterStep.paused).toBe(true);

      effects.dispose();
    } finally {
      if (originalAudio === undefined) delete (globalThis as unknown as { Audio?: unknown }).Audio;
      else (globalThis as unknown as { Audio: unknown }).Audio = originalAudio;
    }
  });
});
