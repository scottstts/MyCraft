/**
 * ChunkRenderer - Manages Three.js meshes for world chunks
 * Input: CHUNK_MESH events from ChunkPipeline
 * Output: Creates/updates Mesh objects in the scene
 */

import * as THREE from 'three';
import { EventEmitter } from '../utils/EventEmitter.js';
import type { ChunkKey, ChunkMeshResponse } from '../../types/workers.js';

export interface ChunkRendererEvents extends Record<string, unknown> {
  MESH_CREATED: { key: ChunkKey; mesh: THREE.Mesh };
  MESH_UPDATED: { key: ChunkKey; mesh: THREE.Mesh };
  MESH_REMOVED: { key: ChunkKey };
}

export class ChunkRenderer extends EventEmitter<ChunkRendererEvents> {
  private scene: THREE.Scene;
  private material: THREE.Material;
  private chunkMeshes: Map<ChunkKey, THREE.Mesh> = new Map();
  private chunkGroups: Map<ChunkKey, THREE.Group> = new Map();
  
  constructor(scene: THREE.Scene, material: THREE.Material) {
    super();
    this.scene = scene;
    this.material = material;
  }
  
  /**
   * Handle chunk mesh data from mesher worker
   */
  handleChunkMesh(response: ChunkMeshResponse): void {
    const { key, payload } = response;
    const { positions, normals, uvs, indices } = payload;
    
    // Remove existing mesh if it exists
    this.removeChunkMesh(key);
    
    // Skip creating mesh if no vertices
    if (positions.length === 0) {
      console.log(`[ChunkRenderer] Skipping empty mesh for chunk ${key}`);
      return;
    }
    
    // Create geometry from buffers
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    
    // Create mesh
    const mesh = new THREE.Mesh(geometry, this.material);
    
    // Parse chunk coordinates from key for positioning
    const [cxStr, cyStr, czStr] = key.split(',');
    const cx = parseInt(cxStr, 10);
    const cy = parseInt(cyStr, 10);
    const cz = parseInt(czStr, 10);
    
    // Position mesh at chunk world coordinates
    // Each chunk is CHUNK_SIZE units in size
    const CHUNK_SIZE = { x: 16, y: 64, z: 16 }; // TODO: Import from constants
    mesh.position.set(
      cx * CHUNK_SIZE.x,
      cy * CHUNK_SIZE.y,
      cz * CHUNK_SIZE.z
    );
    
    // Create group for chunk (for future organization)
    const group = new THREE.Group();
    group.add(mesh);
    group.position.copy(mesh.position);
    mesh.position.set(0, 0, 0); // Relative to group
    
    // Add to scene
    this.scene.add(group);
    
    // Store references
    this.chunkMeshes.set(key, mesh);
    this.chunkGroups.set(key, group);
    
    this.emit('MESH_CREATED', { key, mesh });
    
    console.log(`[ChunkRenderer] Created mesh for chunk ${key} with ${positions.length / 3} vertices`);
  }
  
  /**
   * Remove mesh for a chunk
   */
  removeChunkMesh(key: ChunkKey): void {
    const existingGroup = this.chunkGroups.get(key);
    const existingMesh = this.chunkMeshes.get(key);
    
    if (existingGroup) {
      this.scene.remove(existingGroup);
      
      // Dispose geometry and materials
      existingGroup.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          if (object.geometry) {
            object.geometry.dispose();
          }
          // Don't dispose material as it's shared
        }
      });
      
      this.chunkGroups.delete(key);
    }
    
    if (existingMesh) {
      this.chunkMeshes.delete(key);
      this.emit('MESH_REMOVED', { key });
    }
  }
  
  /**
   * Get mesh for a chunk
   */
  getChunkMesh(key: ChunkKey): THREE.Mesh | undefined {
    return this.chunkMeshes.get(key);
  }
  
  /**
   * Get all chunk keys that have meshes
   */
  getLoadedChunkKeys(): ChunkKey[] {
    return Array.from(this.chunkMeshes.keys());
  }
  
  /**
   * Get number of loaded meshes
   */
  getLoadedMeshCount(): number {
    return this.chunkMeshes.size;
  }
  
  /**
   * Clear all meshes
   */
  clear(): void {
    const keys = this.getLoadedChunkKeys();
    for (const key of keys) {
      this.removeChunkMesh(key);
    }
  }
  
  /**
   * Clean up resources
   */
  destroy(): void {
    this.clear();
  }
}