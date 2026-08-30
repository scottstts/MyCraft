import { describe, expect, it } from 'vitest';
import {
  calculateRendererViewport,
  MAX_PIXEL_RATIO,
  MAX_RENDER_PIXELS,
} from '../src/engine/render/rendererSizing';

describe('renderer drawing-buffer policy', () => {
  it('allows DPR below one when the CSS viewport exceeds the pixel budget', () => {
    const viewport = calculateRendererViewport(3840, 2160, 2);

    expect(viewport.dpr).toBeLessThan(1);
    expect(viewport.width * viewport.height * viewport.dpr ** 2).toBeLessThanOrEqual(MAX_RENDER_PIXELS + 1e-6);
  });

  it('caps ordinary high-DPR viewports without applying a minimum-DPR floor', () => {
    const viewport = calculateRendererViewport(1440, 900, 3);

    expect(viewport.dpr).toBeLessThanOrEqual(MAX_PIXEL_RATIO);
    expect(viewport.dpr).toBeGreaterThan(1);
    expect(viewport.width * viewport.height * viewport.dpr ** 2).toBeLessThanOrEqual(MAX_RENDER_PIXELS + 1e-6);
  });

  it('falls back to a safe ratio for invalid device values', () => {
    expect(calculateRendererViewport(0, 0, Number.NaN)).toEqual({ width: 1, height: 1, dpr: 1 });
  });
});
