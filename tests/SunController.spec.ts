import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SunController } from '../src/engine/render/lighting/SunController';
import { BlockMaterial } from '../src/engine/render/BlockMaterial';
import { NATIVE_WEBGL_SHADOW_MAP_TYPE } from '../src/engine/render/Renderer';

describe('native WebGL shadow stability', () => {
  it('uses a fixed-kernel native PCF filter', () => {
    expect(NATIVE_WEBGL_SHADOW_MAP_TYPE).toBe(THREE.PCFShadowMap);
  });

  it('holds the shadow raster between texel steps and refreshes at a boundary', () => {
    const scene = new THREE.Scene();
    const controller = new SunController(scene, {
      initialTime: 0,
      cycleSeconds: 180,
      enableShadows: true,
    });

    controller.setShadowBounds({ minX: -48, maxX: 96, minZ: -48, maxZ: 96, minY: 0, maxY: 96 });
    expect(controller.consumeShadowDirty()).toBe(true);

    const previousLightPosition = controller.sun.position.clone();
    controller.update(1 / 120);
    expect(controller.consumeShadowDirty()).toBe(false);

    let refreshed = false;
    for (let i = 0; i < 20; i++) {
      controller.update(1 / 120);
      refreshed = controller.consumeShadowDirty() || refreshed;
    }
    expect(refreshed).toBe(true);
    expect(controller.sun.position.distanceTo(previousLightPosition)).toBeGreaterThan(0);

    const shadowDirection = controller.sun.position
      .clone()
      .sub(controller.sun.target.position)
      .normalize();
    expect(shadowDirection.dot(controller.getSunDirection())).toBeGreaterThan(0.999999);

    controller.dispose();
  });

  it('uses a small negative native depth bias by default', () => {
    const controller = new SunController(new THREE.Scene(), { enableShadows: true });
    expect(controller.sun.shadow.bias).toBe(-0.001);
    expect(controller.sun.shadow.radius).toBe(0);
    expect(controller.sun.shadow.normalBias).toBe(0);
    controller.dispose();
  });

  it('does not invalidate the native map for an idempotent settings update', () => {
    const controller = new SunController(new THREE.Scene(), { enableShadows: true });
    controller.consumeShadowDirty();
    controller.setShadowSettings(controller.getShadowSettings());
    expect(controller.consumeShadowDirty()).toBe(false);
    controller.dispose();
  });

  it('casts voxel shadows from outward faces', () => {
    const material = new BlockMaterial(new THREE.Texture(), null, undefined, { tileSize: 16, atlasSize: 11 });
    expect(material.shadowSide).toBe(THREE.FrontSide);
    material.dispose();
  });

  it('encodes an SSAO mask that does not use the shadowed direct term', () => {
    const material = new BlockMaterial(new THREE.Texture(), null, undefined, { tileSize: 16, atlasSize: 11 });
    expect(material.fragmentShader).toContain('shadowIndependentTotal');
    expect(material.fragmentShader).toContain('unshadowedDiffuse');
    expect(material.fragmentShader).not.toContain('float totalLuma = dot(max(total, vec3(0.0))');
    material.dispose();
  });

  it('keeps the finite world inside the native shadow frustum through the sun cycle', () => {
    const scene = new THREE.Scene();
    const controller = new SunController(scene, { enableShadows: true });
    const bounds = { minX: -48, maxX: 96, minY: 0, maxY: 96, minZ: -48, maxZ: 96 };
    controller.setShadowBounds(bounds);
    controller.consumeShadowDirty();

    const corners: THREE.Vector3[] = [];
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const y of [bounds.minY, bounds.maxY]) {
        for (const z of [bounds.minZ, bounds.maxZ]) {
          corners.push(new THREE.Vector3(x, y, z));
        }
      }
    }

    const shadowCamera = controller.sun.shadow.camera as THREE.OrthographicCamera;
    let worstClipCoordinate = 0;
    for (let sample = 0; sample < 256; sample++) {
      controller.setTime(sample / 256);
      shadowCamera.position.copy(controller.sun.position);
      shadowCamera.lookAt(controller.sun.target.position);
      shadowCamera.updateMatrixWorld(true);

      for (const corner of corners) {
        const clip = corner.clone()
          .applyMatrix4(shadowCamera.matrixWorldInverse)
          .applyMatrix4(shadowCamera.projectionMatrix);
        worstClipCoordinate = Math.max(
          worstClipCoordinate,
          Math.abs(clip.x),
          Math.abs(clip.y),
          Math.abs(clip.z),
        );
      }
    }

    expect(worstClipCoordinate).toBeLessThanOrEqual(1.0);
    controller.dispose();
  });
});
