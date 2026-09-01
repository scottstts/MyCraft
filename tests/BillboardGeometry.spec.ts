import { describe, expect, it } from 'vitest'
import { createXBillboardGeometry } from '../src/engine/render/BillboardGeometry'

describe('crossed billboard geometry', () => {
  it('builds the same two 90-degree planes used by grass and seaweed', () => {
    const geometry = createXBillboardGeometry(0.82, 1)
    const positions = geometry.getAttribute('position').array as Float32Array
    const index = geometry.getIndex()?.array as ArrayLike<number>

    expect(geometry.getAttribute('position').count).toBe(8)
    expect(geometry.getAttribute('uv').count).toBe(8)
    expect(geometry.getAttribute('color').count).toBe(8)
    expect(index.length).toBe(12)
    expect(positions[2]).toBe(0.5)
    expect(positions[5]).toBe(0.5)
    expect(positions[8]).toBe(0.5)
    expect(positions[11]).toBe(0.5)
    expect(positions[12]).toBe(0.5)
    expect(positions[15]).toBe(0.5)
    expect(positions[18]).toBe(0.5)
    expect(positions[21]).toBe(0.5)

    geometry.dispose()
  })

  it('preserves a portrait texture aspect on both crossed planes', () => {
    const geometry = createXBillboardGeometry(320 / 640, 1)
    const positions = geometry.getAttribute('position').array as Float32Array

    expect(positions[3] - positions[0]).toBeCloseTo(0.5)
    expect(positions[17] - positions[14]).toBeCloseTo(0.5)

    geometry.dispose()
  })

  it('can segment the same shared cross for smooth rooted deformation', () => {
    const geometry = createXBillboardGeometry(0.5, 1, 4)

    expect(geometry.getAttribute('position').count).toBe(20)
    expect(geometry.getAttribute('uv').count).toBe(20)
    expect(geometry.getIndex()?.count).toBe(48)

    geometry.dispose()
  })
})
