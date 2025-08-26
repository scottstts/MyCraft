/**
 * SkyDome wrapper around three/examples Sky
 * Exposes atmospheric params and sun direction updates.
 */
import * as THREE from 'three';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - types for examples may be incomplete
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
}

type UniformRecord = Record<string, { value: unknown }>;

export class SkyDome {
  readonly sky: THREE.Object3D;
  readonly sun: THREE.Vector3 = new THREE.Vector3();
  private uniforms: UniformRecord;

  constructor(scene: THREE.Scene, params?: Partial<SkyParams>) {
    const sky = new Sky();
    sky.scale.setScalar(450000);
    this.sky = sky;
    scene.add(sky);

    // Extract uniforms (examples Sky exposes .material.uniforms)
    const mat = sky.material as THREE.ShaderMaterial;
    this.uniforms = mat.uniforms as unknown as UniformRecord;

    const p: SkyParams = {
      turbidity: params?.turbidity ?? 2.0,
      rayleigh: params?.rayleigh ?? 1.5,
      mieCoefficient: params?.mieCoefficient ?? 0.005,
      mieDirectionalG: params?.mieDirectionalG ?? 0.8,
    };
    this.setParams(p);

    // Initialize sun
    this.setSunDirection(new THREE.Vector3(1, 1, 0.2).normalize());
  }

  setParams(p: SkyParams): void {
    this.uniforms['turbidity'].value = p.turbidity;
    this.uniforms['rayleigh'].value = p.rayleigh;
    this.uniforms['mieCoefficient'].value = p.mieCoefficient;
    this.uniforms['mieDirectionalG'].value = p.mieDirectionalG;
  }

  setSunDirection(dir: THREE.Vector3): void {
    // Convert direction to spherical for Sky
    const d = new THREE.Vector3().copy(dir).normalize();
    // Sky expects sun position in world space
    this.sun.copy(d).multiplyScalar(400000);
    (this.uniforms['sunPosition'].value as THREE.Vector3).copy(this.sun);
  }
}
