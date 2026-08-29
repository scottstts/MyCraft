/**
 * GPU occupancy representation for the voxel sun-shadow path.
 *
 * The renderer does not derive shadows from a rasterized light camera.  This
 * volume is the authoritative caster representation for opaque blocks, with
 * a parallel grass-tuft occupancy texture for alpha-shaped billboard tests.
 * A coarse 8³ brick volume lets the shader skip large empty regions before
 * falling back to individual-voxel DDA.
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
  brickSize: number;
  loadedChunks: number;
  opaqueVoxels: number;
  grassTufts: number;
  textureBytes: number;
  brickTextureBytes: number;
}

export const VOXEL_SHADOW_BRICK_SIZE = 8;

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
  readonly texture: THREE.Data3DTexture;
  readonly brickTexture: THREE.Data3DTexture;
  readonly grassTexture: THREE.Data3DTexture;

  private readonly width: number;
  private readonly height: number;
  private readonly depth: number;
  private readonly brickWidth: number;
  private readonly brickHeight: number;
  private readonly brickDepth: number;
  private readonly occupancy: Uint8Array;
  private readonly brickOccupancy: Uint8Array;
  private readonly grassOccupancy: Uint8Array;
  private readonly opaqueById = new Uint8Array(256);
  private readonly grassTuftId: BlockId;
  private readonly loadedChunkKeys = new Set<ChunkKey>();
  private opaqueVoxelCount = 0;
  private grassTuftCount = 0;

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

    this.occupancy = new Uint8Array(this.width * this.height * this.depth);
    this.brickOccupancy = new Uint8Array(this.brickWidth * this.brickHeight * this.brickDepth);
    this.grassOccupancy = new Uint8Array(this.width * this.height * this.depth);

    const registry = getBlockRegistry();
    this.grassTuftId = (registry.getAllBlocks().find((block) => block.name === 'grass_tuft')?.id ?? 9) as BlockId;
    for (const block of registry.getAllBlocks()) {
      this.opaqueById[block.id as number] = block.opaque ? 255 : 0;
    }

    this.texture = this.createTexture(this.occupancy, this.width, this.height, this.depth);
    this.brickTexture = this.createTexture(this.brickOccupancy, this.brickWidth, this.brickHeight, this.brickDepth);
    this.grassTexture = this.createTexture(this.grassOccupancy, this.width, this.height, this.depth);
  }

  private createTexture(data: Uint8Array, width: number, height: number, depth: number): THREE.Data3DTexture {
    const texture = new THREE.Data3DTexture(data, width, height, depth);
    texture.format = THREE.RedFormat;
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

  private voxelIndex(x: number, y: number, z: number): number {
    return x + this.width * (y + this.height * z);
  }

  private brickIndex(x: number, y: number, z: number): number {
    return x + this.brickWidth * (y + this.brickHeight * z);
  }

  private inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height && z >= 0 && z < this.depth;
  }

  private setVoxel(x: number, y: number, z: number, opaque: boolean): void {
    if (!this.inBounds(x, y, z)) return;
    const index = this.voxelIndex(x, y, z);
    const previous = this.occupancy[index] !== 0;
    if (previous === opaque) return;
    this.occupancy[index] = opaque ? 255 : 0;
    this.opaqueVoxelCount += opaque ? 1 : -1;
  }

  private setGrassVoxel(x: number, y: number, z: number, present: boolean): void {
    if (!this.inBounds(x, y, z)) return;
    const index = this.voxelIndex(x, y, z);
    const previous = this.grassOccupancy[index] !== 0;
    if (previous === present) return;
    this.grassOccupancy[index] = present ? 255 : 0;
    this.grassTuftCount += present ? 1 : -1;
  }

  private rebuildBricks(): void {
    this.brickOccupancy.fill(0);
    for (let z = 0; z < this.depth; z++) {
      const brickZ = Math.floor(z / VOXEL_SHADOW_BRICK_SIZE);
      for (let y = 0; y < this.height; y++) {
        const brickY = Math.floor(y / VOXEL_SHADOW_BRICK_SIZE);
        for (let x = 0; x < this.width; x++) {
          const index = this.voxelIndex(x, y, z);
          if (this.occupancy[index] === 0 && this.grassOccupancy[index] === 0) continue;
          const brickX = Math.floor(x / VOXEL_SHADOW_BRICK_SIZE);
          this.brickOccupancy[this.brickIndex(brickX, brickY, brickZ)] = 255;
        }
      }
    }
  }

  private markTexturesDirty(): void {
    this.texture.needsUpdate = true;
    this.brickTexture.needsUpdate = true;
    this.grassTexture.needsUpdate = true;
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
          const opaque = this.opaqueById[voxels[sourceIndex] as BlockId] !== 0;
          this.setVoxel(baseX + lx, baseY + ly, baseZ + lz, opaque);
          this.setGrassVoxel(baseX + lx, baseY + ly, baseZ + lz, voxels[sourceIndex] === this.grassTuftId);
        }
      }
    }

    this.loadedChunkKeys.add(key);
    this.rebuildBricks();
    this.markTexturesDirty();
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
          this.setVoxel(baseX + lx, baseY + ly, baseZ + lz, false);
          this.setGrassVoxel(baseX + lx, baseY + ly, baseZ + lz, false);
        }
      }
    }
    this.loadedChunkKeys.delete(key);
    this.rebuildBricks();
    this.markTexturesDirty();
  }

  /** Update a single edited voxel without rebuilding its entire chunk. */
  updateBlock(worldX: number, worldY: number, worldZ: number, blockId: BlockId): void {
    const x = Math.floor(worldX - this.origin.x);
    const y = Math.floor(worldY - this.origin.y);
    const z = Math.floor(worldZ - this.origin.z);
    this.setVoxel(x, y, z, this.opaqueById[blockId] !== 0);
    this.setGrassVoxel(x, y, z, blockId === this.grassTuftId);
    this.rebuildBricks();
    this.markTexturesDirty();
  }

  /** Rebuild from all currently loaded chunks (used by diagnostics/tests). */
  rebuild(chunks: Iterable<{ key: ChunkKey; chunk: Chunk }>): void {
    this.occupancy.fill(0);
    this.brickOccupancy.fill(0);
    this.grassOccupancy.fill(0);
    this.loadedChunkKeys.clear();
    this.opaqueVoxelCount = 0;
    this.grassTuftCount = 0;
    for (const entry of chunks) this.updateChunk(entry.key, entry.chunk);
    this.markTexturesDirty();
  }

  getDiagnostics(): VoxelVolumeDiagnostics {
    return {
      origin: { x: this.origin.x, y: this.origin.y, z: this.origin.z },
      dimensions: { x: this.width, y: this.height, z: this.depth },
      brickDimensions: { x: this.brickWidth, y: this.brickHeight, z: this.brickDepth },
      brickSize: VOXEL_SHADOW_BRICK_SIZE,
      loadedChunks: this.loadedChunkKeys.size,
      opaqueVoxels: this.opaqueVoxelCount,
      grassTufts: this.grassTuftCount,
      textureBytes: this.occupancy.byteLength,
      brickTextureBytes: this.brickOccupancy.byteLength,
    };
  }

  dispose(): void {
    this.texture.dispose();
    this.brickTexture.dispose();
    this.grassTexture.dispose();
  }
}
