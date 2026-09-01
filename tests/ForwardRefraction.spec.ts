import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockMaterial } from '../src/engine/render/BlockMaterial';
import {
  AIR_REFRACTIVE_INDEX,
  FORWARD_REFRACTION_MATERIAL_FLAG,
  FORWARD_REFRACTION_SOLVE_STEPS,
  WATER_REFRACTIVE_INDEX,
  forwardRefractionVertexDeclarations,
  solveFlatRefractionInterface,
} from '../src/engine/render/water/ForwardRefraction';

function snellResidual(
  camera: THREE.Vector3,
  source: THREE.Vector3,
  crossing: THREE.Vector3,
  cameraIor: number,
  sourceIor: number,
): number {
  const cameraVertical = Math.abs(camera.y - crossing.y);
  const sourceVertical = Math.abs(source.y - crossing.y);
  const cameraHorizontal = Math.hypot(
    camera.x - crossing.x,
    camera.z - crossing.z,
  );
  const sourceHorizontal = Math.hypot(
    source.x - crossing.x,
    source.z - crossing.z,
  );
  const cameraSine = cameraHorizontal /
    Math.hypot(cameraVertical, cameraHorizontal);
  const sourceSine = sourceHorizontal /
    Math.hypot(sourceVertical, sourceHorizontal);
  return cameraIor * cameraSine - sourceIor * sourceSine;
}

describe('forward water-interface projection', () => {
  it('solves Snell stationary paths from air into water', () => {
    const camera = new THREE.Vector3(0, 7, 0);
    const source = new THREE.Vector3(15, -4, 5);
    const crossing = solveFlatRefractionInterface(camera, source, 0, false);

    expect(crossing.y).toBe(0);
    expect(Math.abs(snellResidual(
      camera,
      source,
      crossing,
      AIR_REFRACTIVE_INDEX,
      WATER_REFRACTIVE_INDEX,
    ))).toBeLessThan(2e-4);
  });

  it('uses the reciprocal indices from water into air', () => {
    const camera = new THREE.Vector3(-2, -6, 3);
    const source = new THREE.Vector3(12, 8, -5);
    const crossing = solveFlatRefractionInterface(camera, source, 0, true);

    expect(Math.abs(snellResidual(
      camera,
      source,
      crossing,
      WATER_REFRACTIVE_INDEX,
      AIR_REFRACTIVE_INDEX,
    ))).toBeLessThan(2e-4);
  });

  it('brackets the vertex solve by the critical angle and never samples screen color', () => {
    const declarations = forwardRefractionVertexDeclarations();

    expect(FORWARD_REFRACTION_SOLVE_STEPS).toBe(14);
    expect(declarations).toContain('float cameraReach = cameraPlaneDistance');
    expect(declarations).toContain('float sourceReach = sourcePlaneDistance');
    expect(declarations).toContain('cameraIor * cameraSine < sourceIor * sourceSine');
    expect(declarations).toContain('apparentDirection * sourceDistance');
    expect(declarations).not.toContain('texture2D(tSceneColor');
  });

  it('opts terrain into the same vertex and fragment transport contract', () => {
    const material = new BlockMaterial(new THREE.Texture(), null);

    expect(material.userData[FORWARD_REFRACTION_MATERIAL_FLAG]).toBe(true);
    expect(material.vertexShader).toContain('forwardRefractionProject');
    expect(material.fragmentShader).toContain('forwardRefractionDiscardCameraMedium');
    expect(material.fragmentShader).toContain('forwardRefractionEncodeReceiver');
    expect(material.fragmentShader).toContain('forwardRefractionSunVisibility');
    expect(material.fragmentShader).not.toContain('forwardRefractionOriginalScreenUv');

    material.dispose();
  });
});
