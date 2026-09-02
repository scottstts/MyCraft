import * as THREE from 'three'

/**
 * Stable seed for the authored voxel material family. Keeping one seed for the
 * atlas makes the visual language reproducible while each material owns its
 * own salt and causal field response.
 */
export const PROCEDURAL_VOXEL_TEXTURE_SEED = 0x4d794372

export type ProceduralTextureDebugMode = 'final' | 'field' | 'mask'

/** Number of deterministic pattern realizations emitted for each material. */
export const PROCEDURAL_VOXEL_VARIANT_COUNT = 4

export type ProceduralVoxelTextureName =
  | 'grass_top'
  | 'dirt'
  | 'grass_side'
  | 'cobblestone'
  | 'sand'
  | 'wood_top'
  | 'wood_side'
  | 'tree_leaves'
  | 'cherry_leaves'
  | 'maple_leaves'
  | 'water'
  | 'air'

const DEFAULT_PROCEDURAL_BASE_TILES: Record<string, [number, number]> = {
  grass_top: [0, 0],
  dirt: [1, 0],
  grass_side: [2, 0],
  cobblestone: [3, 0],
  sand: [4, 0],
  water: [5, 0],
  wood_top: [6, 0],
  wood_side: [7, 0],
  tree_leaves: [8, 0],
  cherry_leaves: [9, 0],
  air: [10, 0],
}

function createDefaultProceduralAtlasTiles(): Record<string, [number, number]> {
  const tiles: Record<string, [number, number]> = { ...DEFAULT_PROCEDURAL_BASE_TILES }
  const variantSources = [
    'grass_top',
    'dirt',
    'grass_side',
    'cobblestone',
    'sand',
    'wood_top',
    'wood_side',
    'tree_leaves',
    'cherry_leaves',
  ]
  let nextTileX = 11
  for (const name of variantSources) {
    for (let variant = 1; variant < PROCEDURAL_VOXEL_VARIANT_COUNT; variant += 1) {
      tiles[`${name}_${variant}`] = [nextTileX, 0]
      nextTileX += 1
    }
  }
  return tiles
}

export const DEFAULT_PROCEDURAL_ATLAS_TILES = createDefaultProceduralAtlasTiles()

export interface ProceduralVoxelTextureOptions {
  tileSize?: number
  seed?: number
  debugMode?: ProceduralTextureDebugMode
}

export interface ProceduralVoxelAtlasOptions extends ProceduralVoxelTextureOptions {
  atlasSize?: number
  tiles?: Record<string, [number, number]>
}

type RGB = readonly [number, number, number]
type RGBA = [number, number, number, number]

const DIRT_PALETTE: readonly RGB[] = [
  [62, 37, 19],
  [88, 51, 25],
  [113, 68, 32],
  [139, 84, 40],
  [164, 101, 51],
]

const GRASS_PALETTE: readonly RGB[] = [
  [38, 76, 19],
  [52, 101, 23],
  [68, 127, 29],
  [87, 151, 36],
  [111, 174, 48],
]

const SAND_PALETTE: readonly RGB[] = [
  [156, 119, 66],
  [177, 140, 82],
  [198, 161, 101],
  [218, 183, 124],
  [235, 207, 153],
]

const COBBLE_PALETTE: readonly RGB[] = [
  [55, 57, 55],
  [80, 82, 79],
  [105, 106, 101],
  [132, 133, 126],
  [164, 165, 155],
]

const WOOD_SIDE_PALETTE: readonly RGB[] = [
  [52, 29, 13],
  [76, 42, 17],
  [101, 59, 23],
  [129, 78, 31],
  [157, 98, 43],
]

const WOOD_TOP_PALETTE: readonly RGB[] = [
  [61, 34, 15],
  [91, 52, 21],
  [120, 73, 29],
  [150, 96, 42],
  [181, 124, 58],
]

const TREE_LEAF_PALETTE: readonly RGB[] = [
  [11, 52, 17],
  [17, 65, 23],
  [24, 80, 28],
  [34, 96, 33],
  [43, 113, 40],
  [55, 130, 47],
]

const CHERRY_LEAF_PALETTE: readonly RGB[] = [
  [190, 157, 173],
  [214, 184, 198],
  [231, 207, 217],
  [242, 224, 232],
  [249, 238, 243],
  [255, 249, 252],
]

const LEAF_REFERENCE_SIZE = 32
const LEAF_REFERENCE_COUNT = 54
const LEAF_REFERENCE_JITTER = 1
const LEAF_REFERENCE_GAP_BIAS = 0.16
const LEAF_REFERENCE_BRIGHTNESS_MIX = 0.52

type LeafMask = readonly (readonly number[])[]
type LeafShadeGrid = number[][]

// This is intentionally kept as authored silhouettes. Randomness chooses a
// leaf instance, transform, placement, and shade; it never decides alpha one
// texel at a time. That preserves recognizable leaf shapes and broad gaps.
const LEAF_SHAPES: readonly LeafMask[] = [
  [
    [0, 0, 1, 0, 0],
    [0, 1, 1, 1, 0],
    [1, 1, 1, 1, 1],
    [0, 1, 1, 1, 0],
    [0, 0, 1, 0, 0],
  ],
  [
    [0, 1, 0, 0],
    [1, 1, 1, 0],
    [1, 1, 1, 1],
    [0, 1, 1, 1],
    [0, 0, 1, 0],
  ],
  [
    [0, 0, 1, 0, 0],
    [0, 1, 1, 1, 0],
    [1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1],
    [0, 0, 1, 0, 0],
  ],
  [
    [0, 1, 1, 0],
    [1, 1, 1, 1],
    [0, 1, 1, 1],
    [0, 0, 1, 0],
  ],
  [
    [0, 0, 1, 0],
    [0, 1, 1, 1],
    [1, 1, 1, 1],
    [0, 1, 1, 1],
    [0, 0, 1, 0],
  ],
  [
    [0, 1, 0, 0, 0],
    [1, 1, 1, 0, 0],
    [1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1],
    [0, 0, 1, 0, 0],
  ],
]

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smooth(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  return smooth((value - edge0) / (edge1 - edge0))
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount
}

function hash2(seed: number, x: number, y: number): number {
  let value = Math.imul(seed | 0, 0x45d9f3b)
  value = Math.imul(value ^ Math.imul(Math.floor(x), 0x27d4eb2d), 0x165667b1)
  value = Math.imul(value ^ Math.imul(Math.floor(y), 0x1b873593), 0x85ebca6b)
  value ^= value >>> 13
  value = Math.imul(value, 0xc2b2ae35)
  value ^= value >>> 16
  return (value >>> 0) / 4294967295
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = smooth(x - x0)
  const ty = smooth(y - y0)
  const a = hash2(seed, x0, y0)
  const b = hash2(seed, x0 + 1, y0)
  const c = hash2(seed, x0, y0 + 1)
  const d = hash2(seed, x0 + 1, y0 + 1)
  return mix(mix(a, b, tx), mix(c, d, tx), ty)
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let result = 0
  let amplitude = 0.5
  let normalization = 0
  let frequency = 1
  for (let octave = 0; octave < octaves; octave += 1) {
    result += valueNoise(x * frequency, y * frequency, seed + octave * 977) * amplitude
    normalization += amplitude
    amplitude *= 0.5
    frequency *= 2.03
  }
  return normalization > 0 ? result / normalization : 0
}

interface MaterialFields {
  macro: number
  meso: number
  micro: number
  structure: number
}

/**
 * Shared material field stack. The same warped coordinates drive the broad
 * color grouping and the smaller breakup, so the generated tiles do not read
 * as independent noise pasted into unrelated channels.
 */
function materialFields(x: number, y: number, seed: number): MaterialFields {
  const warpX = fbm(x * 0.13 + 7.2, y * 0.13 - 4.4, seed + 19, 2) - 0.5
  const warpY = fbm(x * 0.13 - 2.7, y * 0.13 + 8.9, seed + 41, 2) - 0.5
  const warpedX = x * 0.42 + warpX * 1.35
  const warpedY = y * 0.42 + warpY * 1.35
  const macro = fbm(warpedX * 0.72, warpedY * 0.72, seed + 73, 3)
  const meso = fbm(warpedX * 1.48 + 13.1, warpedY * 1.48 - 8.6, seed + 127, 3)
  const micro = hash2(seed + 181, Math.floor(x), Math.floor(y))
  const structure = clamp01(macro * 0.54 + meso * 0.34 + micro * 0.12)
  return { macro, meso, micro, structure }
}

function paletteColor(palette: readonly RGB[], value: number, jitter = 0): RGB {
  const normalized = clamp01(value + (jitter - 0.5) * 0.08)
  const index = Math.min(palette.length - 1, Math.floor(normalized * palette.length))
  return palette[index]
}

function resolveTextureVariant(name: string): { baseName: string; variant: number } {
  const match = /^(.*)_(\d+)$/.exec(name)
  const rawBaseName = match?.[1] ?? name
  const variant = match ? Math.max(0, Number.parseInt(match[2], 10)) : 0
  const baseName = rawBaseName === 'maple_leaves' ? 'cherry_leaves' : rawBaseName
  return { baseName, variant }
}

function opaque(color: RGB): RGBA {
  return [color[0], color[1], color[2], 255]
}

function generateDirtPixel(x: number, y: number, tileSize: number, seed: number): RGBA {
  const scale = 16 / tileSize
  const fields = materialFields(x * scale, y * scale, seed + 1)
  return opaque(paletteColor(DIRT_PALETTE, 0.06 + fields.structure * 0.86, fields.micro))
}

function generateGrassTopPixel(x: number, y: number, tileSize: number, seed: number): RGBA {
  const scale = 16 / tileSize
  const fields = materialFields(x * scale, y * scale, seed + 11)
  const value = 0.04 + fields.structure * 0.88 + fields.meso * 0.08
  return opaque(paletteColor(GRASS_PALETTE, value, fields.micro))
}

function generateSandPixel(x: number, y: number, tileSize: number, seed: number): RGBA {
  const scale = 16 / tileSize
  const fields = materialFields(x * scale, y * scale, seed + 23)
  const value = 0.12 + fields.structure * 0.78 + fields.macro * 0.08
  return opaque(paletteColor(SAND_PALETTE, value, fields.micro))
}

function generateGrassSidePixel(x: number, y: number, tileSize: number, seed: number): RGBA {
  const scale = 16 / tileSize
  const px = x * scale
  const py = y * scale
  const fields = materialFields(px, py, seed + 37)
  const surfaceField = materialFields(px, 0, seed + 43).macro
  const surfaceY = 3.05 + surfaceField * 1.9 + (hash2(seed + 47, Math.floor(px), 0) - 0.5) * 1.2
  const hangingBlade = py > surfaceY && py < surfaceY + 1.8 && hash2(seed + 53, Math.floor(px), Math.floor(py)) > 0.60
  if (py <= surfaceY || hangingBlade) {
    const grassValue = 0.02 + fields.structure * 0.88
    return opaque(paletteColor(GRASS_PALETTE, grassValue, fields.micro))
  }
  return generateDirtPixel(x, y, tileSize, seed + 59)
}

function generateCobblestonePixel(x: number, y: number, tileSize: number, seed: number): RGBA {
  const scale = 16 / tileSize
  const px = x * scale
  const py = y * scale
  const cellSize = 3.75
  const cellX = Math.floor(px / cellSize)
  const cellY = Math.floor(py / cellSize)
  let closestDistance = Infinity
  let closestCell = 0
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const candidateX = cellX + ox
      const candidateY = cellY + oy
      const jitterX = (hash2(seed + 67, candidateX, candidateY) - 0.5) * 1.15
      const jitterY = (hash2(seed + 71, candidateX, candidateY) - 0.5) * 1.15
      const centerX = (candidateX + 0.5 + jitterX) * cellSize
      const centerY = (candidateY + 0.5 + jitterY) * cellSize
      const distance = Math.hypot(px - centerX, py - centerY)
      if (distance < closestDistance) {
        closestDistance = distance
        closestCell = candidateX * 97 + candidateY * 193
      }
    }
  }
  const stoneCore = 1 - smoothstep(1.25, 1.95, closestDistance)
  if (stoneCore < 0.45) {
    const mortarTone = 0.12 + hash2(seed + 79, Math.floor(px / 2), Math.floor(py / 2)) * 0.22
    return opaque(paletteColor(COBBLE_PALETTE, mortarTone))
  }
  const stoneVariation = hash2(seed + 83, closestCell, Math.floor(closestDistance * 3))
  const value = 0.14 + stoneVariation * 0.76 + stoneCore * 0.08
  return opaque(paletteColor(COBBLE_PALETTE, value, stoneVariation))
}

function generateWoodSidePixel(x: number, y: number, tileSize: number, seed: number): RGBA {
  const scale = 16 / tileSize
  const px = x * scale
  const py = y * scale
  const flow = fbm(px * 0.18 + 4.1, py * 0.055 - 3.7, seed + 89, 2) - 0.5
  const column = Math.floor((px + flow * 2.1) / 1.45)
  const columnTone = hash2(seed + 97, column, 0)
  const streaks = fbm((px + flow * 1.4) * 0.37, py * 0.075, seed + 101, 3)
  const seams = hash2(seed + 103, Math.floor(px / 2), Math.floor(py / 3))
  const value = 0.08 + columnTone * 0.34 + streaks * 0.48 + seams * 0.10
  const color = paletteColor(WOOD_SIDE_PALETTE, value, seams)
  if (seams > 0.965) return [WOOD_SIDE_PALETTE[0][0], WOOD_SIDE_PALETTE[0][1], WOOD_SIDE_PALETTE[0][2], 255]
  return opaque(color)
}

function generateWoodTopPixel(x: number, y: number, tileSize: number, seed: number): RGBA {
  const scale = 16 / tileSize
  const px = x * scale
  const py = y * scale
  const center = 7.5
  const radius = Math.max(Math.abs(px - center), Math.abs(py - center))
  const ringIndex = Math.floor(radius / 1.55)
  const ringPhase = (ringIndex % 5) / 4
  const grain = fbm(px * 0.22 + 2.4, py * 0.22 - 6.5, seed + 113, 2)
  const micro = hash2(seed + 127, Math.floor(px), Math.floor(py))
  const value = 0.10 + ringPhase * 0.45 + grain * 0.34 + micro * 0.11
  return opaque(paletteColor(WOOD_TOP_PALETTE, value, micro))
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state |= 0
    state = (state + 0x6D2B79F5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function rotateLeafMask(mask: LeafMask): number[][] {
  const height = mask.length
  const width = mask[0]?.length ?? 0
  const rotated = Array.from({ length: width }, () => Array<number>(height).fill(0))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rotated[x][height - 1 - y] = mask[y][x] ?? 0
    }
  }
  return rotated
}

function flipLeafMask(mask: LeafMask): number[][] {
  return mask.map((row) => [...row].reverse())
}

function transformLeafMask(mask: LeafMask, rotation: number, flip: boolean): number[][] {
  let transformed: LeafMask = mask.map((row) => [...row])
  if (flip) transformed = flipLeafMask(transformed)
  for (let index = 0; index < rotation; index += 1) transformed = rotateLeafMask(transformed)
  return transformed.map((row) => [...row])
}

function computeLeafBoundary(mask: LeafMask, x: number, y: number): boolean {
  if (!mask[y]?.[x]) return false
  for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nextX = x + offsetX
    const nextY = y + offsetY
    if (
      nextY < 0 || nextY >= mask.length ||
      nextX < 0 || nextX >= (mask[0]?.length ?? 0) ||
      !mask[nextY]?.[nextX]
    ) return true
  }
  return false
}

function makeLeafGrid(size: number): LeafShadeGrid {
  return Array.from({ length: size }, () => Array<number>(size).fill(-1))
}

function wrapLeafCoordinate(value: number, size: number): number {
  return ((value % size) + size) % size
}

function stampLeafGrid(
  grid: LeafShadeGrid,
  leaf: { mask: LeafMask; px: number; py: number; baseShade: number; brightnessMix: number },
): void {
  const { mask, px, py, baseShade, brightnessMix } = leaf
  const height = mask.length
  const width = mask[0]?.length ?? 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y]?.[x]) continue

      const gridX = wrapLeafCoordinate(px + x, LEAF_REFERENCE_SIZE)
      const gridY = wrapLeafCoordinate(py + y, LEAF_REFERENCE_SIZE)
      const topness = 1 - y / Math.max(1, height - 1)
      const centerness = 1 - Math.abs(x / Math.max(1, width - 1) - 0.5) * 2
      let shade = baseShade
      if (topness > 0.60 && brightnessMix > 0.15) shade += 1
      if (centerness > 0.55 && topness > 0.35 && brightnessMix > 0.35) shade += 1
      if (computeLeafBoundary(mask, x, y)) shade -= 1
      if (y >= height - 1) shade -= 1
      grid[gridY][gridX] = Math.max(0, Math.min(TREE_LEAF_PALETTE.length - 1, shade))
    }
  }
}

/**
 * Port of ref/procedural_leaves.html. The reference is authored at 32x32 so
 * leaf silhouettes are built once at that resolution, then area-reduced to
 * the atlas tile size. This keeps alpha coherent and avoids independent
 * random transparent texels (the source of the old shimmering stripes).
 */
function buildReferenceLeafGrid(seed: number): LeafShadeGrid {
  const rand = mulberry32(seed)
  const grid = makeLeafGrid(LEAF_REFERENCE_SIZE)
  const columns = 7
  const rows = 7
  const cellWidth = LEAF_REFERENCE_SIZE / columns
  const cellHeight = LEAF_REFERENCE_SIZE / rows
  const leaves: Array<{
    mask: LeafMask
    px: number
    py: number
    baseShade: number
    brightnessMix: number
  }> = []
  let placed = 0

  for (let gridY = 0; gridY < rows; gridY += 1) {
    for (let gridX = 0; gridX < columns; gridX += 1) {
      if (placed >= LEAF_REFERENCE_COUNT) break
      if (rand() < LEAF_REFERENCE_GAP_BIAS) continue

      const shape = LEAF_SHAPES[Math.floor(rand() * LEAF_SHAPES.length)] ?? LEAF_SHAPES[0]
      const mask = transformLeafMask(shape, Math.floor(rand() * 4), rand() < 0.5)
      const width = mask[0]?.length ?? 0
      const height = mask.length
      const anchorX = Math.floor(gridX * cellWidth + (cellWidth - width) * 0.5)
      const anchorY = Math.floor(gridY * cellHeight + (cellHeight - height) * 0.5)
      const jitterX = Math.floor((rand() * 2 - 1) * LEAF_REFERENCE_JITTER)
      const jitterY = Math.floor((rand() * 2 - 1) * LEAF_REFERENCE_JITTER)
      leaves.push({
        mask,
        px: anchorX + jitterX,
        py: anchorY + jitterY,
        baseShade: 1 + Math.floor(rand() * 4),
        brightnessMix: LEAF_REFERENCE_BRIGHTNESS_MIX,
      })
      placed += 1
    }
  }

  while (leaves.length < LEAF_REFERENCE_COUNT) {
    const shape = LEAF_SHAPES[Math.floor(rand() * LEAF_SHAPES.length)] ?? LEAF_SHAPES[0]
    const mask = transformLeafMask(shape, Math.floor(rand() * 4), rand() < 0.5)
    const width = mask[0]?.length ?? 0
    const height = mask.length
    leaves.push({
      mask,
      px: Math.floor(rand() * LEAF_REFERENCE_SIZE) - Math.floor(width / 2),
      py: Math.floor(rand() * LEAF_REFERENCE_SIZE) - Math.floor(height / 2),
      baseShade: 1 + Math.floor(rand() * 4),
      brightnessMix: LEAF_REFERENCE_BRIGHTNESS_MIX,
    })
  }

  for (const leaf of leaves) stampLeafGrid(grid, leaf)

  const copy = grid.map((row) => [...row])
  for (let y = 0; y < LEAF_REFERENCE_SIZE; y += 1) {
    for (let x = 0; x < LEAF_REFERENCE_SIZE; x += 1) {
      if (copy[y][x] < 0) continue
      let neighbours = 0
      for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (copy[wrapLeafCoordinate(y + offsetY, LEAF_REFERENCE_SIZE)][wrapLeafCoordinate(x + offsetX, LEAF_REFERENCE_SIZE)] >= 0) {
          neighbours += 1
        }
      }
      if (neighbours === 0) grid[y][x] = -1
    }
  }
  return grid
}

function buildLeafShadeGrid(tileSize: number, seed: number): LeafShadeGrid {
  const source = buildReferenceLeafGrid(seed)
  if (tileSize === LEAF_REFERENCE_SIZE) return source

  const grid = makeLeafGrid(tileSize)
  for (let y = 0; y < tileSize; y += 1) {
    const sourceY0 = Math.floor(y * LEAF_REFERENCE_SIZE / tileSize)
    const sourceY1 = Math.max(sourceY0, Math.ceil((y + 1) * LEAF_REFERENCE_SIZE / tileSize) - 1)
    for (let x = 0; x < tileSize; x += 1) {
      const sourceX0 = Math.floor(x * LEAF_REFERENCE_SIZE / tileSize)
      const sourceX1 = Math.max(sourceX0, Math.ceil((x + 1) * LEAF_REFERENCE_SIZE / tileSize) - 1)
      let occupied = 0
      let shadeSum = 0
      let sourcePixels = 0
      for (let sourceY = sourceY0; sourceY <= Math.min(LEAF_REFERENCE_SIZE - 1, sourceY1); sourceY += 1) {
        for (let sourceX = sourceX0; sourceX <= Math.min(LEAF_REFERENCE_SIZE - 1, sourceX1); sourceX += 1) {
          sourcePixels += 1
          const shade = source[sourceY][sourceX]
          if (shade < 0) continue
          occupied += 1
          shadeSum += shade
        }
      }
      if (occupied * 2 >= sourcePixels && occupied > 0) grid[y][x] = Math.round(shadeSum / occupied)
    }
  }
  return grid
}

function generateLeafPixel(
  x: number,
  y: number,
  grid: LeafShadeGrid | undefined,
  palette: readonly RGB[],
): RGBA {
  const shade = grid?.[y]?.[x] ?? -1
  if (shade < 0) return [0, 0, 0, 0]
  return opaque(palette[Math.min(palette.length - 1, shade)] ?? palette[0])
}

function generatePixel(
  name: string,
  x: number,
  y: number,
  tileSize: number,
  seed: number,
  leafGrid?: LeafShadeGrid,
): RGBA {
  const { baseName, variant } = resolveTextureVariant(name)
  const variantSeed = seed + variant * 1049
  switch (baseName) {
    case 'grass_top': return generateGrassTopPixel(x, y, tileSize, variantSeed)
    case 'dirt': return generateDirtPixel(x, y, tileSize, variantSeed)
    case 'grass_side': return generateGrassSidePixel(x, y, tileSize, variantSeed)
    case 'cobblestone': return generateCobblestonePixel(x, y, tileSize, variantSeed)
    case 'sand': return generateSandPixel(x, y, tileSize, variantSeed)
    case 'wood_top': return generateWoodTopPixel(x, y, tileSize, variantSeed)
    case 'wood_side': return generateWoodSidePixel(x, y, tileSize, variantSeed)
    case 'tree_leaves': return generateLeafPixel(x, y, leafGrid, TREE_LEAF_PALETTE)
    case 'cherry_leaves': return generateLeafPixel(x, y, leafGrid, CHERRY_LEAF_PALETTE)
    case 'water':
    case 'air':
      return [0, 0, 0, 0]
    default:
      return [255, 255, 255, 255]
  }
}

function applyDebugMode(pixel: RGBA, debugMode: ProceduralTextureDebugMode, fields: MaterialFields): RGBA {
  if (debugMode === 'field') {
    const value = Math.round(clamp01(fields.structure) * 255)
    return [value, value, value, 255]
  }
  if (debugMode === 'mask') {
    return [pixel[3], pixel[3], pixel[3], 255]
  }
  return pixel
}

function configureTexture(texture: THREE.DataTexture, name: string): THREE.DataTexture {
  texture.name = name
  texture.flipY = true
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

function writePixel(data: Uint8Array, width: number, x: number, y: number, pixel: RGBA): void {
  const index = (y * width + x) * 4
  data[index] = pixel[0]
  data[index + 1] = pixel[1]
  data[index + 2] = pixel[2]
  data[index + 3] = pixel[3]
}

function buildTile(
  name: string,
  tileSize: number,
  seed: number,
  debugMode: ProceduralTextureDebugMode,
): Uint8Array {
  const data = new Uint8Array(tileSize * tileSize * 4)
  const resolved = resolveTextureVariant(name)
  const leafGrid = resolved.baseName === 'tree_leaves' || resolved.baseName === 'cherry_leaves'
    ? buildLeafShadeGrid(tileSize, seed + resolved.variant * 1049 + 191)
    : undefined
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      // The legacy atlas rotated grass_side after loading. Preserve that
      // authored orientation while no longer depending on an image asset.
      const sourceName = resolved.baseName
      const sourceX = sourceName === 'grass_side' ? tileSize - 1 - x : x
      const sourceY = sourceName === 'grass_side' ? tileSize - 1 - y : y
      const pixel = generatePixel(name, sourceX, sourceY, tileSize, seed, leafGrid)
      const scale = 16 / tileSize
      const fields = materialFields(sourceX * scale, sourceY * scale, seed + 191)
      writePixel(data, tileSize, x, y, applyDebugMode(pixel, debugMode, fields))
    }
  }
  return data
}

export function createProceduralVoxelTileTexture(
  name: string,
  options: ProceduralVoxelTextureOptions = {},
): THREE.DataTexture {
  const tileSize = Math.max(4, Math.floor(options.tileSize ?? 16))
  const seed = options.seed ?? PROCEDURAL_VOXEL_TEXTURE_SEED
  const debugMode = options.debugMode ?? 'final'
  const data = buildTile(name, tileSize, seed, debugMode)
  return configureTexture(
    new THREE.DataTexture(data, tileSize, tileSize, THREE.RGBAFormat, THREE.UnsignedByteType),
    `ProceduralVoxelTile:${name}`,
  )
}

export function createProceduralVoxelAtlas(
  options: ProceduralVoxelAtlasOptions = {},
): THREE.DataTexture {
  const tileSize = Math.max(4, Math.floor(options.tileSize ?? 16))
  const seed = options.seed ?? PROCEDURAL_VOXEL_TEXTURE_SEED
  const debugMode = options.debugMode ?? 'final'
  const tiles = options.tiles ?? DEFAULT_PROCEDURAL_ATLAS_TILES
  const maxTileX = Math.max(...Object.values(tiles).map(([x]) => x), 0)
  const maxTileY = Math.max(...Object.values(tiles).map(([, y]) => y), 0)
  const atlasSize = Math.max(1, Math.floor(options.atlasSize ?? maxTileX + 1), maxTileX + 1)
  const atlasHeight = maxTileY + 1
  const width = atlasSize * tileSize
  const height = atlasHeight * tileSize
  const data = new Uint8Array(width * height * 4)

  for (const [name, [tileX, tileY]] of Object.entries(tiles)) {
    const tile = buildTile(name, tileSize, seed, debugMode)
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const sourceIndex = (y * tileSize + x) * 4
        writePixel(data, width, tileX * tileSize + x, tileY * tileSize + y, [
          tile[sourceIndex],
          tile[sourceIndex + 1],
          tile[sourceIndex + 2],
          tile[sourceIndex + 3],
        ])
      }
    }
  }

  return configureTexture(
    new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType),
    'ProceduralVoxelAtlas',
  )
}

/**
 * Extract a tile from a DataTexture atlas without introducing a canvas readback
 * or a second image asset. This is used by the render-only visual seabed.
 */
export function extractProceduralAtlasTile(
  source: THREE.Texture,
  tile: [number, number],
  tileSize: number,
): THREE.DataTexture | null {
  const image = source.image as { data?: ArrayLike<number>; width?: number; height?: number } | undefined
  const sourceData = image?.data
  const sourceWidth = Math.floor(image?.width ?? 0)
  const sourceHeight = Math.floor(image?.height ?? 0)
  if (!sourceData || sourceWidth <= 0 || sourceHeight <= 0) return null
  if (sourceWidth < (tile[0] + 1) * tileSize || sourceHeight < (tile[1] + 1) * tileSize) return null

  const data = new Uint8Array(tileSize * tileSize * 4)
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      const sourceIndex = ((tile[1] * tileSize + y) * sourceWidth + tile[0] * tileSize + x) * 4
      const targetIndex = (y * tileSize + x) * 4
      data[targetIndex] = Number(sourceData[sourceIndex] ?? 0)
      data[targetIndex + 1] = Number(sourceData[sourceIndex + 1] ?? 0)
      data[targetIndex + 2] = Number(sourceData[sourceIndex + 2] ?? 0)
      data[targetIndex + 3] = Number(sourceData[sourceIndex + 3] ?? 255)
    }
  }

  const texture = configureTexture(
    new THREE.DataTexture(data, tileSize, tileSize, THREE.RGBAFormat, THREE.UnsignedByteType),
    'ProceduralAtlasTile',
  )
  texture.flipY = source.flipY
  return texture
}
