import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createProceduralVoxelAtlas,
  createProceduralVoxelTileTexture,
  extractProceduralAtlasTile,
} from '../src/engine/render/ProceduralVoxelTextures';

function getTextureData(texture: THREE.Texture): Uint8Array {
  return (texture.image as { data: Uint8Array }).data;
}

describe('procedural voxel textures', () => {
  it('creates a deterministic pixel-art atlas with sparse leaf alpha', () => {
    const first = createProceduralVoxelAtlas();
    const second = createProceduralVoxelAtlas();
    const data = getTextureData(first);
    const atlasWidth = first.image.width;
    let transparentLeafPixels = 0;
    let opaqueLeafPixels = 0;
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const alphaIndex = (y * atlasWidth + 8 * 16 + x) * 4 + 3;
        if (data[alphaIndex] === 0) transparentLeafPixels += 1;
        if (data[alphaIndex] === 255) opaqueLeafPixels += 1;
      }
    }

    expect(first).toBeInstanceOf(THREE.DataTexture);
    expect(first.image.width).toBe(38 * 16);
    expect(first.image.height).toBe(16);
    expect(data).toEqual(getTextureData(second));
    expect(transparentLeafPixels).toBeGreaterThan(0);
    expect(opaqueLeafPixels).toBeGreaterThan(0);

    first.dispose();
    second.dispose();
  });

  it('keeps cherry and green leaf palettes separate while sharing the cutout contract', () => {
    const green = createProceduralVoxelTileTexture('tree_leaves');
    const cherry = createProceduralVoxelTileTexture('cherry_leaves');
    const greenData = getTextureData(green);
    const cherryData = getTextureData(cherry);

    expect(greenData).not.toEqual(cherryData);
    expect(Array.from(greenData).some((value, index) => index % 4 === 3 && value === 0)).toBe(true);
    expect(Array.from(cherryData).some((value, index) => index % 4 === 3 && value === 0)).toBe(true);
    for (let index = 3; index < greenData.length; index += 4) {
      expect(greenData[index]).toBe(cherryData[index]);
    }

    green.dispose();
    cherry.dispose();
  });

  it('carves leaves as coherent pixel clumps instead of isolated texels', () => {
    const texture = createProceduralVoxelTileTexture('tree_leaves');
    const data = getTextureData(texture);
    let opaquePixels = 0;
    let isolatedPixels = 0;

    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        if (data[(y * 16 + x) * 4 + 3] === 0) continue;
        opaquePixels += 1;
        let hasOpaqueNeighbour = false;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue;
            const neighbourX = x + offsetX;
            const neighbourY = y + offsetY;
            if (neighbourX < 0 || neighbourX >= 16 || neighbourY < 0 || neighbourY >= 16) continue;
            if (data[(neighbourY * 16 + neighbourX) * 4 + 3] !== 0) hasOpaqueNeighbour = true;
          }
        }
        if (!hasOpaqueNeighbour) isolatedPixels += 1;
      }
    }

    expect(opaquePixels).toBeGreaterThan(0);
    expect(isolatedPixels).toBeLessThanOrEqual(1);
    texture.dispose();
  });

  it('emits distinct deterministic pattern variants for each material family', () => {
    const first = createProceduralVoxelTileTexture('sand');
    const second = createProceduralVoxelTileTexture('sand_1');
    const repeat = createProceduralVoxelTileTexture('sand_1');
    const leaf = createProceduralVoxelTileTexture('tree_leaves');
    const leafVariant = createProceduralVoxelTileTexture('tree_leaves_1');

    expect(getTextureData(first)).not.toEqual(getTextureData(second));
    expect(getTextureData(second)).toEqual(getTextureData(repeat));
    expect(getTextureData(leaf)).not.toEqual(getTextureData(leafVariant));

    first.dispose();
    second.dispose();
    repeat.dispose();
    leaf.dispose();
    leafVariant.dispose();
  });

  it('extracts generated sand without a canvas or image asset', () => {
    const atlas = createProceduralVoxelAtlas();
    const sand = extractProceduralAtlasTile(atlas, [4, 0], 16);
    const expected = createProceduralVoxelTileTexture('sand');

    expect(sand).toBeInstanceOf(THREE.DataTexture);
    expect(sand?.image.width).toBe(16);
    expect(sand?.image.height).toBe(16);
    expect(getTextureData(sand!)).toEqual(getTextureData(expected));

    sand?.dispose();
    expected.dispose();
    atlas.dispose();
  });
});
