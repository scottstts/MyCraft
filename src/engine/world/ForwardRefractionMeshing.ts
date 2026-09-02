/**
 * Conservative, worker-safe classification used to split static terrain
 * faces before they reach the forward-refraction vertex shader.
 *
 * The classifier deliberately leaves a full wave-height band around the
 * visual water plane unresolved. Faces in that band are submitted to the
 * existing exact per-vertex solve, so this is a rejection-only optimization.
 */

/** The voxel water table is half a block below the visual ocean centerline. */
export const FORWARD_REFRACTION_WATER_LEVEL_OFFSET = 0.5

/** Maximum vertical excursion of the live ocean wave field. */
export const FORWARD_REFRACTION_WAVE_MARGIN = 0.5

export type ForwardRefractionMedium = 'above' | 'below' | 'boundary'

export type ForwardRefractionIndexBucket =
  | 'aboveOpaque'
  | 'aboveCutout'
  | 'belowOpaque'
  | 'belowCutout'
  | 'boundaryOpaque'
  | 'boundaryCutout'

export const FORWARD_REFRACTION_INDEX_BUCKETS: readonly ForwardRefractionIndexBucket[] = [
  'aboveOpaque',
  'aboveCutout',
  'belowOpaque',
  'belowCutout',
  'boundaryOpaque',
  'boundaryCutout',
]

export function classifyForwardRefractionMedium(
  minY: number,
  maxY: number,
  waterLevel: number,
  waveMargin = FORWARD_REFRACTION_WAVE_MARGIN,
): ForwardRefractionMedium {
  if (
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY) ||
    !Number.isFinite(waterLevel) ||
    !Number.isFinite(waveMargin) ||
    minY > maxY ||
    waveMargin < 0
  ) return 'boundary'

  const lowerSurface = waterLevel - waveMargin
  const upperSurface = waterLevel + waveMargin
  // Strict comparisons keep faces touching the extreme wave envelope in the
  // boundary bucket. A false boundary costs a solve; a false rejection can
  // remove a visible refracted silhouette.
  if (minY > upperSurface) return 'above'
  if (maxY < lowerSurface) return 'below'
  return 'boundary'
}

export function getForwardRefractionIndexBucket(
  medium: ForwardRefractionMedium,
  cutout: boolean,
): ForwardRefractionIndexBucket {
  return `${medium}${cutout ? 'Cutout' : 'Opaque'}` as ForwardRefractionIndexBucket
}

export function getForwardRefractionMediumForBucket(
  bucket: ForwardRefractionIndexBucket,
): ForwardRefractionMedium {
  if (bucket.startsWith('above')) return 'above'
  if (bucket.startsWith('below')) return 'below'
  return 'boundary'
}
