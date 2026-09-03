import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '../src/engine/render/postprocessing/Composer';
import type { RenderStageProfiler } from '../src/engine/render/RenderStageProfiler';

function createRenderer(onRender: () => void): THREE.WebGLRenderer {
  let renderTarget: THREE.WebGLRenderTarget | null = null;
  const clearColor = new THREE.Color(0x123456);
  return {
    getPixelRatio: () => 1,
    getSize: (target: THREE.Vector2) => target.set(1, 1),
    getRenderTarget: () => renderTarget,
    setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
      renderTarget = target;
    },
    clear: vi.fn(),
    render: vi.fn(onRender),
    getClearAlpha: () => 1,
    getClearColor: (target: THREE.Color) => target.copy(clearColor),
    setClearColor: (color: THREE.Color | number) => {
      clearColor.copy(color instanceof THREE.Color ? color : new THREE.Color(color));
    },
  } as unknown as THREE.WebGLRenderer;
}

describe('Composer terrain capture', () => {
  it('swaps only registered opaque terrain to a shared depth-only material when color is unused', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const terrainMaterial = new THREE.MeshBasicMaterial();
    const cutoutMaterial = new THREE.MeshBasicMaterial();
    const terrain = new THREE.Mesh(new THREE.BufferGeometry(), terrainMaterial);
    const cutout = new THREE.Mesh(new THREE.BufferGeometry(), cutoutMaterial);
    scene.add(terrain);
    scene.add(cutout);
    const observedMaterials: THREE.Material[] = [];
    const renderer = createRenderer(() => observedMaterials.push(terrain.material as THREE.Material));
    const profiler = {
      measure: <T>(_stage: string, callback: () => T): T => callback(),
    } as unknown as RenderStageProfiler;
    const composer = new Composer(renderer, scene, camera, 1, 1, undefined, profiler);

    composer.registerSolidTerrainMesh(terrain);
    composer.setSceneColorCaptureRequired(false);
    composer.update(camera, new THREE.Vector3(0, 1, 0));

    expect(observedMaterials[0]).not.toBe(terrainMaterial);
    expect((observedMaterials[0] as THREE.ShaderMaterial).colorWrite).toBe(false);
    expect((observedMaterials[0] as THREE.ShaderMaterial).depthWrite).toBe(true);
    expect((observedMaterials[0] as THREE.ShaderMaterial).depthTest).toBe(true);
    expect((observedMaterials[0] as THREE.ShaderMaterial).side).toBe(THREE.FrontSide);
    expect(cutout.material).toBe(cutoutMaterial);
    expect(terrain.material).toBe(terrainMaterial);

    observedMaterials.length = 0;
    composer.setSceneColorCaptureRequired(true);
    composer.update(camera, new THREE.Vector3(0, 1, 0));
    expect(observedMaterials[0]).toBe(terrainMaterial);

    composer.unregisterSolidTerrainMesh(terrain);
    composer.dispose();
    terrain.geometry.dispose();
    cutout.geometry.dispose();
    terrainMaterial.dispose();
    cutoutMaterial.dispose();
  });
});
