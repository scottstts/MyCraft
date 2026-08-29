/**
 * Screen-space receiver pass for voxel sun visibility.
 *
 * The depth prepass supplies the receiver world position.  This pass then
 * traverses the authoritative occupancy volume with grid DDA toward the
 * current (continuous) sun direction and writes one visibility value per
 * screen pixel.  No light camera, shadow map, projection fitting, or texel
 * snapping participates in this path.
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
        uGrassTexture: { value: null },
        uGrassAlphaCutoff: { value: 0.15 },
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
        uniform sampler2D uGrassTexture;
        uniform float uGrassAlphaCutoff;
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

        bool grassBladeHit(vec3 local, vec3 direction, ivec3 cell, float maxTravel) {
          vec3 cellMin = vec3(cell);
          const float base = 0.04;
          const float extent = 0.92;
          const float height = 0.90;
          const float epsilon = 1e-4;

          // Plane A: x is fixed, z/y carry the grass image coordinates.
          if (abs(direction.x) > epsilon) {
            float travelX = (cellMin.x + 0.5 - local.x) / direction.x;
            if (travelX >= -epsilon && travelX <= maxTravel + epsilon) {
              vec3 point = local + direction * travelX;
              if (point.y >= cellMin.y - epsilon && point.y <= cellMin.y + height + epsilon &&
                  point.z >= cellMin.z + base - epsilon && point.z <= cellMin.z + base + extent + epsilon) {
                vec2 uv = vec2((point.z - cellMin.z - base) / extent, 1.0 - (point.y - cellMin.y) / height);
                if (texture(uGrassTexture, clamp(uv, vec2(0.0), vec2(1.0))).a >= uGrassAlphaCutoff) return true;
              }
            }
          }

          // Plane B: z is fixed, x/y carry the grass image coordinates.
          if (abs(direction.z) > epsilon) {
            float travelZ = (cellMin.z + 0.5 - local.z) / direction.z;
            if (travelZ >= -epsilon && travelZ <= maxTravel + epsilon) {
              vec3 point = local + direction * travelZ;
              if (point.y >= cellMin.y - epsilon && point.y <= cellMin.y + height + epsilon &&
                  point.x >= cellMin.x + base - epsilon && point.x <= cellMin.x + base + extent + epsilon) {
                vec2 uv = vec2((point.x - cellMin.x - base) / extent, 1.0 - (point.y - cellMin.y) / height);
                if (texture(uGrassTexture, clamp(uv, vec2(0.0), vec2(1.0))).a >= uGrassAlphaCutoff) return true;
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
          vec3 local = receiverWorld + direction * 0.002 - uVolumeOrigin;
          ivec3 receiverCell = ivec3(floor(receiverWorld - uVolumeOrigin));
          ivec3 cell = ivec3(floor(local));
          vec3 stepAxis = sign(direction);
          vec3 inverseDirection = 1.0 / abs(directionSafe);
          float travelled = 0.0;

          for (int iteration = 0; iteration < ${MAX_SHADER_STEPS}; iteration++) {
            if (iteration >= uMaxSteps) break;

            if (!insideVolume(cell)) return 1.0;

            // The receiver voxel itself is intentionally skipped. This is the
            // geometric self-intersection rule that replaces depth bias.
            bool differentCell = any(notEqual(cell, receiverCell));
            if (differentCell && voxelAt(cell) > 0.5) return 0.0;

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

            if (differentCell && grassAt(cell) > 0.5 && grassBladeHit(local, direction, cell, travel)) return 0.0;

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

        void main() {
          float viewDepth = readViewDepth(vUv);
          if (!uEnabled || viewDepth >= uCameraFar * 0.999) {
            outColor = vec4(1.0, 0.0, 0.0, 1.0);
            return;
          }
          vec3 receiver = reconstructWorldPosition(vUv, viewDepth);
          vec3 sun = normalize(uSunDirection);
          vec3 tangentUp = abs(sun.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 tangentA = normalize(cross(sun, tangentUp));
          vec3 tangentB = normalize(cross(sun, tangentA));
          vec3 spreadA = tangentA * uSunAngularRadius;
          vec3 spreadB = tangentB * uSunAngularRadius;
          // Fixed five-ray quadrature samples a small solar disc. The center
          // ray preserves hard contact/umbra while the four ring rays create
          // a stable, directionally complete penumbra with no random noise.
          float center = traceVisibility(receiver, sun);
          float sideA = traceVisibility(receiver, normalize(sun + spreadA));
          float sideB = traceVisibility(receiver, normalize(sun - spreadA));
          float sideC = traceVisibility(receiver, normalize(sun + spreadB));
          float sideD = traceVisibility(receiver, normalize(sun - spreadB));
          float visibility = center * 0.4 + (sideA + sideB + sideC + sideD) * 0.15;
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

  setGrassTexture(texture: THREE.Texture): void {
    this.quadMaterial.uniforms.uGrassTexture.value = texture;
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
