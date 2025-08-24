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
  const atlasWidth = 5; // 5 tiles wide for the current blocks
  const atlasHeight = 1; // 1 tile tall

  const canvas = document.createElement('canvas');
  canvas.width = atlasWidth * tileSize;  // 80 pixels wide
  canvas.height = atlasHeight * tileSize; // 16 pixels tall
  const ctx = canvas.getContext('2d')!;

  // Clear to transparent (for unused areas)
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Define texture positions in the atlas - only the textures we actually use
  const texturePositions = {
    'grass_top': [0, 0],
    'dirt': [1, 0],
    'grass_side': [2, 0],
    'stone': [3, 0]
  };

  // Load and draw each texture - grass_top and grass_side from textures directory, others from material_icons
  const loadPromises = Object.entries(texturePositions).map(async ([textureName, [x, y]]) => {
    try {
      let texturePath = '';
      if (textureName === 'grass_top' || textureName === 'grass_side') {
        texturePath = `/src/assets/textures/${textureName}.png`;
      } else {
        texturePath = `/src/assets/material_icons/${textureName}.png`;
      }

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
      // Draw a fallback colored rectangle
      ctx.fillStyle = getFallbackColor(textureName);
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  });

  await Promise.all(loadPromises);

  const atlasTexture = new THREE.CanvasTexture(canvas);
  return configureTexture(atlasTexture);
}

// Helper function to get fallback colors for textures that fail to load
function getFallbackColor(textureName: string): string {
  const fallbackColors: Record<string, string> = {
    'grass_top': '#7CB342',
    'dirt': '#8B4513',
    'grass_side': '#8B4513',
    'stone': '#696969'
  };
  return fallbackColors[textureName] || '#000000';
}

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
      atlasSize: 5,
      tiles: {
        'grass_top': [0, 0],
        'dirt': [1, 0],
        'grass_side': [2, 0],
        'stone': [3, 0],
        'air': [4, 0]
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