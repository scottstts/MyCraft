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
  it('routes opaque, cutout, and block-water buffers to their own materials', () => {
    const scene = new THREE.Scene();
    const opaqueMaterial = new THREE.MeshBasicMaterial();
    const cutoutMaterial = new THREE.MeshBasicMaterial();
    const transparentMaterial = new THREE.MeshBasicMaterial();
    const registered: THREE.Mesh[] = [];
    const unregistered: THREE.Mesh[] = [];
    const renderer = new ChunkRenderer(
      scene,
      { opaque: opaqueMaterial, cutout: cutoutMaterial, transparent: transparentMaterial },
      {
        registerSolidTerrainMesh: (mesh) => registered.push(mesh),
        unregisterSolidTerrainMesh: (mesh) => unregistered.push(mesh),
      },
    );
    const quad = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0];

    renderer.handleChunkMesh({
      type: 'CHUNK_MESH',
      key: '0,0,0',
      payload: {
        opaque: makeBuffers(quad),
        cutout: makeBuffers(quad),
        transparent: makeBuffers(quad),
      },
    });

    const group = scene.getObjectByName('Chunk:0,0,0') as THREE.Group;
    const meshes = group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    expect(meshes.find((mesh) => mesh.material === opaqueMaterial)).toBeDefined();
    expect(meshes.find((mesh) => mesh.material === cutoutMaterial)).toBeDefined();
    expect(meshes.find((mesh) => mesh.material === transparentMaterial)).toBeDefined();
    expect(renderer.getChunkMesh('0,0,0')?.material).toBe(opaqueMaterial);
    expect(renderer.hasBlockWaterGeometry()).toBe(true);
    expect(registered).toHaveLength(1);

    renderer.handleChunkMesh({
      type: 'CHUNK_MESH',
      key: '0,0,0',
      payload: {
        opaque: makeBuffers(quad),
        cutout: makeBuffers(quad),
        transparent: makeBuffers([]),
      },
    });
    expect(renderer.hasBlockWaterGeometry()).toBe(false);

    renderer.destroy();
    expect(unregistered.length).toBeGreaterThan(0);
    opaqueMaterial.dispose();
    cutoutMaterial.dispose();
    transparentMaterial.dispose();
  });

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
        cutout: makeBuffers([]),
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

  it('keeps each chunk in its own editable 1x1 region', () => {
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
        cutout: makeBuffers([]),
        transparent: makeBuffers([]),
      },
    });

    renderer.handleChunkMesh(response('0,0,0'));
    renderer.handleChunkMesh(response('1,0,0'));
    renderer.handleChunkMesh(response('2,0,0'));
    renderer.finalizeStaticRegions();

    expect(renderer.getLoadedMeshCount()).toBe(3);
    expect(renderer.getRenderedMeshCount()).toBe(3);
    const firstRegionMesh = renderer.getChunkMesh('0,0,0');
    expect(firstRegionMesh).not.toBe(renderer.getChunkMesh('1,0,0'));
    expect(firstRegionMesh).not.toBe(renderer.getChunkMesh('2,0,0'));
    expect(scene.children.filter((child) => child.name.startsWith('ChunkRegion:'))).toHaveLength(3);

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
      payload: {
        opaque: makeBuffers([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        cutout: makeBuffers([]),
        transparent: makeBuffers([]),
      },
    });
    renderer.removeChunkMesh('0,0,0');
    expect(opaqueDispose).not.toHaveBeenCalled();
    renderer.destroy();
    opaqueMaterial.dispose();
    transparentMaterial.dispose();
  });

  it('shares source attributes across medium-segregated forward meshes', () => {
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
    const boundaryOpaque = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const response: Parameters<ChunkRenderer['handleChunkMesh']>[0] = {
      type: 'CHUNK_MESH',
      key: '0,0,0',
      payload: {
        opaque: makeBuffers(positions, { belowOpaque, boundaryOpaque }),
        cutout: makeBuffers([]),
        transparent: makeBuffers([]),
      },
    };

    renderer.handleChunkMesh(response);
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
    ]);
    const boundary = scene.getObjectByName('ForwardRefraction:boundaryOpaque') as THREE.Mesh | undefined;
    expect(boundary).toBeDefined();
    expect(boundary?.geometry.getAttribute('position')).toBe(receiver?.geometry.getAttribute('position'));
    expect(boundary?.geometry.getAttribute('normal')).toBe(receiver?.geometry.getAttribute('normal'));
    expect(boundary?.geometry.getAttribute('uv')).toBe(receiver?.geometry.getAttribute('uv'));
    expect(boundary?.geometry.getAttribute('ao')).toBe(receiver?.geometry.getAttribute('ao'));
    expect(boundary?.geometry.getAttribute('color')).toBe(receiver?.geometry.getAttribute('color'));
    expect(boundary?.geometry.getIndex()).not.toBe(receiver?.geometry.getIndex());
    expect(participants.size).toBe(2);
    expect(Array.from(participants.getParticipants())).toEqual([receiver, boundary]);

    renderer.destroy();
    receiverMaterials.opaque.dispose();
    receiverMaterials.cutout.dispose();
    opaqueMaterial.dispose();
    transparentMaterial.dispose();
  });
});
