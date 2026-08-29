import { describe, expect, it } from 'vitest';
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
});
