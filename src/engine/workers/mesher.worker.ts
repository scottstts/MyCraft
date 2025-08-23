/**
 * Mesher Worker - Creates mesh data from chunk voxels
 * Input: ChunkData + block registry
 * Output: Mesh buffers (positions, normals, uvs, indices) - empty for now
 */

import type { 
  WorkerRequest, 
  MeshChunkRequest,
  ChunkMeshResponse
} from '../../types/workers.js';
import { isMeshChunkRequest } from '../../types/workers.js';

// Handle messages from main thread
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  
  if (isMeshChunkRequest(request)) {
    handleMeshChunk(request);
  } else {
    console.warn('[MesherWorker] Unknown request type:', request);
  }
};

function handleMeshChunk(request: MeshChunkRequest): void {
  const { key } = request.payload;
  
  // Create empty mesh buffers for now
  // Real meshing will be implemented later
  const positions = new Float32Array(0);
  const normals = new Float32Array(0);
  const uvs = new Float32Array(0);
  const indices = new Uint32Array(0);
  
  const response: ChunkMeshResponse = {
    type: 'CHUNK_MESH',
    key: key,
    payload: {
      positions,
      normals,
      uvs,
      indices
    }
  };
  
  // Transfer the buffers for performance
  (self as any).postMessage(response, { 
    transfer: [
      positions.buffer, 
      normals.buffer, 
      uvs.buffer, 
      indices.buffer
    ] 
  });
}