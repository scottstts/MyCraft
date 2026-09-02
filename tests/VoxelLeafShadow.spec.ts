import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createProceduralVoxelAtlas, DEFAULT_PROCEDURAL_ATLAS_TILES } from '../src/engine/render/ProceduralVoxelTextures';
import { BlockMaterial } from '../src/engine/render/BlockMaterial';
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
    expect(shader).toContain('uniform highp usampler3D uVoxelCasterFlags');
    expect(shader).toContain('uniform highp usampler3D uMacroBrickOccupancy');
    expect(shader).toContain('uniform sampler2D uXZMaxCasterHeight64');
    expect(shader).toContain('rayClearsXZTile');
    expect(shader).toContain('receiverNeedsVoxelTrace');
    expect(shader).toContain('uSunIntensity <= 0.0001');
    expect(shader).toContain('texelFetch(uVoxelCasterFlags');
    expect(shader).toContain('getMacroBrickBoundary');
    expect(shader).toContain('if (grassAt(cell) && grassBladeHit');
    expect(shader).not.toContain('grassAt(cell) > 0.5');
    expect(shader).toContain('const int DETAILED_LEAF_LAYERS = 3');
    expect(shader).toContain('bool receiverIsLeaf');
    expect(shader).toContain('bool cellTouchesReceiver');
    expect(shader).toContain('LEAF_RECEIVER_LAYER_TRANSMISSION');
    expect(shader).toContain('requiredDetailedLayers = leafReceiver ? 0 : DETAILED_LEAF_LAYERS');
    expect(shader).toContain('const int DISC_SAMPLES = 8');
    expect(shader).not.toContain('leafFbm');
    expect(shader).not.toContain('leafNoise');

    pass.dispose();
    volume.dispose();
    atlas.dispose();
  });

  it('filters only leaf atlas minification and reconstructs fractional shadows', () => {
    const atlas = createProceduralVoxelAtlas();
    const leafTiles = [
      DEFAULT_PROCEDURAL_ATLAS_TILES.tree_leaves!,
      DEFAULT_PROCEDURAL_ATLAS_TILES.tree_leaves_1!,
      DEFAULT_PROCEDURAL_ATLAS_TILES.tree_leaves_2!,
      DEFAULT_PROCEDURAL_ATLAS_TILES.tree_leaves_3!,
    ];
    const material = new BlockMaterial(atlas, null, undefined, {
      atlasSize: 38,
      tileSize: 16,
      leafTiles,
    });
    const shader = material.fragmentShader;

    expect(material.uniforms.leafTileIndicesA.value.toArray()).toEqual([8, 32, 33, 34]);
    expect(shader).toContain('bool isLeafAtlasUv');
    expect(shader).toContain('if (atlasSize > 1.0 && !leafAtlasSample) return base');
    expect(shader).toContain('vec2 offsets[12]');
    expect(shader).toContain('0.82 * uncertainty');

    material.dispose();
    atlas.dispose();
  });
});
