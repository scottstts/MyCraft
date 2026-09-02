import type { MeshBuffers } from '../../types/workers.js';
import {
  FORWARD_REFRACTION_INDEX_BUCKETS,
  type ForwardRefractionIndexBucket,
} from './ForwardRefractionMeshing.js';

type QuadVertex = readonly [number, number, number];
type QuadNormal = readonly [number, number, number];
type QuadUv = readonly [number, number];

/**
 * Exact-size mesh output writer used by the mesher's count/fill passes.
 *
 * A writer constructed without a face count is a count-only writer.  A writer
 * constructed with a face count allocates every output buffer once and writes
 * directly into it, avoiding the large temporary JS number arrays that used
 * to be converted into typed arrays after meshing.
 */
export class MeshBufferWriter {
  private readonly buffers: MeshBuffers | null;
  private readonly expectedFaces: number | null;
  private readonly expectedForwardIndices: Record<ForwardRefractionIndexBucket, number>;
  private readonly forwardIndexOffsets: Record<ForwardRefractionIndexBucket, number>;
  private faceCount = 0;
  private vertexCount = 0;

  constructor(
    expectedFaces?: number,
    expectedForwardIndices: Partial<Record<ForwardRefractionIndexBucket, number>> = {},
  ) {
    this.expectedFaces = expectedFaces ?? null;
    this.expectedForwardIndices = this.createBucketCounts(expectedForwardIndices);
    this.forwardIndexOffsets = this.createBucketCounts();
    if (expectedFaces === undefined) {
      this.buffers = null;
      return;
    }

    const vertexCapacity = expectedFaces * 4;
    this.buffers = {
      positions: new Float32Array(vertexCapacity * 3),
      normals: new Float32Array(vertexCapacity * 3),
      uvs: new Float32Array(vertexCapacity * 2),
      ao: new Float32Array(vertexCapacity),
      colors: new Float32Array(vertexCapacity * 3),
      indices: new Uint32Array(expectedFaces * 6),
    };
    const forwardIndices: Partial<Record<ForwardRefractionIndexBucket, Uint32Array>> = {};
    for (const bucket of FORWARD_REFRACTION_INDEX_BUCKETS) {
      const indexCount = this.expectedForwardIndices[bucket];
      if (indexCount > 0) forwardIndices[bucket] = new Uint32Array(indexCount);
    }
    if (Object.keys(forwardIndices).length > 0) this.buffers.forwardIndices = forwardIndices;
  }

  get isCounting(): boolean {
    return this.buffers === null;
  }

  getFaceCount(): number {
    return this.faceCount;
  }

  getVertexCount(): number {
    return this.vertexCount;
  }

  getForwardIndexCounts(): Record<ForwardRefractionIndexBucket, number> {
    return this.createBucketCounts(this.expectedForwardIndices);
  }

  addFaceCount(forwardBucket?: ForwardRefractionIndexBucket): void {
    this.faceCount += 1;
    this.vertexCount += 4;
    if (forwardBucket) this.expectedForwardIndices[forwardBucket] += 6;
  }

  addFace(
    quad: readonly QuadVertex[],
    normal: QuadNormal,
    uvOrder: readonly QuadUv[],
    aoValues: readonly number[],
    color: number,
    forwardBucket?: ForwardRefractionIndexBucket,
  ): void {
    if (this.isCounting) {
      this.addFaceCount(forwardBucket);
      return;
    }
    if (quad.length !== 4 || uvOrder.length !== 4 || aoValues.length !== 4) {
      throw new Error('[MeshBufferWriter] A face must contain four vertices, UVs, and AO values');
    }

    const buffers = this.buffers;
    if (!buffers) {
      throw new Error('[MeshBufferWriter] Output buffers are unavailable');
    }
    const vertexOffset = this.vertexCount;
    let positionOffset = vertexOffset * 3;
    let uvOffset = vertexOffset * 2;
    let colorOffset = vertexOffset * 3;
    for (let index = 0; index < 4; index += 1) {
      const vertex = quad[index];
      buffers.positions[positionOffset++] = vertex[0];
      buffers.positions[positionOffset++] = vertex[1];
      buffers.positions[positionOffset++] = vertex[2];
      buffers.normals[vertexOffset * 3 + index * 3] = normal[0];
      buffers.normals[vertexOffset * 3 + index * 3 + 1] = normal[1];
      buffers.normals[vertexOffset * 3 + index * 3 + 2] = normal[2];
      const uv = uvOrder[index];
      buffers.uvs[uvOffset++] = uv[0];
      buffers.uvs[uvOffset++] = uv[1];
      buffers.ao[vertexOffset + index] = aoValues[index];
      buffers.colors[colorOffset++] = color;
      buffers.colors[colorOffset++] = color;
      buffers.colors[colorOffset++] = color;
    }

    const ao0 = aoValues[0];
    const ao1 = aoValues[1];
    const ao2 = aoValues[2];
    const ao3 = aoValues[3];
    const indexOffset = this.faceCount * 6;
    if (ao0 + ao2 > ao1 + ao3) {
      buffers.indices[indexOffset] = vertexOffset;
      buffers.indices[indexOffset + 1] = vertexOffset + 1;
      buffers.indices[indexOffset + 2] = vertexOffset + 2;
      buffers.indices[indexOffset + 3] = vertexOffset;
      buffers.indices[indexOffset + 4] = vertexOffset + 2;
      buffers.indices[indexOffset + 5] = vertexOffset + 3;
    } else {
      buffers.indices[indexOffset] = vertexOffset;
      buffers.indices[indexOffset + 1] = vertexOffset + 1;
      buffers.indices[indexOffset + 2] = vertexOffset + 3;
      buffers.indices[indexOffset + 3] = vertexOffset + 1;
      buffers.indices[indexOffset + 4] = vertexOffset + 2;
      buffers.indices[indexOffset + 5] = vertexOffset + 3;
    }
    if (forwardBucket) {
      const forwardIndices = buffers.forwardIndices?.[forwardBucket];
      if (!forwardIndices) {
        throw new Error(`[MeshBufferWriter] Missing forward index bucket: ${forwardBucket}`);
      }
      const forwardOffset = this.forwardIndexOffsets[forwardBucket];
      for (let index = 0; index < 6; index += 1) {
        forwardIndices[forwardOffset + index] = buffers.indices[indexOffset + index];
      }
      this.forwardIndexOffsets[forwardBucket] += 6;
    }
    this.faceCount += 1;
    this.vertexCount += 4;
  }

  toBuffers(): MeshBuffers {
    if (!this.buffers || this.expectedFaces === null) {
      throw new Error('[MeshBufferWriter] Count-only writers do not have output buffers');
    }
    if (this.faceCount !== this.expectedFaces) {
      throw new Error(
        `[MeshBufferWriter] Face count changed between passes: expected ${this.expectedFaces}, got ${this.faceCount}`,
      );
    }
    for (const bucket of FORWARD_REFRACTION_INDEX_BUCKETS) {
      if (this.forwardIndexOffsets[bucket] !== this.expectedForwardIndices[bucket]) {
        throw new Error(
          `[MeshBufferWriter] Forward index count changed for ${bucket}: expected ${this.expectedForwardIndices[bucket]}, got ${this.forwardIndexOffsets[bucket]}`,
        );
      }
    }
    return this.buffers;
  }

  private createBucketCounts(
    values: Partial<Record<ForwardRefractionIndexBucket, number>> = {},
  ): Record<ForwardRefractionIndexBucket, number> {
    const counts = {} as Record<ForwardRefractionIndexBucket, number>;
    for (const bucket of FORWARD_REFRACTION_INDEX_BUCKETS) {
      counts[bucket] = values[bucket] ?? 0;
    }
    return counts;
  }
}
