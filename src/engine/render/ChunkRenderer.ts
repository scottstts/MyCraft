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

    // Reuse group/meshes if present to keep GPU buffers alive (better for WebGPU).
    let group = this.chunkGroups.get(key);
    if (!group) {
      group = new THREE.Group();
      this.chunkGroups.set(key, group);
      this.scene.add(group);
    }

    // Extract existing meshes (by material) before clearing.
    const existingOpaque = group.children.find(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.material === this.materialOpaque
    );
    const existingTransparent = group.children.find(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.material === this.materialTransparent
    );

    // Clear children but keep group and meshes referenced separately.
    group.clear();

    const upsertMesh = (
      buf: { positions: Float32Array; normals: Float32Array; uvs: Float32Array; ao: Float32Array; colors: Float32Array; indices: Uint16Array | Uint32Array },
      mesh: THREE.Mesh | null | undefined,
      mat: THREE.Material,
      isTransparent: boolean
    ): THREE.Mesh | null => {
      if (!buf.positions.length) return null;
      let target = mesh ?? null;
      if (!target) {
        const geometry = new THREE.BufferGeometry();
        target = new THREE.Mesh(geometry, mat);
      }
      const geometry = target.geometry as THREE.BufferGeometry;

      const ensureAttr = (name: string, itemSize: number, array: ArrayLike<number>) => {
        const existing = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
        if (existing && existing.array.length === array.length) {
          existing.set(array as ArrayLike<number>, 0);
          existing.needsUpdate = true;
        } else {
          geometry.setAttribute(name, new THREE.BufferAttribute(array as Float32Array | Uint16Array | Uint32Array, itemSize));
        }
      };

      ensureAttr('position', 3, buf.positions);
      // Native shadow rendering frustum-culls casters using geometry bounds.
      // These geometries are reused across remeshes, so invalidate cached
      // bounds after replacing the position buffer or a stale bound can make
      // an updated chunk disappear from the shadow pass.
      geometry.boundingSphere = null;
      geometry.boundingBox = null;
      ensureAttr('normal', 3, buf.normals);
      ensureAttr('uv', 2, buf.uvs);
      ensureAttr('ao', 1, buf.ao);
      if (buf.colors && buf.colors.length) {
        ensureAttr('color', 3, buf.colors);
      } else if (geometry.getAttribute('color')) {
        geometry.deleteAttribute('color');
      }

      const indexAttr = geometry.getIndex();
      if (indexAttr && indexAttr.array.length === buf.indices.length) {
        (indexAttr as THREE.BufferAttribute).set(buf.indices, 0);
        (indexAttr as THREE.BufferAttribute).needsUpdate = true;
      } else {
        geometry.setIndex(new THREE.BufferAttribute(buf.indices, 1));
      }

      target.castShadow = !isTransparent;
      target.receiveShadow = !isTransparent;
      // Use Three's renderer-owned depth material. The material's
      // `shadowSide` controls the caster winding, while native bias and VSM
      // filtering handle the receiver comparison without a second custom
      // depth path that can drift from the color material.
      target.customDepthMaterial = undefined;
      if (isTransparent) target.renderOrder = 2; // draw after opaque
      return target;
    };

    // Prefer reusing existing meshes to keep GPU buffers resident.
    const opaqueMesh = upsertMesh(opaque, existingOpaque, this.materialOpaque, false);
    const transparentMesh = upsertMesh(transparent, existingTransparent, this.materialTransparent, true);

    if (!opaqueMesh && !transparentMesh) {
      // Nothing to render for this chunk.
      this.removeChunkMesh(key);
      return;
    }

    // Parse chunk coordinates from key for positioning
    const [cxStr, cyStr, czStr] = key.split(',');
    const cx = parseInt(cxStr, 10);
    const cy = parseInt(cyStr, 10);
    const cz = parseInt(czStr, 10);

    group.position.set(
      cx * CHUNK_SIZE.x,
      cy * CHUNK_SIZE.y,
      cz * CHUNK_SIZE.z
    );

    if (opaqueMesh) { group.add(opaqueMesh); }
    if (transparentMesh) { group.add(transparentMesh); }
    if (opaqueMesh) opaqueMesh.position.set(0, 0, 0);
    if (transparentMesh) transparentMesh.position.set(0, 0, 0);

    // Store references (prefer opaque mesh)
    if (opaqueMesh) {
      this.chunkMeshes.set(key, opaqueMesh);
    } else if (transparentMesh) {
      this.chunkMeshes.set(key, transparentMesh);
    }

    this.emit('MESH_CREATED', { key, mesh: (opaqueMesh ?? transparentMesh)! });
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
