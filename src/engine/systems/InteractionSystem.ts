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
import { CHUNK_SIZE, PLAYER, SWING_CYCLE_SECONDS } from '../../config/constants';
import { WATER_LEVEL } from '../world/TerrainGenerator';
import { getBlockIdByName } from '../world/blocks/BlockRegistry';
import { worldToChunk } from '../utils/coords';
import type { ChunkPipeline } from '../world/ChunkPipeline';
import { PlayerController } from './PlayerController';

type WindowWithSfxHooks = Window & { __sfxBreak?: () => void; __sfxPlace?: () => void }

export class InteractionSystem {
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private input: InputSystem;
  private selection: SelectionSystem;
  private pipeline: ChunkPipeline;
  private playerController: PlayerController | null;

  private readonly airId: number = 0;
  private readonly waterId: number = getBlockIdByName('water') ?? 5;
  // Cached IDs for strike logic
  private readonly grassId: number = getBlockIdByName('grass') ?? 1;
  private readonly dirtId: number = getBlockIdByName('dirt') ?? 2;
  private readonly stoneId: number = getBlockIdByName('stone') ?? 3; // cobblestone faces
  private readonly sandId: number = getBlockIdByName('sand') ?? 4;
  private readonly woodId: number = getBlockIdByName('wood') ?? 6; // tree trunk
  private readonly leavesId: number = getBlockIdByName('leaves') ?? 7;
  // Track current strike progress for a targeted block
  private currentHit: { x: number; y: number; z: number; id: number; count: number } | null = null;
  // Global interaction cooldown matching arm swing pace (independent of animation)
  private nextActionAllowedAt: number = 0; // epoch seconds
  

  constructor(
    camera: THREE.PerspectiveCamera,
    world: World,
    input: InputSystem,
    selection: SelectionSystem,
    pipeline: ChunkPipeline,
    playerController?: PlayerController
  ) {
    this.camera = camera;
    this.world = world;
    this.input = input;
    this.selection = selection;
    this.pipeline = pipeline;
    this.playerController = playerController ?? null;
  }

  update(): void {
    const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

    // Left click → mine (honor cooldown)
    if (this.input.consumeLeftClick()) {
      if (nowSec < this.nextActionAllowedAt) {
        // Under cooldown: ignore action, but consume the click so it isn't queued
        // Do not advance strike counts
      } else {
        this.nextActionAllowedAt = nowSec + SWING_CYCLE_SECONDS;
        const sel = this.selection.getSelection();
        if (sel.hit && sel.hitCell) {
          const { x, y, z } = sel.hitCell;
          const blockId = this.world.getBlock(x, y, z);
          if (blockId !== this.airId) {
            // Increment or reset strike counter based on targeted cell and block id
            if (
              this.currentHit &&
              this.currentHit.x === x &&
              this.currentHit.y === y &&
              this.currentHit.z === z &&
              this.currentHit.id === blockId
            ) {
              this.currentHit.count += 1;
            } else {
              this.currentHit = { x, y, z, id: blockId, count: 1 };
            }

            const required = this.getRequiredStrikes(blockId);
            if (this.currentHit.count >= required) {
              // Only play break sound for solid blocks
              const wasSolid = this.world.isBlockSolid(x, y, z);
              if (wasSolid) {
                (window as WindowWithSfxHooks).__sfxBreak?.();
              }
              // Remove the block
              this.world.setBlock(x, y, z, this.airId);
              // Water surface edge-fill: if this cell is at water surface level, open to air above,
              // and adjacent to water at the same level, immediately fill with water.
              if (wasSolid && this.shouldFillWithWater(x, y, z)) {
                this.world.setBlock(x, y, z, this.waterId);
              }
              // Add drop to inventory
              addToInventory(blockId, 1);
              this.remeshAffectedChunks(x, y, z);
              // Reset strike progress after successful break
              this.currentHit = null;
            }
          }
        }
      }
    }

    // Right click → place (honor cooldown)
    if (this.input.consumeRightClick()) {
      if (nowSec < this.nextActionAllowedAt) {
        // Under cooldown: ignore action, but consume the click
      } else {
        this.nextActionAllowedAt = nowSec + SWING_CYCLE_SECONDS;
        const sel = this.selection.getSelection();
        if (sel.hit && sel.placeCell) {
          const { x, y, z } = sel.placeCell;
          const permission = this.evaluatePlacement(x, y, z);
          if (permission.canPlace) {
            const placeId = getSelectedPlacementBlockId();
            if (placeId !== null && consumeOneFromSelected()) {
              if (permission.elevatePlayer) {
                // Smooth visual step: start a short tween from old to new height
                this.camera.position.y += 1;
                this.playerController?.startElevationTween(1);
              }
              this.world.setBlock(x, y, z, placeId);
              this.remeshAffectedChunks(x, y, z);
              (window as WindowWithSfxHooks).__sfxPlace?.();
            }
          }
        }
      }
    }
  }

  /** Return required strikes to break a block id per simple rules */
  private getRequiredStrikes(id: number): number {
    // Leaves and grass: 1
    if (id === this.leavesId || id === this.grassId) return 1;
    // Dirt and sand: 2
    if (id === this.dirtId || id === this.sandId) return 2;
    // Cobblestone (stone id) and wood: 3
    if (id === this.stoneId || id === this.woodId) return 3;
    // All other blocks: 1 (unchanged)
    return 1;
  }

  /** Determine if breaking (x,y,z) should cause a water surface block to flow into this cell */
  private shouldFillWithWater(x: number, y: number, z: number): boolean {
    // Only at global surface level
    if (y !== WATER_LEVEL) return false;
    // If any 4-neighbors at same level are water, consider it an edge of water body
    const neighbors: Array<[number, number]> = [
      // 4-neighbors
      [1, 0], [-1, 0], [0, 1], [0, -1],
      // diagonals to be more forgiving at shoreline corners
      [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];
    for (const [dx, dz] of neighbors) {
      const nb = this.world.getBlock(x + dx, y, z + dz);
      if (nb === this.waterId) return true;
    }
    return false;
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
