import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VoxelSunShadowPass } from '../src/engine/render/lighting/VoxelSunShadowPass';
import { VoxelOccupancyVolume } from '../src/engine/render/lighting/VoxelOccupancyVolume';

function createRendererStub(): THREE.WebGLRenderer {
  return {
    capabilities: { isWebGL2: false },
    getPixelRatio: () => 1,
  } as unknown as THREE.WebGLRenderer;
}

describe('analytic character sun visibility', () => {
  it('keeps the animated caster bound to the voxel pass and computes a conservative screen region', () => {
    const volume = new VoxelOccupancyVolume({
      minX: -16,
      maxX: 16,
      minY: 0,
      maxY: 16,
      minZ: -16,
      maxZ: 16,
    });
    const pass = new VoxelSunShadowPass(createRendererStub(), 320, 200, volume);
    const worldMatrix = new THREE.Matrix4().makeTranslation(0, 1, 0);
    pass.setCharacterShadowBoxes([{
      inverseMatrix: worldMatrix.clone().invert(),
      center: new THREE.Vector3(),
      halfSize: new THREE.Vector3(0.5, 1, 0.5),
    }]);

    const camera = new THREE.PerspectiveCamera(60, 320 / 200, 0.1, 100);
    camera.position.set(0, 3, 8);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld(true);
    pass.update(camera, new THREE.Vector3(0, 1, 0));

    const diagnostics = pass.getDiagnostics();
    expect(diagnostics.characterShadowBoxes).toBe(1);
    expect(diagnostics.characterShadowScreenBounds.maxX).toBeGreaterThan(
      diagnostics.characterShadowScreenBounds.minX,
    );
    expect(diagnostics.characterShadowScreenBounds.maxY).toBeGreaterThan(
      diagnostics.characterShadowScreenBounds.minY,
    );

    pass.dispose();
    volume.dispose();
  });

  it('evaluates the character exactly once after terrain solar visibility, never inside its ray loop', () => {
    const volume = new VoxelOccupancyVolume({
      minX: 0,
      maxX: 16,
      minY: 0,
      maxY: 16,
      minZ: 0,
      maxZ: 16,
    });
    const pass = new VoxelSunShadowPass(createRendererStub(), 1, 1, volume);
    const shader = pass['quadMaterial'].fragmentShader;
    const solarFunction = shader.indexOf('float traceSolarDisc');
    const characterCall = shader.indexOf('traceCharacterVisibility(receiver, sun, edgeWidth)');
    const nestedCharacterCall = shader.indexOf('traceCharacterVisibility(receiverWorld, direction)');

    expect(solarFunction).toBeGreaterThanOrEqual(0);
    expect(characterCall).toBeGreaterThan(solarFunction);
    expect(nestedCharacterCall).toBe(-1);
    expect(shader).not.toContain('fwidth(');

    pass.dispose();
    volume.dispose();
  });
});
