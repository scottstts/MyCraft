import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SunController } from '../src/engine/render/lighting/SunController';
import { BlockMaterial } from '../src/engine/render/BlockMaterial';
import { RENDER_STYLE } from '../src/engine/render/settings/RenderStyle';
import { createScene } from '../src/engine/render/SceneBuilder';
import { FORWARD_REFRACTION_LAYER } from '../src/engine/render/water/ForwardRefraction';

describe('continuous voxel sun lighting', () => {
  it('defaults to a twenty-minute full cycle (ten minutes per half)', () => {
    const controller = new SunController(new THREE.Scene(), { enableShadows: true });
    expect(controller.getTime()).toBeCloseTo(0.25);
    controller.update(600);
    expect(controller.getTime()).toBeCloseTo(0.75);
    expect(RENDER_STYLE.dayNightCycleSeconds).toBe(1200);
    controller.dispose();
  });

  it('updates the authored sun direction every frame without a shadow-raster dirty gate', () => {
    const controller = new SunController(new THREE.Scene(), {
      initialTime: 0,
      cycleSeconds: 180,
      enableShadows: true,
    });
    const before = controller.getSunDirection();
    controller.update(1 / 120);
    const after = controller.getSunDirection();

    expect(after.dot(before)).toBeLessThan(1);
    expect(controller.sun.castShadow).toBe(false);
    controller.dispose();
  });

  it('keeps shadow settings as DDA controls rather than native map state', () => {
    const controller = new SunController(new THREE.Scene(), { enableShadows: true });
    controller.setShadowSettings({ enabled: false, shadowDistance: 42, bias: -0.009 });
    expect(controller.getShadowSettings()).toMatchObject({
      enabled: false,
      shadowDistance: 42,
      bias: -0.009,
    });
    expect(controller.sun.castShadow).toBe(false);
    controller.dispose();
  });

  it('binds BlockMaterial to the screen-space voxel mask and no native shadow chunks', () => {
    const material = new BlockMaterial(new THREE.Texture(), null, undefined, { tileSize: 16, atlasSize: 11 });
    expect(material.lights).toBe(false);
    expect(material.fragmentShader).toContain('voxelShadowMask');
    expect(material.fragmentShader).toContain('sampleVoxelShadow');
    expect(material.fragmentShader).not.toContain('shadowmap_pars_fragment');
    expect(material.vertexShader).not.toContain('shadowmap_vertex');
    material.dispose();
  });

  it('keeps the baseline ambient light on the forward source layer', () => {
    const scene = createScene();
    const ambient = scene.children.find((child) => child instanceof THREE.AmbientLight);
    expect(ambient).toBeDefined();
    expect(ambient?.layers.isEnabled(FORWARD_REFRACTION_LAYER)).toBe(true);
  });
});
