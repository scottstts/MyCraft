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
import type { ChunkData } from '../../types/index.js';
import { isChunkDataResponse, isChunkMeshResponse } from '../../types/workers.js';

export interface ChunkPipelineEvents extends Record<string, unknown> {
  CHUNK_READY: { key: ChunkKey; chunkData: ChunkData };
  CHUNK_MESH: { key: ChunkKey; response: ChunkMeshResponse };
}

export class ChunkPipeline extends EventEmitter<ChunkPipelineEvents> {
  private generatorWorker: Worker;
  private mesherWorker: Worker;
  private pendingRequests = new Set<ChunkKey>();
  
  constructor() {
    super();
    
    // Create generator worker
    this.generatorWorker = new Worker(
      new URL('../workers/generator.worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    this.generatorWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleWorkerResponse(event.data);
    };
    
    this.generatorWorker.onerror = (error) => {
      console.error('[ChunkPipeline] Generator worker error:', error);
    };
    
    // Create mesher worker
    this.mesherWorker = new Worker(
      new URL('../workers/mesher.worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    this.mesherWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleWorkerResponse(event.data);
    };
    
    this.mesherWorker.onerror = (error) => {
      console.error('[ChunkPipeline] Mesher worker error:', error);
    };
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
      payload: { key, cx, cy, cz, seed }
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
    
    // Send chunk data to mesher worker
    const meshRequest: MeshChunkRequest = {
      type: 'MESH_CHUNK',
      payload: { key, chunkData }
    };
    
    this.mesherWorker.postMessage(meshRequest);
    
    this.emit('CHUNK_READY', { key, chunkData });
  }
  
  private handleChunkMeshResponse(response: ChunkMeshResponse): void {
    const { key } = response;
    
    this.emit('CHUNK_MESH', { key, response });
  }
  
  /**
   * Clean up workers
   */
  destroy(): void {
    this.generatorWorker.terminate();
    this.mesherWorker.terminate();
    this.pendingRequests.clear();
  }
}