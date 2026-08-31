import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORLD_CHUNK_COUNT,
  getWorldSizeOption,
  normalizeWorldChunkCount,
  WORLD_SIZE_OPTIONS,
} from '../src/shared/worldSizes'

describe('world size options', () => {
  it('keeps the six named footprints in ascending size order', () => {
    expect(WORLD_SIZE_OPTIONS.map((option) => [option.label, option.side, option.chunkCount])).toEqual([
      ['tiny', 3, 9],
      ['small', 5, 25],
      ['medium', 7, 49],
      ['large', 9, 81],
      ['extra large', 11, 121],
      ['full world', 13, 169],
    ])
  })

  it('normalizes unsupported counts to the tiny footprint', () => {
    expect(DEFAULT_WORLD_CHUNK_COUNT).toBe(9)
    expect(normalizeWorldChunkCount(25)).toBe(25)
    expect(normalizeWorldChunkCount(1)).toBe(DEFAULT_WORLD_CHUNK_COUNT)
    expect(getWorldSizeOption(169)?.id).toBe('full-world')
  })
})
