import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export interface ExposureMeterSettings {
  minimum: number;
  maximum: number;
  middleGray: number;
  compensation: number;
  speedUp: number;
  speedDown: number;
  cadenceFrames: number;
}

/**
 * Small scene-linear luminance meter. It never swaps the composer buffers; it
 * observes the post-atmosphere HDR signal and adapts renderer exposure for the
 * final OutputPass.
 */
export class ExposureMeterPass extends Pass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly pixels: Uint8Array;
  private readonly settings: ExposureMeterSettings;
  private frame = 0;
  private pending = false;
  private averageLuminance = 0.18;
  private targetExposure = 1;
  private currentExposure = 1;

  constructor(settings: ExposureMeterSettings, width: number, height: number) {
    super();
    this.settings = { ...settings };
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.target.texture.colorSpace = THREE.NoColorSpace;
    this.pixels = new Uint8Array(width * height * 4);
    this.material = new THREE.ShaderMaterial({
      name: 'MyCraftExposureMeter',
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
      uniforms: { tDiffuse: { value: null } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          vec3 color = max(texture2D(tDiffuse, vUv).rgb, vec3(0.0));
          float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
          float encoded = luminance / (luminance + 1.0);
          gl_FragColor = vec4(encoded, encoded, encoded, 1.0);
        }
      `,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
  ): void {
    this.currentExposure = this.adapt(this.currentExposure, this.targetExposure, deltaTime);
    renderer.toneMappingExposure = this.currentExposure;

    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear(true, false, false);
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.quad.render(renderer);
    renderer.setRenderTarget(previousTarget);

    this.frame += 1;
    if (this.frame % Math.max(1, this.settings.cadenceFrames) !== 0 || this.pending) return;
    this.pending = true;
    const width = this.target.width;
    const height = this.target.height;
    const asyncReader = renderer.readRenderTargetPixelsAsync;
    if (typeof asyncReader === 'function') {
      void asyncReader.call(renderer, this.target, 0, 0, width, height, this.pixels)
        .then((pixels) => this.consumePixels(pixels as Uint8Array))
        .catch(() => {
          this.pending = false;
          this.targetExposure = 1;
        });
      return;
    }

    try {
      renderer.readRenderTargetPixels(this.target, 0, 0, width, height, this.pixels);
      this.consumePixels(this.pixels);
    } catch {
      this.pending = false;
      this.targetExposure = 1;
    }
  }

  private consumePixels(pixels: Uint8Array): void {
    let weightedLogSum = 0;
    let weightSum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const encoded = pixels[i] / 255;
      const luminance = encoded / Math.max(0.0001, 1 - encoded);
      const weight = luminance > 0.002 ? 1 : 0.15;
      weightedLogSum += Math.log(Math.max(0.0001, luminance)) * weight;
      weightSum += weight;
    }
    this.averageLuminance = Math.exp(weightedLogSum / Math.max(0.0001, weightSum));
    this.targetExposure = THREE.MathUtils.clamp(
      this.settings.middleGray / Math.max(0.0001, this.averageLuminance)
        * Math.pow(2, this.settings.compensation),
      this.settings.minimum,
      this.settings.maximum,
    );
    this.pending = false;
  }

  private adapt(current: number, target: number, deltaTime: number): number {
    const speed = target > current ? this.settings.speedUp : this.settings.speedDown;
    const amount = 1 - Math.exp(-Math.max(0, deltaTime) * speed);
    return current + (target - current) * amount;
  }

  getDiagnostics(): { averageLuminance: number; targetExposure: number; currentExposure: number; pending: boolean } {
    return {
      averageLuminance: this.averageLuminance,
      targetExposure: this.targetExposure,
      currentExposure: this.currentExposure,
      pending: this.pending,
    };
  }

  reset(): void {
    this.averageLuminance = 0.18;
    this.targetExposure = 1;
    this.currentExposure = 1;
    this.pending = false;
    this.frame = 0;
  }

  setSize(): void {
    // The meter is intentionally fixed at its authored low resolution. The
    // composer still calls every pass' resize hook, but resizing this target
    // would invalidate the matching readback buffer and cause WebGL warnings.
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
