import { describe, expect, it } from 'vitest'
import { shouldRebuildGrassForBlockChange } from '../src/engine/render/GrassBillboardSystem'

describe('grass billboard edit invalidation', () => {
  it('ignores edits that cannot create or remove a grass tuft', () => {
    expect(shouldRebuildGrassForBlockChange(1, 2, 9)).toBe(false)
  })

  it('rebuilds when either side of an edit is a grass tuft', () => {
    expect(shouldRebuildGrassForBlockChange(9, 2, 9)).toBe(true)
    expect(shouldRebuildGrassForBlockChange(1, 9, 9)).toBe(true)
  })
})
