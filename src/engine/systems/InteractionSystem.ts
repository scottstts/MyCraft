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
import { getBlockIdByName } from '../world/blocks/BlockRegistry';
import { CHUNK_SIZE } from '../../config/constants';
import { worldToChunk } from '../utils/coords';
import type { ChunkPipeline } from '../world/ChunkPipeline';

export class InteractionSystem {
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private input: InputSystem;
  private selection: SelectionSystem;
  private pipeline: ChunkPipeline;

  private readonly airId: number = 0;
  private readonly defaultPlaceId: number;

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

    this.defaultPlaceId = getBlockIdByName('dirt') ?? 1;
  }

  update(): void {
    // Left click → mine
    if (this.input.consumeLeftClick()) {
      const sel = this.selection.getSelection();
      if (sel.hit && sel.hitCell) {
        const { x, y, z } = sel.hitCell;
        if (this.world.getBlock(x, y, z) !== this.airId) {
          this.world.setBlock(x, y, z, this.airId);
          this.remeshAffectedChunks(x, y, z);
        }
      }
    }

    // Right click → place
    if (this.input.consumeRightClick()) {
      const sel = this.selection.getSelection();
      if (sel.hit && sel.placeCell) {
        const { x, y, z } = sel.placeCell;
        if (this.world.getBlock(x, y, z) === this.airId) {
          this.world.setBlock(x, y, z, this.defaultPlaceId);
          this.remeshAffectedChunks(x, y, z);
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
}


