/**
 * Module: engine/systems/InteractionSystem
 * Purpose: Apply mining/placing based on input and current selection; trigger re-mesh
 * Callers: Engine constructs and updates this each frame; destroyed on stop()
 * Invariants: No React imports; interacts with World and ChunkPipeline only
 */

import type * as THREE from 'three';
import type { World } from '../world/World';
import { InputSystem } from './Input';
import { SelectionSystem } from './SelectionSystem';
 
import { addToInventory, getSelectedPlacementBlockId, consumeOneFromSelected } from '../../state/inventory';
import { CHUNK_SIZE, PLAYER } from '../../config/constants';
import { worldToChunk } from '../utils/coords';
import type { ChunkPipeline } from '../world/ChunkPipeline';

export class InteractionSystem {
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private input: InputSystem;
  private selection: SelectionSystem;
  private pipeline: ChunkPipeline;

  private readonly airId: number = 0;
  

  constructor(
    camera: THREE.PerspectiveCamera,
    world: World,
    input: InputSystem,
    selection: SelectionSystem,
    pipeline: ChunkPipeline
  ) {
    this.camera = camera;
    this.world = world;
    this.input = input;
    this.selection = selection;
    this.pipeline = pipeline;
  }

  update(): void {
    // Left click → mine
    if (this.input.consumeLeftClick()) {
      const sel = this.selection.getSelection();
      if (sel.hit && sel.hitCell) {
        const { x, y, z } = sel.hitCell;
        const blockId = this.world.getBlock(x, y, z);
        if (blockId !== this.airId) {
          this.world.setBlock(x, y, z, this.airId);
          // Add drop to inventory
          addToInventory(blockId, 1);
          this.remeshAffectedChunks(x, y, z);
        }
      }
    }

    // Right click → place
    if (this.input.consumeRightClick()) {
      const sel = this.selection.getSelection();
      if (sel.hit && sel.placeCell) {
        const { x, y, z } = sel.placeCell;
        const permission = this.evaluatePlacement(x, y, z);
        if (permission.canPlace) {
          const placeId = getSelectedPlacementBlockId();
          if (placeId !== null && consumeOneFromSelected()) {
            if (permission.elevatePlayer) {
              // Move player up by exactly one block before placing
              this.camera.position.y += 1;
            }
            this.world.setBlock(x, y, z, placeId);
            this.remeshAffectedChunks(x, y, z);
          }
        }
      }
    }
  }

  private remeshAffectedChunks(worldX: number, worldY: number, worldZ: number): void {
    const { cx, cy, cz, lx, ly, lz } = worldToChunk(worldX, worldY, worldZ);

    const chunk = this.world.getChunk(cx, cy, cz);
    if (chunk) {
      this.pipeline.requestRemesh(cx, cy, cz, chunk.getData());
    }

    // Neighbor checks for boundaries
    const neighbors: Array<[number, number, number]> = [];
    if (lx === 0) neighbors.push([cx - 1, cy, cz]);
    if (lx === CHUNK_SIZE.x - 1) neighbors.push([cx + 1, cy, cz]);
    if (ly === 0) neighbors.push([cx, cy - 1, cz]);
    if (ly === CHUNK_SIZE.y - 1) neighbors.push([cx, cy + 1, cz]);
    if (lz === 0) neighbors.push([cx, cy, cz - 1]);
    if (lz === CHUNK_SIZE.z - 1) neighbors.push([cx, cy, cz + 1]);

    for (const [ncx, ncy, ncz] of neighbors) {
      const n = this.world.getChunk(ncx, ncy, ncz);
      if (n) {
        this.pipeline.requestRemesh(ncx, ncy, ncz, n.getData());
      }
    }
  }

  /**
   * Evaluate if a block can be placed at (x,y,z).
   * General rule: do not allow placement that intersects player's current AABB.
   * Exception: allow placing directly under the player if there is one-block headroom,
   * moving the player up by one block before placement.
   */
  private evaluatePlacement(x: number, y: number, z: number): { canPlace: boolean; elevatePlayer: boolean } {
    // Must be empty cell
    if (this.world.getBlock(x, y, z) !== this.airId) {
      return { canPlace: false, elevatePlayer: false };
    }

    // Compute player AABB from camera position and PLAYER dimensions
    const halfWidth = PLAYER.width / 2;
    const eyeHeight = Math.min(PLAYER.height * 0.9, PLAYER.height - 0.1);
    const cam = this.camera.position;
    const playerMinX = cam.x - halfWidth;
    const playerMaxX = cam.x + halfWidth;
    const playerMinY = cam.y - eyeHeight;
    const playerMaxY = playerMinY + PLAYER.height;
    const playerMinZ = cam.z - halfWidth;
    const playerMaxZ = cam.z + halfWidth;

    const blockMinX = x;
    const blockMaxX = x + 1;
    const blockMinY = y;
    const blockMaxY = y + 1;
    const blockMinZ = z;
    const blockMaxZ = z + 1;

    const EPS = 1e-5;
    const separated =
      playerMaxX <= blockMinX + EPS || playerMinX >= blockMaxX - EPS ||
      playerMaxY <= blockMinY + EPS || playerMinY >= blockMaxY - EPS ||
      playerMaxZ <= blockMinZ + EPS || playerMinZ >= blockMaxZ - EPS;

    if (separated) {
      return { canPlace: true, elevatePlayer: false };
    }

    // Intersects player; check underfoot exception
    const baseY = playerMinY;
    const underfootY = Math.floor(baseY);
    const isUnderfootCell = y === underfootY;

    // Require block center to be within player's footprint to avoid front/side placements elevating
    const centerX = x + 0.5;
    const centerZ = z + 0.5;
    const centerInsideFootprint = centerX > playerMinX + EPS && centerX < playerMaxX - EPS &&
                                  centerZ > playerMinZ + EPS && centerZ < playerMaxZ - EPS;

    if (isUnderfootCell && centerInsideFootprint) {
      // Test one-block upward headroom for the player's AABB
      const newBaseY = baseY + 1;
      const newMinY = newBaseY;
      const newMaxY = newMinY + PLAYER.height;
      if (!this.aabbIntersectsSolid(playerMinX, newMinY, playerMinZ, playerMaxX, newMaxY, playerMaxZ)) {
        return { canPlace: true, elevatePlayer: true };
      }
    }

    return { canPlace: false, elevatePlayer: false };
  }

  /** Test if an AABB intersects any solid blocks in the world */
  private aabbIntersectsSolid(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const ix0 = Math.floor(minX);
    const iy0 = Math.floor(minY);
    const iz0 = Math.floor(minZ);
    const ix1 = Math.floor(maxX);
    const iy1 = Math.floor(maxY);
    const iz1 = Math.floor(maxZ);

    for (let y = iy0; y <= iy1; y++) {
      for (let z = iz0; z <= iz1; z++) {
        for (let x = ix0; x <= ix1; x++) {
          if (this.world.isBlockSolid(x, y, z)) {
            return true;
          }
        }
      }
    }
    return false;
  }
}


