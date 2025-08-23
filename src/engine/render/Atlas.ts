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
}

// Stub implementation that creates a 1x1 white texture
export function loadAtlas(): Promise<Atlas> {
  return new Promise((resolve) => {
    // Create a 1x1 white texture as placeholder
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1, 1);
    
    const texture = new THREE.CanvasTexture(canvas);
    
    const config: AtlasConfig = {
      tileSize: 1,
      atlasSize: 1,
      tiles: {
        'default': [0, 0]
      }
    };
    
    resolve(new Atlas(texture, config));
  });
}