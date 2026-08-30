import { describe, expect, it } from 'vitest';
import {
  createStartupError,
  isStartupErrorInfo,
} from '../src/shared/startup';

describe('startup diagnostics', () => {
  it('preserves the failing stage and renderer environment', () => {
    const failure = createStartupError('shader-compilation', new Error('program link failed'), {
      viewport: { width: 1920, height: 1080 },
      dpr: 1.25,
      platform: 'test-browser',
    });

    expect(failure.stage).toBe('shader-compilation');
    expect(failure.stageLabel).toBe('Compiling graphics shaders');
    expect(failure.message).toBe('program link failed');
    expect(failure.viewport).toEqual({ width: 1920, height: 1080 });
    expect(failure.dpr).toBe(1.25);
    expect(failure.platform).toBe('test-browser');
    expect(isStartupErrorInfo(failure)).toBe(true);
  });
});
