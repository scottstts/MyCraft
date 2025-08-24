/**
 * Module: engine/systems/SelectionSystem
 * Purpose: Update voxel selection by raycasting from camera; draw debug wireframe box
 * Callers: Engine constructs and updates this each frame; destroyed on stop()
 * Invariants: No React imports; lightweight Three.js debug mesh only
 */

import * as THREE from 'three';
import type { World } from '../world/World';
import { raycastVoxels } from '../utils/raycast';
import { INTERACTION } from '../../config/constants';

export interface SelectionResult {
  hit: boolean;
  hitCell?: { x: number; y: number; z: number };
  placeCell?: { x: number; y: number; z: number };
}

export class SelectionSystem {
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private scene: THREE.Scene;

  private readonly reach: number = INTERACTION.reach;
  private selection: SelectionResult = { hit: false };

  // Debug visualization
  private boxMesh: THREE.LineSegments | null = null;

  constructor(camera: THREE.PerspectiveCamera, world: World, scene: THREE.Scene) {
    this.camera = camera;
    this.world = world;
    this.scene = scene;

    this.boxMesh = this.createWireBox();
    this.boxMesh.visible = false;
    this.scene.add(this.boxMesh);
  }

  update(): void {
    // Compute forward direction from camera
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation).normalize();
    const origin = this.camera.position;

    const hit = raycastVoxels(this.world, origin, dir, this.reach);
    this.selection = {
      hit: hit.hit,
      hitCell: hit.hitCell,
      placeCell: hit.placeCell,
    };

    this.updateDebugMesh();
  }

  getSelection(): SelectionResult {
    return this.selection;
  }

  destroy(): void {
    if (this.boxMesh) {
      this.scene.remove(this.boxMesh);
      this.boxMesh.geometry.dispose();
      (this.boxMesh.material as THREE.Material).dispose();
      this.boxMesh = null;
    }
  }

  private updateDebugMesh(): void {
    if (!this.boxMesh) return;
    if (!this.selection.hit || !this.selection.hitCell) {
      this.boxMesh.visible = false;
      return;
    }
    const { x, y, z } = this.selection.hitCell;
    this.boxMesh.visible = true;
    this.boxMesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  }

  private createWireBox(): THREE.LineSegments {
    const geom = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.0001, 1.0001, 1.0001));
    const mat = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const lines = new THREE.LineSegments(geom, mat);
    lines.renderOrder = 9999;
    return lines;
  }
}


