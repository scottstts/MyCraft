import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ChunkRenderer } from '../src/engine/render/ChunkRenderer';
import {
  createForwardRefractionReceiverMaterials,
  FORWARD_REFRACTION_MEDIUM,
  ForwardRefractionParticipantRegistry,
} from '../src/engine/render/water/ForwardRefraction';
import type { MeshBuffers } from '../src/types/workers';

function makeBuffers(
  positions: number[],
  forwardIndices?: MeshBuffers['forwardIndices'],
): MeshBuffers {
  const vertexCount = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(vertexCount * 3),
    uvs: new Float32Array(vertexCount * 2),
    ao: new Float32Array(vertexCount),
    colors: new Float32Array(vertexCount * 3),
    indices: new Uint32Array(vertexCount >= 4 ? [0, 1, 2, 0, 2, 3] : vertexCount >= 3 ? [0, 1, 2] : []),
    ...(forwardIndices ? { forwardIndices } : {}),
  };
}

describe('voxel shadow integration', () => {
  it('keeps native shadow-map flags disabled because occupancy owns casting', () => {
    const scene = new THREE.Scene();
    const opaqueMaterial = new THREE.MeshBasicMaterial();
    const transparentMaterial = new THREE.MeshBasicMaterial();
    const renderer = new ChunkRenderer(scene, {
      opaque: opaqueMaterial,
      transparent: transparentMaterial,
    });

    renderer.handleChunkMesh({
      type: 'CHUNK_MESH',
      key: '0,0,0',
      payload: {
        opaque: makeBuffers([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        transparent: makeBuffers([]),
      },
    });

    const mesh = renderer.getChunkMesh('0,0,0');
    expect(mesh).toBeDefined();
    expect(mesh?.castShadow).toBe(false);
    expect(mesh?.receiveShadow).toBe(false);

    expect(mesh?.customDepthMaterial).toBeUndefined();

    renderer.destroy();
    opaqueMaterial.dispose();
    transparentMaterial.dispose();
  });

  it('compiles complete neighboring chunks into one editable 2x2 region', () => {
    const scene = new THREE.Scene();
    const opaqueMaterial = new THREE.MeshBasicMaterial();
    const transparentMaterial = new THREE.MeshBasicMaterial();
    const renderer = new ChunkRenderer(scene, {
      opaque: opaqueMaterial,
      transparent: transparentMaterial,
    });
    const response = (key: string, x = 0): Parameters<ChunkRenderer['handleChunkMesh']>[0] => ({
      type: 'CHUNK_MESH',
      key,
      payload: {
        opaque: makeBuffers([x, 0, 0, x + 1, 0, 0, x, 1, 0]),
        transparent: makeBuffers([]),
      },
    });

    renderer.handleChunkMesh(response('0,0,0'));
    renderer.handleChunkMesh(response('1,0,0'));
    renderer.handleChunkMesh(response('2,0,0'));
    renderer.finalizeStaticRegions();

    expect(renderer.getLoadedMeshCount()).toBe(3);
    expect(renderer.getRenderedMeshCount()).toBe(2);
    const firstRegionMesh = renderer.getChunkMesh('0,0,0');
    expect(firstRegionMesh).toBe(renderer.getChunkMesh('1,0,0'));
    expect(firstRegionMesh).not.toBe(renderer.getChunkMesh('2,0,0'));
    expect(scene.children.filter((child) => child.name.startsWith('ChunkRegion:'))).toHaveLength(2);

    const secondRegionMesh = renderer.getChunkMesh('2,0,0');
    renderer.handleChunkMesh(response('0,0,0', 2));
    expect(renderer.getChunkMesh('0,0,0')).toBe(firstRegionMesh);
    expect(renderer.getChunkMesh('2,0,0')).toBe(secondRegionMesh);

    renderer.removeChunkMesh('1,0,0');
    expect(renderer.getLoadedMeshCount()).toBe(2);
    expect(renderer.getRenderedMeshCount()).toBe(2);
    renderer.destroy();
    opaqueMaterial.dispose();
    transparentMaterial.dispose();
  });

  it('does not dispose shared materials when an individual chunk is removed', () => {
    const scene = new THREE.Scene();
    const opaqueMaterial = new THREE.MeshBasicMaterial();
    const transparentMaterial = new THREE.MeshBasicMaterial();
    const opaqueDispose = vi.spyOn(opaqueMaterial, 'dispose');
    const renderer = new ChunkRenderer(scene, {
      opaque: opaqueMaterial,
      transparent: transparentMaterial,
    });
    renderer.handleChunkMesh({
      type: 'CHUNK_MESH',
      key: '0,0,0',
      payload: { opaque: makeBuffers([0, 0, 0, 1, 0, 0, 0, 1, 0]), transparent: makeBuffers([]) },
    });
    renderer.removeChunkMesh('0,0,0');
    expect(opaqueDispose).not.toHaveBeenCalled();
    renderer.destroy();
    opaqueMaterial.dispose();
    transparentMaterial.dispose();
  });

  it('merges medium-segregated receiver indices into minimal forward meshes', () => {
    const scene = new THREE.Scene();
    const opaqueMaterial = new THREE.MeshBasicMaterial();
    const transparentMaterial = new THREE.MeshBasicMaterial();
    const receiverMaterials = createForwardRefractionReceiverMaterials({
      map: new THREE.Texture(),
    });
    const participants = new ForwardRefractionParticipantRegistry();
    const renderer = new ChunkRenderer(
      scene,
      { opaque: opaqueMaterial, transparent: transparentMaterial },
      {
        forwardRefractionParticipants: participants,
        forwardRefractionReceiverMaterials: receiverMaterials,
      },
    );
    const positions = [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ];
    const belowOpaque = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const response = (key: string): Parameters<ChunkRenderer['handleChunkMesh']>[0] => ({
      type: 'CHUNK_MESH',
      key,
      payload: {
        opaque: makeBuffers(positions, { belowOpaque }),
        transparent: makeBuffers([]),
      },
    });

    renderer.handleChunkMesh(response('0,0,0'));
    renderer.handleChunkMesh(response('1,0,0'));
    renderer.finalizeStaticRegions();

    const receiver = scene.getObjectByName('ForwardRefraction:belowOpaque') as THREE.Mesh | undefined;
    expect(receiver).toBeDefined();
    expect(receiver?.layers.mask).toBe(1 << 1);
    expect(receiver?.userData[FORWARD_REFRACTION_MEDIUM]).toBe('below');
    // Receiver fragments are minimal, but the shared geometry retains the
    // attributes needed when this mesh switches to full terrain color shading.
    expect(receiver?.geometry.getAttribute('normal')).toBeDefined();
    expect(receiver?.geometry.getAttribute('uv')).toBeDefined();
    expect(receiver?.geometry.getAttribute('ao')).toBeDefined();
    expect(receiver?.geometry.getAttribute('color')).toBeDefined();
    expect(Array.from(receiver?.geometry.getIndex()?.array ?? [])).toEqual([
      0, 1, 2, 0, 2, 3,
      4, 5, 6, 4, 6, 7,
    ]);
    expect(participants.size).toBe(1);
    expect(Array.from(participants.getParticipants())).toEqual([receiver]);

    renderer.destroy();
    receiverMaterials.opaque.dispose();
    receiverMaterials.cutout.dispose();
    opaqueMaterial.dispose();
    transparentMaterial.dispose();
  });
});
