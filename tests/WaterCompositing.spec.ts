import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockMaterial } from '../src/engine/render/BlockMaterial';
import { AerialPerspectivePass } from '../src/engine/render/postprocessing/passes/AerialPerspectivePass';
import { UnderwaterPass } from '../src/engine/render/postprocessing/passes/UnderwaterPass';
import { WaterSurfaceMaterial } from '../src/engine/render/water/WaterSurfaceMaterial';

describe('water compositing ownership', () => {
  it('keeps every surface transmission path under the Fresnel interface weight', () => {
    const material = new WaterSurfaceMaterial({ map: null, ocean: true });

    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.fragmentShader).toContain('float transmissionWeight = clamp(interfaceTransmission, 0.0, 1.0)');
    expect(material.fragmentShader).toContain('reflected * reflectionWeight + transmitted * transmissionWeight');
    expect(material.fragmentShader).toContain('(1.0 - fresnel) * grazingTransmissionCoverage * refractionResolveCoverage');
    expect(material.fragmentShader).toContain('uOceanMode ? 0.0 : clamp(uAlpha, 0.0, 1.0)');

    material.dispose();
  });

  it('reserves the zero alpha marker for the opaque ocean', () => {
    const material = new BlockMaterial(new THREE.Texture(), null);

    expect(material.fragmentShader).toContain('float directLightFraction = max(1.0 - indirectMask, 1.0 / 255.0)');
    expect(material.fragmentShader).toContain('gl_FragColor = vec4(color, directLightFraction)');

    material.dispose();
  });

  it('replaces water pixels seabed capture depth with the water-plane depth', () => {
    const pass = new AerialPerspectivePass();
    const fragmentShader = (pass.material as THREE.ShaderMaterial).fragmentShader;

    expect(fragmentShader).toContain('vec3 viewRayWorld(out vec3 viewRay)');
    expect(fragmentShader).toContain('float waterMask = 1.0 - step(0.001, source.a)');
    expect(fragmentShader).toContain('float surfaceViewDepth = -rayDistance * viewRay.z');
    expect(fragmentShader).toContain('distanceToSurface = mix(');
    expect(fragmentShader).toContain('float validWaterSurfaceRay = cameraAboveWater');
    expect(fragmentShader).toContain('waterMask * validWaterSurfaceRay');
    expect(fragmentShader).toContain('clamp(surfaceViewDepth, 0.0, cameraFar)');
  });

  it('does not reapply camera-side medium to above-water surface pixels', () => {
    const pass = new UnderwaterPass();
    const fragmentShader = (pass.material as THREE.ShaderMaterial).fragmentShader;

    expect(fragmentShader).toContain('float waterSurfaceMask = 1.0 - step(0.001, source.a)');
    expect(fragmentShader).toContain('float cameraAboveWater = step(waterLevel, uCameraPosition.y)');
    expect(fragmentShader).toContain('if (waterSurfaceMask > 0.5 && cameraAboveWater > 0.5)');
    expect(fragmentShader).toContain('gl_FragColor = source');

    pass.dispose();
  });
});
