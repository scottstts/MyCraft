/**
 * ChunkPipeline - Orchestrates chunk generation and meshing via workers.
 *
 * Generator responses are published to World immediately, while the mesher
 * receives each voxel array once into its own cache. Mesh requests then carry
 * only a chunk key, so neighbour data and immutable mesher configuration are
 * never structured-cloned for every job.
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { chunkKey } from '../utils/coords.js';
import type {
  WorkerResponse,
  ChunkKey,
  GenerateChunkRequest,
  ChunkDataResponse,
  ChunkMeshResponse,
  MesherInitRequest,
  StoreChunkRequest,
  MeshChunkRequest,
  RemoveChunkRequest,
} from '../../types/workers.js';
import type { ChunkData, BlockDef } from '../../types/index.js';
import {
  isChunkDataResponse,
  isChunkMeshResponse,
} from '../../types/workers.js';
import type { AtlasConfig } from '../render/Atlas.js';

export interface ChunkPipelineEvents extends Record<string, unknown> {
  CHUNK_READY: { key: ChunkKey; chunkData: ChunkData };
  CHUNK_MESH: { key: ChunkKey; response: ChunkMeshResponse };
  WORKER_ERROR: { worker: 'generator' | 'mesher'; error: unknown };
}

interface InitialBatch {
  expected: Set<ChunkKey>;
  received: Set<ChunkKey>;
  closed: boolean;
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export class ChunkPipeline extends EventEmitter<ChunkPipelineEvents> {
  private generatorWorker: Worker;
  private mesherWorker: Worker;
  private pendingRequests = new Set<ChunkKey>();
  private atlasConfig: AtlasConfig | null = null;
  private mesherInitialized = false;
  private loadedChunkKeys = new Set<ChunkKey>();
  private initialBatch: InitialBatch | null = null;
  private worldRadius: number | null = null;
  private destroyed = false;

  constructor() {
    super();

    this.generatorWorker = new Worker(
      new URL('../workers/generator.worker.ts', import.meta.url),
      { type: 'module' },
    );

    this.generatorWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      try {
        this.handleWorkerResponse(event.data);
      } catch (error) {
        this.reportWorkerError('generator', error);
      }
    };

    this.generatorWorker.onerror = (error) => {
      this.reportWorkerError('generator', error);
    };

    this.mesherWorker = new Worker(
      new URL('../workers/mesher.worker.ts', import.meta.url),
      { type: 'module' },
    );

    this.mesherWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      try {
        this.handleWorkerResponse(event.data);
      } catch (error) {
        this.reportWorkerError('mesher', error);
      }
    };

    this.mesherWorker.onerror = (error) => {
      this.reportWorkerError('mesher', error);
    };
  }

  private reportWorkerError(worker: 'generator' | 'mesher', error: unknown): void {
    console.error(`[ChunkPipeline] ${worker} worker error:`, error);
    this.emit('WORKER_ERROR', { worker, error });
  }

  /**
   * Defer all initial mesh requests until every expected chunk has supplied
   * voxel data. This matches startup's complete-world readiness contract and
   * removes neighbour-arrival remeshes from the initial batch.
   */
  beginInitialBatch(expectedKeys: Iterable<ChunkKey>): void {
    if (this.initialBatch) {
      throw new Error('[ChunkPipeline] An initial batch is already active');
    }
    this.initialBatch = {
      expected: new Set(expectedKeys),
      received: new Set(),
      closed: false,
    };
    this.commitInitialBatchIfReady();
  }

  /** Mark the initial request/ingest phase complete and mesh when data exists. */
  finishInitialBatch(): void {
    if (!this.initialBatch) {
      throw new Error('[ChunkPipeline] finishInitialBatch called without beginInitialBatch');
    }
    this.initialBatch.closed = true;
    this.commitInitialBatchIfReady();
  }

  /**
   * Ingest provided chunk data directly (bypass generator). Used when loading
   * a saved world snapshot.
   */
  ingestChunkData(key: ChunkKey, chunkData: ChunkData): void {
    this.acceptChunkData(key, chunkData);
  }

  /** Set the immutable mesher configuration once for this pipeline. */
  setAtlasConfig(atlasConfig: AtlasConfig, blockRegistry: BlockDef[]): void {
    if (this.mesherInitialized) return;
    this.atlasConfig = atlasConfig;
    const request: MesherInitRequest = {
      type: 'INIT_MESHER',
      payload: { atlasConfig, blockRegistry },
    };
    this.mesherWorker.postMessage(request);
    this.mesherInitialized = true;
  }

  /** Set world radius for island generation. */
  setWorldRadius(worldRadius: number): void {
    this.worldRadius = worldRadius;
  }

  /** Request generation of a chunk. */
  requestChunk(cx: number, cy: number, cz: number, seed: number): void {
    const key = chunkKey(cx, cy, cz);
    if (this.pendingRequests.has(key)) return;

    this.pendingRequests.add(key);
    const request: GenerateChunkRequest = {
      type: 'GEN_CHUNK',
      payload: {
        key,
        cx,
        cy,
        cz,
        seed,
        worldRadius: this.worldRadius || undefined,
      },
    };
    this.generatorWorker.postMessage(request);
  }

  private handleWorkerResponse(response: WorkerResponse): void {
    if (isChunkDataResponse(response)) {
      this.handleChunkDataResponse(response);
    } else if (isChunkMeshResponse(response)) {
      this.handleChunkMeshResponse(response);
    } else {
      console.warn('[ChunkPipeline] Unknown worker response:', response);
    }
  }

  private handleChunkDataResponse(response: ChunkDataResponse): void {
    this.pendingRequests.delete(response.key);
    this.acceptChunkData(response.key, response.payload);
  }

  private acceptChunkData(key: ChunkKey, chunkData: ChunkData): void {
    this.storeChunkForMeshing(key, chunkData);
    this.loadedChunkKeys.add(key);

    if (this.initialBatch) {
      // Inform World immediately during the deferred startup phase; initial
      // mesh requests are committed only after every expected store arrives.
      this.emit('CHUNK_READY', { key, chunkData });
      if (this.initialBatch.expected.has(key)) this.initialBatch.received.add(key);
      this.commitInitialBatchIfReady();
      return;
    }

    this.requestMeshAndLoadedNeighbors(key);
    // Preserve the established runtime ordering: the current and loaded
    // neighbour mesh jobs are queued before CHUNK_READY reaches World.
    this.emit('CHUNK_READY', { key, chunkData });
  }

  private storeChunkForMeshing(key: ChunkKey, chunkData: ChunkData): void {
    if (!this.atlasConfig || !this.mesherInitialized) {
      throw new Error('[ChunkPipeline] Atlas config must be set before meshing');
    }
    const request: StoreChunkRequest = {
      type: 'STORE_CHUNK',
      payload: { key, voxels: chunkData.voxels },
    };
    // The main thread keeps chunkData for World; this is intentionally one
    // structured clone per synchronized chunk, not one clone per mesh job.
    this.mesherWorker.postMessage(request);
  }

  private commitInitialBatchIfReady(): void {
    const batch = this.initialBatch;
    if (!batch || !batch.closed) return;
    for (const key of batch.expected) {
      if (!batch.received.has(key)) return;
    }

    this.initialBatch = null;
    // All STORE_CHUNK messages were posted before this point. Worker message
    // ordering guarantees that every neighbour is available by mesh time.
    for (const key of batch.expected) this.postMeshChunk(key);
  }

  private requestMeshAndLoadedNeighbors(key: ChunkKey): void {
    this.postMeshChunk(key);
    const [cx, cy, cz] = key.split(',').map((part) => parseInt(part, 10));
    for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
      const neighborKey = chunkKey(cx + dx, cy + dy, cz + dz);
      if (this.loadedChunkKeys.has(neighborKey)) this.postMeshChunk(neighborKey);
    }
  }

  private postMeshChunk(key: ChunkKey): void {
    const request: MeshChunkRequest = {
      type: 'MESH_CHUNK',
      payload: { key },
    };
    this.mesherWorker.postMessage(request);
  }

  private handleChunkMeshResponse(response: ChunkMeshResponse): void {
    this.emit('CHUNK_MESH', { key: response.key, response });
  }

  /**
   * Request a re-mesh for an existing chunk given its current data. Callers
   * use a snapshot because World remains the authoritative mutable store.
   */
  requestRemesh(cx: number, cy: number, cz: number, chunkData: ChunkData): void {
    const key = chunkKey(cx, cy, cz);
    this.storeChunkForMeshing(key, chunkData);
    this.loadedChunkKeys.add(key);
    // InteractionSystem explicitly requests boundary neighbours after an
    // edit. Keep this method's original single-chunk contract so one edit
    // does not duplicate every neighbour job.
    this.postMeshChunk(key);
  }

  /** Remove a chunk from the mesher cache and refresh adjacent boundaries. */
  removeChunk(key: ChunkKey): void {
    if (this.destroyed) return;
    const request: RemoveChunkRequest = {
      type: 'REMOVE_CHUNK',
      payload: { key },
    };
    this.mesherWorker.postMessage(request);
    if (!this.loadedChunkKeys.delete(key)) return;

    const [cx, cy, cz] = key.split(',').map((part) => parseInt(part, 10));
    for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
      const neighborKey = chunkKey(cx + dx, cy + dy, cz + dz);
      if (this.loadedChunkKeys.has(neighborKey)) this.postMeshChunk(neighborKey);
    }
  }

  /** Clean up workers. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generatorWorker.terminate();
    this.mesherWorker.terminate();
    this.pendingRequests.clear();
    this.loadedChunkKeys.clear();
    this.initialBatch = null;
  }
}
