import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockMaterial } from '../src/engine/render/BlockMaterial';

describe('BlockMaterial surface variants', () => {
  const atlasInfo = {
    tileSize: 16,
    atlasSize: 16,
    leafTiles: [[9, 0], [10, 0]] as const,
  };

  it('keeps leaf filtering and alpha testing in the cutout variant', () => {
    const material = new BlockMaterial(
      new THREE.Texture(),
      null,
      undefined,
      atlasInfo,
      'cutout',
    );

    expect(material.surfaceMode).toBe('cutout');
    expect(material.uniforms.alphaCutoff).toBeDefined();
    expect(material.fragmentShader).toContain('isLeafAtlasUv');
    expect(material.fragmentShader).toContain('texture2D_AA(map, vUv)');
    expect(material.fragmentShader).toContain('if (texColor.a < alphaCutoff) discard;');
    expect(material.fragmentShader).toContain('dFdx(uv)');

    material.dispose();
  });

  it('compiles the opaque variant down to one clamped atlas lookup', () => {
    const material = new BlockMaterial(
      new THREE.Texture(),
      null,
      undefined,
      atlasInfo,
      'opaque',
    );

    expect(material.surfaceMode).toBe('opaque');
    expect(material.uniforms.alphaCutoff).toBeUndefined();
    expect(material.fragmentShader).toContain(
      'vec4 texColor = texture2D(map, clampUvToTile(vUv, vUv));',
    );
    expect(material.fragmentShader).not.toContain('isLeafAtlasUv');
    expect(material.fragmentShader).not.toContain('texture2D_AA');
    expect(material.fragmentShader).not.toContain('aaEnabled');
    expect(material.fragmentShader).not.toContain('leafTileIndices');
    expect(material.fragmentShader).not.toContain('alphaCutoff');
    expect(material.fragmentShader).not.toContain('dFdx(uv)');
    expect(material.fragmentShader).toContain('sampleVoxelShadow');
    expect(material.fragmentShader).toContain('sampleWaterCaustics');
    expect(material.fragmentShader).toContain('ditherAmount');
    expect(material.fragmentShader).toContain('directSunLighting');

    expect(() => material.setAntialiasing(false)).not.toThrow();
    expect(() => material.setAALodBias(false)).not.toThrow();
    material.dispose();
  });

  it('defaults to the full cutout-compatible path for existing callers', () => {
    const material = new BlockMaterial(new THREE.Texture(), null);

    expect(material.surfaceMode).toBe('cutout');
    expect(material.fragmentShader).toContain('texture2D_AA');
    material.dispose();
  });
});
