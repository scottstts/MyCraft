/**
 * Screen-space receiver pass for voxel sun visibility.
 *
 * The depth prepass supplies the receiver world position.  This pass then
 * traverses the authoritative occupancy volume with grid DDA toward the
 * current (continuous) sun direction and writes one visibility value per
 * screen pixel.  No light camera, shadow map, projection fitting, or texel
 * snapping participates in this path.  Opaque blocks are traced as voxels;
 * grass and render-only seaweed occupancy are traced as small analytic
 * crossed-blade proxies rather than point-sampling source PNGs as
 * micro-geometry.
 */

import * as THREE from 'three';
import {
  SEAWEED_SHADOW_HEIGHT_MAX,
  VoxelOccupancyVolume,
  VOXEL_SHADOW_BRICK_SIZE,
} from './VoxelOccupancyVolume.js';
import type { CharacterShadowBox } from './CharacterShadowBox';
import { RENDER_STYLE } from '../settings/RenderStyle';
import {
  setForwardRefractionReceiverVolume,
  setForwardRefractionSunVisibility,
} from '../water/ForwardRefraction';

const MAX_SHADER_STEPS = 512;
// The real sun's angular radius is ~0.00465 rad (0.266 degrees). A restrained
// 2.25x artistic scale makes that penumbra readable at voxel scale while
// remaining a narrow outdoor-sun transition rather than a point-light blur.
const SOLAR_ANGULAR_RADIUS = 0.00465;
const SUN_ANGULAR_RADIUS = SOLAR_ANGULAR_RADIUS * 2.25;
// The reference rig currently contributes 17 box meshes. Keep a small amount
// of headroom without inflating the fragment uniform arrays unnecessarily.
const MAX_CHARACTER_SHADOW_BOXES = 24;

export interface VoxelSunShadowDiagnostics {
  enabled: boolean;
  supported: boolean;
  resolution: { width: number; height: number };
  maxDistance: number;
  maxSteps: number;
  characterShadowBoxes: number;
  characterShadowScreenBounds: { minX: number; minY: number; maxX: number; maxY: number };
  sunDirection: { x: number; y: number; z: number };
  volume: ReturnType<VoxelOccupancyVolume['getDiagnostics']>;
}

export class VoxelSunShadowPass {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly volume: VoxelOccupancyVolume;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly forwardTarget: THREE.WebGLRenderTarget;
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
  private readonly characterBoxInverse = Array.from(
    { length: MAX_CHARACTER_SHADOW_BOXES },
    () => new THREE.Matrix4(),
  );
  private readonly characterBoxCenters = Array.from(
    { length: MAX_CHARACTER_SHADOW_BOXES },
    () => new THREE.Vector3(),
  );
  private readonly characterBoxHalfSizes = Array.from(
    { length: MAX_CHARACTER_SHADOW_BOXES },
    () => new THREE.Vector3(),
  );
  private readonly characterBoundsMin = new THREE.Vector3();
  private readonly characterBoundsMax = new THREE.Vector3();
  private readonly characterWorldMatrix = new THREE.Matrix4();
  private readonly characterLocalCorner = new THREE.Vector3();
  private readonly characterWorldCorner = new THREE.Vector3();
  private readonly characterClipCorner = new THREE.Vector4();
  private readonly characterScreenPoint = new THREE.Vector2();
  private readonly characterScreenBounds = new THREE.Vector4(0, 0, 0, 0);
  private characterBoxCount = 0;
  private characterShadowMaxDistance = RENDER_STYLE.shadows.character.maxDistance;

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
    this.forwardTarget = new THREE.WebGLRenderTarget(effectiveWidth, effectiveHeight, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.forwardTarget.texture.colorSpace = THREE.NoColorSpace;
    setForwardRefractionReceiverVolume(volume.origin, volume.dimensions);
    setForwardRefractionSunVisibility(this.supported ? this.forwardTarget.texture : null);

    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.quadMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tDepth: { value: null },
        tReceiverWorld: { value: this.forwardTarget.texture },
        uUseReceiverWorld: { value: false },
        uVoxelOccupancy: { value: volume.texture },
        uBrickOccupancy: { value: volume.brickTexture },
        uGrassOccupancy: { value: volume.grassTexture },
        uSeaweedAnchors: { value: volume.seaweedTexture },
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
        uSeaweedWaterLevel: { value: 42.5 },
        uEnabled: { value: true },
        uCharacterBoxCount: { value: 0 },
        uCharacterBoxInverse: { value: this.characterBoxInverse },
        uCharacterBoxCenters: { value: this.characterBoxCenters },
        uCharacterBoxHalfSizes: { value: this.characterBoxHalfSizes },
        uCharacterBoundsMin: { value: this.characterBoundsMin },
        uCharacterBoundsMax: { value: this.characterBoundsMax },
        uCharacterScreenBounds: { value: this.characterScreenBounds },
        uCharacterShadowMaxDistance: { value: this.characterShadowMaxDistance },
        uCameraTanHalfFovY: { value: 1.0 },
        uCameraViewportHeight: { value: Math.max(1, this.resolution.y) },
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
        uniform sampler2D tReceiverWorld;
        uniform bool uUseReceiverWorld;
        uniform sampler3D uVoxelOccupancy;
        uniform sampler3D uBrickOccupancy;
        uniform sampler3D uGrassOccupancy;
        uniform sampler2D uSeaweedAnchors;
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
        uniform float uSeaweedWaterLevel;
        uniform bool uEnabled;
        uniform int uCharacterBoxCount;
        uniform mat4 uCharacterBoxInverse[${MAX_CHARACTER_SHADOW_BOXES}];
        uniform vec3 uCharacterBoxCenters[${MAX_CHARACTER_SHADOW_BOXES}];
        uniform vec3 uCharacterBoxHalfSizes[${MAX_CHARACTER_SHADOW_BOXES}];
        uniform vec3 uCharacterBoundsMin;
        uniform vec3 uCharacterBoundsMax;
        uniform vec4 uCharacterScreenBounds;
        uniform float uCharacterShadowMaxDistance;
        uniform float uCameraTanHalfFovY;
        uniform float uCameraViewportHeight;

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

        vec4 seaweedAt(ivec3 cell) {
          return texture(
            uSeaweedAnchors,
            (vec2(cell.x, cell.z) + vec2(0.5)) / vec2(uVolumeSize.x, uVolumeSize.z)
          );
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

        float seaweedBladeCoverage(vec2 uv) {
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
          float coverage = 0.0;
          // The source seaweed PNG is an alpha-cutout card. This compact
          // silhouette keeps the custom shadow ray cheap while preserving the
          // characteristic two-branch shape at the scale of a world shadow.
          float t = clamp(uv.y, 0.0, 1.0);
          float widthA = mix(0.075, 0.010, t);
          float centerA = 0.33 - 0.10 * t;
          coverage = max(coverage, 1.0 - smoothstep(widthA * 0.55, widthA, abs(uv.x - centerA)));
          float widthB = mix(0.085, 0.012, t);
          float centerB = 0.57 + 0.13 * t;
          coverage = max(coverage, 1.0 - smoothstep(widthB * 0.55, widthB, abs(uv.x - centerB)));
          float widthC = mix(0.065, 0.008, t);
          float centerC = 0.74 - 0.08 * t;
          coverage = max(coverage, 1.0 - smoothstep(widthC * 0.55, widthC, abs(uv.x - centerC)));
          return coverage;
        }

        bool seaweedBladeHit(
          vec3 local,
          vec3 direction,
          ivec3 cell,
          float maxTravel,
          vec4 encoded
        ) {
          if (encoded.a <= 0.0) return false;

          vec3 root = vec3(
            float(cell.x) + encoded.r,
            encoded.b * uVolumeSize.y,
            float(cell.z) + encoded.g
          );
          float height = max(encoded.a * ${SEAWEED_SHADOW_HEIGHT_MAX.toFixed(1)}, 0.02);
          // Roots are at the center of their block. Keep this analytic shadow
          // proxy inside that root cell so one field texel is enough; reading
          // a 3x3 neighbourhood here multiplied the full-screen DDA cost by
          // nine. The visible cards still use the texture's native aspect.
          const float halfWidth = 0.47;
          const float epsilon = 1e-4;
          const float selfHitEpsilon = 0.01;

          // First crossed plane: z is fixed, x/y carry the seaweed mask.
          if (abs(direction.z) > epsilon) {
            float travelZ = (root.z - local.z) / direction.z;
            if (travelZ > selfHitEpsilon && travelZ <= maxTravel + epsilon) {
              vec3 point = local + direction * travelZ;
              if (point.y >= root.y - epsilon && point.y <= root.y + height + epsilon &&
                  point.x >= root.x - halfWidth - epsilon && point.x <= root.x + halfWidth + epsilon) {
                vec2 uv = vec2(
                  (point.x - root.x + halfWidth) / (2.0 * halfWidth),
                  (point.y - root.y) / height
                );
                if (seaweedBladeCoverage(uv) > 0.5) return true;
              }
            }
          }

          // Second crossed plane: x is fixed, z/y carry the same mask.
          if (abs(direction.x) > epsilon) {
            float travelX = (root.x - local.x) / direction.x;
            if (travelX > selfHitEpsilon && travelX <= maxTravel + epsilon) {
              vec3 point = local + direction * travelX;
              if (point.y >= root.y - epsilon && point.y <= root.y + height + epsilon &&
                  point.z >= root.z - halfWidth - epsilon && point.z <= root.z + halfWidth + epsilon) {
                vec2 uv = vec2(
                  (point.z - root.z + halfWidth) / (2.0 * halfWidth),
                  (point.y - root.y) / height
                );
                if (seaweedBladeCoverage(uv) > 0.5) return true;
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

        bool characterBoundsHit(vec3 origin, vec3 direction, float maxTravel) {
          vec3 directionSafe = vec3(
            abs(direction.x) < 1e-5 ? (direction.x < 0.0 ? -1e-5 : 1e-5) : direction.x,
            abs(direction.y) < 1e-5 ? (direction.y < 0.0 ? -1e-5 : 1e-5) : direction.y,
            abs(direction.z) < 1e-5 ? (direction.z < 0.0 ? -1e-5 : 1e-5) : direction.z
          );
          vec3 t0 = (uCharacterBoundsMin - origin) / directionSafe;
          vec3 t1 = (uCharacterBoundsMax - origin) / directionSafe;
          vec3 tMin = min(t0, t1);
          vec3 tMax = max(t0, t1);
          float entry = max(max(tMin.x, tMin.y), tMin.z);
          float exit = min(min(tMax.x, tMax.y), tMax.z);
          return exit >= max(entry, 0.004) && entry <= maxTravel;
        }

        // Returns a signed slab-overlap margin. Positive means the center sun
        // ray intersects this exact animated box before maxTravel; negative
        // means it misses. The continuous margin lets the final edge use a
        // deterministic geometric coverage width instead of a sampled map.
        float characterBoxHitMargin(vec3 origin, vec3 direction, int index, float maxTravel) {
          mat4 inverseBox = uCharacterBoxInverse[index];
          vec3 localOrigin = (inverseBox * vec4(origin, 1.0)).xyz - uCharacterBoxCenters[index];
          vec3 localDirection = (inverseBox * vec4(direction, 0.0)).xyz;
          vec3 safeDirection = vec3(
            abs(localDirection.x) < 1e-5 ? (localDirection.x < 0.0 ? -1e-5 : 1e-5) : localDirection.x,
            abs(localDirection.y) < 1e-5 ? (localDirection.y < 0.0 ? -1e-5 : 1e-5) : localDirection.y,
            abs(localDirection.z) < 1e-5 ? (localDirection.z < 0.0 ? -1e-5 : 1e-5) : localDirection.z
          );
          vec3 t0 = (-uCharacterBoxHalfSizes[index] - localOrigin) / safeDirection;
          vec3 t1 = ( uCharacterBoxHalfSizes[index] - localOrigin) / safeDirection;
          vec3 tMin = min(t0, t1);
          vec3 tMax = max(t0, t1);
          float entry = max(max(tMin.x, tMin.y), tMin.z);
          float exit = min(min(tMax.x, tMax.y), tMax.z);
          float clippedEntry = max(entry, 0.004);
          return min(exit - clippedEntry, maxTravel - clippedEntry);
        }

        float traceCharacterVisibility(vec3 receiverWorld, vec3 direction, float edgeWidth) {
          if (uCharacterBoxCount <= 0 || !characterBoundsHit(receiverWorld, direction, uCharacterShadowMaxDistance)) {
            return 1.0;
          }

          float shadowCoverage = 0.0;
          for (int index = 0; index < ${MAX_CHARACTER_SHADOW_BOXES}; index++) {
            if (index >= uCharacterBoxCount) break;
            float margin = characterBoxHitMargin(receiverWorld, direction, index, uCharacterShadowMaxDistance);
            shadowCoverage = max(shadowCoverage, smoothstep(-edgeWidth, edgeWidth, margin));
          }
          return 1.0 - shadowCoverage;
        }

        float traceVisibility(vec3 receiverWorld, vec3 rayDirection, bool includeSeaweed) {
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
            if (includeSeaweed) {
              // One nearest-filtered lookup per traversed root cell. Seaweed
              // is a render-only caster and is deliberately absent from the
              // opaque voxel texture and from inland/above-water rays.
              vec4 seaweed = seaweedAt(cell);
              if (seaweed.a > 0.0 && seaweedBladeHit(local, direction, cell, travel, seaweed)) return 0.0;
            }

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

        float traceSolarDisc(
          vec3 receiver,
          vec3 sun,
          vec3 tangentA,
          vec3 tangentB,
          bool includeSeaweed
        ) {
          // Five cheap probes are used only as a boundary classifier.  If all
          // agree, the receiver is in stable umbra/full light and no extra
          // rays are needed.  Mixed probes trigger equal-area disc sampling.
          float center = traceVisibility(receiver, sun, includeSeaweed);
          float sideA = traceVisibility(receiver, normalize(sun + tangentA * uSunAngularRadius), includeSeaweed);
          float sideB = traceVisibility(receiver, normalize(sun - tangentA * uSunAngularRadius), includeSeaweed);
          float sideC = traceVisibility(receiver, normalize(sun + tangentB * uSunAngularRadius), includeSeaweed);
          float sideD = traceVisibility(receiver, normalize(sun - tangentB * uSunAngularRadius), includeSeaweed);
          if (center == sideA && center == sideB && center == sideC && center == sideD) return center;

          const int DISC_SAMPLES = 16;
          const float GOLDEN_ANGLE = 2.39996323;
          float sum = center + sideA + sideB + sideC + sideD;
          for (int i = 0; i < DISC_SAMPLES; i++) {
            float fraction = (float(i) + 0.5) / float(DISC_SAMPLES);
            float radius = sqrt(fraction) * uSunAngularRadius;
            float angle = (float(i) + 0.5) * GOLDEN_ANGLE;
            vec2 disk = vec2(cos(angle), sin(angle)) * radius;
            sum += traceVisibility(
              receiver,
              normalize(sun + tangentA * disk.x + tangentB * disk.y),
              includeSeaweed
            );
          }
          return sum / float(5 + DISC_SAMPLES);
        }

        void main() {
          float viewDepth = readViewDepth(vUv);
          vec4 receiverSample = texture(tReceiverWorld, vUv);
          if (!uEnabled || (uUseReceiverWorld
              ? receiverSample.a <= 0.0
              : viewDepth >= uCameraFar * 0.999)) {
            outColor = vec4(1.0, 0.0, 0.0, 1.0);
            return;
          }
          vec3 receiver = uUseReceiverWorld
            ? uVolumeOrigin + receiverSample.rgb * uVolumeSize
            : reconstructWorldPosition(vUv, viewDepth);
          vec3 sun = normalize(uSunDirection);
          // Project a fixed world-up vector onto the solar-disc tangent plane.
          // Only the singular straight-up case needs a fallback; there is no
          // arbitrary |sun.y| threshold that can rotate the kernel in flight.
          vec3 tangentSeed = vec3(0.0, 1.0, 0.0);
          vec3 tangentA = tangentSeed - sun * dot(tangentSeed, sun);
          if (dot(tangentA, tangentA) < 1e-6) tangentA = vec3(1.0, 0.0, 0.0);
          tangentA = normalize(tangentA);
          vec3 tangentB = normalize(cross(sun, tangentA));
          bool includeSeaweed = receiver.y < uSeaweedWaterLevel - 0.05;
          float visibility = traceSolarDisc(receiver, sun, tangentA, tangentB, includeSeaweed);
          // The player caster is evaluated exactly once per receiver, outside
          // traceSolarDisc's terrain ray loop. The screen bound is a
          // conservative optimization; the world-space AABB remains the
          // correctness guard inside traceCharacterVisibility.
          if (uCharacterBoxCount > 0 &&
              (uUseReceiverWorld || (
                vUv.x >= uCharacterScreenBounds.x && vUv.x <= uCharacterScreenBounds.z &&
                vUv.y >= uCharacterScreenBounds.y && vUv.y <= uCharacterScreenBounds.w
              ))) {
            // Use the receiver's camera-space pixel footprint as a stable
            // geometric edge width. It avoids undefined derivatives inside
            // the divergent character broadphase branch.
            float pixelWorldSize = 2.0 * viewDepth * uCameraTanHalfFovY / max(uCameraViewportHeight, 1.0);
            float edgeWidth = max(0.004, pixelWorldSize * 1.25);
            visibility = min(visibility, traceCharacterVisibility(receiver, sun, edgeWidth));
          }
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

  getForwardTexture(): THREE.Texture {
    return this.forwardTarget.texture;
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
    this.forwardTarget.setSize(effectiveWidth, effectiveHeight);
  }

  setSunDirection(direction: THREE.Vector3): void {
    this.sunDirection.copy(direction).normalize();
    (this.quadMaterial.uniforms.uSunDirection.value as THREE.Vector3).copy(this.sunDirection);
  }

  setSeaweedWaterLevel(level: number): void {
    if (!Number.isFinite(level)) return;
    this.quadMaterial.uniforms.uSeaweedWaterLevel.value = level;
  }

  /**
   * Bind the animated player boxes used by the deterministic geometric caster.
   * The matrices are world-to-local transforms; the box center and half-size
   * remain in each mesh's local geometry space.
   */
  setCharacterShadowBoxes(boxes: ReadonlyArray<CharacterShadowBox>): void {
    this.characterBoxCount = Math.min(MAX_CHARACTER_SHADOW_BOXES, boxes.length);
    this.characterBoundsMin.set(Infinity, Infinity, Infinity);
    this.characterBoundsMax.set(-Infinity, -Infinity, -Infinity);

    for (let index = 0; index < MAX_CHARACTER_SHADOW_BOXES; index += 1) {
      const source = boxes[index];
      if (index < this.characterBoxCount && source) {
        this.characterBoxInverse[index].copy(source.inverseMatrix);
        this.characterBoxCenters[index].copy(source.center);
        this.characterBoxHalfSizes[index].copy(source.halfSize);
        this.includeCharacterWorldBounds(source);
      } else {
        this.characterBoxInverse[index].identity();
        this.characterBoxCenters[index].set(0, 0, 0);
        this.characterBoxHalfSizes[index].set(0, 0, 0);
      }
    }

    if (this.characterBoxCount === 0 || !Number.isFinite(this.characterBoundsMin.x)) {
      this.characterBoundsMin.set(0, 0, 0);
      this.characterBoundsMax.set(0, 0, 0);
      this.characterScreenBounds.set(0, 0, 0, 0);
    }

    this.quadMaterial.uniforms.uCharacterBoxCount.value = this.characterBoxCount;
    (this.quadMaterial.uniforms.uCharacterBoundsMin.value as THREE.Vector3).copy(this.characterBoundsMin);
    (this.quadMaterial.uniforms.uCharacterBoundsMax.value as THREE.Vector3).copy(this.characterBoundsMax);
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
    camera.updateMatrixWorld();
    this.quadMaterial.uniforms.uCameraNear.value = camera.near;
    this.quadMaterial.uniforms.uCameraFar.value = camera.far;
    this.quadMaterial.uniforms.uCameraTanHalfFovY.value = Math.tan(
      THREE.MathUtils.degToRad(camera.getEffectiveFOV()) * 0.5,
    );
    this.quadMaterial.uniforms.uCameraViewportHeight.value = Math.max(1, this.resolution.y);
    (this.quadMaterial.uniforms.uInvProjectionMatrix.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (this.quadMaterial.uniforms.uCameraMatrixWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    this.updateCharacterScreenBounds(camera);
    if (this.depthTexture) this.quadMaterial.uniforms.tDepth.value = this.depthTexture;

    if (!this.supported) return;
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previousTarget);
  }

  /**
   * Resolve the same world-space caster field for forward-refracted source
   * receivers. The input stores the source point that generated each
   * apparent pixel, so visibility remains attached to geometry rather than
   * to the unrefracted camera silhouette.
   */
  updateForward(
    receiverTexture: THREE.Texture,
    receiverDepth: THREE.DepthTexture,
  ): void {
    this.quadMaterial.uniforms.tReceiverWorld.value = receiverTexture;
    this.quadMaterial.uniforms.tDepth.value = receiverDepth;
    this.quadMaterial.uniforms.uUseReceiverWorld.value = true;

    const previousTarget = this.renderer.getRenderTarget();
    if (this.supported) {
      this.renderer.setRenderTarget(this.forwardTarget);
      this.renderer.clear(true, false, false);
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.setRenderTarget(previousTarget);

    this.quadMaterial.uniforms.uUseReceiverWorld.value = false;
    this.quadMaterial.uniforms.tReceiverWorld.value = this.forwardTarget.texture;
    this.quadMaterial.uniforms.tDepth.value = this.depthTexture;
  }

  getDiagnostics(): VoxelSunShadowDiagnostics {
    return {
      enabled: this.enabled,
      supported: this.supported,
      resolution: { width: this.resolution.x, height: this.resolution.y },
      maxDistance: this.maxDistance,
      maxSteps: this.maxSteps,
      characterShadowBoxes: this.characterBoxCount,
      characterShadowScreenBounds: {
        minX: this.characterScreenBounds.x,
        minY: this.characterScreenBounds.y,
        maxX: this.characterScreenBounds.z,
        maxY: this.characterScreenBounds.w,
      },
      sunDirection: { x: this.sunDirection.x, y: this.sunDirection.y, z: this.sunDirection.z },
      volume: this.volume.getDiagnostics(),
    };
  }

  private includeCharacterWorldBounds(box: CharacterShadowBox): void {
    this.characterWorldMatrix.copy(box.inverseMatrix).invert();
    for (let x = 0; x < 2; x += 1) {
      for (let y = 0; y < 2; y += 1) {
        for (let z = 0; z < 2; z += 1) {
          this.characterLocalCorner.set(
            box.center.x + (x ? box.halfSize.x : -box.halfSize.x),
            box.center.y + (y ? box.halfSize.y : -box.halfSize.y),
            box.center.z + (z ? box.halfSize.z : -box.halfSize.z),
          );
          this.characterWorldCorner.copy(this.characterLocalCorner).applyMatrix4(this.characterWorldMatrix);
          this.characterBoundsMin.min(this.characterWorldCorner);
          this.characterBoundsMax.max(this.characterWorldCorner);
        }
      }
    }
  }

  private updateCharacterScreenBounds(camera: THREE.PerspectiveCamera): void {
    if (this.characterBoxCount === 0) {
      this.characterScreenBounds.set(0, 0, 0, 0);
      (this.quadMaterial.uniforms.uCharacterScreenBounds.value as THREE.Vector4).copy(this.characterScreenBounds);
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let requiresFullScreen = false;

    for (let x = 0; x < 2; x += 1) {
      for (let y = 0; y < 2; y += 1) {
        for (let z = 0; z < 2; z += 1) {
          this.characterWorldCorner.set(
            x ? this.characterBoundsMax.x : this.characterBoundsMin.x,
            y ? this.characterBoundsMax.y : this.characterBoundsMin.y,
            z ? this.characterBoundsMax.z : this.characterBoundsMin.z,
          );
          if (this.includeCharacterScreenPoint(camera, this.characterWorldCorner)) {
            minX = Math.min(minX, this.characterScreenPoint.x);
            minY = Math.min(minY, this.characterScreenPoint.y);
            maxX = Math.max(maxX, this.characterScreenPoint.x);
            maxY = Math.max(maxY, this.characterScreenPoint.y);
          } else {
            requiresFullScreen = true;
          }

          this.characterWorldCorner.addScaledVector(this.sunDirection, -this.characterShadowMaxDistance);
          if (this.includeCharacterScreenPoint(camera, this.characterWorldCorner)) {
            minX = Math.min(minX, this.characterScreenPoint.x);
            minY = Math.min(minY, this.characterScreenPoint.y);
            maxX = Math.max(maxX, this.characterScreenPoint.x);
            maxY = Math.max(maxY, this.characterScreenPoint.y);
          } else {
            requiresFullScreen = true;
          }
        }
      }
    }

    if (requiresFullScreen || !Number.isFinite(minX) || !Number.isFinite(minY)) {
      this.characterScreenBounds.set(0, 0, 1, 1);
    } else {
      const padX = 2 / Math.max(1, this.resolution.x);
      const padY = 2 / Math.max(1, this.resolution.y);
      this.characterScreenBounds.set(
        THREE.MathUtils.clamp(minX - padX, 0, 1),
        THREE.MathUtils.clamp(minY - padY, 0, 1),
        THREE.MathUtils.clamp(maxX + padX, 0, 1),
        THREE.MathUtils.clamp(maxY + padY, 0, 1),
      );
    }
    (this.quadMaterial.uniforms.uCharacterScreenBounds.value as THREE.Vector4).copy(this.characterScreenBounds);
  }

  private includeCharacterScreenPoint(
    camera: THREE.PerspectiveCamera,
    point: THREE.Vector3,
  ): boolean {
    this.characterClipCorner.set(point.x, point.y, point.z, 1)
      .applyMatrix4(camera.matrixWorldInverse)
      .applyMatrix4(camera.projectionMatrix);
    if (this.characterClipCorner.w <= 1e-4) {
      return false;
    }
    const inverseW = 1 / this.characterClipCorner.w;
    this.characterScreenPoint.set(
      this.characterClipCorner.x * inverseW * 0.5 + 0.5,
      this.characterClipCorner.y * inverseW * 0.5 + 0.5,
    );
    return true;
  }

  dispose(): void {
    this.target.dispose();
    this.forwardTarget.dispose();
    this.quadGeometry.dispose();
    this.quadMaterial.dispose();
  }
}
