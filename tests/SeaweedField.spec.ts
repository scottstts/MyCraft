import { describe, expect, it } from 'vitest'
import {
  generateSeaweedAnchors,
  SEAWEED_MIN_DEPTH,
  SEAWEED_MIN_DISTANCE,
} from '../src/engine/render/SeaweedField'
import { WATER_LEVEL, createTerrainSampler } from '../src/engine/world/TerrainGenerator'

const bounds = {
  minX: -416,
  maxX: 416,
  minZ: -416,
  maxZ: 416,
}

function fieldOptions(distributionSeed: number) {
  return {
    bounds,
    terrainSeed: 12345,
    worldRadius: 416,
    waterLevel: WATER_LEVEL,
    distributionSeed,
  }
}

describe('weighted ocean seaweed field', () => {
  it('places only deep-ocean, fully submerged anchors with Poisson spacing', () => {
    const generated = generateSeaweedAnchors(fieldOptions(0x12345678))
    const terrain = createTerrainSampler(12345, 416)
    const anchors = generated.anchors
    const grid = new Map<string, Array<{ x: number; z: number }>>()
    const cellSize = SEAWEED_MIN_DISTANCE / Math.SQRT2

    expect(anchors.length).toBeGreaterThan(0)
    expect(generated.diagnostics.oceanOnly).toBe(true)
    expect(generated.diagnostics.acceptedCount).toBe(anchors.length)

    for (const anchor of anchors) {
      const sample = terrain(anchor.x, anchor.z)
      expect(sample.isOcean).toBe(true)
      expect(anchor.rootY).toBe(sample.height + 1)
      expect(WATER_LEVEL + 0.5 - anchor.rootY).toBeGreaterThan(SEAWEED_MIN_DEPTH)
      expect(anchor.rootY + anchor.height).toBeLessThanOrEqual(generated.diagnostics.safeSurfaceY + 1e-6)
      expect(anchor.x).toBeGreaterThanOrEqual(bounds.minX)
      expect(anchor.x).toBeLessThan(bounds.maxX)
      expect(anchor.z).toBeGreaterThanOrEqual(bounds.minZ)
      expect(anchor.z).toBeLessThan(bounds.maxZ)

      const cellX = Math.floor(anchor.x / cellSize)
      const cellZ = Math.floor(anchor.z / cellSize)
      for (let x = cellX - 2; x <= cellX + 2; x += 1) {
        for (let z = cellZ - 2; z <= cellZ + 2; z += 1) {
          for (const neighbour of grid.get(`${x},${z}`) ?? []) {
            const dx = anchor.x - neighbour.x
            const dz = anchor.z - neighbour.z
            expect(dx * dx + dz * dz).toBeGreaterThanOrEqual(
              SEAWEED_MIN_DISTANCE * SEAWEED_MIN_DISTANCE - 1e-8,
            )
          }
        }
      }
      const key = `${cellX},${cellZ}`
      const cell = grid.get(key)
      if (cell) cell.push(anchor)
      else grid.set(key, [{ x: anchor.x, z: anchor.z }])
    }
  })

  it('is stable within a load but changes when the load seed changes', () => {
    const first = generateSeaweedAnchors(fieldOptions(0x2468ace0)).anchors
    const repeat = generateSeaweedAnchors(fieldOptions(0x2468ace0)).anchors
    const nextLoad = generateSeaweedAnchors(fieldOptions(0x2468ace1)).anchors

    expect(repeat).toEqual(first)
    expect(nextLoad).not.toEqual(first)
  })
})
