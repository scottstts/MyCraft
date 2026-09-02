import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE } from '../src/config/constants';
import { getChunkVoxelCount } from '../src/engine/world/chunk';
import { localToIndex } from '../src/engine/utils/coords';
import type { ChunkData } from '../src/types';

describe('generator worker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('transfers grass metadata that matches the final voxel array', async () => {
    const fakeSelf = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn(),
    };
    vi.stubGlobal('self', fakeSelf);
    await import('../src/engine/workers/generator.worker');

    fakeSelf.onmessage?.({
      data: {
        type: 'GEN_CHUNK',
        payload: { key: '0,0,0', cx: 0, cy: 0, cz: 0, seed: 12345, worldRadius: 96 },
      },
    } as MessageEvent);

    const response = fakeSelf.postMessage.mock.calls[0]?.[0] as { payload: ChunkData };
    expect(response.payload.voxels).toHaveLength(getChunkVoxelCount());
    const positions = response.payload.grassTuftPositions;
    expect(positions).toBeInstanceOf(Uint16Array);
    expect((positions?.length ?? 0) % 3).toBe(0);

    const listed = new Set<string>();
    for (let index = 0; index + 2 < (positions?.length ?? 0); index += 3) {
      const lx = positions![index];
      const ly = positions![index + 1];
      const lz = positions![index + 2];
      expect(lx).toBeLessThan(CHUNK_SIZE.x);
      expect(ly).toBeLessThan(CHUNK_SIZE.y);
      expect(lz).toBeLessThan(CHUNK_SIZE.z);
      expect(response.payload.voxels[localToIndex(lx, ly, lz)]).toBe(9);
      listed.add(`${lx},${ly},${lz}`);
    }

    let voxelGrassCount = 0;
    for (let ly = 0; ly < CHUNK_SIZE.y; ly += 1) {
      for (let lz = 0; lz < CHUNK_SIZE.z; lz += 1) {
        for (let lx = 0; lx < CHUNK_SIZE.x; lx += 1) {
          if (response.payload.voxels[localToIndex(lx, ly, lz)] === 9) voxelGrassCount += 1;
        }
      }
    }
    expect(listed.size).toBe(voxelGrassCount);
  });
});
