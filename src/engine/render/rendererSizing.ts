export const MAX_RENDER_PIXELS = 1_600_000;
export const MAX_PIXEL_RATIO = 1.7;

export interface RendererViewport {
  width: number;
  height: number;
  dpr: number;
}

/**
 * Calculate the logical viewport and drawing-buffer ratio from the shared
 * renderer policy. A large CSS viewport is allowed to produce a DPR below 1
 * so the drawing buffer never exceeds the pixel budget.
 */
export function calculateRendererViewport(
  width: number,
  height: number,
  devicePixelRatio: number,
): RendererViewport {
  const safeWidth = Number.isFinite(width) ? Math.max(1, width) : 1;
  const safeHeight = Number.isFinite(height) ? Math.max(1, height) : 1;
  const dpr = Math.min(
    devicePixelRatio,
    MAX_PIXEL_RATIO,
    Math.sqrt(MAX_RENDER_PIXELS / (safeWidth * safeHeight)),
  );

  return {
    width: safeWidth,
    height: safeHeight,
    dpr: Number.isFinite(dpr) && dpr > 0 ? dpr : 1,
  };
}
