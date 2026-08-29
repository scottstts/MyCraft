/**
 * Screen-space receiver pass for voxel sun visibility.
 *
 * The depth prepass supplies the receiver world position.  This pass then
 * traverses the authoritative occupancy volume with grid DDA toward the
 * current (continuous) sun direction and writes one visibility value per
 * screen pixel.  No light camera, shadow map, projection fitting, or texel
 * snapping participates in this path.  Opaque blocks are traced as voxels;
 * grass occupancy is traced as a small analytic crossed-blade proxy rather
 * than point-sampling the source PNG as micro-geometry.
 */

import * as THREE from 'three';
import { VoxelOccupancyVolume, VOXEL_SHADOW_BRICK_SIZE } from './VoxelOccupancyVolume.js';

const MAX_SHADER_STEPS = 512;
// The real sun's angular radius is ~0.00465 rad (0.266 degrees). A restrained
// 2.25x artistic scale makes that penumbra readable at voxel scale while
// remaining a narrow outdoor-sun transition rather than a point-light blur.
const SOLAR_ANGULAR_RADIUS = 0.00465;
const SUN_ANGULAR_RADIUS = SOLAR_ANGULAR_RADIUS * 2.25;

export interface VoxelSunShadowDiagnostics {
  enabled: boolean;
  supported: boolean;
  resolution: { width: number; height: number };
  maxDistance: number;
  maxSteps: number;
  sunDirection: { x: number; y: number; z: number };
  volume: ReturnType<VoxelOccupancyVolume['getDiagnostics']>;
}

export class VoxelSunShadowPass {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly volume: VoxelOccupancyVolume;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly quadGeometry: THREE.PlaneGeometry;
  private readonly quadMaterial: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly resolution = new THREE.Vector2(1, 1);
  private readonly sunDirection = new THREE.Vector3(0.7, 0.7, 0).normalize();
  private depthTexture: THREE.Texture | null = null;
  private enabled = true;
  private maxDistance = 300;
  private maxSteps = MAX_SHADER_STEPS;
  private supported: boolean;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number, volume: VoxelOccupancyVolume) {
    this.renderer = renderer;
    this.volume = volume;
    this.supported = renderer.capabilities.isWebGL2;

    const effectiveWidth = Math.max(1, Math.floor(width * renderer.getPixelRatio()));
    const effectiveHeight = Math.max(1, Math.floor(height * renderer.getPixelRatio()));
    this.resolution.set(effectiveWidth, effectiveHeight);
    this.target = new THREE.WebGLRenderTarget(effectiveWidth, effectiveHeight, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.target.texture.colorSpace = THREE.NoColorSpace;

    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.quadMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tDepth: { value: null },
        uVoxelOccupancy: { value: volume.texture },
        uBrickOccupancy: { value: volume.brickTexture },
        uGrassOccupancy: { value: volume.grassTexture },
        uVolumeOrigin: { value: volume.origin.clone() },
        uVolumeSize: { value: volume.dimensions.clone() },
        uBrickGridSize: { value: volume.brickDimensions.clone() },
        uSunDirection: { value: this.sunDirection.clone() },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 1024 },
        uInvProjectionMatrix: { value: new THREE.Matrix4() },
        uCameraMatrixWorld: { value: new THREE.Matrix4() },
        uMaxDistance: { value: this.maxDistance },
        uMaxSteps: { value: this.maxSteps },
        uSunAngularRadius: { value: SUN_ANGULAR_RADIUS },
        uEnabled: { value: true },
      },
      vertexShader: `
        out vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        precision highp int;

        uniform sampler2D tDepth;
        uniform sampler3D uVoxelOccupancy;
        uniform sampler3D uBrickOccupancy;
        uniform sampler3D uGrassOccupancy;
        uniform vec3 uVolumeOrigin;
        uniform vec3 uVolumeSize;
        uniform vec3 uBrickGridSize;
        uniform vec3 uSunDirection;
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform mat4 uInvProjectionMatrix;
        uniform mat4 uCameraMatrixWorld;
        uniform float uMaxDistance;
        uniform int uMaxSteps;
        uniform float uSunAngularRadius;
        uniform bool uEnabled;

        in vec2 vUv;
        layout(location = 0) out vec4 outColor;

        const int BRICK_SIZE = ${VOXEL_SHADOW_BRICK_SIZE};

        bool insideVolume(ivec3 cell) {
          return all(greaterThanEqual(cell, ivec3(0))) &&
            all(lessThan(cell, ivec3(uVolumeSize)));
        }

        bool insideBrickGrid(ivec3 cell) {
          return all(greaterThanEqual(cell, ivec3(0))) &&
            all(lessThan(cell, ivec3(uBrickGridSize)));
        }

        float voxelAt(ivec3 cell) {
          return texture(uVoxelOccupancy, (vec3(cell) + vec3(0.5)) / uVolumeSize).r;
        }

        float brickAt(ivec3 brick) {
          return texture(uBrickOccupancy, (vec3(brick) + vec3(0.5)) / uBrickGridSize).r;
        }

        float grassAt(ivec3 cell) {
          return texture(uGrassOccupancy, (vec3(cell) + vec3(0.5)) / uVolumeSize).r;
        }

        // A grass tuft is rendered as two crossed billboard planes.  For
        // shadows we use a compact vector silhouette made from seven tapered
        // blades on each plane.  This deliberately does not turn every alpha
        // texel in grass_leaves.png into a separate caster: at grazing sun
        // angles that representation projects source scanlines onto the
        // receiver and creates the striped artifact this pass is designed to
        // avoid.
        float taperedBlade(vec2 uv, float baseX, float tip, float lean, float baseWidth) {
          if (uv.y < 0.0 || uv.y > tip) return 0.0;
          float t = clamp(uv.y / max(tip, 1e-4), 0.0, 1.0);
          float center = baseX + lean * t;
          float width = mix(baseWidth, 0.010, t);
          return 1.0 - smoothstep(width * 0.55, width, abs(uv.x - center));
        }

        float bladeCoverage(vec2 uv) {
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
          float coverage = 0.0;
          // base, tip, lean, base width for a deliberately irregular tuft.
          coverage = max(coverage, taperedBlade(uv, 0.16, 0.78, -0.08, 0.045));
          coverage = max(coverage, taperedBlade(uv, 0.29, 0.96,  0.03, 0.055));
          coverage = max(coverage, taperedBlade(uv, 0.43, 0.88, -0.05, 0.060));
          coverage = max(coverage, taperedBlade(uv, 0.55, 1.00,  0.08, 0.065));
          coverage = max(coverage, taperedBlade(uv, 0.68, 0.91, -0.03, 0.052));
          coverage = max(coverage, taperedBlade(uv, 0.80, 0.72,  0.04, 0.045));
          coverage = max(coverage, taperedBlade(uv, 0.91, 0.56, -0.02, 0.040));
          return coverage;
        }

        bool grassBladeHit(vec3 local, vec3 direction, ivec3 cell, float maxTravel) {
          vec3 cellMin = vec3(cell);
          const float base = 0.04;
          const float extent = 0.92;
          const float height = 0.90;
          const float epsilon = 1e-4;
          const float selfHitEpsilon = 0.01;

          // First billboard plane: z is fixed, x/y carry the silhouette UV.
          if (abs(direction.z) > epsilon) {
            float travelZ = (cellMin.z + 0.5 - local.z) / direction.z;
            if (travelZ > selfHitEpsilon && travelZ <= maxTravel + epsilon) {
              vec3 point = local + direction * travelZ;
              if (point.y >= cellMin.y - epsilon && point.y <= cellMin.y + height + epsilon &&
                  point.x >= cellMin.x + base - epsilon && point.x <= cellMin.x + base + extent + epsilon) {
                vec2 uv = vec2((point.x - cellMin.x - base) / extent, (point.y - cellMin.y) / height);
                if (bladeCoverage(uv) > 0.5) return true;
              }
            }
          }

          // Second billboard plane: x is fixed, z/y carry the same silhouette.
          if (abs(direction.x) > epsilon) {
            float travelX = (cellMin.x + 0.5 - local.x) / direction.x;
            if (travelX > selfHitEpsilon && travelX <= maxTravel + epsilon) {
              vec3 point = local + direction * travelX;
              if (point.y >= cellMin.y - epsilon && point.y <= cellMin.y + height + epsilon &&
                  point.z >= cellMin.z + base - epsilon && point.z <= cellMin.z + base + extent + epsilon) {
                vec2 uv = vec2((point.z - cellMin.z - base) / extent, (point.y - cellMin.y) / height);
                if (bladeCoverage(uv) > 0.5) return true;
              }
            }
          }
          return false;
        }

        float readViewDepth(vec2 uv) {
          float rawDepth = texture(tDepth, clamp(uv, vec2(0.0), vec2(1.0))).r;
          if (rawDepth >= 0.999999) return uCameraFar;
          float viewZ = (uCameraNear * uCameraFar) /
            ((uCameraFar - uCameraNear) * rawDepth - uCameraFar);
          return -viewZ;
        }

        vec3 reconstructWorldPosition(vec2 uv, float viewDepth) {
          vec2 ndc = uv * 2.0 - 1.0;
          vec4 viewFar = uInvProjectionMatrix * vec4(ndc, 1.0, 1.0);
          viewFar /= viewFar.w;
          vec3 directionView = normalize(viewFar.xyz);
          vec3 positionView = directionView * (viewDepth / max(1e-4, -directionView.z));
          return (uCameraMatrixWorld * vec4(positionView, 1.0)).xyz;
        }

        float minimumPositive(vec3 values) {
          float result = 1e30;
          if (values.x > 1e-5) result = min(result, values.x);
          if (values.y > 1e-5) result = min(result, values.y);
          if (values.z > 1e-5) result = min(result, values.z);
          return result;
        }

        float traceVisibility(vec3 receiverWorld, vec3 rayDirection) {
          vec3 direction = normalize(rayDirection);
          vec3 directionSafe = vec3(
            abs(direction.x) < 1e-5 ? (direction.x < 0.0 ? -1e-5 : 1e-5) : direction.x,
            abs(direction.y) < 1e-5 ? (direction.y < 0.0 ? -1e-5 : 1e-5) : direction.y,
            abs(direction.z) < 1e-5 ? (direction.z < 0.0 ? -1e-5 : 1e-5) : direction.z
          );
          // Start just outside the receiver.  Opaque self-intersection is
          // suppressed by cell identity, while grass is tested independently
          // below so a tuft rooted directly on a terrain face remains a valid
          // caster even when it shares the receiver's integer cell.
          vec3 local = receiverWorld + direction * 0.002 - uVolumeOrigin;
          ivec3 receiverCell = ivec3(floor(receiverWorld - uVolumeOrigin));
          ivec3 cell = ivec3(floor(local));
          vec3 stepAxis = sign(direction);
          vec3 inverseDirection = 1.0 / abs(directionSafe);
          float travelled = 0.0;

          for (int iteration = 0; iteration < ${MAX_SHADER_STEPS}; iteration++) {
            if (iteration >= uMaxSteps) break;

            if (!insideVolume(cell)) return 1.0;

            // Preserve the established opaque self-intersection rule.  Grass
            // does not use this gate; it has its own minimum hit distance.
            bool differentOpaqueCell = any(notEqual(cell, receiverCell));
            if (differentOpaqueCell && voxelAt(cell) > 0.5) return 0.0;

            ivec3 brick = cell / BRICK_SIZE;
            if (insideBrickGrid(brick) && brickAt(brick) < 0.5) {
              vec3 brickMin = vec3(brick * BRICK_SIZE);
              vec3 brickBoundary = brickMin + mix(
                vec3(0.0), vec3(float(BRICK_SIZE)), greaterThan(direction, vec3(0.0))
              );
              vec3 brickDistance = (brickBoundary - local) / directionSafe;
              float jump = minimumPositive(brickDistance);
              if (jump < 1e29) {
                travelled += jump;
                if (travelled > uMaxDistance) return 1.0;
                local += directionSafe * (jump + 1e-3);
                cell = ivec3(floor(local));
                continue;
              }
            }

            vec3 voxelBoundary = vec3(cell) + mix(
              vec3(0.0), vec3(1.0), greaterThan(direction, vec3(0.0))
            );
            vec3 voxelDistance = (voxelBoundary - local) / directionSafe;
            float travel = minimumPositive(voxelDistance);
            travelled += travel;
            if (travelled > uMaxDistance || travel >= 1e29) return 1.0;

            if (grassAt(cell) > 0.5 && grassBladeHit(local, direction, cell, travel)) return 0.0;

            if (voxelDistance.x <= voxelDistance.y && voxelDistance.x <= voxelDistance.z) {
              cell.x += int(stepAxis.x);
            } else if (voxelDistance.y <= voxelDistance.z) {
              cell.y += int(stepAxis.y);
            } else {
              cell.z += int(stepAxis.z);
            }
            local += directionSafe * travel;
          }
          return 1.0;
        }

        float traceSolarDisc(vec3 receiver, vec3 sun, vec3 tangentA, vec3 tangentB) {
          // Five cheap probes are used only as a boundary classifier.  If all
          // agree, the receiver is in stable umbra/full light and no extra
          // rays are needed.  Mixed probes trigger equal-area disc sampling.
          float center = traceVisibility(receiver, sun);
          float sideA = traceVisibility(receiver, normalize(sun + tangentA * uSunAngularRadius));
          float sideB = traceVisibility(receiver, normalize(sun - tangentA * uSunAngularRadius));
          float sideC = traceVisibility(receiver, normalize(sun + tangentB * uSunAngularRadius));
          float sideD = traceVisibility(receiver, normalize(sun - tangentB * uSunAngularRadius));
          if (center == sideA && center == sideB && center == sideC && center == sideD) return center;

          const int DISC_SAMPLES = 16;
          const float GOLDEN_ANGLE = 2.39996323;
          float sum = center + sideA + sideB + sideC + sideD;
          for (int i = 0; i < DISC_SAMPLES; i++) {
            float fraction = (float(i) + 0.5) / float(DISC_SAMPLES);
            float radius = sqrt(fraction) * uSunAngularRadius;
            float angle = (float(i) + 0.5) * GOLDEN_ANGLE;
            vec2 disk = vec2(cos(angle), sin(angle)) * radius;
            sum += traceVisibility(receiver, normalize(sun + tangentA * disk.x + tangentB * disk.y));
          }
          return sum / float(5 + DISC_SAMPLES);
        }

        void main() {
          float viewDepth = readViewDepth(vUv);
          if (!uEnabled || viewDepth >= uCameraFar * 0.999) {
            outColor = vec4(1.0, 0.0, 0.0, 1.0);
            return;
          }
          vec3 receiver = reconstructWorldPosition(vUv, viewDepth);
          vec3 sun = normalize(uSunDirection);
          // Project a fixed world-up vector onto the solar-disc tangent plane.
          // Only the singular straight-up case needs a fallback; there is no
          // arbitrary |sun.y| threshold that can rotate the kernel in flight.
          vec3 tangentSeed = vec3(0.0, 1.0, 0.0);
          vec3 tangentA = tangentSeed - sun * dot(tangentSeed, sun);
          if (dot(tangentA, tangentA) < 1e-6) tangentA = vec3(1.0, 0.0, 0.0);
          tangentA = normalize(tangentA);
          vec3 tangentB = normalize(cross(sun, tangentA));
          float visibility = traceSolarDisc(receiver, sun, tangentA, tangentB);
          outColor = vec4(visibility, 0.0, 0.0, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = new THREE.Mesh(this.quadGeometry, this.quadMaterial);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  getTexture(): THREE.Texture {
    return this.target.texture;
  }

  setDepthTexture(texture: THREE.Texture): void {
    this.depthTexture = texture;
    this.quadMaterial.uniforms.tDepth.value = texture;
  }

  setSize(width: number, height: number): void {
    const effectiveWidth = Math.max(1, Math.floor(width * this.renderer.getPixelRatio()));
    const effectiveHeight = Math.max(1, Math.floor(height * this.renderer.getPixelRatio()));
    this.resolution.set(effectiveWidth, effectiveHeight);
    this.target.setSize(effectiveWidth, effectiveHeight);
  }

  setSunDirection(direction: THREE.Vector3): void {
    this.sunDirection.copy(direction).normalize();
    (this.quadMaterial.uniforms.uSunDirection.value as THREE.Vector3).copy(this.sunDirection);
  }

  setSettings(settings: { enabled?: boolean; maxDistance?: number; maxSteps?: number }): void {
    if (settings.enabled !== undefined) this.enabled = !!settings.enabled;
    if (settings.maxDistance !== undefined) this.maxDistance = THREE.MathUtils.clamp(settings.maxDistance, 1, 2000);
    if (settings.maxSteps !== undefined) this.maxSteps = THREE.MathUtils.clamp(Math.floor(settings.maxSteps), 32, MAX_SHADER_STEPS);
    this.quadMaterial.uniforms.uEnabled.value = this.enabled;
    this.quadMaterial.uniforms.uMaxDistance.value = this.maxDistance;
    this.quadMaterial.uniforms.uMaxSteps.value = this.maxSteps;
  }

  update(camera: THREE.PerspectiveCamera, sunDirection: THREE.Vector3): void {
    this.setSunDirection(sunDirection);
    this.quadMaterial.uniforms.uCameraNear.value = camera.near;
    this.quadMaterial.uniforms.uCameraFar.value = camera.far;
    (this.quadMaterial.uniforms.uInvProjectionMatrix.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (this.quadMaterial.uniforms.uCameraMatrixWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    if (this.depthTexture) this.quadMaterial.uniforms.tDepth.value = this.depthTexture;

    if (!this.supported) return;
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previousTarget);
  }

  getDiagnostics(): VoxelSunShadowDiagnostics {
    return {
      enabled: this.enabled,
      supported: this.supported,
      resolution: { width: this.resolution.x, height: this.resolution.y },
      maxDistance: this.maxDistance,
      maxSteps: this.maxSteps,
      sunDirection: { x: this.sunDirection.x, y: this.sunDirection.y, z: this.sunDirection.z },
      volume: this.volume.getDiagnostics(),
    };
  }

  dispose(): void {
    this.target.dispose();
    this.quadGeometry.dispose();
    this.quadMaterial.dispose();
  }
}
