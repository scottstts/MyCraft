import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockMaterial } from '../src/engine/render/BlockMaterial';
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

  it('keeps every caster box from the most detailed authored character', () => {
    const volume = new VoxelOccupancyVolume({
      minX: -16,
      maxX: 16,
      minY: 0,
      maxY: 16,
      minZ: -16,
      maxZ: 16,
    });
    const pass = new VoxelSunShadowPass(createRendererStub(), 1, 1, volume);
    const boxes = Array.from({ length: 48 }, () => ({
      inverseMatrix: new THREE.Matrix4(),
      center: new THREE.Vector3(),
      halfSize: new THREE.Vector3(0.1, 0.1, 0.1),
    }));

    pass.setCharacterShadowBoxes(boxes);

    expect(pass.getDiagnostics().characterShadowBoxes).toBe(48);

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
    expect(shader).toContain('uSeaweedAnchors');
    expect(shader).toContain('uSeaweedWaterLevel');
    expect(shader).toContain('bool includeSeaweed');
    expect(shader).toContain('seaweedBladeHit');
    expect(shader).not.toContain('seaweedNearHit');
    expect(shader).toContain('uUseReceiverWorld');
    expect(shader).toContain('? receiverSample.rgb');
    expect(shader).not.toContain('uVolumeOrigin + receiverSample.rgb * uVolumeSize');
    expect(shader).toContain('length(dFdx(receiver))');
    expect(shader).toContain('? refractedPixelWorldSize');
    expect(shader).toContain('uUseReceiverWorld || (');

    pass.dispose();
    volume.dispose();
  });

  it('shares the live character-shadow receiver state with the underwater seabed material', () => {
    const albedo = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    albedo.needsUpdate = true;
    const shadowMask = albedo.clone();
    const shadowDepth = albedo.clone();
    const terrain = new BlockMaterial(albedo, null);
    const seabed = new BlockMaterial(albedo, null);

    terrain.setVoxelShadowTexture(shadowMask, 320, 200, true);
    terrain.setVoxelShadowDepthTexture(shadowDepth, 0.1, 1024);
    seabed.shareVoxelShadowState(terrain);

    expect(seabed.uniforms.voxelShadowMask).toBe(terrain.uniforms.voxelShadowMask);
    expect(seabed.uniforms.voxelShadowDepth).toBe(terrain.uniforms.voxelShadowDepth);
    expect(seabed.uniforms.voxelShadowResolution).toBe(terrain.uniforms.voxelShadowResolution);
    expect(seabed.uniforms.voxelShadowEnabled).toBe(terrain.uniforms.voxelShadowEnabled);

    terrain.setVoxelShadowTexture(shadowMask, 640, 360, false);
    expect(seabed.uniforms.voxelShadowResolution.value).toEqual(new THREE.Vector2(640, 360));
    expect(seabed.uniforms.voxelShadowEnabled.value).toBe(false);

    terrain.dispose();
    seabed.dispose();
    shadowMask.dispose();
    shadowDepth.dispose();
    albedo.dispose();
  });
});
