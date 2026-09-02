import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHUNK_SIZE } from '../src/config/constants';
import { Chunk } from '../src/engine/world/chunk/Chunk';
import { VoxelOccupancyVolume } from '../src/engine/render/lighting/VoxelOccupancyVolume';

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
    expect(voxels[index]).toBe(255);
    const waterIndex = 5 + CHUNK_SIZE.x * (3 + CHUNK_SIZE.y * 4);
    expect(voxels[waterIndex]).toBe(0);

    const grass = volume.grassTexture.image.data as Uint8Array;
    const grassIndex = 16 + CHUNK_SIZE.x * (3 + CHUNK_SIZE.y * 4);
    expect(grass[grassIndex]).toBe(255);

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

    const leaf = volume.leafTexture.image.data as Uint8Array;
    const greenIndex = 7 + CHUNK_SIZE.x * (5 + CHUNK_SIZE.y * 7);
    const cherryIndex = 8 + CHUNK_SIZE.x * (5 + CHUNK_SIZE.y * 7);
    expect(leaf[greenIndex]).toBe(255);
    expect(leaf[cherryIndex]).toBe(255);
    expect((volume.texture.image.data as Uint8Array)[greenIndex]).toBe(0);
    expect((volume.texture.image.data as Uint8Array)[cherryIndex]).toBe(0);
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
});
