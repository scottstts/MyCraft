/**
 * Texture atlas manager
 * Inputs: Atlas configuration (tileSize, atlasSize, tile mappings)
 * Outputs: THREE.Texture with pixel art filtering and tile coordinate helpers
 */

import * as THREE from 'three';

// Import texture files as modules so Vite can process them
import grassTopTexture from '../../assets/textures/grass_top.png';
import dirtTexture from '../../assets/textures/dirt.png';
import grassSideTexture from '../../assets/textures/grass_side.png';
import cobblestoneTexture from '../../assets/textures/cobblestone.png';
import sandTexture from '../../assets/textures/sand.png';
import woodTopTexture from '../../assets/textures/wood_top.png';
import woodSideTexture from '../../assets/textures/wood_side.png';
import treeLeavesTexture from '../../assets/textures/tree_leaves.png';
import mapleLeavesTexture from '../../assets/textures/maple_leaves.png';

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
    
    // Configure for pixel art - match UV convention
    this.texture.flipY = true;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;          // no mips until padding exists
    this.texture.generateMipmaps = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
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
  const atlasSize = 5; // 5 tiles in a row = 80x16 texture
  const canvas = document.createElement('canvas');
  canvas.width = atlasSize * tileSize;  // 80 pixels wide
  canvas.height = tileSize;              // 16 pixels tall (1 row only)
  const ctx = canvas.getContext('2d')!;

  // Clear to transparent; no programmatic placeholder tiles since we use image textures
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Air (4,0) - transparent (leave black)
  // ctx.fillStyle = 'transparent'; // Already black/transparent

  const texture = new THREE.CanvasTexture(canvas);

  // --- critical lines ---
  texture.flipY = true;                             // match UV convention
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;          // no mips until padding exists
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  // ----------------------

  return texture;
}

// Load actual texture images and create atlas
async function loadTextureAtlas(): Promise<THREE.Texture> {
  const textureLoader = new THREE.TextureLoader();
  const tileSize = 16;
  const atlasWidth = 11; // expanded to include wood + leaves (water tile slot left empty)
  const atlasHeight = 1; // 1 tile tall

  const canvas = document.createElement('canvas');
  canvas.width = atlasWidth * tileSize;  // 80 pixels wide
  canvas.height = atlasHeight * tileSize; // 16 pixels tall
  const ctx = canvas.getContext('2d')!;

  // Clear to transparent (for unused areas)
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Define texture positions in the atlas with their imported paths
  const textureData = {
    'grass_top': { path: grassTopTexture, position: [0, 0] },
    'dirt': { path: dirtTexture, position: [1, 0] },
    'grass_side': { path: grassSideTexture, position: [2, 0] },
    'cobblestone': { path: cobblestoneTexture, position: [3, 0] },
    'sand': { path: sandTexture, position: [4, 0] },
    // Slot [5,0] reserved for historical 'water' tile; left transparent as water uses procedural shader
    'wood_top': { path: woodTopTexture, position: [6, 0] },
    'wood_side': { path: woodSideTexture, position: [7, 0] },
    'tree_leaves': { path: treeLeavesTexture, position: [8, 0] },
    'maple_leaves': { path: mapleLeavesTexture, position: [9, 0] }
  } as const;

  // Load and draw each texture using imported paths
  const loadPromises = Object.entries(textureData).map(async ([textureName, { path: texturePath, position: [x, y] }]) => {
    try {

      const texture = await new Promise<THREE.Texture>((resolve, reject) => {
        textureLoader.load(
          texturePath,
          resolve,
          undefined,
          reject
        );
      });

      const img = texture.image as HTMLImageElement;
      if (textureName === 'grass_side') {
        // Rotate grass_side by 180 degrees when drawing into the atlas
        ctx.save();
        ctx.translate((x + 0.5) * tileSize, (y + 0.5) * tileSize);
        ctx.rotate(Math.PI);
        ctx.drawImage(img, -tileSize / 2, -tileSize / 2, tileSize, tileSize);
        ctx.restore();
      } else {
        ctx.drawImage(img, x * tileSize, y * tileSize, tileSize, tileSize);
      }

      // Dispose the temporary texture
      texture.dispose();
    } catch (error) {
      console.warn(`Failed to load texture ${textureName}:`, error);
      // Leave transparent if texture fails to load
    }
  });

  await Promise.all(loadPromises);

  const atlasTexture = new THREE.CanvasTexture(canvas);
  return configureTexture(atlasTexture);
}

// (Removed) Fallback color fills are not used when loading image textures

// Configure texture with proper pixel art settings
function configureTexture(texture: THREE.Texture): THREE.Texture {
  texture.flipY = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

// Load full atlas with JSON configuration
export async function loadFullAtlas(): Promise<Atlas> {
  try {
    // Load atlas configuration
    const response = await fetch('/atlas.json');
    const config: AtlasConfig = await response.json();

    // Load actual texture images
    const texture = await loadTextureAtlas();

    return new Atlas(texture, config);
  } catch (error) {
    console.warn('Failed to load atlas, falling back to simple atlas:', error);

    // Fallback configuration
    const config: AtlasConfig = {
      tileSize: 16,
      atlasSize: 11,
      tiles: {
        'grass_top': [0, 0],
        'dirt': [1, 0],
        'grass_side': [2, 0],
        'cobblestone': [3, 0],
        'sand': [4, 0],
        'water': [5, 0],
        'wood_top': [6, 0],
        'wood_side': [7, 0],
        'tree_leaves': [8, 0],
        'maple_leaves': [9, 0],
        'air': [10, 0]
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
