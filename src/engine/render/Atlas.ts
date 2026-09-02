/**
 * Texture atlas manager.
 *
 * The atlas layout remains a public contract for the worker mesher, but its
 * tile pixels are generated deterministically at runtime. This keeps the
 * voxel materials pixel-art sized without shipping a separate image for each
 * block face.
 */

import * as THREE from 'three'
import {
  createProceduralVoxelAtlas,
  DEFAULT_PROCEDURAL_ATLAS_TILES,
  PROCEDURAL_VOXEL_TEXTURE_SEED,
} from './ProceduralVoxelTextures'

export interface AtlasConfig {
  tileSize: number
  atlasSize: number
  tiles: Record<string, [number, number]> // name -> [u, v] in tile coordinates
}

export interface AtlasTile {
  u: number
  v: number
}

export class Atlas {
  private texture: THREE.Texture
  private config: AtlasConfig

  constructor(texture: THREE.Texture, config: AtlasConfig) {
    this.texture = texture
    this.config = config

    // Configure for pixel art - match UV convention.
    this.texture.flipY = true
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.magFilter = THREE.NearestFilter
    this.texture.minFilter = THREE.NearestFilter // no mips until padding exists
    this.texture.generateMipmaps = false
    this.texture.wrapS = THREE.ClampToEdgeWrapping
    this.texture.wrapT = THREE.ClampToEdgeWrapping
    this.texture.needsUpdate = true
  }

  getTexture(): THREE.Texture {
    return this.texture
  }

  getTile(name: string): AtlasTile | null {
    const coords = this.config.tiles[name]
    if (!coords) return null

    return {
      u: coords[0],
      v: coords[1],
    }
  }

  getTileSize(): number {
    return this.config.tileSize
  }

  getAtlasSize(): number {
    return this.config.atlasSize
  }

  getTiles(): Record<string, [number, number]> {
    return this.config.tiles
  }

  getConfig(): AtlasConfig {
    return this.config
  }
}

function getDefaultAtlasConfig(): AtlasConfig {
  const tiles = Object.fromEntries(
    Object.entries(DEFAULT_PROCEDURAL_ATLAS_TILES).map(([name, position]) => [name, [...position] as [number, number]]),
  )
  return {
    tileSize: 16,
    atlasSize: Math.max(...Object.values(tiles).map(([x]) => x), 0) + 1,
    tiles,
  }
}

function normalizeAtlasConfig(config: AtlasConfig): AtlasConfig {
  const tiles = { ...config.tiles }
  // Keep the old alternate-leaf key readable for saved/debug configurations;
  // both names intentionally resolve to the same cherry tile.
  if (!tiles.cherry_leaves && tiles.maple_leaves) tiles.cherry_leaves = tiles.maple_leaves
  if (!tiles.maple_leaves && tiles.cherry_leaves) tiles.maple_leaves = tiles.cherry_leaves
  const maxTileX = Math.max(...Object.values(tiles).map(([x]) => x), 0)
  return {
    tileSize: Math.max(4, Math.floor(config.tileSize || 16)),
    atlasSize: Math.max(1, Math.floor(config.atlasSize || 0), maxTileX + 1),
    tiles,
  }
}

function createConfiguredProceduralAtlas(config: AtlasConfig): THREE.Texture {
  return createProceduralVoxelAtlas({
    tileSize: config.tileSize,
    atlasSize: config.atlasSize,
    tiles: config.tiles,
    seed: PROCEDURAL_VOXEL_TEXTURE_SEED,
  })
}

/**
 * Load the atlas layout and create its pixels procedurally. The fetch is kept
 * because atlas.json is also consumed by the mesher worker; only image loading
 * has been removed from the startup path.
 */
export async function loadFullAtlas(): Promise<Atlas> {
  try {
    const response = await fetch('/atlas.json')
    const config = normalizeAtlasConfig(await response.json() as AtlasConfig)
    return new Atlas(createConfiguredProceduralAtlas(config), config)
  } catch (error) {
    console.warn('Failed to load atlas configuration, using procedural defaults:', error)
    const config = getDefaultAtlasConfig()
    return new Atlas(createConfiguredProceduralAtlas(config), config)
  }
}

/** Backward-compatible synchronous atlas entry point for diagnostics/tests. */
export function loadAtlas(): THREE.Texture {
  return createConfiguredProceduralAtlas(getDefaultAtlasConfig())
}
