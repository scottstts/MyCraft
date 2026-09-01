import {
  createTerrainSampler,
  WATER_LEVEL,
  type TerrainSampler,
} from '../world/TerrainGenerator'
import {
  getOceanMaxAmplitude,
  OCEAN_WATER_CENTER_OFFSET,
} from './water/OceanWaveField'

export interface SeaweedAnchor {
  x: number
  z: number
  rootY: number
  height: number
  seed: number
}

export interface SeaweedFieldBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface SeaweedFieldOptions {
  bounds: SeaweedFieldBounds
  terrainSeed: number
  worldRadius: number
  /** A fresh per-game-load seed; it is intentionally not part of a save file. */
  distributionSeed: number
  waterLevel?: number
  terrainSampler?: TerrainSampler
}

export interface SeaweedFieldDiagnostics {
  distributionSeed: number
  candidateCount: number
  acceptedCount: number
  minDistance: number
  minimumDepth: number
  safeSurfaceY: number
  depthRange: { min: number; max: number }
  heightRange: { min: number; max: number }
  oceanOnly: boolean
  weightedBy: string[]
}

/** Seaweed starts below the beach shelf, where the sea floor has room for it. */
export const SEAWEED_MIN_DEPTH = 5.0
export const SEAWEED_MIN_HEIGHT = 1.75
export const SEAWEED_MAX_HEIGHT = 7.0
export const SEAWEED_MIN_DISTANCE = 2.65
export const SEAWEED_CANDIDATE_SPACING = 2.8
export const SEAWEED_SAFE_SURFACE_CLEARANCE = 0.14

const HASH_A = 0x9e3779b9
const HASH_B = 0x85ebca6b
const HASH_C = 0xc2b2ae35

function hash2D(x: number, z: number, seed: number): number {
  let value = (seed ^ Math.imul(x | 0, HASH_A) ^ Math.imul(z | 0, HASH_B)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x7feb352d)
  value ^= value >>> 15
  value = Math.imul(value, 0x846ca68b)
  value ^= value >>> 16
  return (value >>> 0) / 4294967296
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(edge1 - edge0, 1e-6)))
  return t * t * (3 - 2 * t)
}

function valueNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const tx = x - x0
  const tz = z - z0
  const sx = tx * tx * (3 - 2 * tx)
  const sz = tz * tz * (3 - 2 * tz)
  const a = hash2D(x0, z0, seed)
  const b = hash2D(x0 + 1, z0, seed)
  const c = hash2D(x0, z0 + 1, seed)
  const d = hash2D(x0 + 1, z0 + 1, seed)
  const xA = a + (b - a) * sx
  const xB = c + (d - c) * sx
  return xA + (xB - xA) * sz
}

function gridKey(x: number, z: number): string {
  return `${x},${z}`
}

function fieldDepthWeight(depth: number, patch: number): number {
  // The first factor keeps the distribution off the shallow beach shelf. The
  // second allows a little deep-water presence without turning open ocean
  // into a uniform lawn. Patch noise is a habitat multiplier, not a hard mask.
  const shelf = smoothstep(SEAWEED_MIN_DEPTH, 9.0, depth)
  const deepFade = 1.0 - smoothstep(17.0, 28.0, depth) * 0.58
  const patchWeight = 0.32 + patch * 0.90
  return Math.max(0, Math.min(1, shelf * deepFade * patchWeight))
}

/**
 * Generate a weighted Poisson-disk field from random candidate positions.
 *
 * Candidates are jittered inside a coarse search lattice only to bound the
 * amount of work; their acceptance, priority, height, and yaw seed are all
 * random draws from the per-load distribution seed. A priority-ordered dart
 * throw plus a spatial rejection grid gives the field blue-noise spacing while
 * the depth and macro patch weights create natural stands and open gaps.
 */
export function generateSeaweedAnchors(options: SeaweedFieldOptions): {
  anchors: SeaweedAnchor[]
  diagnostics: SeaweedFieldDiagnostics
} {
  const waterLevel = options.waterLevel ?? WATER_LEVEL
  const terrain = options.terrainSampler ?? createTerrainSampler(options.terrainSeed, options.worldRadius)
  const safeSurfaceY = waterLevel
    + OCEAN_WATER_CENTER_OFFSET
    - getOceanMaxAmplitude()
    - SEAWEED_SAFE_SURFACE_CLEARANCE
  const candidateSpacing = Math.max(SEAWEED_CANDIDATE_SPACING, SEAWEED_MIN_DISTANCE)
  const poissonCellSize = SEAWEED_MIN_DISTANCE / Math.SQRT2
  const candidateMinX = Math.floor(options.bounds.minX / candidateSpacing) - 1
  const candidateMaxX = Math.ceil(options.bounds.maxX / candidateSpacing) + 1
  const candidateMinZ = Math.floor(options.bounds.minZ / candidateSpacing) - 1
  const candidateMaxZ = Math.ceil(options.bounds.maxZ / candidateSpacing) + 1

  type Candidate = SeaweedAnchor & { priority: number; rejectionRadius: number }
  const candidates: Candidate[] = []

  for (let gridX = candidateMinX; gridX <= candidateMaxX; gridX += 1) {
    for (let gridZ = candidateMinZ; gridZ <= candidateMaxZ; gridZ += 1) {
      const jitterX = hash2D(gridX, gridZ, options.distributionSeed ^ HASH_C) - 0.5
      const jitterZ = hash2D(gridX, gridZ, options.distributionSeed ^ (HASH_C ^ 0x51ed270b)) - 0.5
      const x = (gridX + 0.5 + jitterX * 0.86) * candidateSpacing
      const z = (gridZ + 0.5 + jitterZ * 0.86) * candidateSpacing
      if (x < options.bounds.minX || x >= options.bounds.maxX || z < options.bounds.minZ || z >= options.bounds.maxZ) continue

      const sample = terrain(x, z)
      // This is the important ocean/inland-water boundary. A low terrain
      // height is not enough because inland lake depressions are still land
      // samples in the generator's island mask.
      if (!sample.isOcean) continue

      const neighbourX = terrain(x + 1, z)
      const neighbourZ = terrain(x, z + 1)
      const slope = Math.max(
        Math.abs(neighbourX.height - sample.height),
        Math.abs(neighbourZ.height - sample.height),
      )
      if (slope > 2) continue

      const rootY = sample.height + 1
      const depth = waterLevel + OCEAN_WATER_CENTER_OFFSET - rootY
      if (depth <= SEAWEED_MIN_DEPTH) continue

      const patch = valueNoise2D(
        x * 0.034 + options.terrainSeed * 0.00017,
        z * 0.034 - options.terrainSeed * 0.00013,
        options.distributionSeed ^ HASH_A,
      )
      const weight = fieldDepthWeight(depth, patch)
      const acceptance = Math.min(0.92, 0.10 + weight * 0.78)
      const randomAcceptance = hash2D(gridX, gridZ, options.distributionSeed ^ 0x3c6ef372)
      if (randomAcceptance > acceptance) continue

      const randomHeight = hash2D(gridX, gridZ, options.distributionSeed ^ 0xda3e39cb)
      const randomVariation = hash2D(gridX, gridZ, options.distributionSeed ^ 0x1b56c4f5)
      const availableHeight = safeSurfaceY - rootY
      const heightCeiling = Math.min(
        SEAWEED_MAX_HEIGHT,
        availableHeight,
        2.35 + depth * 0.20,
      )
      if (heightCeiling < SEAWEED_MIN_HEIGHT) continue
      const height = SEAWEED_MIN_HEIGHT
        + (heightCeiling - SEAWEED_MIN_HEIGHT) * (0.35 + randomHeight * 0.65)

      candidates.push({
        x,
        z,
        rootY,
        height,
        seed: randomVariation,
        // A weighted random priority prevents the scan order from becoming a
        // visible lattice while keeping the final accepted set stable for the
        // duration of this game load. The hard radius remains constant so the
        // weighted field is a true Poisson-disk sample rather than a variable
        // spacing field that could form tight clumps.
        priority: hash2D(gridX, gridZ, options.distributionSeed ^ 0xa54ff53a) * (0.35 + weight),
        rejectionRadius: SEAWEED_MIN_DISTANCE,
      })
    }
  }

  candidates.sort((a, b) => b.priority - a.priority)
  const accepted: SeaweedAnchor[] = []
  const acceptedGrid = new Map<string, Candidate>()
  const neighbourRadius = Math.ceil(SEAWEED_MIN_DISTANCE / poissonCellSize) + 1

  for (const candidate of candidates) {
    const cellX = Math.floor(candidate.x / poissonCellSize)
    const cellZ = Math.floor(candidate.z / poissonCellSize)
    let blocked = false
    for (let x = cellX - neighbourRadius; x <= cellX + neighbourRadius && !blocked; x += 1) {
      for (let z = cellZ - neighbourRadius; z <= cellZ + neighbourRadius; z += 1) {
        const neighbour = acceptedGrid.get(gridKey(x, z))
        if (!neighbour) continue
        const dx = neighbour.x - candidate.x
        const dz = neighbour.z - candidate.z
        const requiredDistance = Math.max(neighbour.rejectionRadius, candidate.rejectionRadius)
        if (dx * dx + dz * dz < requiredDistance * requiredDistance) {
          blocked = true
          break
        }
      }
    }
    if (blocked) continue
    accepted.push({
      x: candidate.x,
      z: candidate.z,
      rootY: candidate.rootY,
      height: candidate.height,
      seed: candidate.seed,
    })
    acceptedGrid.set(gridKey(cellX, cellZ), candidate)
  }

  let minimumDepthSeen = Infinity
  let maximumDepthSeen = -Infinity
  let minimumHeightSeen = Infinity
  let maximumHeightSeen = -Infinity
  for (const anchor of accepted) {
    const depth = waterLevel + OCEAN_WATER_CENTER_OFFSET - anchor.rootY
    minimumDepthSeen = Math.min(minimumDepthSeen, depth)
    maximumDepthSeen = Math.max(maximumDepthSeen, depth)
    minimumHeightSeen = Math.min(minimumHeightSeen, anchor.height)
    maximumHeightSeen = Math.max(maximumHeightSeen, anchor.height)
  }

  return {
    anchors: accepted,
    diagnostics: {
      distributionSeed: options.distributionSeed >>> 0,
      candidateCount: candidates.length,
      acceptedCount: accepted.length,
      minDistance: SEAWEED_MIN_DISTANCE,
      minimumDepth: SEAWEED_MIN_DEPTH,
      safeSurfaceY,
      depthRange: {
        min: Number.isFinite(minimumDepthSeen) ? minimumDepthSeen : 0,
        max: Number.isFinite(maximumDepthSeen) ? maximumDepthSeen : 0,
      },
      heightRange: {
        min: Number.isFinite(minimumHeightSeen) ? minimumHeightSeen : 0,
        max: Number.isFinite(maximumHeightSeen) ? maximumHeightSeen : 0,
      },
      oceanOnly: true,
      weightedBy: ['ocean-only terrain mask', 'minimum water depth', 'macro habitat patches', 'slope clearance'],
    },
  }
}

/** Generate a fresh session seed. It is deliberately not saved with worlds. */
export function createSeaweedSessionSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const values = new Uint32Array(1)
    crypto.getRandomValues(values)
    return values[0]
  }
  return Math.floor(Math.random() * 0x100000000) >>> 0
}
