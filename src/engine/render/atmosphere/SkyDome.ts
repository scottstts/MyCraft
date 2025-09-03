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
  // Optional controls to tame sky luminance without affecting terrain lighting
  sunIntensityScale?: number; // scales vSunE (default 1.0)
  sunDiscScale?: number;      // scales only the solar disc term (default 1.0)
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

    // Inject additional uniforms and shader tweaks to control sun brightness
    // Add uniforms with safe defaults
    (this.uniforms as Record<string, { value: unknown }>)["sunIntensityScale"] = { value: params?.sunIntensityScale ?? 1.0 };
    (this.uniforms as Record<string, { value: unknown }>)["sunDiscScale"] = { value: params?.sunDiscScale ?? 1.0 };

    // Patch shader to apply the uniforms
    try {
      // Apply intensity scale to vSunE in vertex shader
      if (typeof mat.vertexShader === 'string') {
        const vs = mat.vertexShader;
        const withUniform = vs.includes('sunIntensityScale')
          ? vs
          : vs.replace('uniform vec3 up;', 'uniform vec3 up;\n\t\tuniform float sunIntensityScale;');
        const withScale = withUniform.replace(
          'vSunE = sunIntensity( dot( vSunDirection, up ) );',
          'vSunE = sunIntensity( dot( vSunDirection, up ) ) * sunIntensityScale;'
        );
        mat.vertexShader = withScale;
      }

      // Apply disc scale in fragment shader on the solar disc term
      if (typeof mat.fragmentShader === 'string') {
        const fs = mat.fragmentShader;
        const withUniform = fs.includes('sunDiscScale')
          ? fs
          : fs.replace('uniform vec3 up;', 'uniform vec3 up;\n\t\tuniform float sunDiscScale;');
        const withDiscScale = withUniform.replace(
          'L0 += ( vSunE * 19000.0 * Fex ) * sundisk;',
          'L0 += ( vSunE * 19000.0 * Fex ) * sundisk * sunDiscScale;'
        );
        mat.fragmentShader = withDiscScale;
      }
      mat.needsUpdate = true;
    } catch (err) {
      console.warn('[SkyDome] Failed to patch Sky shader for sun scaling:', err);
    }

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
    if (p.sunIntensityScale !== undefined) (this.uniforms['sunIntensityScale'] as { value: number }).value = p.sunIntensityScale;
    if (p.sunDiscScale !== undefined) (this.uniforms['sunDiscScale'] as { value: number }).value = p.sunDiscScale;
  }

  setSunDirection(dir: THREE.Vector3): void {
    // Convert direction to spherical for Sky
    const d = new THREE.Vector3().copy(dir).normalize();
    // Sky expects sun position in world space
    this.sun.copy(d).multiplyScalar(400000);
    (this.uniforms['sunPosition'].value as THREE.Vector3).copy(this.sun);
  }

  // Optional runtime tweak controls
  setSunLuminance(params: { intensityScale?: number; discScale?: number }): void {
    if (params.intensityScale !== undefined) (this.uniforms['sunIntensityScale'] as { value: number }).value = params.intensityScale;
    if (params.discScale !== undefined) (this.uniforms['sunDiscScale'] as { value: number }).value = params.discScale;
  }
}
