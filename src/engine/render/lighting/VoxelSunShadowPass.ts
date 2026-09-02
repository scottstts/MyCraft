/**
 * Screen-space receiver pass for voxel sun visibility.
 *
 * The depth prepass supplies the receiver world position.  This pass then
 * traverses the authoritative occupancy volume with grid DDA toward the
 * current (continuous) sun direction and writes one visibility value per
 * screen pixel.  No light camera, shadow map, projection fitting, or texel
 * snapping participates in this path. Opaque blocks are traced as voxels;
 * leaf occupancy is traced through the generated atlas cutout, while grass
 * and render-only seaweed use porous analytic proxies.
 */

import * as THREE from 'three';
import {
  SEAWEED_SHADOW_HEIGHT_MAX,
  VoxelOccupancyVolume,
  VOXEL_CASTER_GRASS_BIT,
  VOXEL_CASTER_LEAF_BIT,
  VOXEL_CASTER_OPAQUE_BIT,
  VOXEL_SHADOW_MACRO_BRICK_SIZE,
  VOXEL_SHADOW_BRICK_SIZE,
} from './VoxelOccupancyVolume.js';
import type { CharacterShadowBox } from './CharacterShadowBox';
import { RENDER_STYLE } from '../settings/RenderStyle';
import {
  setForwardRefractionSunVisibility,
} from '../water/ForwardRefraction';

const MAX_SHADER_STEPS = 512;
// The real sun's angular radius is ~0.00465 rad (0.266 degrees). A restrained
// 2.25x artistic scale makes that penumbra readable at voxel scale while
// remaining a narrow outdoor-sun transition rather than a point-light blur.
const SOLAR_ANGULAR_RADIUS = 0.00465;
const SUN_ANGULAR_RADIUS = SOLAR_ANGULAR_RADIUS * 2.25;
// The authored appearances contribute up to 48 box meshes (Eryndor). Keep the
// caster budget aligned with the most detailed authored body so every visible
// part remains registered as a shadow caster when the active appearance changes.
const MAX_CHARACTER_SHADOW_BOXES = 48;
const LEAF_VARIANT_SLOTS = 4;

export interface VoxelLeafAtlasBinding {
  texture: THREE.Texture;
  atlasSize: number;
  tileSize: number;
  atlasHeight?: number;
  /** Base leaf tile followed by the generated variant tiles. */
  variantTiles?: ReadonlyArray<readonly [number, number]>;
}

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
  private readonly leafAtlasFallback: THREE.DataTexture | null;
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

  constructor(
    renderer: THREE.WebGLRenderer,
    width: number,
    height: number,
    volume: VoxelOccupancyVolume,
    leafAtlas?: VoxelLeafAtlasBinding,
  ) {
    this.renderer = renderer;
    this.volume = volume;
    this.supported = renderer.capabilities.isWebGL2;

    const leafAtlasFallback = leafAtlas ? null : new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    if (leafAtlasFallback) leafAtlasFallback.needsUpdate = true;
    const leafVariantTiles = Array.from({ length: LEAF_VARIANT_SLOTS }, (_, index) => {
      const tile = leafAtlas?.variantTiles?.[index] ?? leafAtlas?.variantTiles?.[0] ?? [8, 0];
      return new THREE.Vector4(tile[0], tile[1], 0, 0);
    });
    const leafVariantCount = Math.max(1, Math.min(
      LEAF_VARIANT_SLOTS,
      leafAtlas?.variantTiles?.length ?? 1,
    ));

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
    setForwardRefractionSunVisibility(this.supported ? this.forwardTarget.texture : null);

    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.quadMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tDepth: { value: null },
        tReceiverWorld: { value: this.forwardTarget.texture },
        uUseReceiverWorld: { value: false },
        uVoxelCasterFlags: { value: volume.casterFlagsTexture },
        uBrickOccupancy: { value: volume.brickTexture },
        uMacroBrickOccupancy: { value: volume.macroBrickTexture },
        uBrickDetailOccupancy: { value: volume.brickDetailTexture },
        uLeafBrickDensity: { value: volume.leafBrickTexture },
        uSeaweedAnchors: { value: volume.seaweedTexture },
        uLeafAtlas: { value: leafAtlas?.texture ?? leafAtlasFallback },
        uLeafAtlasEnabled: { value: !!leafAtlas },
        uLeafAtlasSize: { value: Math.max(1, leafAtlas?.atlasSize ?? 1) },
        uLeafAtlasHeight: { value: Math.max(1, leafAtlas?.atlasHeight ?? 1) },
        uLeafAtlasTileSize: { value: Math.max(1, leafAtlas?.tileSize ?? 1) },
        uLeafVariantCount: { value: leafVariantCount },
        uLeafVariantTiles: { value: leafVariantTiles },
        uVolumeOrigin: { value: volume.origin.clone() },
        uVolumeSize: { value: volume.dimensions.clone() },
        uBrickGridSize: { value: volume.brickDimensions.clone() },
        uMacroBrickGridSize: { value: volume.macroBrickDimensions.clone() },
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
        uniform highp usampler3D uVoxelCasterFlags;
        uniform highp usampler3D uBrickOccupancy;
        uniform highp usampler3D uMacroBrickOccupancy;
        uniform highp usampler3D uBrickDetailOccupancy;
        uniform sampler3D uLeafBrickDensity;
        uniform sampler2D uSeaweedAnchors;
        uniform sampler2D uLeafAtlas;
        uniform bool uLeafAtlasEnabled;
        uniform float uLeafAtlasSize;
        uniform float uLeafAtlasHeight;
        uniform float uLeafAtlasTileSize;
        uniform int uLeafVariantCount;
        uniform vec4 uLeafVariantTiles[${LEAF_VARIANT_SLOTS}];
        uniform vec3 uVolumeOrigin;
        uniform vec3 uVolumeSize;
        uniform vec3 uBrickGridSize;
        uniform vec3 uMacroBrickGridSize;
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
        const int MACRO_BRICK_SIZE = ${VOXEL_SHADOW_MACRO_BRICK_SIZE};
        const uint CASTER_OPAQUE_BIT = ${VOXEL_CASTER_OPAQUE_BIT}u;
        const uint CASTER_LEAF_BIT = ${VOXEL_CASTER_LEAF_BIT}u;
        const uint CASTER_GRASS_BIT = ${VOXEL_CASTER_GRASS_BIT}u;
        const float LEAF_BRICK_DENSITY_FAST_PATH_THRESHOLD = 0.18;
        const int DETAILED_LEAF_LAYERS = 3;
        const float LEAF_RECEIVER_LAYER_TRANSMISSION = 0.62;

        bool insideVolume(ivec3 cell) {
          return all(greaterThanEqual(cell, ivec3(0))) &&
            all(lessThan(cell, ivec3(uVolumeSize)));
        }

        bool insideBrickGrid(ivec3 cell) {
          return all(greaterThanEqual(cell, ivec3(0))) &&
            all(lessThan(cell, ivec3(uBrickGridSize)));
        }

        uint casterFlagsAt(ivec3 cell) {
          return texelFetch(uVoxelCasterFlags, cell, 0).r;
        }

        bool casterHasFlag(ivec3 cell, uint flag) {
          return (casterFlagsAt(cell) & flag) != 0u;
        }

        bool safeCasterHasFlag(ivec3 cell, uint flag) {
          return insideVolume(cell) && casterHasFlag(cell, flag);
        }

        bool insideMacroBrickGrid(ivec3 cell) {
          return all(greaterThanEqual(cell, ivec3(0))) &&
            all(lessThan(cell, ivec3(uMacroBrickGridSize)));
        }

        bool macroBrickAt(ivec3 brick) {
          return texelFetch(uMacroBrickOccupancy, brick, 0).r != 0u;
        }

        bool receiverIsLeaf(vec3 localPosition) {
          // Depth reconstructs an axis-aligned face exactly on a voxel
          // boundary. Select the nearest boundary axis and probe its two sides
          // rather than trusting floor(), which can choose a different side
          // as the camera moves by a sub-pixel amount.
          const float epsilon = 0.003;
          vec3 withinCell = fract(localPosition);
          vec3 boundaryDistance = min(withinCell, vec3(1.0) - withinCell);
          vec3 axis = boundaryDistance.x <= boundaryDistance.y &&
              boundaryDistance.x <= boundaryDistance.z
            ? vec3(1.0, 0.0, 0.0)
            : boundaryDistance.y <= boundaryDistance.z
              ? vec3(0.0, 1.0, 0.0)
              : vec3(0.0, 0.0, 1.0);
          ivec3 positiveCell = ivec3(floor(localPosition + axis * epsilon));
          ivec3 negativeCell = ivec3(floor(localPosition - axis * epsilon));
          bool touchesLeaf = safeCasterHasFlag(positiveCell, CASTER_LEAF_BIT) ||
            safeCasterHasFlag(negativeCell, CASTER_LEAF_BIT);
          bool touchesOpaque = safeCasterHasFlag(positiveCell, CASTER_OPAQUE_BIT) ||
            safeCasterHasFlag(negativeCell, CASTER_OPAQUE_BIT);
          // An opaque gameplay surface takes precedence when it shares a
          // boundary with foliage; terrain must retain detailed leaf dapple.
          return touchesLeaf && !touchesOpaque;
        }

        bool cellTouchesReceiver(ivec3 cell, vec3 receiverLocal) {
          const float epsilon = 0.004;
          vec3 cellMin = vec3(cell) - vec3(epsilon);
          vec3 cellMax = vec3(cell + ivec3(1)) + vec3(epsilon);
          return all(greaterThanEqual(receiverLocal, cellMin)) &&
            all(lessThanEqual(receiverLocal, cellMax));
        }

        bool brickAt(ivec3 brick) {
          return texelFetch(uBrickOccupancy, brick, 0).r != 0u;
        }

        bool brickDetailAt(ivec3 brick) {
          return texelFetch(uBrickDetailOccupancy, brick, 0).r != 0u;
        }

        float leafBrickDensityAt(vec3 localPosition) {
          return texture(
            uLeafBrickDensity,
            (localPosition / float(BRICK_SIZE)) / uBrickGridSize
          ).r;
        }

        vec3 getBrickBoundary(ivec3 brick, vec3 direction) {
          vec3 brickMin = vec3(brick * BRICK_SIZE);
          // Edge bricks can be smaller than BRICK_SIZE. Clamp their positive
          // boundary to the actual volume so density integration never counts
          // empty space beyond the authoritative occupancy field.
          vec3 brickMax = min(brickMin + vec3(float(BRICK_SIZE)), uVolumeSize);
          return mix(brickMin, brickMax, greaterThan(direction, vec3(0.0)));
        }

        vec3 getMacroBrickBoundary(ivec3 brick, vec3 direction) {
          vec3 brickMin = vec3(brick * MACRO_BRICK_SIZE);
          vec3 brickMax = min(brickMin + vec3(float(MACRO_BRICK_SIZE)), uVolumeSize);
          return mix(brickMin, brickMax, greaterThan(direction, vec3(0.0)));
        }

        bool grassAt(ivec3 cell) {
          return casterHasFlag(cell, CASTER_GRASS_BIT);
        }

        uint leafHash32(ivec3 point) {
          uint h = (uint(point.x) * 374761393u)
            ^ (uint(point.y) * 668265263u)
            ^ (uint(point.z) * 2147483647u);
          h = (h ^ (h >> 13u)) * 1274126177u;
          return h ^ (h >> 16u);
        }

        vec2 rotateLeafUv(vec2 uv, float turn) {
          if (turn < 0.5) return uv;
          if (turn < 1.5) return vec2(1.0 - uv.y, uv.x);
          if (turn < 2.5) return vec2(1.0 - uv.x, 1.0 - uv.y);
          return vec2(uv.y, 1.0 - uv.x);
        }

        int leafFaceSalt(vec3 direction) {
          vec3 absoluteDirection = abs(direction);
          if (absoluteDirection.y >= absoluteDirection.x && absoluteDirection.y >= absoluteDirection.z) {
            return direction.y > 0.0 ? 17 : 31;
          }
          if (absoluteDirection.x >= absoluteDirection.z) return direction.x > 0.0 ? 71 : 83;
          return direction.z > 0.0 ? 43 : 59;
        }

        vec2 leafFaceUv(vec3 pointInCell, vec3 direction) {
          vec3 absoluteDirection = abs(direction);
          if (absoluteDirection.y >= absoluteDirection.x && absoluteDirection.y >= absoluteDirection.z) {
            return direction.y > 0.0
              ? pointInCell.xz
              : vec2(pointInCell.x, 1.0 - pointInCell.z);
          }
          if (absoluteDirection.x >= absoluteDirection.z) {
            return direction.x > 0.0
              ? vec2(1.0 - pointInCell.z, 1.0 - pointInCell.y)
              : vec2(pointInCell.z, 1.0 - pointInCell.y);
          }
          return direction.z > 0.0
            ? vec2(pointInCell.x, 1.0 - pointInCell.y)
            : vec2(1.0 - pointInCell.x, 1.0 - pointInCell.y);
        }

        float fallbackLeafAlpha(vec2 uv, ivec3 cell) {
          // Runtime uses the generated atlas. Keep an explicitly clustered,
          // stable fallback for diagnostic construction without an atlas; it
          // must not reintroduce per-fragment FBM or scanline noise.
          ivec2 cluster = ivec2(floor(clamp(uv, vec2(0.0), vec2(1.0)) * 8.0));
          uint hash = leafHash32(cell + ivec3(cluster, cluster.x + cluster.y));
          return (hash & 3u) == 0u ? 0.0 : 1.0;
        }

        float leafAlphaAt(vec2 uv, ivec3 cell, vec3 faceDirection) {
          ivec3 worldCell = cell + ivec3(floor(uVolumeOrigin));
          int salt = leafFaceSalt(faceDirection);
          uint variantHash = leafHash32(ivec3(
            worldCell.x + salt,
            worldCell.y + salt * 3,
            worldCell.z + salt * 7
          ));
          int variant = int(variantHash % uint(max(uLeafVariantCount, 1)));
          float tileSize = max(uLeafAtlasTileSize, 1.0);
          vec2 orientedUv = rotateLeafUv(clamp(uv, vec2(0.0), vec2(1.0)), float(variantHash & 3u));
          vec2 texel = clamp(floor(orientedUv * tileSize), vec2(0.0), vec2(tileSize - 1.0));
          if (!uLeafAtlasEnabled) return fallbackLeafAlpha(orientedUv, worldCell);
          vec4 tile = uLeafVariantTiles[variant];
          vec2 atlasTexel = tile.xy * tileSize + texel + vec2(0.5);
          vec2 atlasResolution = vec2(uLeafAtlasSize * tileSize, uLeafAtlasHeight * tileSize);
          return texture(uLeafAtlas, atlasTexel / atlasResolution).a;
        }

        float leafShadowTransmission(
          vec3 local,
          vec3 direction,
          ivec3 cell,
          float travel,
          vec3 faceDirection
        ) {
          vec3 exitPoint = clamp(local + direction * travel - vec3(cell), vec3(0.0), vec3(1.0));
          float coverage = leafAlphaAt(leafFaceUv(exitPoint, faceDirection), cell, faceDirection);
          // A fully covered cutout texel still transmits a small amount through
          // the leaf volume; neighboring leaf voxels then accumulate naturally
          // while isolated blocks remain visibly porous.
          return clamp(1.0 - coverage * 0.78, 0.18, 1.0);
        }

        vec4 seaweedAt(ivec3 cell) {
          return texelFetch(uSeaweedAnchors, ivec2(cell.x, cell.z), 0);
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

          // The visible tuft geometry is authored with a 45-degree yaw around
          // its cell center. Transform the shadow ray into that local frame so
          // the compact analytic caster remains aligned with the cards.
          const float yawCos = 0.70710678118;
          const float yawSin = 0.70710678118;
          vec2 cellCenter = vec2(cellMin.x + 0.5, cellMin.z + 0.5);
          vec2 localOffset = local.xz - cellCenter;
          vec2 directionXZ = direction.xz;
          vec2 rotatedLocalOffset = vec2(
            yawCos * localOffset.x + yawSin * localOffset.y,
            -yawSin * localOffset.x + yawCos * localOffset.y
          );
          vec2 rotatedDirectionXZ = vec2(
            yawCos * directionXZ.x + yawSin * directionXZ.y,
            -yawSin * directionXZ.x + yawCos * directionXZ.y
          );
          vec3 grassLocal = local;
          grassLocal.xz = cellCenter + rotatedLocalOffset;
          vec3 grassDirection = direction;
          grassDirection.xz = rotatedDirectionXZ;

          // First billboard plane: z is fixed, x/y carry the silhouette UV.
          if (abs(grassDirection.z) > epsilon) {
            float travelZ = (cellMin.z + 0.5 - grassLocal.z) / grassDirection.z;
            if (travelZ > selfHitEpsilon && travelZ <= maxTravel + epsilon) {
              vec3 point = grassLocal + grassDirection * travelZ;
              if (point.y >= cellMin.y - epsilon && point.y <= cellMin.y + height + epsilon &&
                  point.x >= cellMin.x + base - epsilon && point.x <= cellMin.x + base + extent + epsilon) {
                vec2 uv = vec2((point.x - cellMin.x - base) / extent, (point.y - cellMin.y) / height);
                if (bladeCoverage(uv) > 0.5) return true;
              }
            }
          }

          // Second billboard plane: x is fixed, z/y carry the same silhouette.
          if (abs(grassDirection.x) > epsilon) {
            float travelX = (cellMin.x + 0.5 - grassLocal.x) / grassDirection.x;
            if (travelX > selfHitEpsilon && travelX <= maxTravel + epsilon) {
              vec3 point = grassLocal + grassDirection * travelX;
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

        float traceVisibility(
          vec3 receiverWorld,
          vec3 rayDirection,
          bool includeSeaweed,
          bool leafReceiver
        ) {
          vec3 direction = normalize(rayDirection);
          vec3 directionSafe = vec3(
            abs(direction.x) < 1e-5 ? (direction.x < 0.0 ? -1e-5 : 1e-5) : direction.x,
            abs(direction.y) < 1e-5 ? (direction.y < 0.0 ? -1e-5 : 1e-5) : direction.y,
            abs(direction.z) < 1e-5 ? (direction.z < 0.0 ? -1e-5 : 1e-5) : direction.z
          );
          // Start just outside the receiver. Opaque self-intersection is
          // suppressed by cell identity, while porous grass and leaves are
          // tested independently below so a caster rooted directly on a
          // receiver face remains valid even when it shares the cell.
          vec3 local = receiverWorld + direction * 0.002 - uVolumeOrigin;
          vec3 receiverLocal = receiverWorld - uVolumeOrigin;
          ivec3 receiverCell = ivec3(floor(receiverWorld - uVolumeOrigin));
          ivec3 cell = ivec3(floor(local));
          vec3 stepAxis = sign(direction);
          vec3 inverseDirection = 1.0 / abs(directionSafe);
          float travelled = 0.0;
          float visibility = 1.0;
          ivec3 cachedLeafBrick = ivec3(-1);
          float cachedLeafDensity = 0.0;
          bool cachedLeafOnly = false;
          int detailedLeafLayers = 0;

          for (int iteration = 0; iteration < ${MAX_SHADER_STEPS}; iteration++) {
            if (iteration >= uMaxSteps) break;

            if (!insideVolume(cell)) return visibility;

            ivec3 macroBrick = cell / MACRO_BRICK_SIZE;
            if (insideMacroBrickGrid(macroBrick) && !macroBrickAt(macroBrick)) {
              vec3 macroBoundary = getMacroBrickBoundary(macroBrick, direction);
              vec3 macroDistance = (macroBoundary - local) / directionSafe;
              float jump = minimumPositive(macroDistance);
              if (jump < 1e29) {
                travelled += jump;
                if (travelled > uMaxDistance) return visibility;
                local += directionSafe * (jump + 1e-3);
                cell = ivec3(floor(local));
                continue;
              }
            }

            ivec3 brick = cell / BRICK_SIZE;
            if (insideBrickGrid(brick) && !brickAt(brick)) {
              vec3 brickBoundary = getBrickBoundary(brick, direction);
              vec3 brickDistance = (brickBoundary - local) / directionSafe;
              float jump = minimumPositive(brickDistance);
              if (jump < 1e29) {
                travelled += jump;
                if (travelled > uMaxDistance) return visibility;
                local += directionSafe * (jump + 1e-3);
                cell = ivec3(floor(local));
                continue;
              }
            }

            // Preserve the established opaque self-intersection rule. Grass
            // and leaves do not use this gate as a solid blocker; each has its
            // own porous test below and both may share the receiver cell.
            bool differentOpaqueCell = any(notEqual(cell, receiverCell));
            if (differentOpaqueCell && casterHasFlag(cell, CASTER_OPAQUE_BIT)) return 0.0;

            bool receiverLeafCell = leafReceiver && cellTouchesReceiver(cell, receiverLocal);

            // A dense brick containing only leaves has no opaque voxel or
            // billboard caster that requires per-cell detail. After enough
            // exact front layers establish the visible dapple, integrate its
            // measured occupancy in one step. This keeps deep canopy bounded
            // without replacing the near-field silhouette with an 8³ cube.
            if (insideBrickGrid(brick)) {
              if (any(notEqual(brick, cachedLeafBrick))) {
                cachedLeafBrick = brick;
                cachedLeafDensity = leafBrickDensityAt(
                  (vec3(brick) + vec3(0.5)) * float(BRICK_SIZE)
                );
                cachedLeafOnly = cachedLeafDensity >= LEAF_BRICK_DENSITY_FAST_PATH_THRESHOLD &&
                  !brickDetailAt(brick);
              }
              // Keep the first few intersected leaf voxels exact. Their
              // independently oriented atlas silhouettes create the readable
              // near-field dapple; only deeper canopy is summarized for cost.
              int requiredDetailedLayers = leafReceiver ? 0 : DETAILED_LEAF_LAYERS;
              if (cachedLeafOnly &&
                  detailedLeafLayers >= requiredDetailedLayers &&
                  !receiverLeafCell) {
                vec3 brickBoundary = getBrickBoundary(brick, direction);
                vec3 brickDistance = (brickBoundary - local) / directionSafe;
                float jump = minimumPositive(brickDistance);
                if (jump < 1e29) {
                  float density = leafBrickDensityAt(local + direction * jump * 0.5);
                  bool receiverInBrick = all(equal(
                    brick,
                    ivec3(floor(vec3(receiverCell) / float(BRICK_SIZE)))
                  ));
                  // Preserve the per-cell self-hit suppression used by the
                  // detailed path when the receiver itself is a leaf fragment.
                  if (receiverInBrick && (leafReceiver || casterHasFlag(receiverCell, CASTER_LEAF_BIT))) {
                    density = max(0.0, density - 1.0 / 512.0);
                  }
                  visibility *= exp(-0.78 * density * jump);
                  travelled += jump;
                  if (travelled > uMaxDistance) return visibility;
                  local += directionSafe * (jump + 1e-3);
                  cell = ivec3(floor(local));
                  continue;
                }
              }
            }

            vec3 voxelBoundary = vec3(cell) + mix(
              vec3(0.0), vec3(1.0), greaterThan(direction, vec3(0.0))
            );
            vec3 voxelDistance = (voxelBoundary - local) / directionSafe;
            float travel = minimumPositive(voxelDistance);
            travelled += travel;
            if (travelled > uMaxDistance || travel >= 1e29) return visibility;

            vec3 exitFaceDirection = vec3(0.0);
            if (voxelDistance.x <= voxelDistance.y && voxelDistance.x <= voxelDistance.z) {
              exitFaceDirection.x = stepAxis.x;
            } else if (voxelDistance.y <= voxelDistance.z) {
              exitFaceDirection.y = stepAxis.y;
            } else {
              exitFaceDirection.z = stepAxis.z;
            }

            bool differentDecorativeCell = leafReceiver
              ? !receiverLeafCell
              : any(notEqual(cell, receiverCell));
            if (differentDecorativeCell && casterHasFlag(cell, CASTER_LEAF_BIT)) {
              if (leafReceiver) {
                // Projecting one binary leaf tile onto a parallel interior
                // leaf face creates moire-like diagonal bands and unstable
                // layer switching. Interior foliage receives the same canopy
                // energy as a smooth layer transmission; non-leaf receivers
                // retain the exact procedural silhouette below.
                visibility *= LEAF_RECEIVER_LAYER_TRANSMISSION;
              } else {
                visibility *= leafShadowTransmission(
                  local,
                  direction,
                  cell,
                  travel,
                  exitFaceDirection
                );
                detailedLeafLayers += 1;
              }
              if (visibility <= 0.01) return 0.0;
            }
            if (grassAt(cell) && grassBladeHit(local, direction, cell, travel)) return 0.0;
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
          return visibility;
        }

        float traceSolarDisc(
          vec3 receiver,
          vec3 sun,
          vec3 tangentA,
          vec3 tangentB,
          bool includeSeaweed,
          bool leafReceiver
        ) {
          // Use one fixed, deterministic nine-ray kernel. The previous
          // 5-or-21-ray boundary classifier made the cost and result change
          // abruptly as a leaf edge crossed a pixel, which presented as both
          // tree-adjacent FPS drops and flickering shadow stripes.
          const int DISC_SAMPLES = 8;
          const float GOLDEN_ANGLE = 2.39996323;
          float sum = traceVisibility(receiver, sun, includeSeaweed, leafReceiver);
          for (int i = 0; i < DISC_SAMPLES; i++) {
            float fraction = (float(i) + 0.5) / float(DISC_SAMPLES);
            float radius = sqrt(fraction) * uSunAngularRadius;
            float angle = (float(i) + 0.5) * GOLDEN_ANGLE;
            vec2 disk = vec2(cos(angle), sin(angle)) * radius;
            sum += traceVisibility(
              receiver,
              normalize(sun + tangentA * disk.x + tangentB * disk.y),
              includeSeaweed,
              leafReceiver
            );
          }
          return sum / float(1 + DISC_SAMPLES);
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
            ? receiverSample.rgb
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
          bool leafReceiver = receiverIsLeaf(receiver - uVolumeOrigin);
          float visibility = traceSolarDisc(
            receiver,
            sun,
            tangentA,
            tangentB,
            includeSeaweed,
            leafReceiver
          );
          // The player caster is evaluated exactly once per receiver, outside
          // traceSolarDisc's terrain ray loop. The screen bound is a
          // conservative optimization; the world-space AABB remains the
          // correctness guard inside traceCharacterVisibility.
          if (uCharacterBoxCount > 0 &&
              (uUseReceiverWorld || (
                vUv.x >= uCharacterScreenBounds.x && vUv.x <= uCharacterScreenBounds.z &&
                vUv.y >= uCharacterScreenBounds.y && vUv.y <= uCharacterScreenBounds.w
              ))) {
            // Direct receivers use the ordinary perspective footprint. The
            // forward path instead differentiates its stored source receiver:
            // Snell projection changes the screen-to-world Jacobian, so camera
            // depth alone is not the footprint of a refracted pixel.
            float perspectivePixelWorldSize = 2.0 * viewDepth * uCameraTanHalfFovY /
              max(uCameraViewportHeight, 1.0);
            float refractedPixelWorldSize = max(
              length(dFdx(receiver)),
              length(dFdy(receiver))
            );
            float pixelWorldSize = uUseReceiverWorld
              ? refractedPixelWorldSize
              : perspectivePixelWorldSize;
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
    this.leafAtlasFallback = leafAtlasFallback;
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
    this.leafAtlasFallback?.dispose();
  }
}
