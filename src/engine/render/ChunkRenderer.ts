/**
 * ChunkRenderer - Manages Three.js meshes for world chunks
 * Input: CHUNK_MESH events from ChunkPipeline
 * Output: Creates/updates Mesh objects in the scene
 */

import * as THREE from 'three';
import { EventEmitter } from '../utils/EventEmitter.js';
import type { ChunkKey, ChunkMeshResponse } from '../../types/workers.js';
import { CHUNK_SIZE } from '../../config/constants.js';

export interface ChunkRendererEvents extends Record<string, unknown> {
  MESH_CREATED: { key: ChunkKey; mesh: THREE.Mesh };
  MESH_UPDATED: { key: ChunkKey; mesh: THREE.Mesh };
  MESH_REMOVED: { key: ChunkKey };
}

export class ChunkRenderer extends EventEmitter<ChunkRendererEvents> {
  private scene: THREE.Scene;
  private materialOpaque: THREE.Material;
  private materialTransparent: THREE.Material;
  private chunkMeshes: Map<ChunkKey, THREE.Mesh> = new Map();
  private chunkGroups: Map<ChunkKey, THREE.Group> = new Map();
  
  constructor(scene: THREE.Scene, materials: { opaque: THREE.Material; transparent: THREE.Material }) {
    super();
    this.scene = scene;
    this.materialOpaque = materials.opaque;
    this.materialTransparent = materials.transparent;
  }
  
  /**
   * Handle chunk mesh data from mesher worker
   */
  handleChunkMesh(response: ChunkMeshResponse): void {
    const { key, payload } = response;
    const { opaque, transparent } = payload;
    // Remove existing mesh if it exists
    this.removeChunkMesh(key);
    const group = new THREE.Group();

    const makeMesh = (buf: { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array | Uint32Array }, mat: THREE.Material, isTransparent: boolean): THREE.Mesh | null => {
      if (!buf.positions.length) return null;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(buf.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(buf.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(buf.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(buf.indices, 1));
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.castShadow = !isTransparent;
      mesh.receiveShadow = !isTransparent;
      if (isTransparent) mesh.renderOrder = 2; // draw after opaque
      return mesh;
    };

    const opaqueMesh = makeMesh(opaque, this.materialOpaque, false);
    const transparentMesh = makeMesh(transparent, this.materialTransparent, true);
    
    if (!opaqueMesh && !transparentMesh) {
      // nothing to add
      return;
    }
    
    // Parse chunk coordinates from key for positioning
    const [cxStr, cyStr, czStr] = key.split(',');
    const cx = parseInt(cxStr, 10);
    const cy = parseInt(cyStr, 10);
    const cz = parseInt(czStr, 10);
    
    // Position group at chunk world coordinates (meshes stay local at 0,0,0)
    // Each chunk is CHUNK_SIZE units in size
    group.position.set(
      cx * CHUNK_SIZE.x,
      cy * CHUNK_SIZE.y,
      cz * CHUNK_SIZE.z
    );
    
    if (opaqueMesh) { group.add(opaqueMesh); }
    if (transparentMesh) { group.add(transparentMesh); }
    // Ensure local positions are zero within the group
    if (opaqueMesh) opaqueMesh.position.set(0,0,0);
    if (transparentMesh) transparentMesh.position.set(0,0,0);
    
    // Add to scene
    this.scene.add(group);
    
    // Store references
    // Store primary mesh reference (prefer opaque)
    this.chunkMeshes.set(key, opaqueMesh ?? transparentMesh!);
    this.chunkGroups.set(key, group);
    
    this.emit('MESH_CREATED', { key, mesh: (opaqueMesh ?? transparentMesh)! });
    
    // console.log(`[ChunkRenderer] Created mesh for chunk ${key} with ${positions.length / 3} vertices`);
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
