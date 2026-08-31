import { describe, it, expect } from 'vitest'
import { CHUNK_SIZE } from '../src/config/constants'

describe('sanity', () => {
  it('constants compile and have expected values', () => {
    expect(CHUNK_SIZE.x).toBe(64)
    expect(CHUNK_SIZE.y).toBe(128)
    expect(CHUNK_SIZE.z).toBe(64)
  })
})
