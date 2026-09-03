import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CAMERA_AUDIO_SAMPLE_HEIGHT,
  CAMERA_AUDIO_SUBMERSION_THRESHOLD,
  getInverseSquareSoundAttenuation,
  OCEAN_AUDIO_MAX_DISTANCE,
  OCEAN_AUDIO_REFERENCE_DISTANCE,
  getCameraWaterSubmersion,
  isCameraMoreThanHalfSubmerged,
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

  it('does not enable underwater audio at exactly 50% submersion', () => {
    expect(isCameraMoreThanHalfSubmerged(surfaceY, surfaceY)).toBe(false);
    expect(isCameraMoreThanHalfSubmerged(surfaceY - 0.001, surfaceY)).toBe(true);
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
  it('uses Web Audio clock scheduling for gulp boundaries and does not false-retrigger from dy', async () => {
    const globals = globalThis as unknown as {
      Audio?: unknown;
      AudioContext?: unknown;
      fetch?: unknown;
    };
    const originalAudio = globals.Audio;
    const originalAudioContext = globals.AudioContext;
    const originalFetch = globals.fetch;

    const htmlAudioSources: string[] = [];
    class FakeAudio {
      paused = true;
      loop = false;
      volume = 1;
      preload = 'auto';
      muted = false;

      constructor(public readonly src: string) {
        htmlAudioSources.push(src);
      }

      play(): Promise<void> {
        this.paused = false;
        return Promise.resolve();
      }

      pause(): void {
        this.paused = true;
      }
    }

    class FakeAudioParam {
      value = 1;
      readonly events: Array<{ type: string; value?: number; time: number }> = [];

      cancelScheduledValues(time: number): void {
        this.events.push({ type: 'cancel', time });
      }

      setValueAtTime(value: number, time: number): void {
        this.value = value;
        this.events.push({ type: 'set', value, time });
      }

      linearRampToValueAtTime(value: number, time: number): void {
        this.value = value;
        this.events.push({ type: 'ramp', value, time });
      }
    }

    class FakeGainNode {
      gain = new FakeAudioParam();
      connect(): void {}
      disconnect(): void {}
    }

    class FakeBufferSourceNode {
      buffer: { duration: number } | null = null;
      onended: (() => void) | null = null;
      startedAt: number | null = null;
      readonly stopCalls: number[] = [];

      connect(): void {}
      disconnect(): void {}

      start(when = 0): void {
        this.startedAt = when;
      }

      stop(when = 0): void {
        this.stopCalls.push(when);
      }
    }

    const contexts: FakeAudioContext[] = [];
    class FakeAudioContext {
      currentTime = 0;
      state: AudioContextState = 'running';
      destination = {};
      readonly sources: FakeBufferSourceNode[] = [];
      readonly gains: FakeGainNode[] = [];

      constructor() {
        contexts.push(this);
      }

      createBufferSource(): FakeBufferSourceNode {
        const source = new FakeBufferSourceNode();
        this.sources.push(source);
        return source;
      }

      createGain(): FakeGainNode {
        const gain = new FakeGainNode();
        this.gains.push(gain);
        return gain;
      }

      decodeAudioData(): Promise<{ duration: number }> {
        return Promise.resolve({ duration: 7 });
      }

      resume(): Promise<void> {
        this.state = 'running';
        return Promise.resolve();
      }

      close(): Promise<void> {
        this.state = 'closed';
        return Promise.resolve();
      }
    }

    globals.Audio = FakeAudio;
    globals.AudioContext = FakeAudioContext;
    globals.fetch = (() => Promise.resolve({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    })) as unknown;

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

      effects.tryUnlockOnUserGesture();
      const context = contexts[0]!;
      expect(context).toBeDefined();

      const sourceCount = () => context.sources.length;
      const currentSource = () => context.sources[context.sources.length - 1]!;
      const waitForSourceCount = async (expected: number): Promise<void> => {
        // Buffer fetch/decode and the callback that starts the first source are
        // asynchronous. Do not couple the test to an arbitrary microtask count.
        for (let attempt = 0; attempt < 50; attempt++) {
          if (sourceCount() === expected) return;
          await Promise.resolve();
        }
        expect(sourceCount()).toBe(expected);
      };
      const setPlaybackOffset = (source: FakeBufferSourceNode, seconds: number) => {
        context.currentTime = source.startedAt! + seconds;
      };
      const endSource = (source: FakeBufferSourceNode) => source.onended?.();

      // Water-step must no longer use HTMLAudioElement at all.
      expect(htmlAudioSources.some((source) => source.includes('water_step'))).toBe(false);

      // Merely standing in surface water stays silent.
      effects.update(1 / 60, false, true);
      inWater = true;
      effects.update(1 / 60, false, true);
      expect(sourceCount()).toBe(0);

      // Walking starts one Web Audio source; repeated valid frames do not restart it.
      moving = true;
      position.x = 0.2;
      effects.update(1 / 60, false, true);
      await waitForSourceCount(1);
      const first = currentSource();
      position.x = 0.4;
      effects.update(1 / 60, false, true);
      expect(sourceCount()).toBe(1);

      // Inactivity during gulp 1 schedules an audio-clock stop exactly at 1.28 s.
      setPlaybackOffset(first, 0.9);
      moving = false;
      effects.update(1 / 60, false, true);
      expect(first.stopCalls.at(-1)).toBeCloseTo(first.startedAt! + WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[0]);

      // Repeated inactive frames must not move that stop to a later gulp.
      const stopCallCount = first.stopCalls.length;
      setPlaybackOffset(first, 1.1);
      effects.update(1 / 60, false, true);
      expect(first.stopCalls).toHaveLength(stopCallCount);

      // Simulate the scheduled stop completing. Inactive means no chaining.
      setPlaybackOffset(first, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[0]);
      endSource(first);
      expect(sourceCount()).toBe(1);

      // Inactivity after 1.28 s schedules 2.73, proving 1.28 is not a binary gate.
      moving = true;
      effects.update(1 / 60, false, true);
      expect(sourceCount()).toBe(2);
      const second = currentSource();
      setPlaybackOffset(second, 1.8);
      moving = false;
      effects.update(1 / 60, false, true);
      expect(second.stopCalls.at(-1)).toBeCloseTo(second.startedAt! + WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[1]);
      endSource(second);

      // Gulp 3 and 4 use their authored boundaries as well.
      for (const [offset, boundary] of [
        [3.2, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[2]],
        [4.5, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[3]],
      ] as const) {
        moving = true;
        effects.update(1 / 60, false, true);
        const source = currentSource();
        setPlaybackOffset(source, offset);
        moving = false;
        effects.update(1 / 60, false, true);
        expect(source.stopCalls.at(-1)).toBeCloseTo(source.startedAt! + boundary);
        endSource(source);
      }

      // After 5.25 s there is no artificial stop: natural file end owns the tail.
      moving = true;
      effects.update(1 / 60, false, true);
      const finalGulp = currentSource();
      setPlaybackOffset(finalGulp, WATER_STEP_INACTIVITY_STOP_POINTS_SECONDS[3] + 0.1);
      moving = false;
      effects.update(1 / 60, false, true);
      expect(finalGulp.stopCalls).toHaveLength(0);
      const beforeNaturalEnd = sourceCount();
      endSource(finalGulp);
      expect(sourceCount()).toBe(beforeNaturalEnd);

      // Reactivation before a scheduled boundary keeps the same source and replaces
      // its early stop with the natural 7 s end rather than restarting from zero.
      moving = true;
      effects.update(1 / 60, false, true);
      const reactivated = currentSource();
      setPlaybackOffset(reactivated, 1.9);
      moving = false;
      effects.update(1 / 60, false, true);
      expect(reactivated.stopCalls.at(-1)).toBeCloseTo(reactivated.startedAt! + 2.73);
      const beforeReactivation = sourceCount();
      setPlaybackOffset(reactivated, 2.0);
      moving = true;
      effects.update(1 / 60, false, true);
      expect(sourceCount()).toBe(beforeReactivation);
      expect(reactivated.stopCalls.at(-1)).toBeCloseTo(reactivated.startedAt! + 7);

      // Continuous valid action still chains at the real file end.
      endSource(reactivated);
      expect(sourceCount()).toBe(beforeReactivation + 1);
      const chained = currentSource();

      // Regression: dy/collision corrections while still touching the surface do
      // not create a fresh action/source after movement input stops.
      setPlaybackOffset(chained, 0.7);
      moving = false;
      position.y = 43.15;
      effects.update(1 / 60, false, true);
      const afterInactivity = sourceCount();
      const scheduledStops = chained.stopCalls.length;
      position.y = 43.30;
      effects.update(1 / 60, false, true);
      position.y = 43.20;
      effects.update(1 / 60, false, true);
      expect(sourceCount()).toBe(afterInactivity);
      expect(chained.stopCalls).toHaveLength(scheduledStops);
      endSource(chained);

      // Discrete takeoff and landing remain valid one-frame water actions.
      position.y = 43;
      effects.update(1 / 60, false, true);
      const beforeJump = sourceCount();
      position.y = 45.2;
      effects.update(1 / 60, false, true);
      expect(sourceCount()).toBe(beforeJump + 1);
      const jump = currentSource();
      effects.update(1 / 60, false, true);
      expect(jump.stopCalls.at(-1)).toBeCloseTo(jump.startedAt! + 1.28);
      endSource(jump);

      const beforeLanding = sourceCount();
      position.y = 43;
      effects.update(1 / 60, false, true);
      expect(sourceCount()).toBe(beforeLanding + 1);
      const landing = currentSource();
      effects.update(1 / 60, false, true);
      expect(landing.stopCalls.at(-1)).toBeCloseTo(landing.startedAt! + 1.28);

      // The anti-click fade is scheduled on the same audio clock as the stop.
      const landingGain = context.gains[context.gains.length - 1]!;
      const zeroRamp = landingGain.gain.events.find((event) => event.type === 'ramp' && event.value === 0);
      expect(zeroRamp?.time).toBeCloseTo(landing.startedAt! + 1.28);

      effects.dispose();
    } finally {
      if (originalAudio === undefined) delete globals.Audio;
      else globals.Audio = originalAudio;
      if (originalAudioContext === undefined) delete globals.AudioContext;
      else globals.AudioContext = originalAudioContext;
      if (originalFetch === undefined) delete globals.fetch;
      else globals.fetch = originalFetch;
    }
  });
});
