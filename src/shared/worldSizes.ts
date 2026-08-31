/**
 * Player-facing world footprints and their engine chunk counts.
 *
 * World size is intentionally a small closed set. Keeping the mapping in one
 * module prevents the start UI, state normalization, save loading, and engine
 * bounds calculations from drifting apart.
 */

export const WORLD_SIZE_OPTIONS = [
  { id: 'tiny', label: 'tiny', side: 3, chunkCount: 9 },
  { id: 'small', label: 'small', side: 5, chunkCount: 25 },
  { id: 'medium', label: 'medium', side: 7, chunkCount: 49 },
  { id: 'large', label: 'large', side: 9, chunkCount: 81 },
  { id: 'extra-large', label: 'extra large', side: 11, chunkCount: 121 },
  { id: 'full-world', label: 'full world', side: 13, chunkCount: 169 },
] as const

export type WorldSizeId = (typeof WORLD_SIZE_OPTIONS)[number]['id']
export type WorldSizeOption = (typeof WORLD_SIZE_OPTIONS)[number]

export const DEFAULT_WORLD_SIZE = WORLD_SIZE_OPTIONS[0]
export const DEFAULT_WORLD_SIZE_ID: WorldSizeId = DEFAULT_WORLD_SIZE.id
export const DEFAULT_WORLD_CHUNK_COUNT = DEFAULT_WORLD_SIZE.chunkCount

export function getWorldSizeOption(chunkCount: number): WorldSizeOption | undefined {
  return WORLD_SIZE_OPTIONS.find((option) => option.chunkCount === chunkCount)
}

export function normalizeWorldChunkCount(chunkCount: number): number {
  return getWorldSizeOption(chunkCount)?.chunkCount ?? DEFAULT_WORLD_CHUNK_COUNT
}
