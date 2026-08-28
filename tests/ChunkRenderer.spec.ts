import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChunkRenderer } from '../src/engine/render/ChunkRenderer';
import type { MeshBuffers } from '../src/types/workers';

function makeBuffers(positions: number[]): MeshBuffers {
  const vertexCount = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(vertexCount * 3),
    uvs: new Float32Array(vertexCount * 2),
    ao: new Float32Array(vertexCount),
    colors: new Float32Array(vertexCount * 3),
    indices: new Uint16Array(vertexCount >= 3 ? [0, 1, 2] : []),
  };
}

describe('native voxel shadow caster setup', () => {
  it('uses a depth-only polygon offset while preserving the voxel shadow silhouette', () => {
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
    expect(mesh?.castShadow).toBe(true);
    expect(mesh?.receiveShadow).toBe(true);

    const depthMaterial = mesh?.customDepthMaterial;
    expect(depthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
    const typedDepthMaterial = depthMaterial as THREE.MeshDepthMaterial;
    expect(typedDepthMaterial.depthPacking).toBe(THREE.RGBADepthPacking);

    const shaderParameters = {
      vertexShader: 'void main() { vHighPrecisionZW = gl_Position.zw; }',
      fragmentShader: '',
      uniforms: {},
    } as unknown as Parameters<THREE.Material['onBeforeCompile']>[0];
    typedDepthMaterial.onBeforeCompile(shaderParameters, null as unknown as THREE.WebGLRenderer);
    expect(shaderParameters.vertexShader).toContain('gl_Position.z += 0.0004 * gl_Position.w;');
    expect(shaderParameters.vertexShader).toContain('gl_Position.z -= 0.0004 * gl_Position.w;');

    renderer.destroy();
    opaqueMaterial.dispose();
    transparentMaterial.dispose();
  });
});
