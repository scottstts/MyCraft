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

export type InteractionOriginProvider = (target: THREE.Vector3) => THREE.Vector3;

export class SelectionSystem {
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private scene: THREE.Scene;
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  private readonly reach: number = INTERACTION.reach;
  private selection: SelectionResult = { hit: false };

  // Debug visualization
  private boxMesh: THREE.LineSegments | null = null;
  private readonly rayOrigin = new THREE.Vector3();
  private readonly rayDirection = new THREE.Vector3();
  private readonly interactionOrigin = new THREE.Vector3();
  private readonly hitPoint = new THREE.Vector3();
  private readonly interactionOriginProvider: InteractionOriginProvider | null;

  constructor(
    camera: THREE.PerspectiveCamera,
    world: World,
    scene: THREE.Scene,
    bounds?: { minX: number; maxX: number; minZ: number; maxZ: number },
    interactionOriginProvider?: InteractionOriginProvider,
  ) {
    this.camera = camera;
    this.world = world;
    this.scene = scene;
    if (bounds) this.bounds = bounds;
    this.interactionOriginProvider = interactionOriginProvider ?? null;

    this.boxMesh = this.createWireBox();
    this.boxMesh.visible = false;
    this.scene.add(this.boxMesh);
  }

  /**
   * Read the exact world-space ray through the viewport center. Selection and
   * gameplay both consume the resulting hit, so the reticle cannot disagree
   * with the block that an action affects.
   */
  getCenterRay(origin: THREE.Vector3, direction: THREE.Vector3): void {
    this.camera.updateMatrixWorld(true);
    this.camera.getWorldPosition(origin);
    this.camera.getWorldDirection(direction);
  }

  update(): void {
    // Derive the ray from the camera's actual world transform. This is the
    // exact center-of-viewport ray used by the screen crosshair, including the
    // third-person shoulder orbit and any camera parent transform.
    this.getCenterRay(this.rayOrigin, this.rayDirection);
    const dir = this.rayDirection;
    const origin = this.rayOrigin;

    // In first person the interaction origin is the camera, preserving the
    // original reach exactly. In third person the camera sits behind the
    // player, so extend only the search distance by that separation. The
    // actual hit surface is still required to lie within player reach below.
    const interactionOrigin = this.interactionOriginProvider
      ? this.interactionOriginProvider(this.interactionOrigin)
      : this.interactionOrigin.copy(origin);
    const searchDistance = this.reach + origin.distanceTo(interactionOrigin);
    const hit = raycastVoxels(this.world, origin, dir, searchDistance);

    if (hit.hit && hit.t !== undefined) {
      this.hitPoint.copy(dir).multiplyScalar(hit.t).add(origin);
      if (this.hitPoint.distanceToSquared(interactionOrigin) > this.reach * this.reach + 1e-6) {
        hit.hit = false;
        hit.hitCell = undefined;
        hit.placeCell = undefined;
      }
    }

    // If a world bounds rectangle is defined, suppress selection when hit is outside bounds
    let finalHit = hit.hit;
    let finalHitCell = hit.hitCell;
    let finalPlaceCell = hit.placeCell;
    if (this.bounds && hit.hit && hit.hitCell) {
      const { minX, maxX, minZ, maxZ } = this.bounds;
      const inside = hit.hitCell.x >= minX && hit.hitCell.x < maxX &&
                     hit.hitCell.z >= minZ && hit.hitCell.z < maxZ;
      if (!inside) {
        finalHit = false;
        finalHitCell = undefined;
        finalPlaceCell = undefined;
      }
    }

    this.selection = {
      hit: finalHit,
      hitCell: finalHitCell,
      placeCell: finalPlaceCell,
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
