import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { WaterSurfaceMaterial } from '../src/engine/render/water/WaterSurfaceMaterial';
import { WaterSystem } from '../src/engine/render/water/WaterSystem';

describe('WaterSurfaceMaterial', () => {
  it('uses projected Snell refraction and reconstructed scene thickness', () => {
    const material = new WaterSurfaceMaterial({ map: null, ocean: true });

    expect(material.fragmentShader).toContain('projectWorldToUv');
    expect(material.fragmentShader).toContain('reconstructWorldPosition');
    expect(material.fragmentShader).toContain('uProjectionMatrix * viewMatrix');
    expect(material.fragmentShader).toContain('length(backgroundWorld - vWorld)');
    expect(material.fragmentShader).toContain('dielectricFresnel');
    expect(material.fragmentShader).toContain('ggxDistribution');
    expect(material.fragmentShader).toContain('float skirtAlpha');
    expect(material.fragmentShader).toContain('float sunLobe = mix(coreLobe, skirtLobe, 0.42)');
    expect(material.fragmentShader).toContain('normalFootprint');
    expect(material.fragmentShader).not.toContain('pow(sun, 2200.0)');
    expect(material.fragmentShader).not.toContain('refractedDirection.xz * uRefractAmount');
    expect(material.fragmentShader).not.toContain('abs(refractedDirection.z)');
    expect(material.fragmentShader).not.toContain('pow((1.0 - 1.333)');

    material.dispose();
  });

  it('keeps camera reconstruction matrices current', () => {
    const material = new WaterSurfaceMaterial({ map: null, ocean: true });
    const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.2, 768);
    camera.position.set(12, 48, -19);
    camera.lookAt(4, 42, 7);
    camera.updateProjectionMatrix();

    material.setCamera(camera);

    expect(material.uniforms.uProjectionMatrix.value.elements)
      .toEqual(camera.projectionMatrix.elements);
    expect(material.uniforms.uProjectionMatrixInverse.value.elements)
      .toEqual(camera.projectionMatrixInverse.elements);
    expect(material.uniforms.uViewMatrixInverse.value.elements)
      .toEqual(camera.matrixWorld.elements);
    expect(material.uniforms.uCameraNear.value).toBe(camera.near);
    expect(material.uniforms.uCameraFar.value).toBe(camera.far);

    material.dispose();
  });

  it('reapplies current sun visibility to only the refracted direct-light share', () => {
    const material = new WaterSurfaceMaterial({ map: null, ocean: true });
    const visibility = new THREE.Texture();

    material.setSunVisibility(visibility);

    expect(material.uniforms.tSunVisibility.value).toBe(visibility);
    expect(material.uniforms.uHasSunVisibility.value).toBe(1);
    expect(material.fragmentShader).toContain('refractedSunVisibility');
    expect(material.fragmentShader).toContain('float directLightFraction = clamp(sceneSample.a');
    expect(material.fragmentShader).toContain('mix(1.0, sunVisibility, directLightFraction)');
    expect(material.fragmentShader).toContain('abs(neighbourDepth - referenceDepth)');

    material.setSunVisibility(null);
    expect(material.uniforms.uHasSunVisibility.value).toBe(0);

    visibility.dispose();
    material.dispose();
  });

  it('excludes every water layer from the scene-color capture and restores it', () => {
    const textureLoad = vi.spyOn(THREE.TextureLoader.prototype, 'load')
      .mockImplementation((_url, onLoad) => {
        const texture = new THREE.Texture();
        onLoad?.(texture);
        return texture;
      });
    const scene = new THREE.Scene();
    const blockWater = new WaterSurfaceMaterial({ map: null });
    const water = new WaterSystem(scene, {
      bounds: { minX: -16, maxX: 16, minZ: -16, maxZ: 16 },
      waterLevel: 42,
      farDistance: 128,
      seed: 17,
      worldRadius: 32,
      blockWaterMaterial: blockWater,
    });
    const ocean = scene.getObjectByName('OceanSurface');

    expect(ocean?.visible).toBe(true);
    expect(blockWater.visible).toBe(true);

    water.setOpaqueCaptureMode(true);
    expect(ocean?.visible).toBe(false);
    expect(blockWater.visible).toBe(false);

    water.setOpaqueCaptureMode(false);
    expect(ocean?.visible).toBe(true);
    expect(blockWater.visible).toBe(true);

    water.dispose();
    blockWater.dispose();
    textureLoad.mockRestore();
  });
});
