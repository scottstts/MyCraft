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
      const sample = terrain(Math.floor(anchor.x), Math.floor(anchor.z))
      expect(sample.isOcean).toBe(true)
      expect(anchor.rootY).toBe(sample.height + 1)
      expect(WATER_LEVEL + 0.5 - anchor.rootY).toBeGreaterThan(SEAWEED_MIN_DEPTH)
      expect(anchor.height).toBe(2)
      expect(anchor.rootY + anchor.height).toBeLessThanOrEqual(generated.diagnostics.safeSurfaceY + 1e-6)
      expect(anchor.x - Math.floor(anchor.x)).toBeCloseTo(0.5)
      expect(anchor.z - Math.floor(anchor.z)).toBeCloseTo(0.5)
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

  it('allows anchors on a descending underwater seabed', () => {
    const generated = generateSeaweedAnchors({
      bounds: { minX: 0, maxX: 16, minZ: 0, maxZ: 32 },
      terrainSeed: 12345,
      worldRadius: 16,
      waterLevel: WATER_LEVEL,
      distributionSeed: 0x13579bdf,
      terrainSampler: (x) => ({
        // One-block descent per X block: every candidate has an uphill side,
        // but the slope is still gentle enough for the rooted two-block card.
        height: 24 - Math.floor(x),
        isOcean: true,
      }),
    })

    expect(generated.anchors.length).toBeGreaterThan(0)
    expect(generated.anchors.some((anchor) => {
      const current = 24 - Math.floor(anchor.x)
      const uphill = 24 - Math.floor(anchor.x - 1)
      return uphill > current
    })).toBe(true)
  })

  it('uses the integer terrain column for the exposed top face', () => {
    const generated = generateSeaweedAnchors({
      bounds: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 },
      terrainSeed: 12345,
      worldRadius: 16,
      waterLevel: WATER_LEVEL,
      distributionSeed: 0x10203040,
      terrainSampler: (x) => ({
        // Deliberately make a half-coordinate sample disagree with the
        // generated integer column; the field must use the latter.
        height: Number.isInteger(x) ? 24 : 30,
        isOcean: true,
      }),
    })

    expect(generated.anchors.length).toBeGreaterThan(0)
    for (const anchor of generated.anchors) {
      expect(anchor.rootY).toBe(25)
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
