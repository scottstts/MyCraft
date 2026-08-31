import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_SWITCH_VFX_CONFIG,
  CharacterSwitchVFX,
} from '../src/engine/render/CharacterSwitchVFX';

describe('character switch VFX', () => {
  it('uses the reference scan shader and finite sweep lifetime', () => {
    const vfx = new CharacterSwitchVFX();
    const target = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    target.add(mesh);
    vfx.setTarget(target);

    const scan = vfx.object.getObjectByName('CharacterSwitchVFX.Scan') as THREE.Mesh;
    expect(scan).toBeTruthy();
    expect(scan.material).toBeInstanceOf(THREE.ShaderMaterial);
    const material = scan.material as THREE.ShaderMaterial;
    expect(material.vertexShader).toContain('uSweep');
    expect(material.fragmentShader).toContain('float fbm');

    vfx.trigger();
    expect(vfx.object.visible).toBe(true);
    const uniforms = material.uniforms as {
      uSweep: { value: number };
      uTop: { value: number };
    };
    expect(uniforms.uSweep.value).toBeCloseTo(uniforms.uTop.value + 0.04, 6);
    vfx.update(CHARACTER_SWITCH_VFX_CONFIG.cycleDuration);
    expect(vfx.object.visible).toBe(false);

    vfx.dispose();
  });
});
