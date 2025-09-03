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
import { getBlockIdByName, getBlock } from '../world/blocks/BlockRegistry';
import { worldToChunk } from '../utils/coords';
import type { ChunkPipeline } from '../world/ChunkPipeline';
import { PlayerController } from './PlayerController';

type WindowWithSfxHooks = Window & { __sfxBreak?: () => void; __sfxPlace?: () => void }
type WindowWithBodyHooks = Window & { __bodyPrimary?: () => void; __bodySecondary?: () => void; __isBodySwingActive?: () => boolean }

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
  private readonly leavesMapleId: number = getBlockIdByName('leaves_maple') ?? 8;
  private readonly grassTuftId: number = getBlockIdByName('grass_tuft') ?? 9; // decorative grass
  // Track current strike progress for a targeted block
  private currentHit: { x: number; y: number; z: number; id: number; count: number } | null = null;
  // Global interaction cooldown matching arm swing pace (independent of animation)
  private nextActionAllowedAt: number = 0; // epoch seconds (used for RMB only)
  // Last time we actually started a swing (epoch seconds) for LMB cadence
  private lastSwingStartAt: number = 0;
  

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

    // Left mouse: mine while held or on click (cadence synced to swing start; no queuing)
    {
      const clicked = this.input.consumeLeftClick();
      const held = this.input.isLeftHeld?.() ?? false;
      if (clicked || held) {
        const bodyBusy = (window as WindowWithBodyHooks).__isBodySwingActive?.() ?? false;
        const canStart = !bodyBusy && (this.lastSwingStartAt === 0 || (nowSec - this.lastSwingStartAt) >= SWING_CYCLE_SECONDS);
        if (canStart) {
          // Start swing and record cadence timestamp
          (window as WindowWithBodyHooks).__bodyPrimary?.();
          this.lastSwingStartAt = nowSec;

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
                // Propagate water surface into newly connected cavities (mine shafts/tunnels)
                // When breaking a block at or below water level near a water body, flood the WATER_LEVEL plane
                // from nearby water into reachable air cells, forming a single-block-thin surface inside the shaft.
                this.propagateSurfaceWaterFromConnection(x, y, z);
                // Add drop to inventory
                addToInventory(blockId, 1);
                this.remeshAffectedChunks(x, y, z);
                // Reset strike progress after successful break
                this.currentHit = null;
              }
            }
          }
        } else {
          // Either on cooldown or body is still in the middle of a swing; do nothing
        }
      } else {
        // Not held: reset schedule so next press swings immediately
        this.lastSwingStartAt = 0;
      }
    }

    // Right click → place (honor cooldown; independent of LMB cadence)
    if (this.input.consumeRightClick()) {
      if (nowSec < this.nextActionAllowedAt) {
        // Under cooldown: ignore action, but consume the click
      } else {
        this.nextActionAllowedAt = nowSec + SWING_CYCLE_SECONDS;
        const sel = this.selection.getSelection();
        if (sel.hit && sel.placeCell) {
          const { x, y, z } = sel.placeCell;
          const placeId = getSelectedPlacementBlockId();
          const permission = this.evaluatePlacement(x, y, z, placeId ?? undefined);
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
    if (id === this.leavesId || id === this.leavesMapleId || id === this.grassId || id === this.grassTuftId) return 1;
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

  /**
   * Flood-fill water surface blocks at y=WATER_LEVEL from nearby existing water into reachable air cells.
   * This simulates water entering a newly opened mine shaft: the interior becomes underwater up to the surface,
   * and a single-block-thin sheet of water appears at the shaft entrance at WATER_LEVEL.
   */
  private propagateSurfaceWaterFromConnection(bx: number, by: number, bz: number): void {
    // Only relevant when the break is near or below the water surface
    if (by > WATER_LEVEL + 1) return;

    const WL = WATER_LEVEL;
    const AIR = this.airId;
    const WATER = this.waterId;

    // Bounds around the break to constrain search
    const FILL_RADIUS = 64;
    const minX = bx - FILL_RADIUS;
    const maxX = bx + FILL_RADIUS;
    const minZ = bz - FILL_RADIUS;
    const maxZ = bz + FILL_RADIUS;

    // Step 1: 3D connectivity check from the break through passable cells (AIR or WATER) at/below WL.
    const key3 = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const q3: Array<{x: number; y: number; z: number}> = [];
    const vis3 = new Set<string>();
    const visitedAir: Array<{x: number; y: number; z: number}> = [];
    const seenCols = new Set<string>();
    let connectedToWater = false;

    const tryPush = (x: number, y: number, z: number) => {
      if (y < 0 || y > WL) return;
      if (x < minX || x > maxX || z < minZ || z > maxZ) return;
      const k = key3(x, y, z);
      if (vis3.has(k)) return;
      // Passable if not solid (AIR or WATER)
      if (this.world.isBlockSolid(x, y, z)) return;
      vis3.add(k);
      q3.push({ x, y, z });
    };

    // Start from the broken cell (now AIR) and its neighbors
    tryPush(bx, Math.min(by, WL), bz);
    tryPush(bx + 1, Math.min(by, WL), bz);
    tryPush(bx - 1, Math.min(by, WL), bz);
    tryPush(bx, Math.min(by, WL), bz + 1);
    tryPush(bx, Math.min(by, WL), bz - 1);
    tryPush(bx, Math.min(by + 1, WL), bz);
    tryPush(bx, Math.max(by - 1, 0), bz);

    const MAX_3D = 120000; // safety cap
    while (q3.length > 0 && vis3.size <= MAX_3D) {
      const cur = q3.shift()!;
      const id = this.world.getBlock(cur.x, cur.y, cur.z);
      if (id === WATER) connectedToWater = true;
      else if (id === AIR) {
        visitedAir.push(cur);
        seenCols.add(`${cur.x},${cur.z}`);
      }
      // 6-neighbors
      tryPush(cur.x + 1, cur.y, cur.z);
      tryPush(cur.x - 1, cur.y, cur.z);
      tryPush(cur.x, cur.y, cur.z + 1);
      tryPush(cur.x, cur.y, cur.z - 1);
      tryPush(cur.x, cur.y + 1, cur.z);
      tryPush(cur.x, cur.y - 1, cur.z);
    }

    if (!connectedToWater) {
      // No connectivity discovered under WL within bounds; nothing to do
      return;
    }

    // Step 2: Mark the entire connected air volume as flooded-air
    if (visitedAir.length > 0) {
      this.world.addFloodedAir(visitedAir);
    }

    // Step 3: Ensure a one-block-thin water surface exists at WL for every visited column
    const surfacePlaced: Array<{x: number; y: number; z: number}> = [];
    for (const col of seenCols) {
      const [xs, zs] = col.split(',');
      const x = parseInt(xs, 10); const z = parseInt(zs, 10);
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const idWL = this.world.getBlock(x, WL, z);
      if (idWL === AIR) {
        this.world.setBlock(x, WL, z, WATER);
        surfacePlaced.push({ x, y: WL, z });
      }
    }

    // Request remesh for newly placed surface water blocks
    if (surfacePlaced.length > 0) {
      const touched2 = new Set<string>();
      for (const s of surfacePlaced) {
        const { cx, cy, cz } = worldToChunk(s.x, s.y, s.z);
        touched2.add(`${cx},${cy},${cz}`);
      }
      for (const k of touched2) {
        const [cx, cy, cz] = k.split(',').map(n => parseInt(n, 10));
        const chunk = this.world.getChunk(cx, cy, cz);
        if (chunk) this.pipeline.requestRemesh(cx, cy, cz, chunk.getData());
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
  private evaluatePlacement(x: number, y: number, z: number, placeId?: number): { canPlace: boolean; elevatePlayer: boolean } {
    // Must be empty cell
    if (this.world.getBlock(x, y, z) !== this.airId) {
      return { canPlace: false, elevatePlayer: false };
    }

    // Special rule: placing decorative grass tufts only allowed on top of grass blocks
    if (placeId === this.grassTuftId) {
      const belowId = this.world.getBlock(x, y - 1, z);
      if (belowId !== this.grassId) return { canPlace: false, elevatePlayer: false };
      // Decorative and non-solid → ignore player intersection tests
      return { canPlace: true, elevatePlayer: false };
    }

    // New rule: disallow placing a solid block or a grass block directly on top of a grass tuft
    // i.e., if the cell immediately below the placement cell contains a decorative grass tuft
    if (placeId !== undefined) {
      const belowId = this.world.getBlock(x, y - 1, z);
      if (belowId === this.grassTuftId) {
        const def = getBlock(placeId);
        const isSolid = !!def?.solid;
        const isGrassBlock = placeId === this.grassId;
        if (isSolid || isGrassBlock) {
          return { canPlace: false, elevatePlayer: false };
        }
      }
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
