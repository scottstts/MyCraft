/**
 * Diagnostic camera definitions.
 *
 * Diagnostics never introduce a second camera model. Every view is created
 * from the same `createPlayerCamera` factory used by gameplay; this module
 * only supplies deterministic poses for that camera instance.
 */

import * as THREE from 'three';
import { PLAYER } from '../config/constants';
import { findSpawnPosition, getHeightAtPosition, WATER_LEVEL } from '../engine/world/TerrainGenerator';
import { createPlayerCamera } from '../engine/render/SceneBuilder';

export const DIAGNOSTIC_CAMERA_IDS = [
  'overview',
  'player-spawn',
  'player-ridge',
  'player-gully',
  'sky',
] as const;

export type DiagnosticCameraId = typeof DIAGNOSTIC_CAMERA_IDS[number];

export interface DiagnosticRequest {
  view: DiagnosticCameraId;
  /** Optional fixed normalized cycle position for deterministic captures. */
  time?: number;
}

export interface DiagnosticCameraContext {
  seed: number;
  worldRadius: number;
}

export interface DiagnosticCameraPose {
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
}

const PLAYER_EYE_HEIGHT = PLAYER.eyeHeight;

/** The only hostnames on which the diagnostics route is accepted. */
export function isLocalDiagnosticsHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

export function isDiagnosticCameraId(value: string | null | undefined): value is DiagnosticCameraId {
  return value !== null && value !== undefined && (DIAGNOSTIC_CAMERA_IDS as readonly string[]).includes(value);
}

/**
 * Parse the diagnostics URL without ever enabling it on a deployed host.
 * A malformed request falls through to the normal game rather than exposing
 * a partially initialized debug surface.
 */
export function getDiagnosticsRequest(location: Pick<Location, 'hostname' | 'search'>): DiagnosticRequest | null {
  if (!isLocalDiagnosticsHost(location.hostname)) return null;

  const params = new URLSearchParams(location.search);
  if (params.get('debug') !== '1') return null;

  const view = params.get('view');
  if (!isDiagnosticCameraId(view)) return null;

  const rawTime = params.get('time');
  if (!rawTime) return { view };
  const preset: Record<string, number> = {
    sunrise: 0.02,
    noon: 0.25,
    sunset: 0.48,
    midnight: 0.75,
  };
  const parsed = preset[rawTime.toLowerCase()] ?? Number.parseFloat(rawTime);
  if (!Number.isFinite(parsed)) return null;
  return { view, time: ((parsed % 1) + 1) % 1 };
}

function chooseLandPosition(seed: number, desiredX: number, desiredZ: number, worldRadius: number): { x: number; z: number; height: number } {
  // Keep the authored locations deterministic, but move a few blocks if a
  // seed places the requested point in water or a steep edge.
  let best = {
    x: desiredX,
    z: desiredZ,
    height: getHeightAtPosition(desiredX, desiredZ, seed, worldRadius),
  };
  if (best.height > WATER_LEVEL + 1) return best;

  for (let radius = 1; radius <= 8; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const x = desiredX + dx;
        const z = desiredZ + dz;
        const height = getHeightAtPosition(x, z, seed, worldRadius);
        if (height > best.height) best = { x, z, height };
      }
    }
    if (best.height > WATER_LEVEL + 1) return best;
  }
  return best;
}

function aimAt(position: THREE.Vector3, target: THREE.Vector3): { yaw: number; pitch: number } {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dz = target.z - position.z;
  const horizontalDistance = Math.max(1e-6, Math.hypot(dx, dz));

  // Gameplay's FPS camera looks down -Z at yaw/pitch zero. In Three.js a
  // negative X rotation pitches that direction downward, matching the
  // InputSystem's mouse-look convention.
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, horizontalDistance),
  };
}

function chooseOpenTerrainOffset(seed: number, x: number, z: number, worldRadius: number): THREE.Vector3 {
  const sampleDistance = 16;
  // Use the same distance for scoring and aiming so a noisy intermediate
  // sample cannot turn an intended downhill view back into an uphill wall.
  const targetDistance = sampleDistance;
  const originHeight = getHeightAtPosition(x, z, seed, worldRadius);
  const directions = [
    new THREE.Vector2(0, -1), new THREE.Vector2(1, 0),
    new THREE.Vector2(0, 1), new THREE.Vector2(-1, 0),
    new THREE.Vector2(1, -1).normalize(), new THREE.Vector2(1, 1).normalize(),
    new THREE.Vector2(-1, 1).normalize(), new THREE.Vector2(-1, -1).normalize(),
  ];
  let best = directions[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const direction of directions) {
    const sampleX = x + direction.x * sampleDistance;
    const sampleZ = z + direction.y * sampleDistance;
    const height = getHeightAtPosition(sampleX, sampleZ, seed, worldRadius);
    // Prefer a modest downhill grade (~4 blocks over the sample distance),
    // which keeps nearby terrain in frame without aiming into the ocean or a
    // cliff face. Water-level candidates are strongly disfavored.
    const downhill = originHeight - height;
    const waterPenalty = height <= WATER_LEVEL + 2 ? 1000 : 0;
    const uphillPenalty = Math.max(0, -downhill) * 2;
    const score = Math.abs(downhill - 4) + uphillPenalty + waterPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = direction;
    }
  }
  // Aim at a nearby surface patch, not at the horizon. The terrain-height
  // choice avoids the common spawn case where -Z is a vertical wall.
  return new THREE.Vector3(best.x * targetDistance, -2.5, best.y * targetDistance);
}

function groundedPlayerPose(seed: number, worldRadius: number, x: number, z: number, targetOffset: THREE.Vector3): DiagnosticCameraPose {
  const land = chooseLandPosition(seed, x, z, worldRadius);
  const position = new THREE.Vector3(land.x, land.height + 1 + PLAYER_EYE_HEIGHT, land.z);
  // Aim at the actual nearby terrain surface. Using only a fixed vertical
  // offset leaves the camera almost level on a slope, which makes walls and
  // the distant horizon dominate the frame.
  const targetX = land.x + targetOffset.x;
  const targetZ = land.z + targetOffset.z;
  const targetHeight = getHeightAtPosition(targetX, targetZ, seed, worldRadius);
  const target = new THREE.Vector3(targetX, targetHeight + 1 + targetOffset.y, targetZ);
  const direction = aimAt(position, target);
  return { position, ...direction };
}

export function getDiagnosticCameraPose(id: DiagnosticCameraId, context: DiagnosticCameraContext): DiagnosticCameraPose {
  const spawn = findSpawnPosition(context.seed, 0, 0, context.worldRadius);

  switch (id) {
    case 'overview': {
      const target = new THREE.Vector3(
        spawn.x,
        getHeightAtPosition(spawn.x, spawn.z, context.seed, context.worldRadius) + 1,
        spawn.z,
      );
      // About three player heights above the surface, with a small diagonal
      // offset so the frame contains an actual terrain patch instead of a
      // straight-down pixel sample or the distant ocean horizon.
      const position = target.clone().add(new THREE.Vector3(12, PLAYER.height * 3, 12));
      return { position, ...aimAt(position, target) };
    }
    case 'player-spawn':
      return groundedPlayerPose(
        context.seed,
        context.worldRadius,
        spawn.x,
        spawn.z,
        chooseOpenTerrainOffset(context.seed, spawn.x, spawn.z, context.worldRadius),
      );
    case 'player-ridge':
      return groundedPlayerPose(
        context.seed,
        context.worldRadius,
        20,
        -18,
        chooseOpenTerrainOffset(context.seed, 20, -18, context.worldRadius),
      );
    case 'player-gully':
      return groundedPlayerPose(context.seed, context.worldRadius, -22, 18, new THREE.Vector3(4, -1.5, -6));
    case 'sky': {
      const position = new THREE.Vector3(spawn.x, getHeightAtPosition(spawn.x, spawn.z, context.seed, context.worldRadius) + PLAYER_EYE_HEIGHT + 1, spawn.z);
      return { position, yaw: 0, pitch: THREE.MathUtils.degToRad(65) };
    }
  }
}

/**
 * Create one diagnostic camera with the exact player projection settings.
 * Engine uses this same factory for the active gameplay camera; diagnostics
 * only differ in the authored world-space pose selected by `view`.
 */
export function createDiagnosticCamera(aspect: number, id: DiagnosticCameraId, context: DiagnosticCameraContext): THREE.PerspectiveCamera {
  const camera = createPlayerCamera(aspect);
  applyDiagnosticCameraPose(camera, id, context);
  return camera;
}

export function applyDiagnosticCameraPose(camera: THREE.PerspectiveCamera, id: DiagnosticCameraId, context: DiagnosticCameraContext): void {
  const pose = getDiagnosticCameraPose(id, context);
  camera.rotation.order = 'YXZ';
  camera.position.copy(pose.position);
  camera.rotation.set(pose.pitch, pose.yaw, 0);
  camera.updateMatrixWorld(true);
}
