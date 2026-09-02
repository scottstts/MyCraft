import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE } from '../src/config/constants';
import { localToIndex } from '../src/engine/utils/coords';
import { getBlockRegistry } from '../src/engine/world/blocks/BlockRegistry';
import type { AtlasConfig } from '../src/engine/render/Atlas';

describe('mesher worker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('initializes once, stores chunk data, and emits a key-meshed typed buffer', async () => {
    const fakeSelf = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn(),
    };
    vi.stubGlobal('self', fakeSelf);
    await import('../src/engine/workers/mesher.worker');

    const atlasConfig = {
      atlasSize: 16,
      tileSize: 16,
      tiles: {
        air: [0, 0],
        dirt: [1, 0],
        cobblestone: [2, 0],
        grass_top: [3, 0],
        grass_side: [4, 0],
        sand: [5, 0],
        water: [6, 0],
        wood_top: [7, 0],
        wood_side: [8, 0],
        tree_leaves: [9, 0],
        cherry_leaves: [10, 0],
      },
    } as unknown as AtlasConfig;
    const blockRegistry = getBlockRegistry().getAllBlocks();
    fakeSelf.onmessage?.({
      data: { type: 'INIT_MESHER', payload: { atlasConfig, blockRegistry } },
    } as MessageEvent);

    const voxels = new Uint8Array(CHUNK_SIZE.x * CHUNK_SIZE.y * CHUNK_SIZE.z);
    voxels[localToIndex(1, 1, 1)] = 3;
    fakeSelf.onmessage?.({
      data: { type: 'STORE_CHUNK', payload: { key: '0,0,0', voxels } },
    } as MessageEvent);
    fakeSelf.onmessage?.({
      data: { type: 'MESH_CHUNK', payload: { key: '0,0,0' } },
    } as MessageEvent);

    expect(fakeSelf.postMessage).toHaveBeenCalledTimes(1);
    const response = fakeSelf.postMessage.mock.calls[0]?.[0] as {
      type: string;
      payload: {
        opaque: { positions: Float32Array; indices: Uint32Array };
        transparent: { positions: Float32Array; indices: Uint32Array };
      };
    };
    expect(response.type).toBe('CHUNK_MESH');
    expect(response.payload.opaque.positions).toHaveLength(6 * 4 * 3);
    expect(response.payload.opaque.indices).toHaveLength(6 * 6);
    expect(response.payload.transparent.positions).toHaveLength(0);
    expect(response.payload.transparent.indices).toHaveLength(0);
  });
});
