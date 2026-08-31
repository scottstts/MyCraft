import { describe, expect, it } from 'vitest';
import {
  CAMERA_AUDIO_SAMPLE_HEIGHT,
  CAMERA_AUDIO_SUBMERSION_THRESHOLD,
  getCameraWaterSubmersion,
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
});
