import * as THREE from 'three'
import {
  OCEAN_CAUSTIC_WAVES,
  OCEAN_WAVES,
  oceanCausticWaveDeclarations,
  oceanWaveDeclarations,
} from './OceanWaveField'
import { CAUSTIC_FIELD_SCALE, CAUSTIC_REFERENCE_DEPTH, WATER_IOR } from './WaterOptics'
export { CAUSTIC_FIELD_SCALE, CAUSTIC_REFERENCE_DEPTH } from './WaterOptics'

/** Small world-anchored tile used for stable, repeatable caustic filaments. */
export const CAUSTIC_TILE_SIZE = 17.0

export interface WaterCausticsOptions {
  resolution?: number
  extent?: number
  patchExtent?: number
  projectDepth?: number
}

/**
 * A small world-anchored tiled caustic field for the WebGL renderer.
 *
 * The pass follows the submerged-ocean example's differential-area method:
 * a regular surface patch is refracted onto a virtual floor and the old/new
 * projected-area ratio becomes the concentration.  It is intentionally a
 * render-only target; gameplay blocks and selection never see this object.
 */
export class WaterCaustics {
  private readonly renderer: THREE.WebGLRenderer
  private readonly target: THREE.WebGLRenderTarget
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly geometry: THREE.PlaneGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly resolution: number
  private readonly extent: number
  private readonly patchExtent: number
  private readonly referenceDepth: number
  private readonly origin = new THREE.Vector2()
  private disposed = false
  private warned = false

  constructor(renderer: THREE.WebGLRenderer, options: WaterCausticsOptions = {}) {
    this.renderer = renderer
    this.resolution = Math.max(128, Math.min(512, Math.floor(options.resolution ?? 256)))
    // The submerged example uses a short tile (17 m) and wraps it. Keeping
    // this footprint small gives the 256² projection enough texels to resolve
    // thin caustic lines instead of averaging them into broad patches.
    this.extent = Math.max(8, options.extent ?? CAUSTIC_TILE_SIZE)
    this.patchExtent = Math.max(this.extent * 1.2, options.patchExtent ?? this.extent * 1.35)
    this.referenceDepth = Math.max(2, options.projectDepth ?? CAUSTIC_REFERENCE_DEPTH)
    const supportsHalfFloat = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float')
    const waveDeclarations = `${oceanWaveDeclarations()}\n${oceanCausticWaveDeclarations()}`

    this.target = new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
      format: THREE.RGBAFormat,
      type: supportsHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    })
    this.target.texture.wrapS = THREE.RepeatWrapping
    this.target.texture.wrapT = THREE.RepeatWrapping
    this.target.texture.generateMipmaps = false
    this.target.texture.colorSpace = THREE.NoColorSpace

    const displacementTerms = [
      ...Array.from({ length: OCEAN_WAVES.length }, (_, index) => ({ prefix: 'OCEAN_WAVE', index, lod: true })),
      ...Array.from({ length: OCEAN_CAUSTIC_WAVES.length }, (_, index) => ({ prefix: 'CAUSTIC_WAVE', index, lod: false })),
    ]
    const displacement = displacementTerms.map(({ prefix, index, lod }) => `
      {
        float k = 6.28318530718 / ${prefix}_LENGTH_${index};
        float omega = oceanOmega(k, ${prefix}_SPEED_${index}) * uWaveSpeed;
        float phase = k * dot(${prefix}_DIRECTION_${index}, xz) - omega * time + ${prefix}_PHASE_${index};
        float amplitude = ${prefix}_AMPLITUDE_${index}${lod ? ' * min(uWaveAmp, 1.0) * oceanWaveLod(0.0, ' + prefix + '_LENGTH_' + index + ')' : ''};
        float c = cos(phase);
        displaced.xz += ${prefix}_DIRECTION_${index} * ${prefix}_STEEPNESS_${index} * amplitude * uWaveChop * c;
        displaced.y += amplitude * sin(phase);
      }
    `).join('\n')
    const normal = displacementTerms.map(({ prefix, index, lod }) => `
      {
        float k = 6.28318530718 / ${prefix}_LENGTH_${index};
        float omega = oceanOmega(k, ${prefix}_SPEED_${index}) * uWaveSpeed;
        float phase = k * dot(${prefix}_DIRECTION_${index}, xz) - omega * time + ${prefix}_PHASE_${index};
        float amplitude = ${prefix}_AMPLITUDE_${index}${lod ? ' * min(uWaveAmp, 1.0) * oceanWaveLod(0.0, ' + prefix + '_LENGTH_' + index + ')' : ''};
        float q = ${prefix}_STEEPNESS_${index};
        float s = sin(phase);
        float c = cos(phase);
        float dx = ${prefix}_DIRECTION_${index}.x;
        float dz = ${prefix}_DIRECTION_${index}.y;
        float phaseDx = k * dx;
        float phaseDz = k * dz;
        tangentX += vec3(-q * amplitude * dx * phaseDx * s, amplitude * phaseDx * c, -q * amplitude * dz * phaseDx * s);
        tangentZ += vec3(-q * amplitude * dx * phaseDz * s, amplitude * phaseDz * c, -q * amplitude * dz * phaseDz * s);
      }
    `).join('\n')

    this.geometry = new THREE.PlaneGeometry(2, 2, this.resolution, this.resolution)
    this.material = new THREE.ShaderMaterial({
      name: 'MyCraftWaterCaustics',
      uniforms: {
        uOrigin: { value: this.origin },
        uExtent: { value: this.extent },
        uPatchExtent: { value: this.patchExtent },
        uTime: { value: 0 },
        uProjectDepth: { value: this.referenceDepth },
        uEta: { value: 1.0 / WATER_IOR },
        uFieldScale: { value: CAUSTIC_FIELD_SCALE },
        // oceanWaveDeclarations also emits the shared displacement helper.
        // Keep its controls declared here even though this projection uses
        // the fixed full-spectrum caustic path below.
        uWaveAmp: { value: 1.0 },
        uWaveChop: { value: 1.0 },
        uWaveSpeed: { value: 1.0 },
        uSunDirection: { value: new THREE.Vector3(0.35, 0.9, 0.2).normalize() },
      },
      vertexShader: `
        precision highp float;
        uniform vec2 uOrigin;
        uniform float uExtent;
        uniform float uPatchExtent;
        uniform float uTime;
        uniform float uProjectDepth;
        uniform float uEta;
        uniform float uWaveAmp;
        uniform float uWaveChop;
        uniform float uWaveSpeed;
        uniform vec3 uSunDirection;
        ${waveDeclarations}

        varying vec2 vOldPosition;
        varying vec2 vNewPosition;

        float oceanTanh(float x) {
          float e = exp(min(2.0 * x, 20.0));
          return (e - 1.0) / (e + 1.0);
        }

        float oceanOmega(float k, float speed) {
          float depthTerm = oceanTanh(min(k * OCEAN_WATER_DEPTH, 20.0));
          float gravityTerm = 9.81 * k * depthTerm;
          float capillaryTerm = OCEAN_SURFACE_TENSION_OVER_DENSITY * k * k * k;
          return sqrt(max(gravityTerm + capillaryTerm, 0.0)) * speed;
        }

        vec3 oceanDisplacement(vec2 xz, float time) {
          vec3 displaced = vec3(0.0);
          ${displacement}
          displaced.y = clamp(displaced.y, -OCEAN_WAVE_HALF_RANGE, OCEAN_WAVE_HALF_RANGE);
          return displaced;
        }

        vec3 oceanNormal(vec2 xz, float time) {
          vec3 tangentX = vec3(1.0, 0.0, 0.0);
          vec3 tangentZ = vec3(0.0, 0.0, 1.0);
          ${normal}
          return normalize(cross(tangentZ, tangentX));
        }

        void main() {
          vec3 sun = normalize(uSunDirection);
          vec3 flatRefract = refract(-sun, vec3(0.0, 1.0, 0.0), uEta);
          float flatTravel = uProjectDepth / max(abs(flatRefract.y), 0.12);
          vec2 flatOffset = flatRefract.xz * flatTravel;
          // Center the source patch so its flat Snell projection is centered
          // on the same world tile as the receiver. This is the inverse of
          // the depth-correct receiver projection used by terrain and the
          // underwater volume.
          vec2 surfaceXZ = uOrigin - flatOffset + (uv - 0.5) * uPatchExtent;

          vec3 displacement = oceanDisplacement(surfaceXZ, uTime);
          vec3 surfaceNormal = oceanNormal(surfaceXZ, uTime);
          vec3 waveRefract = refract(-sun, surfaceNormal, uEta);
          float waveTravel = (uProjectDepth + displacement.y) / max(abs(waveRefract.y), 0.12);

          // The old projection is the undeformed optical map.  The new map
          // carries horizontal Gerstner displacement and bent Snell rays.
          vOldPosition = surfaceXZ + flatOffset;
          vNewPosition = surfaceXZ + displacement.xz + waveRefract.xz * waveTravel;
          vec2 ndc = (vNewPosition - uOrigin) / max(uExtent, 1.0) * 2.0;
          gl_Position = vec4(ndc, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uFieldScale;
        varying vec2 vOldPosition;
        varying vec2 vNewPosition;

        void main() {
          vec2 oldDx = dFdx(vOldPosition);
          vec2 oldDy = dFdy(vOldPosition);
          vec2 newDx = dFdx(vNewPosition);
          vec2 newDy = dFdy(vNewPosition);
          float oldArea = abs(oldDx.x * oldDy.y - oldDx.y * oldDy.x);
          float newArea = max(abs(newDx.x * newDy.y - newDx.y * newDy.x), 1e-5);
          // The ratio is the irradiance concentration for a regular bundle
          // of rays. No independent line pattern is added: every filament is
          // produced by the live wave slope and Snell projection above.
          float concentration = clamp(oldArea / newArea, 0.0, 8.0);
          float encodedField = clamp(concentration / max(uFieldScale, 1.0), 0.0, 1.0);
          gl_FragColor = vec4(vec3(encodedField), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(this.geometry, this.material)
    mesh.name = 'WaterCausticProjection'
    mesh.frustumCulled = false
    this.scene.add(mesh)
  }

  setSun(direction: THREE.Vector3): void {
    const target = this.material.uniforms.uSunDirection.value as THREE.Vector3
    target.copy(direction).normalize()
  }

  update(timeSeconds: number, centerX: number, centerZ: number): void {
    if (this.disposed) return
    this.material.uniforms.uTime.value = timeSeconds
    // Keep the optical tile world anchored.  Following the camera on a large
    // snap grid made the caustic texture jump (and visibly flash) whenever a
    // boundary was crossed; RepeatWrapping now gives every receiver the same
    // stable pattern in world space.
    this.origin.set(0, 0)
    void centerX
    void centerZ

    const previousTarget = this.renderer.getRenderTarget()
    const previousViewport = new THREE.Vector4()
    const previousScissor = new THREE.Vector4()
    this.renderer.getViewport(previousViewport)
    this.renderer.getScissor(previousScissor)
    const previousScissorTest = this.renderer.getScissorTest()
    const previousAutoClear = this.renderer.autoClear
    const previousClearColor = new THREE.Color()
    this.renderer.getClearColor(previousClearColor)
    const previousClearAlpha = this.renderer.getClearAlpha()

    try {
      this.renderer.setRenderTarget(this.target)
      this.renderer.setViewport(0, 0, this.resolution, this.resolution)
      this.renderer.setScissor(0, 0, this.resolution, this.resolution)
      this.renderer.setScissorTest(false)
      this.renderer.autoClear = false
      this.renderer.setClearColor(0x000000, 0)
      this.renderer.clear(true, false, false)
      this.renderer.render(this.scene, this.camera)
    } catch (error) {
      if (!this.warned) {
        this.warned = true
        console.warn('[WaterCaustics] Disabled after render failure:', error)
      }
    } finally {
      this.renderer.setRenderTarget(previousTarget)
      this.renderer.setViewport(previousViewport)
      this.renderer.setScissor(previousScissor)
      this.renderer.setScissorTest(previousScissorTest)
      this.renderer.autoClear = previousAutoClear
      this.renderer.setClearColor(previousClearColor, previousClearAlpha)
    }
  }

  getTexture(): THREE.Texture { return this.target.texture }

  getOrigin(): { x: number; y: number } { return { x: this.origin.x, y: this.origin.y } }

  getExtent(): number { return this.extent }

  getReferenceDepth(): number { return this.referenceDepth }

  getResolution(): { x: number; y: number } { return { x: this.resolution, y: this.resolution } }

  getDiagnostics(): Record<string, unknown> {
    return {
      resolution: this.resolution,
      extent: this.extent,
      patchExtent: this.patchExtent,
      referenceDepth: this.referenceDepth,
      fieldScale: CAUSTIC_FIELD_SCALE,
      origin: this.origin.toArray(),
      disposed: this.disposed,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.geometry.dispose()
    this.material.dispose()
    this.target.dispose()
  }
}
