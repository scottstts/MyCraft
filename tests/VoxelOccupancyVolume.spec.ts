import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHUNK_SIZE } from '../src/config/constants';
import { Chunk } from '../src/engine/world/chunk/Chunk';
import {
  VoxelOccupancyVolume,
  VOXEL_CASTER_GRASS_BIT,
  VOXEL_CASTER_LEAF_BIT,
  VOXEL_CASTER_OPAQUE_BIT,
} from '../src/engine/render/lighting/VoxelOccupancyVolume';

describe('VoxelOccupancyVolume', () => {
  it('encodes only opaque block IDs and mirrors brick occupancy', () => {
    const volume = new VoxelOccupancyVolume({
      minX: 0,
      maxX: CHUNK_SIZE.x,
      minY: 0,
      maxY: CHUNK_SIZE.y,
      minZ: 0,
      maxZ: CHUNK_SIZE.z,
    });
    const chunk = new Chunk();
    chunk.set(2, 3, 4, 1); // opaque grass
    chunk.set(5, 3, 4, 5); // transparent water
    chunk.set(16, 3, 4, 9); // decorative grass tuft
    volume.updateChunk('0,0,0', chunk);

    const voxels = volume.texture.image.data as Uint8Array;
    const index = 2 + CHUNK_SIZE.x * (3 + CHUNK_SIZE.y * 4);
    expect(voxels[index]).toBe(VOXEL_CASTER_OPAQUE_BIT);
    const waterIndex = 5 + CHUNK_SIZE.x * (3 + CHUNK_SIZE.y * 4);
    expect(voxels[waterIndex]).toBe(0);

    const grass = volume.texture.image.data as Uint8Array;
    const grassIndex = 16 + CHUNK_SIZE.x * (3 + CHUNK_SIZE.y * 4);
    expect(grass[grassIndex]).toBe(VOXEL_CASTER_GRASS_BIT);
    expect(volume.texture.format).toBe(THREE.RedIntegerFormat);
    expect(volume.casterFlagsTexture).toBe(volume.texture);

    const bricks = volume.brickTexture.image.data as Uint8Array;
    expect(bricks[0]).toBe(255);
    expect(volume.getDiagnostics().opaqueVoxels).toBe(1);
    expect(volume.getDiagnostics().grassTufts).toBe(1);

    volume.updateBlock(2, 3, 4, 0);
    expect(voxels[index]).toBe(0);
    expect(bricks[0]).toBe(0);
    expect(volume.getDiagnostics().opaqueVoxels).toBe(0);
    expect(volume.getDiagnostics().grassTufts).toBe(1);
    volume.dispose();
  });

  it('keeps render-only seaweed casters outside voxel occupancy', () => {
    const volume = new VoxelOccupancyVolume({
      minX: 0,
      maxX: 32,
      minY: 0,
      maxY: 32,
      minZ: 0,
      maxZ: 32,
    });
    volume.setSeaweedAnchors([{ x: 3.25, z: 4.75, rootY: 8, height: 4 }]);

    const encoded = volume.seaweedTexture.image.data as Uint8Array;
    const index = (4 * 32 + 3) * 4;
    expect(encoded[index]).toBe(64)
    expect(encoded[index + 1]).toBe(191)
    expect(encoded[index + 2]).toBe(64)
    expect(encoded[index + 3]).toBe(128)
    const voxelIndex = 3 + 32 * (8 + 32 * 4)
    expect((volume.texture.image.data as Uint8Array)[voxelIndex]).toBe(0)
    expect(volume.getDiagnostics().seaweedAnchors).toBe(1)
    expect(volume.getDiagnostics().seaweedTextureBytes).toBe(32 * 32 * 4)

    const bricks = volume.brickTexture.image.data as Uint8Array
    expect(bricks[4]).toBe(255)
    expect((volume.macroBrickTexture.image.data as Uint8Array)[0]).toBe(255)
    volume.dispose()
  });

  it('coalesces bulk ingestion into one brick reduction while keeping edits local', () => {
    const volume = new VoxelOccupancyVolume({
      minX: 0,
      maxX: CHUNK_SIZE.x * 2,
      minY: 0,
      maxY: CHUNK_SIZE.y,
      minZ: 0,
      maxZ: CHUNK_SIZE.z,
    });
    const firstChunk = new Chunk();
    firstChunk.set(1, 2, 3, 1);
    const secondChunk = new Chunk();
    secondChunk.set(2, 2, 3, 1);
    const seaweedTextureVersion = volume.seaweedTexture.version;

    volume.beginBulkUpdate();
    volume.setSeaweedAnchors([{ x: 100.25, z: 4.75, rootY: 8, height: 4 }]);
    volume.updateChunk('0,0,0', firstChunk);
    volume.updateChunk('1,0,0', secondChunk);
    expect(volume.getDiagnostics().fullBrickRebuilds).toBe(0);
    expect(volume.seaweedTexture.version).toBe(seaweedTextureVersion);
    volume.finishBulkUpdate();

    expect(volume.getDiagnostics().fullBrickRebuilds).toBe(1);
    expect(volume.getDiagnostics().opaqueVoxels).toBe(2);
    expect(volume.seaweedTexture.version).toBeGreaterThan(seaweedTextureVersion);

    const beforeEdit = volume.getDiagnostics().fullBrickRebuilds;
    volume.updateBlock(1, 2, 3, 0);
    expect(volume.getDiagnostics().fullBrickRebuilds).toBe(beforeEdit);
    expect(volume.getDiagnostics().opaqueVoxels).toBe(1);
    expect((volume.texture.image.data as Uint8Array)[1 + CHUNK_SIZE.x * (2 + CHUNK_SIZE.y * 3)]).toBe(0);
    volume.dispose();
  });

  it('keeps leaf blocks porous in the shadow caster while preserving the brick fast path', () => {
    const volume = new VoxelOccupancyVolume({
      minX: 0,
      maxX: CHUNK_SIZE.x,
      minY: 0,
      maxY: CHUNK_SIZE.y,
      minZ: 0,
      maxZ: CHUNK_SIZE.z,
    });
    const chunk = new Chunk();
    chunk.set(7, 5, 7, 7); // green leaf block
    chunk.set(8, 5, 7, 8); // cherry leaf block, legacy id
    volume.updateChunk('0,0,0', chunk);

    const leaf = volume.texture.image.data as Uint8Array;
    const greenIndex = 7 + CHUNK_SIZE.x * (5 + CHUNK_SIZE.y * 7);
    const cherryIndex = 8 + CHUNK_SIZE.x * (5 + CHUNK_SIZE.y * 7);
    expect(leaf[greenIndex]).toBe(VOXEL_CASTER_LEAF_BIT);
    expect(leaf[cherryIndex]).toBe(VOXEL_CASTER_LEAF_BIT);
    expect((volume.texture.image.data as Uint8Array)[greenIndex] & VOXEL_CASTER_OPAQUE_BIT).toBe(0);
    expect((volume.texture.image.data as Uint8Array)[cherryIndex] & VOXEL_CASTER_OPAQUE_BIT).toBe(0);
    expect(volume.getDiagnostics().opaqueVoxels).toBe(0);
    expect(volume.getDiagnostics().leafVoxels).toBe(2);
    expect((volume.brickTexture.image.data as Uint8Array)[0]).toBe(255);
    expect((volume.brickDetailTexture.image.data as Uint8Array)[0]).toBe(0);
    expect((volume.leafBrickTexture.image.data as Uint8Array)[0]).toBeGreaterThan(0);
    expect(volume.leafBrickTexture.minFilter).toBe(THREE.LinearFilter);
    expect(volume.leafBrickTexture.magFilter).toBe(THREE.LinearFilter);

    volume.updateBlock(7, 5, 7, 0);
    expect(leaf[greenIndex]).toBe(0);
    expect(volume.getDiagnostics().leafVoxels).toBe(1);
    expect((volume.brickTexture.image.data as Uint8Array)[1]).toBe(255);
    expect((volume.leafBrickTexture.image.data as Uint8Array)[1]).toBeGreaterThan(0);
    volume.dispose();
  });

  it('updates the 32-cell macro hierarchy incrementally above 8-cell bricks', () => {
    const volume = new VoxelOccupancyVolume({
      minX: 0,
      maxX: 64,
      minY: 0,
      maxY: 32,
      minZ: 0,
      maxZ: 64,
    });

    volume.updateBlock(1, 1, 1, 1);
    volume.updateBlock(33, 1, 1, 1);
    const macros = volume.macroBrickTexture.image.data as Uint8Array;
    expect(volume.getDiagnostics().macroBrickDimensions).toEqual({ x: 2, y: 1, z: 2 });
    expect(macros[0]).toBe(255);
    expect(macros[1]).toBe(255);
    expect(volume.getDiagnostics().fullBrickRebuilds).toBe(0);

    // A render-only seaweed replacement can force a brick reduction outside
    // startup bulk mode; existing voxel occupancy must remain represented in
    // the macro ancestor during that rebuild.
    volume.setSeaweedAnchors([{ x: 40.5, z: 5.5, rootY: 8, height: 4 }]);
    expect(macros[0]).toBe(255);
    const afterSeaweedRebuilds = volume.getDiagnostics().fullBrickRebuilds;

    volume.updateBlock(1, 1, 1, 0);
    expect(macros[0]).toBe(0);
    expect(macros[1]).toBe(255);
    expect(volume.getDiagnostics().fullBrickRebuilds).toBe(afterSeaweedRebuilds);
    volume.dispose();
  });

  it('maintains incremental XZ maximum-caster heights at all three horizons', () => {
    const volume = new VoxelOccupancyVolume({
      minX: 0,
      maxX: 64,
      minY: 0,
      maxY: 32,
      minZ: 0,
      maxZ: 64,
    });

    const level8 = volume.xzMaxCasterHeight8Texture.image.data as Float32Array;
    const level32 = volume.xzMaxCasterHeight32Texture.image.data as Float32Array;
    const level64 = volume.xzMaxCasterHeight64Texture.image.data as Float32Array;
    expect(volume.xzMaxCasterHeight8Texture.image.width).toBe(8);
    expect(volume.xzMaxCasterHeight8Texture.image.height).toBe(8);
    expect(volume.xzMaxCasterHeight32Texture.image.width).toBe(2);
    expect(volume.xzMaxCasterHeight32Texture.image.height).toBe(2);
    expect(volume.xzMaxCasterHeight64Texture.image.width).toBe(1);
    expect(volume.xzMaxCasterHeight64Texture.image.height).toBe(1);

    volume.updateBlock(3, 4, 5, 1);
    volume.updateBlock(40, 10, 40, 1);
    expect(level8[0]).toBe(5);
    expect(level8[5 + 8 * 5]).toBe(11);
    expect(level32[1 + 2 * 1]).toBe(11);
    expect(level64[0]).toBe(11);
    expect(volume.getDiagnostics().xzMaxCasterHeightTextureBytes).toEqual({
      level8: 8 * 8 * Float32Array.BYTES_PER_ELEMENT,
      level32: 2 * 2 * Float32Array.BYTES_PER_ELEMENT,
      level64: Float32Array.BYTES_PER_ELEMENT,
    });

    // Removing the tile's highest caster must rescan that tile rather than
    // leaving a stale horizon that would disable a valid shadow traversal.
    volume.updateBlock(41, 7, 41, 1);
    volume.updateBlock(40, 10, 40, 0);
    expect(level8[5 + 8 * 5]).toBe(8);
    expect(level32[1 + 2 * 1]).toBe(8);
    expect(level64[0]).toBe(8);

    volume.updateBlock(41, 7, 41, 0);
    expect(level8[5 + 8 * 5]).toBe(-1);
    expect(level32[1 + 2 * 1]).toBe(-1);
    expect(level64[0]).toBe(5);
    volume.dispose();
  });

  it('includes seaweed proxy tops in the XZ horizon without adding voxel occupancy', () => {
    const volume = new VoxelOccupancyVolume({
      minX: 0,
      maxX: 32,
      minY: 0,
      maxY: 32,
      minZ: 0,
      maxZ: 32,
    });
    volume.setSeaweedAnchors([{ x: 3.25, z: 4.75, rootY: 8, height: 4 }]);

    const height = volume.xzMaxCasterHeight8Texture.image.data as Float32Array;
    expect(height[0]).toBe(12);
    expect((volume.texture.image.data as Uint8Array).some((value) => value !== 0)).toBe(false);
    volume.dispose();
  });
});
