/**
 * Texture atlas manager
 * Inputs: Atlas configuration (tileSize, atlasSize, tile mappings)
 * Outputs: THREE.Texture with pixel art filtering and tile coordinate helpers
 */

import * as THREE from 'three';

export interface AtlasConfig {
  tileSize: number;
  atlasSize: number;
  tiles: Record<string, [number, number]>; // name -> [u, v] in tile coordinates
}

export interface AtlasTile {
  u: number;
  v: number;
}

export class Atlas {
  private texture: THREE.Texture;
  private config: AtlasConfig;

  constructor(texture: THREE.Texture, config: AtlasConfig) {
    this.texture = texture;
    this.config = config;
    
    // Configure for pixel art
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestMipmapNearestFilter;
    this.texture.anisotropy = 1;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.RepeatWrapping;
  }

  getTexture(): THREE.Texture {
    return this.texture;
  }

  getTile(name: string): AtlasTile | null {
    const coords = this.config.tiles[name];
    if (!coords) return null;
    
    return {
      u: coords[0],
      v: coords[1]
    };
  }

  getTileSize(): number {
    return this.config.tileSize;
  }

  getAtlasSize(): number {
    return this.config.atlasSize;
  }

  getTiles(): Record<string, [number, number]> {
    return this.config.tiles;
  }

  getConfig(): AtlasConfig {
    return this.config;
  }
}

// Create a simple programmatic atlas texture for now
function createSimpleAtlas(): THREE.Texture {
  const tileSize = 16;
  const atlasSize = 4; // 4x4 tiles = 64x64 texture
  const canvas = document.createElement('canvas');
  canvas.width = atlasSize * tileSize;
  canvas.height = atlasSize * tileSize;
  const ctx = canvas.getContext('2d')!;
  
  // Clear to black
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Grass top (0,0) - green
  ctx.fillStyle = '#7CB342';
  ctx.fillRect(0, 0, tileSize, tileSize);
  
  // Dirt (1,0) - brown
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(tileSize, 0, tileSize, tileSize);
  
  // Grass side (2,0) - brown with green top stripe
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(tileSize * 2, 0, tileSize, tileSize);
  ctx.fillStyle = '#7CB342';
  ctx.fillRect(tileSize * 2, 0, tileSize, 3);
  
  // Stone (3,0) - gray
  ctx.fillStyle = '#696969';
  ctx.fillRect(tileSize * 3, 0, tileSize, tileSize);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.anisotropy = 1;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  
  return texture;
}

// Load full atlas with JSON configuration
export async function loadFullAtlas(): Promise<Atlas> {
  try {
    // Load atlas configuration
    const response = await fetch('/atlas.json');
    const config: AtlasConfig = await response.json();
    
    // For now, use programmatic texture
    // TODO: Later load actual image file
    const texture = createSimpleAtlas();
    
    return new Atlas(texture, config);
  } catch (error) {
    console.warn('Failed to load atlas, falling back to simple atlas:', error);
    
    // Fallback configuration
    const config: AtlasConfig = {
      tileSize: 16,
      atlasSize: 4,
      tiles: {
        'grass_top': [0, 0],
        'dirt': [1, 0], 
        'grass_side': [2, 0],
        'stone': [3, 0],
        'grass_bottom': [1, 0],
        'air': [0, 0]
      }
    };
    
    const texture = createSimpleAtlas();
    return new Atlas(texture, config);
  }
}

// Backward compatibility 
export function loadAtlas(): THREE.Texture {
  return createSimpleAtlas();
}