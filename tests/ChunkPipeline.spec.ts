import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE } from '../src/config/constants';
import { ChunkPipeline } from '../src/engine/world/ChunkPipeline';
import { getBlockRegistry } from '../src/engine/world/blocks/BlockRegistry';
import type { AtlasConfig } from '../src/engine/render/Atlas';

class TestWorker {
  static instances: TestWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    TestWorker.instances.push(this);
  }
}

describe('ChunkPipeline', () => {
  let pipeline: ChunkPipeline;

  beforeEach(() => {
    TestWorker.instances.length = 0;
    vi.stubGlobal('Worker', TestWorker);
    pipeline = new ChunkPipeline();
  });

  afterEach(() => {
    pipeline.destroy();
    vi.unstubAllGlobals();
  });

  function chunkData() {
    return {
      size: { ...CHUNK_SIZE },
      voxels: new Uint8Array(CHUNK_SIZE.x * CHUNK_SIZE.y * CHUNK_SIZE.z),
    };
  }

  it('initializes immutable mesher state once and meshes a complete batch once per chunk', () => {
    const atlasConfig = {
      atlasSize: 16,
      tileSize: 16,
      tiles: { air: [0, 0] },
    } as unknown as AtlasConfig;
    const mesher = TestWorker.instances[1];
    pipeline.setAtlasConfig(atlasConfig, getBlockRegistry().getAllBlocks());
    pipeline.setAtlasConfig(atlasConfig, getBlockRegistry().getAllBlocks());

    expect(mesher.postMessage).toHaveBeenCalledTimes(1);
    expect(mesher.postMessage.mock.calls[0][0]).toMatchObject({ type: 'INIT_MESHER' });

    pipeline.beginInitialBatch(['0,0,0', '1,0,0']);
    pipeline.ingestChunkData('0,0,0', chunkData());
    pipeline.ingestChunkData('1,0,0', chunkData());

    expect(mesher.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      'INIT_MESHER',
      'STORE_CHUNK',
      'STORE_CHUNK',
    ]);

    pipeline.finishInitialBatch();
    const messages = mesher.postMessage.mock.calls.map(([message]) => message);
    expect(messages.map((message) => message.type)).toEqual([
      'INIT_MESHER',
      'STORE_CHUNK',
      'STORE_CHUNK',
      'MESH_CHUNK',
      'MESH_CHUNK',
    ]);
    expect(messages.slice(3).map((message) => message.payload)).toEqual([
      { key: '0,0,0' },
      { key: '1,0,0' },
    ]);
    expect(messages[3].payload).not.toHaveProperty('chunkData');
    expect(messages[3].payload).not.toHaveProperty('neighbors');
  });

  it('stores an edited chunk once and remeshes only the requested chunk', () => {
    const mesher = TestWorker.instances[1];
    pipeline.setAtlasConfig({} as AtlasConfig, getBlockRegistry().getAllBlocks());
    pipeline.beginInitialBatch(['0,0,0', '1,0,0']);
    pipeline.ingestChunkData('0,0,0', chunkData());
    pipeline.ingestChunkData('1,0,0', chunkData());
    pipeline.finishInitialBatch();
    mesher.postMessage.mockClear();

    pipeline.requestRemesh(0, 0, 0, chunkData());
    const messages = mesher.postMessage.mock.calls.map(([message]) => message);
    expect(messages.map((message) => message.type)).toEqual([
      'STORE_CHUNK',
      'MESH_CHUNK',
    ]);
    expect(messages[1].payload.key).toBe('0,0,0');

    mesher.postMessage.mockClear();
    pipeline.removeChunk('0,0,0');
    const removalMessages = mesher.postMessage.mock.calls.map(([message]) => message);
    expect(removalMessages.map((message) => message.type)).toEqual([
      'REMOVE_CHUNK',
      'MESH_CHUNK',
    ]);
    expect(removalMessages[1].payload.key).toBe('1,0,0');
  });
});
