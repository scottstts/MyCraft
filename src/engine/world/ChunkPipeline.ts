/**
 * ChunkPipeline - Orchestrates chunk generation and meshing via workers
 * Inputs: chunk coordinates, emits events when chunks are ready
 * Outputs: CHUNK_READY events with ChunkData
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { chunkKey } from '../utils/coords.js';
import type {
  WorkerResponse,
  ChunkKey,
  GenerateChunkRequest,
  ChunkDataResponse,
  MeshChunkRequest,
  ChunkMeshResponse
} from '../../types/workers.js';
import type { ChunkData, BlockDef } from '../../types/index.js';
import { isChunkDataResponse, isChunkMeshResponse } from '../../types/workers.js';
import type { AtlasConfig } from '../render/Atlas.js';

export interface ChunkPipelineEvents extends Record<string, unknown> {
  CHUNK_READY: { key: ChunkKey; chunkData: ChunkData };
  CHUNK_MESH: { key: ChunkKey; response: ChunkMeshResponse };
  WORKER_ERROR: { worker: 'generator' | 'mesher'; error: unknown };
}

export class ChunkPipeline extends EventEmitter<ChunkPipelineEvents> {
  private generatorWorker: Worker;
  private mesherWorker: Worker;
  private pendingRequests = new Set<ChunkKey>();
  private atlasConfig: AtlasConfig | null = null;
  private blockRegistry: BlockDef[] = [];
  private chunkDataMap: Map<ChunkKey, ChunkData> = new Map();
  private worldRadius: number | null = null;
  
  constructor() {
    super();
    
    // Create generator worker
    this.generatorWorker = new Worker(
      new URL('../workers/generator.worker.ts', import.meta.url),
      { type: 'module' }
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
    
    // Create mesher worker
    this.mesherWorker = new Worker(
      new URL('../workers/mesher.worker.ts', import.meta.url),
      { type: 'module' }
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
   * Ingest provided chunk data directly (bypass generator), then mesh and emit events.
   * Used when loading a saved world snapshot.
   */
  ingestChunkData(key: ChunkKey, chunkData: ChunkData): void {
    // Cache chunk data for neighbor-aware meshing
    this.chunkDataMap.set(key, chunkData);

    if (!this.atlasConfig) {
      throw new Error('[ChunkPipeline] Atlas config must be set before ingesting chunks');
    }

    // Mesh this chunk with neighbors if available
    const neighbors = this.buildNeighborsForKey(key);
    const meshRequest: MeshChunkRequest = {
      type: 'MESH_CHUNK',
      payload: {
        key,
        chunkData,
        atlasConfig: this.atlasConfig,
        blockRegistry: this.blockRegistry,
        neighbors,
      },
    };
    this.mesherWorker.postMessage(meshRequest);

    // Inform world about chunk data
    this.emit('CHUNK_READY', { key, chunkData });

    // Also request re-mesh for already-present neighbors to update shared faces
    const [cx, cy, cz] = key.split(',').map((s) => parseInt(s, 10));
    const neighborCoords: Array<[number, number, number]> = [
      [cx + 1, cy, cz],
      [cx - 1, cy, cz],
      [cx, cy + 1, cz],
      [cx, cy - 1, cz],
      [cx, cy, cz + 1],
      [cx, cy, cz - 1],
    ];
    for (const [nx, ny, nz] of neighborCoords) {
      const nKey = chunkKey(nx, ny, nz);
      const nData = this.chunkDataMap.get(nKey);
      if (nData) {
        const nNeighbors = this.buildNeighborsFor(nx, ny, nz);
        const remeshReq: MeshChunkRequest = {
          type: 'MESH_CHUNK',
          payload: {
            key: nKey,
            chunkData: nData,
            atlasConfig: this.atlasConfig,
            blockRegistry: this.blockRegistry,
            neighbors: nNeighbors,
          },
        };
        this.mesherWorker.postMessage(remeshReq);
      }
    }
  }
  
  /**
   * Set atlas configuration and block registry for meshing
   */
  setAtlasConfig(atlasConfig: AtlasConfig, blockRegistry: BlockDef[]): void {
    this.atlasConfig = atlasConfig;
    this.blockRegistry = blockRegistry;
  }

  /**
   * Set world radius for island generation
   */
  setWorldRadius(worldRadius: number): void {
    this.worldRadius = worldRadius;
  }
  
  /**
   * Request generation of a chunk
   */
  requestChunk(cx: number, cy: number, cz: number, seed: number): void {
    const key = chunkKey(cx, cy, cz);
    
    if (this.pendingRequests.has(key)) {
      return; // Already requested
    }
    
    this.pendingRequests.add(key);
    
    const request: GenerateChunkRequest = {
      type: 'GEN_CHUNK',
      payload: { 
        key, 
        cx, 
        cy, 
        cz, 
        seed,
        worldRadius: this.worldRadius || undefined
      }
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
    const { key, payload: chunkData } = response;
    this.pendingRequests.delete(key);

    // Cache chunk data for neighbor-aware meshing
    this.chunkDataMap.set(key, chunkData);

    // Send chunk data to mesher worker with atlas config, registry, and neighbors
    if (!this.atlasConfig) {
      throw new Error('[ChunkPipeline] Atlas config must be set before requesting chunks');
    }

    const neighbors = this.buildNeighborsForKey(key);
    const meshRequest: MeshChunkRequest = {
      type: 'MESH_CHUNK',
      payload: {
        key,
        chunkData,
        atlasConfig: this.atlasConfig,
        blockRegistry: this.blockRegistry,
        neighbors,
      },
    };
    this.mesherWorker.postMessage(meshRequest);

    // Also re-mesh any already-present neighbors to cull shared faces now that this chunk exists
    const [cx, cy, cz] = key.split(',').map((s) => parseInt(s, 10));
    const neighborCoords: Array<[number, number, number]> = [
      [cx + 1, cy, cz],
      [cx - 1, cy, cz],
      [cx, cy + 1, cz],
      [cx, cy - 1, cz],
      [cx, cy, cz + 1],
      [cx, cy, cz - 1],
    ];
    for (const [nx, ny, nz] of neighborCoords) {
      const nKey = chunkKey(nx, ny, nz);
      const nData = this.chunkDataMap.get(nKey);
      if (nData) {
        const nNeighbors = this.buildNeighborsFor(nx, ny, nz);
        const remeshReq: MeshChunkRequest = {
          type: 'MESH_CHUNK',
          payload: {
            key: nKey,
            chunkData: nData,
            atlasConfig: this.atlasConfig,
            blockRegistry: this.blockRegistry,
            neighbors: nNeighbors,
          },
        };
        this.mesherWorker.postMessage(remeshReq);
      }
    }

    // Inform world about chunk data
    this.emit('CHUNK_READY', { key, chunkData });
  }

  private buildNeighborsForKey(key: ChunkKey) {
    const [cx, cy, cz] = key.split(',').map((s) => parseInt(s, 10));
    return this.buildNeighborsFor(cx, cy, cz);
  }

  private buildNeighborsFor(cx: number, cy: number, cz: number) {
    return {
      posX: this.chunkDataMap.get(chunkKey(cx + 1, cy, cz)),
      negX: this.chunkDataMap.get(chunkKey(cx - 1, cy, cz)),
      posY: this.chunkDataMap.get(chunkKey(cx, cy + 1, cz)),
      negY: this.chunkDataMap.get(chunkKey(cx, cy - 1, cz)),
      posZ: this.chunkDataMap.get(chunkKey(cx, cy, cz + 1)),
      negZ: this.chunkDataMap.get(chunkKey(cx, cy, cz - 1)),
    } as const;
  }
  
  private handleChunkMeshResponse(response: ChunkMeshResponse): void {
    const { key } = response;
    
    this.emit('CHUNK_MESH', { key, response });
  }

  /**
   * Request a re-mesh for an existing chunk given its current data.
   * Callers: interaction systems after block edits.
   */
  requestRemesh(cx: number, cy: number, cz: number, chunkData: ChunkData): void {
    if (!this.atlasConfig) {
      throw new Error('[ChunkPipeline] Atlas config must be set before meshing');
    }
    const key = chunkKey(cx, cy, cz);
    this.chunkDataMap.set(key, chunkData);
    const neighbors = this.buildNeighborsFor(cx, cy, cz);
    const meshRequest: MeshChunkRequest = {
      type: 'MESH_CHUNK',
      payload: {
        key,
        chunkData,
        atlasConfig: this.atlasConfig,
        blockRegistry: this.blockRegistry,
        neighbors,
      },
    };
    this.mesherWorker.postMessage(meshRequest);
  }
  
  /**
   * Clean up workers
   */
  destroy(): void {
    this.generatorWorker.terminate();
    this.mesherWorker.terminate();
    this.pendingRequests.clear();
    this.chunkDataMap.clear();
  }
}
