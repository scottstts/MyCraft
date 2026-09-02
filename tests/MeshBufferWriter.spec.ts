import { describe, expect, it } from 'vitest';
import { MeshBufferWriter } from '../src/engine/world/MeshBufferWriter';
import { FORWARD_REFRACTION_INDEX_BUCKETS } from '../src/engine/world/ForwardRefractionMeshing';

describe('MeshBufferWriter', () => {
  it('counts faces and fills exact typed buffers without a JS array staging pass', () => {
    const counter = new MeshBufferWriter();
    counter.addFaceCount();
    counter.addFaceCount();

    expect(counter.getFaceCount()).toBe(2);
    expect(counter.getVertexCount()).toBe(8);

    const writer = new MeshBufferWriter(counter.getFaceCount());
    writer.addFace(
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      [0, 0, 1],
      [[0, 1], [1, 1], [1, 0], [0, 0]],
      [0.7, 0.56, 0.42, 0.7],
      0.9,
    );
    writer.addFace(
      [[2, 0, 0], [3, 0, 0], [3, 1, 0], [2, 1, 0]],
      [0, 0, 1],
      [[2, 1], [3, 1], [3, 0], [2, 0]],
      [0.45, 0.6, 0.45, 0.6],
      1,
    );

    const buffers = writer.toBuffers();
    expect(buffers.positions).toBeInstanceOf(Float32Array);
    expect(buffers.indices).toBeInstanceOf(Uint32Array);
    expect(buffers.positions).toHaveLength(24);
    expect(buffers.normals).toHaveLength(24);
    expect(buffers.uvs).toHaveLength(16);
    expect(buffers.ao).toHaveLength(8);
    expect(buffers.colors).toHaveLength(24);
    expect(buffers.indices).toHaveLength(12);
    expect(Array.from(buffers.positions.slice(0, 12))).toEqual([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ]);
    expect(Array.from(buffers.indices)).toEqual([
      0, 1, 3, 1, 2, 3,
      4, 5, 7, 5, 6, 7,
    ]);
    const expectedAo = [0.7, 0.56, 0.42, 0.7, 0.45, 0.6, 0.45, 0.6];
    for (let index = 0; index < expectedAo.length; index += 1) {
      expect(buffers.ao[index]).toBeCloseTo(expectedAo[index], 6);
    }
  });

  it('detects a topology count mismatch before returning output', () => {
    const writer = new MeshBufferWriter(1);
    expect(() => writer.toBuffers()).toThrow(/Face count changed/);
  });

  it('keeps medium-segregated forward indices in the same face topology', () => {
    const counter = new MeshBufferWriter();
    counter.addFaceCount('belowOpaque');
    counter.addFaceCount('boundaryCutout');
    const counts = counter.getForwardIndexCounts();

    expect(FORWARD_REFRACTION_INDEX_BUCKETS).toHaveLength(6);
    expect(counts.belowOpaque).toBe(6);
    expect(counts.boundaryCutout).toBe(6);
    expect(counts.aboveOpaque).toBe(0);

    const writer = new MeshBufferWriter(2, counts);
    const face = (
      x: number,
      bucket: 'belowOpaque' | 'boundaryCutout',
    ) => writer.addFace(
      [[x, 0, 0], [x + 1, 0, 0], [x + 1, 1, 0], [x, 1, 0]],
      [0, 0, 1],
      [[0, 1], [1, 1], [1, 0], [0, 0]],
      [0.7, 0.56, 0.42, 0.7],
      1,
      bucket,
    );
    face(0, 'belowOpaque');
    face(2, 'boundaryCutout');

    const buffers = writer.toBuffers();
    expect(Array.from(buffers.forwardIndices?.belowOpaque ?? [])).toEqual([0, 1, 3, 1, 2, 3]);
    expect(Array.from(buffers.forwardIndices?.boundaryCutout ?? [])).toEqual([4, 5, 7, 5, 6, 7]);
    expect(buffers.forwardIndices?.aboveOpaque).toBeUndefined();
  });
});
