import * as THREE from 'three'
import { OCEAN_WAVES, oceanWaveDeclarations } from './OceanWaveField'

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
    const supportsHalfFloat = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float')
    const waveDeclarations = oceanWaveDeclarations()

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

    const displacement = Array.from({ length: OCEAN_WAVES.length }, (_, index) => `
      {
        float k = 6.28318530718 / OCEAN_WAVE_LENGTH_${index};
        float omega = oceanOmega(k, OCEAN_WAVE_SPEED_${index});
        float phase = k * dot(OCEAN_WAVE_DIRECTION_${index}, xz) - omega * time + OCEAN_WAVE_PHASE_${index};
        float amplitude = OCEAN_WAVE_AMPLITUDE_${index};
        float c = cos(phase);
        displaced.xz += OCEAN_WAVE_DIRECTION_${index} * OCEAN_WAVE_STEEPNESS_${index} * amplitude * c;
        displaced.y += amplitude * sin(phase);
      }
    `).join('\n')
    const normal = Array.from({ length: OCEAN_WAVES.length }, (_, index) => `
      {
        float k = 6.28318530718 / OCEAN_WAVE_LENGTH_${index};
        float omega = oceanOmega(k, OCEAN_WAVE_SPEED_${index});
        float phase = k * dot(OCEAN_WAVE_DIRECTION_${index}, xz) - omega * time + OCEAN_WAVE_PHASE_${index};
        float amplitude = OCEAN_WAVE_AMPLITUDE_${index};
        float q = OCEAN_WAVE_STEEPNESS_${index};
        float s = sin(phase);
        float c = cos(phase);
        float dx = OCEAN_WAVE_DIRECTION_${index}.x;
        float dz = OCEAN_WAVE_DIRECTION_${index}.y;
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
        uProjectDepth: { value: options.projectDepth ?? 24 },
        uEta: { value: 1.0 / 1.333 },
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
          vec2 surfaceXZ = uOrigin + (uv - 0.5) * uPatchExtent;
          vec3 sun = normalize(uSunDirection);
          vec3 flatRefract = refract(-sun, vec3(0.0, 1.0, 0.0), uEta);
          float flatTravel = uProjectDepth / max(abs(flatRefract.y), 0.12);
          vec2 flatOffset = flatRefract.xz * flatTravel;

          vec3 displacement = oceanDisplacement(surfaceXZ, uTime);
          vec3 surfaceNormal = oceanNormal(surfaceXZ, uTime);
          vec3 waveRefract = refract(-sun, surfaceNormal, uEta);
          float waveTravel = (uProjectDepth + displacement.y) / max(abs(waveRefract.y), 0.12);

          // The old projection is the undeformed optical map.  The new map
          // carries horizontal Gerstner displacement and bent Snell rays.
          vOldPosition = surfaceXZ + flatOffset;
          vNewPosition = surfaceXZ + displacement.xz + waveRefract.xz * waveTravel - flatOffset;
          vec2 ndc = (vNewPosition - uOrigin) / max(uExtent, 1.0) * 2.0;
          gl_Position = vec4(ndc, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform vec3 uSunDirection;
        uniform float uTime;
        varying vec2 vOldPosition;
        varying vec2 vNewPosition;

        void main() {
          vec2 oldDx = dFdx(vOldPosition);
          vec2 oldDy = dFdy(vOldPosition);
          vec2 newDx = dFdx(vNewPosition);
          vec2 newDy = dFdy(vNewPosition);
          float oldArea = abs(oldDx.x * oldDy.y - oldDx.y * oldDy.x);
          float newArea = max(abs(newDx.x * newDy.y - newDx.y * newDy.x), 1e-5);
          float concentration = clamp((oldArea / newArea) * 0.18, 0.0, 6.0);
          // Differential area supplies the physically meaningful envelope;
          // these three incommensurate ridge bands turn that envelope into
          // the thin, branching caustic lines visible on a pool floor.  The
          // phase is evaluated in the refracted (new) domain, so the live
          // wave field bends and advects the filaments rather than a detached
          // scrolling light decal.
          vec2 p = vNewPosition;
          float bendA = 0.58 * sin(dot(p, vec2(0.37, 0.53)) + uTime * 0.06);
          float bendB = 0.42 * sin(dot(p, vec2(-0.61, 0.29)) - uTime * 0.043);
          float phaseA = dot(p, vec2(1.67, 2.31)) + bendA + 0.35 * bendB;
          float phaseB = dot(p, vec2(-2.09, 1.27)) + bendB - 0.28 * bendA;
          float phaseC = dot(p, vec2(0.83, -2.73)) + 0.55 * sin(dot(p, vec2(0.52, -0.74)) + bendA);
          float aaA = max(fwidth(phaseA), 0.018);
          float aaB = max(fwidth(phaseB), 0.018);
          float aaC = max(fwidth(phaseC), 0.018);
          float ridgeA = 1.0 - smoothstep(0.025 + aaA, 0.27 + aaA, abs(sin(phaseA)));
          float ridgeB = 1.0 - smoothstep(0.025 + aaB, 0.27 + aaB, abs(sin(phaseB)));
          float ridgeC = 1.0 - smoothstep(0.025 + aaC, 0.27 + aaC, abs(sin(phaseC)));
          float deformation = max(length(newDx - oldDx), length(newDy - oldDy));
          float waveFocus = smoothstep(0.008, 0.18, deformation);
          float lineMask = clamp(max(max(ridgeA, ridgeB * 0.88), ridgeC * 0.72) + ridgeA * ridgeB * 0.24, 0.0, 1.0);
          lineMask *= 0.24 + 0.76 * waveFocus;
          float sunVisibility = smoothstep(0.06, 0.22, max(uSunDirection.y, 0.0));
          float field = clamp(concentration * 0.52 + lineMask * (0.72 + 0.42 * smoothstep(0.12, 0.75, concentration)), 0.0, 6.0);
          gl_FragColor = vec4(vec3(field * sunVisibility), 1.0);
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

  getResolution(): { x: number; y: number } { return { x: this.resolution, y: this.resolution } }

  getDiagnostics(): Record<string, unknown> {
    return {
      resolution: this.resolution,
      extent: this.extent,
      patchExtent: this.patchExtent,
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
