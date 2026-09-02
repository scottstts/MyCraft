import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createProceduralVoxelAtlas, DEFAULT_PROCEDURAL_ATLAS_TILES } from '../src/engine/render/ProceduralVoxelTextures';
import { VoxelOccupancyVolume } from '../src/engine/render/lighting/VoxelOccupancyVolume';
import { VoxelSunShadowPass } from '../src/engine/render/lighting/VoxelSunShadowPass';

function createRendererStub(): THREE.WebGLRenderer {
  return {
    capabilities: { isWebGL2: false },
    getPixelRatio: () => 1,
  } as unknown as THREE.WebGLRenderer;
}

describe('voxel leaf shadow path', () => {
  it('uses the visible procedural atlas and the leaf-only brick fast path', () => {
    const atlas = createProceduralVoxelAtlas();
    const volume = new VoxelOccupancyVolume({
      minX: 0,
      maxX: 16,
      minY: 0,
      maxY: 16,
      minZ: 0,
      maxZ: 16,
    });
    const leafVariants = Array.from({ length: 4 }, (_, variant) =>
      DEFAULT_PROCEDURAL_ATLAS_TILES[variant === 0 ? 'tree_leaves' : `tree_leaves_${variant}`]!,
    );
    const pass = new VoxelSunShadowPass(createRendererStub(), 1, 1, volume, {
      texture: atlas,
      atlasSize: 38,
      tileSize: 16,
      variantTiles: leafVariants,
    });
    const shader = pass['quadMaterial'].fragmentShader;

    expect(pass['quadMaterial'].uniforms.uLeafAtlas.value).toBe(atlas);
    expect(shader).toContain('uLeafAtlas');
    expect(shader).toContain('leafHash32');
    expect(shader).toContain('rotateLeafUv(clamp(uv');
    expect(shader).toContain('brickDetailAt');
    expect(shader).toContain('leafBrickDensityAt');
    expect(shader).toContain('const int DISC_SAMPLES = 8');
    expect(shader).not.toContain('leafFbm');
    expect(shader).not.toContain('leafNoise');

    pass.dispose();
    volume.dispose();
    atlas.dispose();
  });
});
