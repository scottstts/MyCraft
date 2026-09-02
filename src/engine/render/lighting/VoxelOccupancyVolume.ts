/**
 * GPU occupancy representation for the voxel sun-shadow path.
 *
 * The renderer does not derive shadows from a rasterized light camera. This
 * volume is the authoritative caster representation for opaque blocks and
 * alpha-shaped casters. The world-sized R8 integer field packs opaque, leaf,
 * and grass flags into bits 0..2, so the shader can fetch one discrete texel
 * for all three tests. A 32³ macro-brick hierarchy sits above the existing 8³
 * bricks and lets the shader skip four brick widths at a time before falling
 * back to individual-voxel DDA. Dense leaf-only bricks additionally carry a
 * density estimate so the shadow shader can integrate the whole porous brick
 * in one step instead of visiting every leaf voxel.
 */

import * as THREE from 'three';
import type { ChunkKey } from '../../../types/workers.js';
import type { BlockId } from '../../../types/index.js';
import { CHUNK_SIZE } from '../../../config/constants.js';
import { getBlockRegistry } from '../../world/blocks/BlockRegistry.js';
import type { Chunk } from '../../world/chunk/Chunk.js';

export interface VoxelVolumeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface VoxelVolumeDiagnostics {
  origin: { x: number; y: number; z: number };
  dimensions: { x: number; y: number; z: number };
  brickDimensions: { x: number; y: number; z: number };
  macroBrickDimensions: { x: number; y: number; z: number };
  brickSize: number;
  macroBrickSize: number;
  loadedChunks: number;
  opaqueVoxels: number;
  leafVoxels: number;
  grassTufts: number;
  seaweedAnchors: number;
  textureBytes: number;
  brickTextureBytes: number;
  brickDetailTextureBytes: number;
  leafBrickTextureBytes: number;
  macroBrickTextureBytes: number;
  seaweedTextureBytes: number;
  /** Number of full brick reductions performed; runtime edits should not add to it. */
  fullBrickRebuilds: number;
}

export const VOXEL_SHADOW_BRICK_SIZE = 8;
export const VOXEL_SHADOW_MACRO_BRICK_SIZE = 32;
export const VOXEL_CASTER_OPAQUE_BIT = 1;
export const VOXEL_CASTER_LEAF_BIT = 2;
export const VOXEL_CASTER_GRASS_BIT = 4;
/** Maximum seaweed height representable by the compact shadow field. */
export const SEAWEED_SHADOW_HEIGHT_MAX = 8;

export interface SeaweedShadowAnchor {
  x: number;
  z: number;
  rootY: number;
  height: number;
}

function positiveDimension(min: number, max: number, name: string): number {
  const dimension = Math.round(max - min);
  if (!Number.isFinite(dimension) || dimension <= 0) {
    throw new Error(`[VoxelOccupancyVolume] Invalid ${name} bounds: ${min}..${max}`);
  }
  return dimension;
}

function parseChunkKey(key: ChunkKey): { cx: number; cy: number; cz: number } {
  const parts = key.split(',').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error(`[VoxelOccupancyVolume] Invalid chunk key: ${key}`);
  }
  return { cx: parts[0], cy: parts[1], cz: parts[2] };
}

/**
 * Keeps CPU occupancy authoritative and mirrors it to nearest-filtered 3D
 * textures.  Updates are chunk/block targeted; the GPU upload is coalesced by
 * Three.js through needsUpdate and never depends on the sun/camera transform.
 */
export class VoxelOccupancyVolume {
  readonly origin: THREE.Vector3;
  readonly dimensions: THREE.Vector3;
  readonly brickDimensions: THREE.Vector3;
  readonly macroBrickDimensions: THREE.Vector3;
  /** Packed opaque/leaf/grass flags; bit 0/1/2 respectively. */
  readonly texture: THREE.Data3DTexture;
  readonly casterFlagsTexture: THREE.Data3DTexture;
  readonly brickTexture: THREE.Data3DTexture;
  readonly macroBrickTexture: THREE.Data3DTexture;
  /** Non-zero when a brick contains a solid or analytic non-leaf caster. */
  readonly brickDetailTexture: THREE.Data3DTexture;
  /** Leaf occupancy fraction per brick, encoded as an 8-bit value. */
  readonly leafBrickTexture: THREE.Data3DTexture;
  /** One RGBA texel per world XZ cell containing the seaweed shadow proxy. */
  readonly seaweedTexture: THREE.DataTexture;

  private readonly width: number;
  private readonly height: number;
  private readonly depth: number;
  private readonly brickWidth: number;
  private readonly brickHeight: number;
  private readonly brickDepth: number;
  private readonly macroBrickWidth: number;
  private readonly macroBrickHeight: number;
  private readonly macroBrickDepth: number;
  private readonly casterFlags: Uint8Array;
  private readonly brickOccupancy: Uint8Array;
  private readonly brickDetailOccupancy: Uint8Array;
  private readonly leafBrickDensity: Uint8Array;
  private readonly brickCellCounts: Uint16Array;
  private readonly opaqueBrickCounts: Uint16Array;
  private readonly leafBrickCounts: Uint16Array;
  private readonly grassBrickCounts: Uint16Array;
  private readonly seaweedBrickCounts: Uint16Array;
  private readonly macroBrickOccupancy: Uint8Array;
  private readonly macroBrickCounts: Uint16Array;
  private readonly seaweedOccupancy: Uint8Array;
  private readonly opaqueById = new Uint8Array(256);
  private readonly leafById = new Uint8Array(256);
  private readonly grassTuftId: BlockId;
  private readonly loadedChunkKeys = new Set<ChunkKey>();
  private opaqueVoxelCount = 0;
  private leafVoxelCount = 0;
  private grassTuftCount = 0;
  private seaweedAnchorCount = 0;
  private bulkUpdateDepth = 0;
  private fullBrickRebuilds = 0;
  private seaweedTextureDirty = false;
  private readonly seaweedShadowAnchors: Array<{
    cellX: number;
    cellZ: number;
    rootY: number;
    height: number;
  }> = [];

  constructor(bounds: VoxelVolumeBounds) {
    this.origin = new THREE.Vector3(bounds.minX, bounds.minY, bounds.minZ);
    this.width = positiveDimension(bounds.minX, bounds.maxX, 'X');
    this.height = positiveDimension(bounds.minY, bounds.maxY, 'Y');
    this.depth = positiveDimension(bounds.minZ, bounds.maxZ, 'Z');
    this.dimensions = new THREE.Vector3(this.width, this.height, this.depth);

    this.brickWidth = Math.ceil(this.width / VOXEL_SHADOW_BRICK_SIZE);
    this.brickHeight = Math.ceil(this.height / VOXEL_SHADOW_BRICK_SIZE);
    this.brickDepth = Math.ceil(this.depth / VOXEL_SHADOW_BRICK_SIZE);
    this.brickDimensions = new THREE.Vector3(this.brickWidth, this.brickHeight, this.brickDepth);

    this.macroBrickWidth = Math.ceil(this.width / VOXEL_SHADOW_MACRO_BRICK_SIZE);
    this.macroBrickHeight = Math.ceil(this.height / VOXEL_SHADOW_MACRO_BRICK_SIZE);
    this.macroBrickDepth = Math.ceil(this.depth / VOXEL_SHADOW_MACRO_BRICK_SIZE);
    this.macroBrickDimensions = new THREE.Vector3(
      this.macroBrickWidth,
      this.macroBrickHeight,
      this.macroBrickDepth,
    );

    this.casterFlags = new Uint8Array(this.width * this.height * this.depth);
    this.brickOccupancy = new Uint8Array(this.brickWidth * this.brickHeight * this.brickDepth);
    this.brickDetailOccupancy = new Uint8Array(this.brickWidth * this.brickHeight * this.brickDepth);
    this.leafBrickDensity = new Uint8Array(this.brickWidth * this.brickHeight * this.brickDepth);
    this.brickCellCounts = new Uint16Array(this.brickOccupancy.length);
    this.opaqueBrickCounts = new Uint16Array(this.brickOccupancy.length);
    this.leafBrickCounts = new Uint16Array(this.brickOccupancy.length);
    this.grassBrickCounts = new Uint16Array(this.brickOccupancy.length);
    this.seaweedBrickCounts = new Uint16Array(this.brickOccupancy.length);
    this.macroBrickOccupancy = new Uint8Array(this.macroBrickWidth * this.macroBrickHeight * this.macroBrickDepth);
    this.macroBrickCounts = new Uint16Array(this.macroBrickOccupancy.length);
    this.seaweedOccupancy = new Uint8Array(this.width * this.depth * 4);

    const registry = getBlockRegistry();
    this.grassTuftId = (registry.getAllBlocks().find((block) => block.name === 'grass_tuft')?.id ?? 9) as BlockId;
    for (const block of registry.getAllBlocks()) {
      this.opaqueById[block.id as number] = block.opaque ? 255 : 0;
      this.leafById[block.id as number] = block.name === 'leaves' || block.name === 'leaves_maple' ? 255 : 0;
    }

    this.texture = this.createTexture(this.casterFlags, this.width, this.height, this.depth, true);
    this.casterFlagsTexture = this.texture;
    this.brickTexture = this.createTexture(
      this.brickOccupancy,
      this.brickWidth,
      this.brickHeight,
      this.brickDepth,
      true,
    );
    this.macroBrickTexture = this.createTexture(
      this.macroBrickOccupancy,
      this.macroBrickWidth,
      this.macroBrickHeight,
      this.macroBrickDepth,
      true,
    );
    this.brickDetailTexture = this.createTexture(
      this.brickDetailOccupancy,
      this.brickWidth,
      this.brickHeight,
      this.brickDepth,
      true,
    );
    this.leafBrickTexture = this.createTexture(
      this.leafBrickDensity,
      this.brickWidth,
      this.brickHeight,
      this.brickDepth,
      false,
    );
    // Density is a low-frequency integration field, not categorical
    // occupancy. Trilinear sampling prevents adjacent 8³ canopy summaries
    // from projecting their brick boundaries onto nearby receivers.
    this.leafBrickTexture.minFilter = THREE.LinearFilter;
    this.leafBrickTexture.magFilter = THREE.LinearFilter;
    this.seaweedTexture = this.createSeaweedTexture();

    for (let brickZ = 0; brickZ < this.brickDepth; brickZ += 1) {
      const cellsZ = Math.min(VOXEL_SHADOW_BRICK_SIZE, this.depth - brickZ * VOXEL_SHADOW_BRICK_SIZE);
      for (let brickY = 0; brickY < this.brickHeight; brickY += 1) {
        const cellsY = Math.min(VOXEL_SHADOW_BRICK_SIZE, this.height - brickY * VOXEL_SHADOW_BRICK_SIZE);
        for (let brickX = 0; brickX < this.brickWidth; brickX += 1) {
          const cellsX = Math.min(VOXEL_SHADOW_BRICK_SIZE, this.width - brickX * VOXEL_SHADOW_BRICK_SIZE);
          this.brickCellCounts[this.brickIndex(brickX, brickY, brickZ)] = cellsX * cellsY * cellsZ;
        }
      }
    }
  }

  private createTexture(
    data: Uint8Array,
    width: number,
    height: number,
    depth: number,
    integer = false,
  ): THREE.Data3DTexture {
    const texture = new THREE.Data3DTexture(data, width, height, depth);
    texture.format = integer ? THREE.RedIntegerFormat : THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private createSeaweedTexture(): THREE.DataTexture {
    const texture = new THREE.DataTexture(
      this.seaweedOccupancy,
      this.width,
      this.depth,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
  }

  private voxelIndex(x: number, y: number, z: number): number {
    return x + this.width * (y + this.height * z);
  }

  private brickIndex(x: number, y: number, z: number): number {
    return x + this.brickWidth * (y + this.brickHeight * z);
  }

  private macroBrickIndex(x: number, y: number, z: number): number {
    return x + this.macroBrickWidth * (y + this.macroBrickHeight * z);
  }

  private inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height && z >= 0 && z < this.depth;
  }

  private updateBrick(brickX: number, brickY: number, brickZ: number): void {
    if (brickX < 0 || brickX >= this.brickWidth ||
        brickY < 0 || brickY >= this.brickHeight ||
        brickZ < 0 || brickZ >= this.brickDepth) return;
    const index = this.brickIndex(brickX, brickY, brickZ);
    const hasSeaweed = this.seaweedBrickCounts[index] !== 0;
    const occupied = (
      this.opaqueBrickCounts[index] !== 0 ||
      this.leafBrickCounts[index] !== 0 ||
      this.grassBrickCounts[index] !== 0 ||
      hasSeaweed
    );
    const wasOccupied = this.brickOccupancy[index] !== 0;
    this.brickOccupancy[index] = occupied ? 255 : 0;
    this.brickDetailOccupancy[index] = (
      this.opaqueBrickCounts[index] !== 0 ||
      this.grassBrickCounts[index] !== 0 ||
      hasSeaweed
    ) ? 255 : 0;
    const leafCount = this.leafBrickCounts[index];
    this.leafBrickDensity[index] = leafCount === 0
      ? 0
      : Math.max(
        1,
        Math.min(255, Math.round((leafCount / Math.max(1, this.brickCellCounts[index])) * 255)),
      );

    if (wasOccupied !== occupied) {
      const macroIndex = this.macroBrickIndex(
        Math.floor(brickX * VOXEL_SHADOW_BRICK_SIZE / VOXEL_SHADOW_MACRO_BRICK_SIZE),
        Math.floor(brickY * VOXEL_SHADOW_BRICK_SIZE / VOXEL_SHADOW_MACRO_BRICK_SIZE),
        Math.floor(brickZ * VOXEL_SHADOW_BRICK_SIZE / VOXEL_SHADOW_MACRO_BRICK_SIZE),
      );
      this.macroBrickCounts[macroIndex] += occupied ? 1 : -1;
      this.macroBrickOccupancy[macroIndex] = this.macroBrickCounts[macroIndex] !== 0 ? 255 : 0;
    }
  }

  private setCell(x: number, y: number, z: number, opaque: boolean, leaf: boolean, grass: boolean): boolean {
    if (!this.inBounds(x, y, z)) return false;
    const index = this.voxelIndex(x, y, z);
    const previousFlags = this.casterFlags[index];
    const previousOpaque = (previousFlags & VOXEL_CASTER_OPAQUE_BIT) !== 0;
    const previousLeaf = (previousFlags & VOXEL_CASTER_LEAF_BIT) !== 0;
    const previousGrass = (previousFlags & VOXEL_CASTER_GRASS_BIT) !== 0;
    if (previousOpaque === opaque && previousLeaf === leaf && previousGrass === grass) return false;

    const brickIndex = this.brickIndex(
      Math.floor(x / VOXEL_SHADOW_BRICK_SIZE),
      Math.floor(y / VOXEL_SHADOW_BRICK_SIZE),
      Math.floor(z / VOXEL_SHADOW_BRICK_SIZE),
    );
    let nextFlags = 0;
    if (previousOpaque !== opaque) {
      if (opaque) nextFlags |= VOXEL_CASTER_OPAQUE_BIT;
      this.opaqueBrickCounts[brickIndex] += opaque ? 1 : -1;
      this.opaqueVoxelCount += opaque ? 1 : -1;
    }
    if (previousOpaque === opaque && previousOpaque) nextFlags |= VOXEL_CASTER_OPAQUE_BIT;
    if (previousLeaf !== leaf) {
      if (leaf) nextFlags |= VOXEL_CASTER_LEAF_BIT;
      this.leafBrickCounts[brickIndex] += leaf ? 1 : -1;
      this.leafVoxelCount += leaf ? 1 : -1;
    }
    if (previousLeaf === leaf && previousLeaf) nextFlags |= VOXEL_CASTER_LEAF_BIT;
    if (previousGrass !== grass) {
      if (grass) nextFlags |= VOXEL_CASTER_GRASS_BIT;
      this.grassBrickCounts[brickIndex] += grass ? 1 : -1;
      this.grassTuftCount += grass ? 1 : -1;
    }
    if (previousGrass === grass && previousGrass) nextFlags |= VOXEL_CASTER_GRASS_BIT;
    this.casterFlags[index] = nextFlags;
    if (this.bulkUpdateDepth === 0) this.updateBrick(
      Math.floor(x / VOXEL_SHADOW_BRICK_SIZE),
      Math.floor(y / VOXEL_SHADOW_BRICK_SIZE),
      Math.floor(z / VOXEL_SHADOW_BRICK_SIZE),
    );
    return true;
  }

  private rebuildBricks(): void {
    // Recompute the brick state from authoritative counts. Clearing the old
    // occupancy first is important because macro counts are rebuilt from the
    // occupied-brick transitions below; otherwise a brick that stayed
    // occupied across a seaweed-only rebuild would not increment its macro.
    this.brickOccupancy.fill(0);
    this.macroBrickOccupancy.fill(0);
    this.macroBrickCounts.fill(0);
    for (let index = 0; index < this.brickOccupancy.length; index += 1) {
      this.updateBrick(
        index % this.brickWidth,
        Math.floor(index / this.brickWidth) % this.brickHeight,
        Math.floor(index / (this.brickWidth * this.brickHeight)),
      );
    }
    this.fullBrickRebuilds += 1;
  }

  private rebuildSeaweedBrickCounts(): void {
    this.seaweedBrickCounts.fill(0);
    for (const anchor of this.seaweedShadowAnchors) {
      const minY = Math.max(0, Math.floor(anchor.rootY - this.origin.y));
      const maxY = Math.min(
        this.height - 1,
        Math.floor(anchor.rootY - this.origin.y + Math.max(anchor.height, 0) - 1e-4),
      );
      if (maxY < minY) continue;
      const brickX = Math.floor(anchor.cellX / VOXEL_SHADOW_BRICK_SIZE);
      const brickZ = Math.floor(anchor.cellZ / VOXEL_SHADOW_BRICK_SIZE);
      if (brickX < 0 || brickX >= this.brickWidth || brickZ < 0 || brickZ >= this.brickDepth) continue;
      for (let brickY = Math.floor(minY / VOXEL_SHADOW_BRICK_SIZE); brickY <= Math.floor(maxY / VOXEL_SHADOW_BRICK_SIZE); brickY += 1) {
        this.seaweedBrickCounts[this.brickIndex(brickX, brickY, brickZ)] += 1;
      }
    }
  }

  private markTexturesDirty(includeSeaweed = false): void {
    this.texture.needsUpdate = true;
    this.brickTexture.needsUpdate = true;
    this.macroBrickTexture.needsUpdate = true;
    this.brickDetailTexture.needsUpdate = true;
    this.leafBrickTexture.needsUpdate = true;
    if (includeSeaweed) this.seaweedTexture.needsUpdate = true;
  }

  /**
   * Replace the render-only seaweed caster field. The field is intentionally
   * separate from voxel and grass occupancy: seaweed cannot be mined, edited,
   * collided with, or serialized as a block.
   *
   * RGBA encoding per XZ cell:
   *   R/G = root X/Z fraction inside the cell
   *   B   = root Y normalized over the volume height
   *   A   = blade height normalized by SEAWEED_SHADOW_HEIGHT_MAX
   */
  setSeaweedAnchors(anchors: ReadonlyArray<SeaweedShadowAnchor>): void {
    this.seaweedTextureDirty = true;
    this.seaweedOccupancy.fill(0);
    this.seaweedShadowAnchors.length = 0;
    this.seaweedBrickCounts.fill(0);
    this.seaweedAnchorCount = 0;

    for (const anchor of anchors) {
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.z) ||
          !Number.isFinite(anchor.rootY) || !Number.isFinite(anchor.height) || anchor.height <= 0) {
        continue;
      }
      const localX = anchor.x - this.origin.x;
      const localZ = anchor.z - this.origin.z;
      const cellX = Math.floor(localX);
      const cellZ = Math.floor(localZ);
      if (cellX < 0 || cellX >= this.width || cellZ < 0 || cellZ >= this.depth) continue;

      const index = (cellZ * this.width + cellX) * 4;
      // The weighted Poisson field guarantees that roots do not share a cell.
      // Keep the first root if a caller supplies a malformed/overlapping field
      // so the sparse brick list and encoded texture remain one-to-one.
      if (this.seaweedOccupancy[index + 3] !== 0) continue;

      const rootY = THREE.MathUtils.clamp(anchor.rootY - this.origin.y, 0, this.height - 1e-4);
      const height = THREE.MathUtils.clamp(anchor.height, 0, SEAWEED_SHADOW_HEIGHT_MAX);
      this.seaweedOccupancy[index] = Math.round((localX - cellX) * 255);
      this.seaweedOccupancy[index + 1] = Math.round((localZ - cellZ) * 255);
      this.seaweedOccupancy[index + 2] = Math.round((rootY / Math.max(1, this.height)) * 255);
      this.seaweedOccupancy[index + 3] = Math.max(1, Math.round((height / SEAWEED_SHADOW_HEIGHT_MAX) * 255));
      this.seaweedShadowAnchors.push({ cellX, cellZ, rootY: anchor.rootY, height });
      this.seaweedAnchorCount += 1;

    }

    this.rebuildSeaweedBrickCounts();
    if (this.bulkUpdateDepth === 0) {
      this.rebuildBricks();
      this.seaweedTextureDirty = false;
      this.markTexturesDirty(true);
    }
  }

  /** Replace one full chunk's occupancy from its authoritative voxel array. */
  updateChunk(key: ChunkKey, chunk: Chunk): void {
    const { cx, cy, cz } = parseChunkKey(key);
    const baseX = cx * CHUNK_SIZE.x - this.origin.x;
    const baseY = cy * CHUNK_SIZE.y - this.origin.y;
    const baseZ = cz * CHUNK_SIZE.z - this.origin.z;
    const voxels = chunk.getVoxelsArray();

    for (let lz = 0; lz < CHUNK_SIZE.z; lz++) {
      for (let ly = 0; ly < CHUNK_SIZE.y; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE.x; lx++) {
          const sourceIndex = ly * (CHUNK_SIZE.x * CHUNK_SIZE.z) + lz * CHUNK_SIZE.x + lx;
          const blockId = voxels[sourceIndex] as BlockId;
          const leaf = this.leafById[blockId] !== 0;
          const opaque = this.opaqueById[blockId] !== 0 && !leaf;
          this.setCell(baseX + lx, baseY + ly, baseZ + lz, opaque, leaf, blockId === this.grassTuftId);
        }
      }
    }

    this.loadedChunkKeys.add(key);
    if (this.bulkUpdateDepth === 0) this.markTexturesDirty();
  }

  /** Clear one chunk when a world region is removed. */
  clearChunk(key: ChunkKey): void {
    const { cx, cy, cz } = parseChunkKey(key);
    const baseX = cx * CHUNK_SIZE.x - this.origin.x;
    const baseY = cy * CHUNK_SIZE.y - this.origin.y;
    const baseZ = cz * CHUNK_SIZE.z - this.origin.z;
    for (let lz = 0; lz < CHUNK_SIZE.z; lz++) {
      for (let ly = 0; ly < CHUNK_SIZE.y; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE.x; lx++) {
          this.setCell(baseX + lx, baseY + ly, baseZ + lz, false, false, false);
        }
      }
    }
    this.loadedChunkKeys.delete(key);
    if (this.bulkUpdateDepth === 0) this.markTexturesDirty();
  }

  /** Update a single edited voxel without rebuilding its entire chunk. */
  updateBlock(worldX: number, worldY: number, worldZ: number, blockId: BlockId): void {
    const x = Math.floor(worldX - this.origin.x);
    const y = Math.floor(worldY - this.origin.y);
    const z = Math.floor(worldZ - this.origin.z);
    const leaf = this.leafById[blockId] !== 0;
    const changed = this.setCell(x, y, z, this.opaqueById[blockId] !== 0 && !leaf, leaf, blockId === this.grassTuftId);
    if (changed && this.bulkUpdateDepth === 0) this.markTexturesDirty();
  }

  /** Defer brick reduction and GPU dirty commits while a known batch is ingested. */
  beginBulkUpdate(): void {
    this.bulkUpdateDepth += 1;
  }

  /** Commit one brick reduction and one texture dirty update for the batch. */
  finishBulkUpdate(): void {
    if (this.bulkUpdateDepth === 0) {
      throw new Error('[VoxelOccupancyVolume] finishBulkUpdate called without beginBulkUpdate');
    }
    this.bulkUpdateDepth -= 1;
    if (this.bulkUpdateDepth !== 0) return;
    const includeSeaweed = this.seaweedTextureDirty;
    this.seaweedTextureDirty = false;
    this.rebuildBricks();
    this.markTexturesDirty(includeSeaweed);
  }

  /** Rebuild from all currently loaded chunks (used by diagnostics/tests). */
  rebuild(chunks: Iterable<{ key: ChunkKey; chunk: Chunk }>): void {
    this.casterFlags.fill(0);
    this.brickOccupancy.fill(0);
    this.macroBrickOccupancy.fill(0);
    this.macroBrickCounts.fill(0);
    this.brickDetailOccupancy.fill(0);
    this.leafBrickDensity.fill(0);
    this.opaqueBrickCounts.fill(0);
    this.leafBrickCounts.fill(0);
    this.grassBrickCounts.fill(0);
    this.seaweedBrickCounts.fill(0);
    this.loadedChunkKeys.clear();
    this.opaqueVoxelCount = 0;
    this.leafVoxelCount = 0;
    this.grassTuftCount = 0;
    this.rebuildSeaweedBrickCounts();
    this.beginBulkUpdate();
    try {
      for (const entry of chunks) this.updateChunk(entry.key, entry.chunk);
    } finally {
      this.finishBulkUpdate();
    }
  }

  getDiagnostics(): VoxelVolumeDiagnostics {
    return {
      origin: { x: this.origin.x, y: this.origin.y, z: this.origin.z },
      dimensions: { x: this.width, y: this.height, z: this.depth },
      brickDimensions: { x: this.brickWidth, y: this.brickHeight, z: this.brickDepth },
      macroBrickDimensions: {
        x: this.macroBrickWidth,
        y: this.macroBrickHeight,
        z: this.macroBrickDepth,
      },
      brickSize: VOXEL_SHADOW_BRICK_SIZE,
      macroBrickSize: VOXEL_SHADOW_MACRO_BRICK_SIZE,
      loadedChunks: this.loadedChunkKeys.size,
      opaqueVoxels: this.opaqueVoxelCount,
      leafVoxels: this.leafVoxelCount,
      grassTufts: this.grassTuftCount,
      seaweedAnchors: this.seaweedAnchorCount,
      textureBytes: this.casterFlags.byteLength,
      brickTextureBytes: this.brickOccupancy.byteLength,
      brickDetailTextureBytes: this.brickDetailOccupancy.byteLength,
      leafBrickTextureBytes: this.leafBrickDensity.byteLength,
      macroBrickTextureBytes: this.macroBrickOccupancy.byteLength,
      seaweedTextureBytes: this.seaweedOccupancy.byteLength,
      fullBrickRebuilds: this.fullBrickRebuilds,
    };
  }

  dispose(): void {
    this.texture.dispose();
    this.brickTexture.dispose();
    this.macroBrickTexture.dispose();
    this.brickDetailTexture.dispose();
    this.leafBrickTexture.dispose();
    this.seaweedTexture.dispose();
  }
}
