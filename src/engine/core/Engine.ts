/**
 * Module: engine/core/Engine
 * Purpose: Game engine with RAF loop, Three.js rendering, and subsystem management
 * Callers: CanvasHost loads this module and calls start/stop
 * Invariants: Pure TS module; no React imports anywhere under /engine
 */

import * as THREE from 'three';
import { Renderer } from '../render/Renderer';
import { createScene, createPlayerCamera } from '../render/SceneBuilder';
import { World } from '../world/World';
import type { ChunkPipelineEvents } from '../world/ChunkPipeline';
import type { ChunkMeshResponse, ChunkKey } from '../../types/workers';
import { ChunkRenderer } from '../render/ChunkRenderer';
import { loadFullAtlas } from '../render/Atlas';
import { BlockMaterial } from '../render/BlockMaterial';
import { Composer } from '../render/postprocessing/Composer';
import { SunController } from '../render/lighting/SunController';
import { SkyDome } from '../render/atmosphere/SkyDome';
import { AtmosphereModel } from '../render/atmosphere/AtmosphereModel';
import { applyGraphicsSettings, type GraphicsSettings } from '../render/settings/GraphicsSettings';
import { RENDER_STYLE } from '../render/settings/RenderStyle';
import { getBlockRegistry } from '../world/blocks/BlockRegistry';
import { findSpawnPosition } from '../world/TerrainGenerator';
import { CHUNK_SIZE } from '../../config/constants';
import { WATER_LEVEL } from '../world/TerrainGenerator';
import { WaterSystem } from '../render/water/WaterSystem';
import { WaterSurfaceMaterial } from '../render/water/WaterSurfaceMaterial';
import { OCEAN_WATER_CENTER_OFFSET } from '../render/water/OceanWaveField';
import { CAUSTIC_REFERENCE_DEPTH } from '../render/water/WaterOptics';
import { InputSystem } from '../systems/Input';
import { PlayerController } from '../systems/PlayerController';
import { SelectionSystem } from '../systems/SelectionSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import { GrassBillboardSystem } from '../render/GrassBillboardSystem';
import { SeaweedSystem } from '../render/SeaweedSystem';
import { getBlockIdByName } from '../world/blocks/BlockRegistry';
import { chunkKey } from '../utils/coords';
import { useUIStore } from '../../state/ui';
import { USE_OCEAN_HORIZON } from '../../config/flags';
import { SoundEffects } from '../audio/SoundEffects';
import type { WorldSavePayload, SavedChunk, SavedInventory, WorldSaveFile } from '../../types/save';
import { base64FromBytes, signPayload, encryptPayload, SAVE_ENC_ALG, SAVE_SIGNATURE_ALG, SAVE_PUBLIC_KEY_ID } from '../../shared/save';
import { getInventorySlots } from '../../state/inventory';
import { DEFAULT_WORLD_CHUNK_COUNT, getWorldSizeOption, normalizeWorldChunkCount } from '../../shared/worldSizes';
import PlayerCharacter from '../render/PlayerCharacter';
import {
  getNextPlayerCharacter,
  normalizePlayerCharacter,
  type PlayerCharacterId,
} from '../../shared/playerCharacters';
import { applyDiagnosticCameraPose, type DiagnosticCameraId } from '../../diagnostics/cameras';
import { VoxelOccupancyVolume } from '../render/lighting/VoxelOccupancyVolume.js';
import { VoxelSunShadowPass } from '../render/lighting/VoxelSunShadowPass.js';
import {
  createForwardRefractionReceiverMaterials,
  ForwardRefractionParticipantRegistry,
  type ForwardRefractionReceiverMaterials,
} from '../render/water/ForwardRefraction';
import { ResizeCoordinator } from '../render/ResizeCoordinator';
import {
  createStartupError,
  type BootStage,
  type StartupEnvironment,
} from '../../shared/startup';

let rafId: number | null = null;
let running = false;
let startPromise: Promise<void> | null = null;
let gameplayReady = false;
let cancelStartupWait: (() => void) | null = null;
let resizeCoordinator: ResizeCoordinator | null = null;
let currentBootStage: BootStage = 'engine-import';
let firstFramePromise: Promise<void> | null = null;
let resolveFirstFrame: (() => void) | null = null;
let rejectFirstFrame: ((reason?: unknown) => void) | null = null;
let firstFrameGateOpen = false;
let firstFrameSettled = false;

// Engine subsystems
let renderer: Renderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let world: World | null = null;
let chunkRenderer: ChunkRenderer | null = null;
let blockMaterial: BlockMaterial | null = null;
let blockOpaqueMaterial: BlockMaterial | null = null;
let waterMaterial: WaterSurfaceMaterial | null = null;
let composer: Composer | null = null;
let sunController: SunController | null = null;
let skyDome: SkyDome | null = null;
let atmosphereModel: AtmosphereModel | null = null;
let waterSystem: WaterSystem | null = null;
let inputSystem: InputSystem | null = null;
let playerController: PlayerController | null = null;
let selectionSystem: SelectionSystem | null = null;
let interactionSystem: InteractionSystem | null = null;
let grassSystem: GrassBillboardSystem | null = null;
let seaweedSystem: SeaweedSystem | null = null;
let lastFrameNow: number = 0;
let fpsCounterFrames: number = 0;
let fpsLastReportNow: number = 0;
let lastPaused: boolean = false;
let sfx: SoundEffects | null = null;
let aerialPerspectiveDistance = 600; // default, updated based on world size
let playerRigRoot: THREE.Group | null = null;
let playerBody: PlayerCharacter | null = null;
let diagnosticMode = false;
let diagnosticView: DiagnosticCameraId | null = null;
let voxelShadowVolumeReported = false;
let voxelShadowVolume: VoxelOccupancyVolume | null = null;
let voxelSunShadowPass: VoxelSunShadowPass | null = null;
let forwardRefractionReceiverMaterials: ForwardRefractionReceiverMaterials | null = null;
// Render-only center of the one-voxel water envelope. Gameplay keeps its
// existing WATER_LEVEL + 1.0 interaction surface; this value only drives
// water optics, caustics, and screen-space water masking.
const VISUAL_WATER_LEVEL = WATER_LEVEL + OCEAN_WATER_CENTER_OFFSET;
// Frame counter for coordinating mesh swaps
let frameCounter = 0;
// Queue incoming chunk meshes; apply in small batches to avoid border flicker
const pendingChunkMeshes: Map<ChunkKey, { response: ChunkMeshResponse; receivedAt: number }> = new Map();
// Snapshot pending from StartPanel (global handoff)
declare global {
  interface Window {
    __WORLD_SNAPSHOT?: WorldSavePayload;
    __saveWorld?: () => void;
    __getVoxelShadowDiagnostics?: () => unknown;
    __getRenderDiagnostics?: () => unknown;
    __setPlayerCharacter?: (character: PlayerCharacterId) => void;
    // UI can set this before triggering save to make the browser show a native save dialog.
    // We avoid tight typing here to keep DOM lib compatibility across environments.
    __nextSaveFileHandle?: unknown;
  }
}

interface StartupReadiness {
  promise: Promise<void>;
  markChunkReady: (key: ChunkKey) => void;
  markChunkMesh: (key: ChunkKey) => void;
  fail: (reason: unknown) => void;
  cancel: () => void;
}

function createStartupReadiness(expectedKeys: Iterable<ChunkKey>): StartupReadiness {
  const expected = new Set(expectedKeys);
  const ready = new Set<ChunkKey>();
  const meshed = new Set<ChunkKey>();
  let resolvePromise: () => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  let settled = false;

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // Validation can reject startup before the await below is reached. Keep the
  // cancellation path from producing an unhandled-rejection report while the
  // public start() promise still receives the original rejection.
  void promise.catch(() => undefined);

  const maybeResolve = () => {
    if (settled || ready.size < expected.size || meshed.size < expected.size) return;
    settled = true;
    resolvePromise();
  };

  const markChunkReady = (key: ChunkKey) => {
    if (expected.has(key)) {
      ready.add(key);
      maybeResolve();
    }
  };

  const markChunkMesh = (key: ChunkKey) => {
    if (expected.has(key)) {
      meshed.add(key);
      maybeResolve();
    }
  };

  const fail = (reason: unknown) => {
    if (settled) return;
    settled = true;
    rejectPromise(reason);
  };

  const cancel = () => fail(new Error('World startup was cancelled'));

  maybeResolve();
  return { promise, markChunkReady, markChunkMesh, fail, cancel };
}

function setBootStage(stage: BootStage, onBootStage?: (stage: BootStage) => void): void {
  currentBootStage = stage;
  onBootStage?.(stage);
}

function createFirstFrameReadiness(): Promise<void> {
  firstFrameGateOpen = false;
  firstFrameSettled = false;
  resolveFirstFrame = null;
  rejectFirstFrame = null;
  const promise = new Promise<void>((resolve, reject) => {
    resolveFirstFrame = resolve;
    rejectFirstFrame = reject;
  });
  // Stop can cancel the startup while the public start() promise is still
  // unwinding. Attach a handler here so cancellation never becomes an
  // unhandled rejection independently of that public promise.
  void promise.catch(() => undefined);
  firstFramePromise = promise;
  return promise;
}

function resolveFirstFrameIfReady(): void {
  if (!firstFrameGateOpen || firstFrameSettled) return;
  firstFrameSettled = true;
  resolveFirstFrame?.();
  resolveFirstFrame = null;
  rejectFirstFrame = null;
}

function rejectFirstFrameIfPending(reason: unknown): void {
  if (firstFrameSettled) return;
  firstFrameSettled = true;
  rejectFirstFrame?.(reason);
  resolveFirstFrame = null;
  rejectFirstFrame = null;
}

function computeBoundsFromChunkCount(totalChunks: number) {
  const side = getWorldSizeOption(totalChunks)?.side ?? Math.sqrt(DEFAULT_WORLD_CHUNK_COUNT);
  const negRadius = Math.floor(side / 2);
  const posRadius = side - 1 - negRadius;
  const bounds = {
    minX: -negRadius * CHUNK_SIZE.x,
    maxX: (posRadius + 1) * CHUNK_SIZE.x,
    minZ: -negRadius * CHUNK_SIZE.z,
    maxZ: (posRadius + 1) * CHUNK_SIZE.z,
  } as const;
  const worldRadius = Math.max(Math.abs(bounds.maxX - bounds.minX), Math.abs(bounds.maxZ - bounds.minZ)) / 2;
  return { bounds, worldRadius };
}

function getGeneratedChunkKeys(totalChunks: number): ChunkKey[] {
  const side = getWorldSizeOption(totalChunks)?.side ?? Math.sqrt(DEFAULT_WORLD_CHUNK_COUNT);
  const negRadius = Math.floor(side / 2);
  const posRadius = side - 1 - negRadius;
  const keys: ChunkKey[] = [];
  for (let cx = -negRadius; cx <= posRadius; cx++) {
    for (let cz = -negRadius; cz <= posRadius; cz++) {
      keys.push(chunkKey(cx, 0, cz));
    }
  }
  return keys;
}

function downloadJson(filename: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function saveWorldToFile(): Promise<void> {
  try {
    if (!world) throw new Error('World not initialized');
    const ui = useUIStore.getState();
    const totalChunks = normalizeWorldChunkCount(ui.chunkCount);
    const { bounds, worldRadius } = computeBoundsFromChunkCount(totalChunks);

    const chunks = world.getLoadedChunkKeys().map((key): SavedChunk => {
      const chunk = world!.getChunkByKey(key)!;
      const [cx, cy, cz] = key.split(',').map((s) => parseInt(s, 10));
      const data = chunk.getData();
      return {
        key,
        cx,
        cy,
        cz,
        size: { ...data.size },
        voxelsB64: base64FromBytes(data.voxels),
      };
    });

    const payload: WorldSavePayload = {
      kind: 'MyCraftWorld',
      version: 2,
      meta: { createdAt: new Date().toISOString() },
      settings: {
        seed: world.getSeed(),
        chunkCount: totalChunks,
        chunkSize: { ...CHUNK_SIZE },
        bounds,
        worldRadius,
      },
      chunks,
      inventory: {
        slots: getInventorySlots().map(s => ({ blockId: s.blockId, count: s.count })),
        selectedSlot: useUIStore.getState().selectedSlot,
      } satisfies SavedInventory,
    };

    const signatureB64 = await signPayload(payload);
    const { ivB64, cipherB64 } = await encryptPayload(payload);
    const save: WorldSaveFile = {
      kind: 'MyCraftWorld',
      version: 2,
      encAlg: SAVE_ENC_ALG,
      ivB64,
      cipherB64,
      signatureAlg: SAVE_SIGNATURE_ALG,
      signatureB64,
      publicKeyId: SAVE_PUBLIC_KEY_ID,
    };
    // If UI provided a FileSystemFileHandle via showSaveFilePicker, write directly to it.
    try {
      // minimal structural type to avoid relying on lib.dom's File System Access types
      type WritableStreamLike = { write(data: Blob | BufferSource | string): Promise<void>; close(): Promise<void> };
      type FileHandleLike = { createWritable: () => Promise<WritableStreamLike> };
      const h: unknown = (window as Window & { __nextSaveFileHandle?: unknown }).__nextSaveFileHandle as unknown;
      // Clear the handle immediately; only valid for one save
      (window as Window & { __nextSaveFileHandle?: unknown }).__nextSaveFileHandle = undefined;
      if (h && typeof (h as { createWritable?: unknown }).createWritable === 'function') {
        const handle = h as FileHandleLike;
        const writable = await handle.createWritable();
        const json = JSON.stringify(save, null, 2);
        await writable.write(new Blob([json], { type: 'application/json' }));
        await writable.close();
        return;
      }
    } catch (err) {
      console.warn('Saving via chosen file handle failed. Falling back to download.', err);
    }
    const filename = `mycraft-world-${new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').replace('Z','')}.json`;
    downloadJson(filename, save);
  } catch (e) {
    console.error('Save world failed:', e);
    alert('Failed to save world. See console for details.');
  }
}

function flushPendingChunkMeshes(): void {
  if (!chunkRenderer || pendingChunkMeshes.size === 0) return;
  for (const [key, entry] of pendingChunkMeshes) {
    try {
      chunkRenderer.handleChunkMesh(entry.response);
    } catch (error) {
      console.error(`Apply initial chunk mesh failed for ${key}`, error);
      throw error;
    } finally {
      pendingChunkMeshes.delete(key);
    }
  }
}

function update(dtSeconds: number) {
  // Reset the shared renderer counters and retire completed asynchronous GPU
  // timer queries before any water, shadow, or post-processing work starts.
  composer?.beginFrame();
  // Apply any pending mesh swaps before rendering starts this frame.
  // Try to co-apply neighboring chunks arriving together to prevent a 1-frame "hole" at borders.
  if (chunkRenderer && pendingChunkMeshes.size) {
    const keys = Array.from(pendingChunkMeshes.keys());
    const toApply = new Set<ChunkKey>();

    // Helper to add a key safely
    const select = (k: ChunkKey) => { if (pendingChunkMeshes.has(k)) toApply.add(k); };

    // First pass: if a chunk and any of its neighbors are both pending, apply them together
    for (const key of keys) {
      if (toApply.has(key)) continue;
      const [cx, cy, cz] = key.split(',').map((s) => parseInt(s, 10));
      const neighbors: ChunkKey[] = [
        `${cx+1},${cy},${cz}`, `${cx-1},${cy},${cz}`,
        `${cx},${cy+1},${cz}`, `${cx},${cy-1},${cz}`,
        `${cx},${cy},${cz+1}`, `${cx},${cy},${cz-1}`,
      ];
      const hasNeighborPending = neighbors.some(nk => pendingChunkMeshes.has(nk));
      if (hasNeighborPending) {
        select(key);
        neighbors.forEach(nk => { if (pendingChunkMeshes.has(nk)) select(nk); });
      }
    }

    // Second pass: apply any items that have been waiting for >= 2 frames to avoid starvation
    for (const [key, entry] of pendingChunkMeshes) {
      if (toApply.has(key)) continue;
      if (frameCounter - entry.receivedAt >= 2) {
        toApply.add(key);
      }
    }

    // Apply selected set
    if (toApply.size) {
      for (const key of toApply) {
        const entry = pendingChunkMeshes.get(key);
        if (!entry) continue;
        try { chunkRenderer.handleChunkMesh(entry.response); } catch (e) { console.error('Apply chunk mesh failed', e); }
        finally { /* voxel occupancy is updated from World events, not mesh raster state */ }
        pendingChunkMeshes.delete(key);
      }
    }
  }
  // Always allow pause toggle to be consumed
  if (inputSystem && inputSystem.consumePauseToggle?.()) {
    const ui = useUIStore.getState();
    const nextPaused = !ui.paused;
    // Only allow pause toggle when inGame
    if (ui.inGame) {
      ui.setPaused(nextPaused);
      if (nextPaused) {
        // Pausing: keep inGame true but release pointer lock so user can click menu
        inputSystem.exitPointerLock?.();
      } else {
        // Resuming: request pointer lock again for gameplay
        inputSystem.requestPointerLock?.();
      }
    }
  }

  // Gate updates on paused state; keep rendering the scene for visual continuity
  const { paused, inGame } = useUIStore.getState();

  // Detect resume edge: paused -> running, and we are inGame; reacquire pointer lock
  if (lastPaused && !paused && inGame) {
    inputSystem?.requestPointerLock?.();
  }
  if (inGame && !paused && !diagnosticMode) {
    if (inputSystem) {
      inputSystem.update();
    }
    if (inputSystem?.consumeViewToggle()) {
      playerBody?.toggleView();
    }
    // Handle number key slot selection (UI side-effect is fine here)
    if (inputSystem) {
      const slot = inputSystem.consumeSelectedSlot?.();
      if (slot !== undefined && slot !== null) {
        useUIStore.getState().setSelectedSlot(slot);
        // If the selected slot is empty, do nothing; InteractionSystem consults inventory
      }
    }
    if (playerController) {
      playerController.update(dtSeconds);
    }
    // Update the character before selection/interaction so the active camera
    // is already in its current third-/first-person pose for this frame.
    playerBody?.update(dtSeconds);
    if (selectionSystem) {
      selectionSystem.update();
    }
    if (interactionSystem) {
      interactionSystem.update();
    }
  }
  // Keep diagnostic camera poses authoritative while still drawing the full
  // character rig at the corresponding player position.
  if (playerBody && inGame && !paused && diagnosticMode) {
    playerBody.update(dtSeconds, false);
  }
  // The switch burst is presentation-only, so it continues while the world
  // is paused and can finish if selected from the settings panel.
  playerBody?.updateSwitchVfx(dtSeconds);
  
  // Time-of-day and lighting: pause only when UI paused
  if (sunController) {
    if (!paused) {
      sunController.update(dtSeconds);
    }
  }
  const atmosphereState = sunController && atmosphereModel
    ? atmosphereModel.evaluate(sunController.getSunDirection())
    : null;
  if (atmosphereState) {
    sunController?.setAtmosphereLighting(atmosphereState.sunColor, atmosphereState.sunIntensity);
    playerBody?.setLighting(atmosphereState.skyIrradiance, atmosphereState.starVisibility);
    skyDome?.setAtmosphereState(atmosphereState);
    if (camera) skyDome?.setCameraPosition(camera.position);
  }

  // Update block materials with sun uniforms
  if (blockMaterial && blockOpaqueMaterial && sunController && atmosphereState) {
    const sdir = sunController.getSunDirection();
    blockMaterial.setSunUniforms(sdir, atmosphereState.sunColor);
    blockOpaqueMaterial.setSunUniforms(sdir, atmosphereState.sunColor);
    // Day/night factor for ambient modulation with a small night floor to avoid total darkness
    const NIGHT_MIN_LIGHT = 0.10; // keep nights faintly lit
    const dayLight = Math.max(NIGHT_MIN_LIGHT, atmosphereState.daylight);
    blockMaterial.setDayLight(dayLight);
    blockOpaqueMaterial.setDayLight(dayLight);
    blockMaterial.setStarLight(atmosphereState.starVisibility * 0.35);
    blockOpaqueMaterial.setStarLight(atmosphereState.starVisibility * 0.35);
    blockMaterial.setSkyAmbient(atmosphereState.skyIrradiance);
    blockOpaqueMaterial.setSkyAmbient(atmosphereState.skyIrradiance);
    blockMaterial.setWaterCaustics(
      true,
      VISUAL_WATER_LEVEL,
      0.80,
      waterSystem?.getTime() ?? 0,
      waterSystem?.getCausticReferenceDepth() ?? CAUSTIC_REFERENCE_DEPTH,
      atmosphereState.sunIntensity,
    );
    blockOpaqueMaterial.setWaterCaustics(
      true,
      VISUAL_WATER_LEVEL,
      0.80,
      waterSystem?.getTime() ?? 0,
      waterSystem?.getCausticReferenceDepth() ?? CAUSTIC_REFERENCE_DEPTH,
      atmosphereState.sunIntensity,
    );
    if (grassSystem) grassSystem.setSunUniforms(sdir, atmosphereState.sunColor);
    if (grassSystem) grassSystem.setDayNight(dayLight, atmosphereState.starVisibility * 0.35);
    if (grassSystem) grassSystem.setSkyAmbient(atmosphereState.skyIrradiance);
    if (seaweedSystem) seaweedSystem.setSun(sdir, atmosphereState.sunColor);
    if (seaweedSystem) seaweedSystem.setDayNight(dayLight, atmosphereState.starVisibility * 0.35);
    if (seaweedSystem) seaweedSystem.setSkyAmbient(atmosphereState.skyIrradiance);
    if (seaweedSystem) {
      seaweedSystem.setWaterCaustics(
        true,
        VISUAL_WATER_LEVEL,
        0.80,
        waterSystem?.getCausticReferenceDepth() ?? CAUSTIC_REFERENCE_DEPTH,
        atmosphereState.sunIntensity,
      );
    }
  }

  // Update water materials with ambient lighting to match day/night cycle.
  // This only changes render uniforms; player water/collision logic remains
  // owned by PlayerController and is intentionally not touched here.
  if ((waterMaterial || waterSystem) && sunController && atmosphereState) {
    const sdir = sunController.getSunDirection();
    const waterAmbient = Math.max(0.15, atmosphereState.daylight);
    // Apply to both water material instances
    if (waterMaterial) {
      waterMaterial.setSun(sdir, atmosphereState.sunColor);
      waterMaterial.setAmbientLighting(waterAmbient, atmosphereState.nightTint);
      waterMaterial.setSkyColors(atmosphereState.skyZenith, atmosphereState.skyHorizon);
      waterMaterial.setSkyAtmosphere(
        atmosphereState.skyAerosol,
        atmosphereState.skyAerosolStrength,
        RENDER_STYLE.atmosphere.skyRadianceScale,
      );
    }
    if (waterSystem) {
      waterSystem.setSun(sdir, atmosphereState.sunColor, atmosphereState.sunIntensity);
      waterSystem.setAmbientLighting(waterAmbient, atmosphereState.nightTint);
      waterSystem.setSkyColors(atmosphereState.skyZenith, atmosphereState.skyHorizon);
      waterSystem.setSkyAtmosphere(
        atmosphereState.skyAerosol,
        atmosphereState.skyAerosolStrength,
        RENDER_STYLE.atmosphere.skyRadianceScale,
      );
    }
  }
  
  // Advance the render-only water system. This does not alter gameplay water
  // blocks, swimming, or interaction state.
  if (waterSystem && camera) {
    waterSystem.update(dtSeconds, camera);
    blockOpaqueMaterial?.setWaterCausticTexture(
      waterSystem.getCausticTexture(),
      waterSystem.getCausticOrigin(),
      waterSystem.getCausticExtent(),
      waterSystem.getCausticResolution(),
      waterSystem.getCausticReferenceDepth(),
    );
    seaweedSystem?.update(waterSystem.getTime(), camera);
    seaweedSystem?.setWaterCausticTexture(
      waterSystem.getCausticTexture(),
      waterSystem.getCausticOrigin(),
      waterSystem.getCausticExtent(),
      waterSystem.getCausticResolution(),
      waterSystem.getCausticReferenceDepth(),
    );
    waterMaterial?.setTime(waterSystem.getTime());
    waterMaterial?.setCameraUnderwater(waterSystem.isCameraUnderwater());
    composer?.setWaterCameraState(
      waterSystem.isCameraUnderwater(),
      waterSystem.getCameraSurfaceY(),
    );
    // Keep the medium pass active on both sides of the interface. It resolves
    // the actual below-water interval per view ray; the displaced surface's
    // camera-medium state only determines which end of that interval contains
    // the camera.
    composer?.setUnderwater(true);
    if (composer) {
      composer.setUnderwaterCaustics(
        waterSystem.getCausticTexture(),
        waterSystem.getCausticOrigin(),
        waterSystem.getCausticExtent(),
        waterSystem.getCausticResolution(),
        waterSystem.getCausticReferenceDepth(),
      );
      composer.setUnderwaterTime(waterSystem.getTime());
    }
  }

  // Update sound effects after the water system has resolved this frame's
  // camera position against the live displaced ocean surface.
  if (sfx) {
    sfx.update(dtSeconds, paused, inGame);
  }

  // Update subsystems here (physics, input, etc.)
  if (composer && camera && sunController && atmosphereState) {
    const sdir = sunController.getSunDirection();
    // Bind the animated player boxes after the rig has applied this frame's
    // pose. VoxelSunShadowPass evaluates them once per receiver, outside its
    // terrain solar-ray loop, so this remains deterministic and bounded.
    voxelSunShadowPass?.setCharacterShadowBoxes(playerBody?.getShadowBoxes() ?? []);
    composer.setSceneColorCaptureRequired(chunkRenderer?.hasBlockWaterGeometry() ?? false);
    composer.update(camera, sdir, atmosphereState.sunColor, atmosphereState);
    // Feed the same bounded frame delta used by the simulation into the
    // composer so any time-based post effects remain synchronized with the
    // rest of the frame.
    composer.render(dtSeconds);
  } else if (renderer && scene && camera) {
    // Fallback to basic rendering
    renderer.render(scene, camera);
  }
  // Remember paused state for next frame
  lastPaused = paused;
}

function tick(now: number) {
  if (!running) return;
  // Compute clamped delta time
  const dtSeconds = Math.min(0.1, Math.max(0, (now - lastFrameNow) / 1000));
  lastFrameNow = now;
  frameCounter++;

  try {
    update(dtSeconds);
    // FPS reporting every ~0.5s
    fpsCounterFrames += 1;
    if (fpsLastReportNow === 0) fpsLastReportNow = now;
    const elapsedSinceReport = now - fpsLastReportNow;
    if (elapsedSinceReport >= 500) {
      const fps = Math.round((fpsCounterFrames * 1000) / elapsedSinceReport);
      useUIStore.getState().setFps(fps);
      fpsCounterFrames = 0;
      fpsLastReportNow = now;
    }
  } catch (error) {
    console.error(`[Engine] Frame failed during ${currentBootStage}:`, error);
    rejectFirstFrameIfPending(error);
    stop();
    return;
  }

  resolveFirstFrameIfReady();
  
  rafId = requestAnimationFrame(tick);
}

export interface EngineStartOptions {
  /** When set, render a fixed local diagnostics pose through the normal pipeline. */
  diagnosticView?: DiagnosticCameraId;
  /** Optional normalized time-of-day used by local validation captures. */
  diagnosticTime?: number;
  /** Reports the observed startup stage to the entry UI. */
  onBootStage?: (stage: BootStage) => void;
}

async function startInternal(canvas: HTMLCanvasElement, options: EngineStartOptions = {}) {

  const onBootStage = options.onBootStage;
  setBootStage('renderer', onBootStage);
  diagnosticView = options.diagnosticView ?? null;
  diagnosticMode = diagnosticView !== null;
  gameplayReady = false;
  voxelShadowVolumeReported = false;
  pendingChunkMeshes.clear();
  createFirstFrameReadiness();
  
  // Initialize renderer
  renderer = new Renderer(canvas);
  const baseRenderer = renderer.getRenderer();
  
  // Initialize scene and camera
  setBootStage('scene', onBootStage);
  scene = createScene();
  const initialCanvasSize = renderer.getCanvasSize();
  const aspect = initialCanvasSize.width / Math.max(1, initialCanvasSize.height);
  // This is the same camera instance used by gameplay. Diagnostics only apply
  // a different world-space pose after the normal world/render setup exists.
  camera = createPlayerCamera(aspect);
  
  // Initialize world
  setBootStage('world', onBootStage);
  world = new World();
  
  // Load atlas and initialize chunk renderer with custom material
  setBootStage('assets', onBootStage);
  const atlas = await loadFullAtlas();
  const atlasConfig = atlas.getConfig();
  const leafAtlasTiles = [
    'tree_leaves',
    'tree_leaves_1',
    'tree_leaves_2',
    'tree_leaves_3',
    'cherry_leaves',
    'cherry_leaves_1',
    'cherry_leaves_2',
    'cherry_leaves_3',
  ].flatMap((name) => atlasConfig.tiles[name] ? [atlasConfig.tiles[name]] : []);
  setBootStage('render-pipeline', onBootStage);
  const blockAtlasInfo = {
    tileSize: atlasConfig.tileSize,
    atlasSize: atlasConfig.atlasSize,
    leafTiles: leafAtlasTiles,
  };
  blockMaterial = new BlockMaterial(
    atlas.getTexture(),
    null,
    undefined,
    blockAtlasInfo,
    'cutout',
  );
  blockOpaqueMaterial = new BlockMaterial(
    atlas.getTexture(),
    null,
    undefined,
    blockAtlasInfo,
    'opaque',
  );
  // Mild in-shader AA to reduce texture shimmer on distant blocks
  blockMaterial.setAntialiasing(true, 0.9);
  
  // Configure material properties for natural block materials
  blockMaterial.setMaterialProperties(0.8, 0.0, 0.3);
  blockMaterial.setWaterCaustics(true, VISUAL_WATER_LEVEL, 0.80, 0, CAUSTIC_REFERENCE_DEPTH, 1.35);
  blockOpaqueMaterial.setMaterialProperties(0.8, 0.0, 0.3);
  blockOpaqueMaterial.setWaterCaustics(true, VISUAL_WATER_LEVEL, 0.80, 0, CAUSTIC_REFERENCE_DEPTH, 1.35);
  const forwardRefractionParticipants = new ForwardRefractionParticipantRegistry();
  forwardRefractionReceiverMaterials = createForwardRefractionReceiverMaterials({
    map: atlas.getTexture(),
    alphaCutoff: 0.5,
  });

  // Water material uses the same shader as far ocean, but uses vUv on block meshes
  waterMaterial = new WaterSurfaceMaterial({
    map: null,
    color: 0x1a2744, // Deep navy blue like real ocean
    tileScale: 1.0,
    useWorldUV: true,
    bounds: {
      minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity,
    },
  });
  // Make block water surfaces slightly translucent
  waterMaterial.setAlpha(0.7);
  waterMaterial.setWaterLevel(VISUAL_WATER_LEVEL);
  // Add subtle refraction and wave perturbation
  waterMaterial.setRefraction(0.18, 0.75, 0.12, 0.035, 0.06);
  // Increase Fresnel-driven opacity at shallow (grazing) angles
  waterMaterial.setFresnelAlpha(0.65, 0.9);

  chunkRenderer = new ChunkRenderer(
    scene,
    { opaque: blockOpaqueMaterial, cutout: blockMaterial, transparent: waterMaterial },
    {
      forwardRefractionParticipants,
      forwardRefractionReceiverMaterials,
      registerSolidTerrainMesh: (mesh) => composer?.registerSolidTerrainMesh(mesh),
      unregisterSolidTerrainMesh: (mesh) => composer?.unregisterSolidTerrainMesh(mesh),
    },
  );
  
  // Create player rig root and in-world first-person body
  playerRigRoot = new THREE.Group();
  playerRigRoot.name = 'PlayerRigRoot';
  scene.add(playerRigRoot);
  playerBody = new PlayerCharacter(useUIStore.getState().playerCharacter, { forwardRefractionParticipants });

  // Initialize the single active post-processing pipeline.
  const canvasSize = renderer.getCanvasSize();
  composer = new Composer(
    baseRenderer,
    scene,
    camera,
    canvasSize.width,
    canvasSize.height,
    forwardRefractionParticipants,
  );
  composer.registerShadowSamplingMaterial(blockMaterial);
  composer.registerShadowSamplingMaterial(blockOpaqueMaterial);
  composer.setBloom(RENDER_STYLE.bloom.enabled, RENDER_STYLE.bloom.strength, RENDER_STYLE.bloom.threshold);
  composer.setLens(RENDER_STYLE.lens.enabled, RENDER_STYLE.lens.intensity);
  composer.setAerialPerspective(true, aerialPerspectiveDistance);
  composer.setUnderwaterWaterLevel(VISUAL_WATER_LEVEL);

  // Initialize the continuous sun illumination. Voxel visibility is resolved
  // by VoxelSunShadowPass from the same WebGL scene depth used by the composer.
  setBootStage('systems', onBootStage);
  sunController = new SunController(scene, {
    cycleSeconds: RENDER_STYLE.dayNightCycleSeconds,
    // A fresh diagnostic URL must be immediately sunlit. At t=0 the authored
    // sun is exactly on the horizon and its direct intensity is zero, which
    // makes correctly rendered voxel visibility look as if shadows were missing.
    // Keep normal gameplay's existing dawn start unchanged.
    // 0.125 puts the sun at a 45° elevation: direct light is already at its
    // full daytime intensity, while cast shadows are long enough to inspect
    // in every diagnostic pose instead of hiding directly beneath casters.
    initialTime: options.diagnosticTime ?? (diagnosticMode ? 0.125 : 0.0),
    paused: diagnosticMode,
    enableShadows: true,
  });
  if (diagnosticMode) console.info('[AtmosphereInit]', JSON.stringify({ requestedTime: options.diagnosticTime, actualTime: sunController.getTime(), paused: sunController.isPaused() }));

  atmosphereModel = new AtmosphereModel();
  skyDome = new SkyDome(scene);
  
  // Set atlas config and block registry in chunk pipeline
  const blockRegistry = getBlockRegistry();
  world.chunkPipeline.setAtlasConfig(atlas.getConfig(), blockRegistry.getAllBlocks());

  // Input system (pointer lock + mouse look)
  inputSystem = new InputSystem(canvas, camera);
  inputSystem.onCharacterSwitchRequested(() => {
    const ui = useUIStore.getState();
    if (!gameplayReady || diagnosticMode || !ui.inGame || ui.paused) return;
    setPlayerCharacter(getNextPlayerCharacter(ui.playerCharacter));
  });
  // A native file picker can produce a delayed pointerlockchange event after
  // the input system is constructed. Only a lock that was active once
  // gameplay was ready should be interpreted as an Esc/manual pause; an
  // initial unlock must not manufacture a pause screen on snapshot entry.
  let pointerLockWasActiveInGameplay = false;
  // Track pointer lock -> set inGame accordingly
  inputSystem.onPointerLockChanged((locked: boolean) => {
    const ui = useUIStore.getState();
    if (locked) {
      // Pointer lock may be granted from the launch button while workers are
      // still loading. Keep the menu in control until terrain readiness has
      // explicitly completed.
      if (gameplayReady) {
        pointerLockWasActiveInGameplay = true;
        const wasAwaitingEntry = !ui.inGame;
        ui.setInGame(true);
        // A delayed grant can arrive after CanvasHost has shown the fallback
        // pause card. Treat that grant as successful entry, but never dismiss
        // a pause that was already active during gameplay.
        if (wasAwaitingEntry) ui.setPaused(false);
      }
    } else {
      // Treat pointer-lock loss (normally Escape) as a real pause. Keep the
      // game session active so the HUD remains visible and PauseMenu can own
      // the resume action with a fresh user gesture.
      if (gameplayReady && pointerLockWasActiveInGameplay && !ui.paused) {
        ui.setPaused(true);
        ui.setInGame(true);
      }
    }
  });
  // InputSystem must exist before the character is initialized. The character
  // owns the active camera follow, so passing the earlier null module value
  // would leave both the body and camera frozen at their initial pose.
  if (playerBody && playerRigRoot && camera) {
    playerBody.init(playerRigRoot, camera, inputSystem);
  }

  // Determine world size (total chunks -> NxN grid)
  const totalChunks = Math.max(1, Math.floor(useUIStore.getState().chunkCount || 9));
  const { bounds, worldRadius } = computeBoundsFromChunkCount(totalChunks);
  const pendingSave = (window as Window & { __WORLD_SNAPSHOT?: WorldSavePayload; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT;
  const wasVerified = (window as Window & { __WORLD_SNAPSHOT?: WorldSavePayload; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT_VERIFIED;
  const initialChunkKeys = pendingSave && pendingSave.kind === 'MyCraftWorld'
    ? pendingSave.chunks.map((chunk) => chunk.key)
    : getGeneratedChunkKeys(totalChunks);
  const startupReadiness = createStartupReadiness(initialChunkKeys);
  cancelStartupWait = startupReadiness.cancel;

  // World readiness is shared by the gameplay scene and the render pipeline.
  world.on('CHUNK_ADDED', ({ key }) => {
    startupReadiness.markChunkReady(key);
  });

  world.chunkPipeline.on('WORKER_ERROR', ({ worker, error }) => {
    startupReadiness.fail(new Error(`${worker} worker failed during startup`, { cause: error }));
  });

  // The voxel shadow volume is the static terrain/grass caster representation.
  // It is fixed to the generated world bounds, while the animated player is
  // supplied as exact OBB geometry to the same screen-space visibility pass.
  voxelShadowVolume = new VoxelOccupancyVolume({
    minX: bounds.minX,
    maxX: bounds.maxX,
    minY: 0,
    maxY: CHUNK_SIZE.y,
    minZ: bounds.minZ,
    maxZ: bounds.maxZ,
  });
  const leafAtlasConfig = atlas.getConfig();
  const leafBaseTile: [number, number] = leafAtlasConfig.tiles.tree_leaves ?? [8, 0];
  const leafVariantTiles: Array<readonly [number, number]> = [leafBaseTile];
  for (let variant = 1; variant < 4; variant += 1) {
    const tile = leafAtlasConfig.tiles[`tree_leaves_${variant}`];
    if (!tile) break;
    leafVariantTiles.push(tile);
  }
  voxelSunShadowPass = new VoxelSunShadowPass(
    baseRenderer,
    canvasSize.width,
    canvasSize.height,
    voxelShadowVolume,
    {
      texture: atlas.getTexture(),
      atlasSize: leafAtlasConfig.atlasSize,
      tileSize: leafAtlasConfig.tileSize,
      variantTiles: leafVariantTiles,
    },
  );
  voxelSunShadowPass.setSeaweedWaterLevel(VISUAL_WATER_LEVEL);
  const shadowResolution = voxelSunShadowPass.getDiagnostics().resolution;
  blockMaterial?.setVoxelShadowTexture(voxelSunShadowPass.getTexture(), shadowResolution.width, shadowResolution.height, true);
  blockOpaqueMaterial?.setVoxelShadowTexture(voxelSunShadowPass.getTexture(), shadowResolution.width, shadowResolution.height, true);
  blockMaterial?.setVoxelShadowDepthTexture(composer.getDepthTexture(), camera.near, camera.far);
  blockOpaqueMaterial?.setVoxelShadowDepthTexture(composer.getDepthTexture(), camera.near, camera.far);
  composer.setVoxelSunShadowPass(voxelSunShadowPass);
  if (diagnosticMode) console.info('[VoxelSunShadow]', JSON.stringify(voxelSunShadowPass.getDiagnostics()));

  // Occupancy follows authoritative World events, including block edits and
  // chunk replacement/removal. Mesh arrival is intentionally irrelevant.
  world.on('CHUNK_ADDED', ({ key, chunk }) => {
    voxelShadowVolume?.updateChunk(key, chunk);
    if (diagnosticMode && !voxelShadowVolumeReported && voxelShadowVolume) {
      voxelShadowVolumeReported = true;
      console.info('[VoxelSunShadowVolume]', JSON.stringify(voxelShadowVolume.getDiagnostics()));
    }
  });
  world.on('CHUNK_REMOVED', ({ key }) => voxelShadowVolume?.clearChunk(key));
  world.on('BLOCK_CHANGED', ({ worldX, worldY, worldZ, newBlockId }) => {
    voxelShadowVolume?.updateBlock(worldX, worldY, worldZ, newBlockId);
  });
  // Startup receives a complete fixed world. Defer the occupancy reduction and
  // all initial mesh jobs until every chunk has arrived, so no partial-world
  // rebuilds or neighbour-arrival remeshes are paid during boot.
  world.chunkPipeline.beginInitialBatch(initialChunkKeys);
  voxelShadowVolume.beginBulkUpdate();
  sunController?.setShadowSettings({
    enabled: RENDER_STYLE.shadows.enabled,
    shadowDistance: RENDER_STYLE.shadows.distance,
    resolution: 2048,
    softness: 0,
    bias: 0,
    normalBias: 0,
    intensity: RENDER_STYLE.shadows.intensity,
  });
  if (voxelSunShadowPass && sunController) {
    const settings = sunController.getShadowSettings();
    voxelSunShadowPass.setSettings({ enabled: settings.enabled, maxDistance: settings.shadowDistance });
  }

  // Update water material edge bounds for consistent seam blend
  if (waterMaterial) {
    waterMaterial.setBounds(bounds);
    waterMaterial.setEdge(0.0, 2.0); // disable edge brightening to avoid visible grid
  }

  // worldRadius computed above

  // Calculate the aerial-perspective cutoff to avoid horizon gaps.
  const margin = CHUNK_SIZE.x * 2; // small cushion
  aerialPerspectiveDistance = Math.min(camera.far * 0.95, worldRadius + margin);
  composer?.setAerialPerspective(true, aerialPerspectiveDistance);

  // Set world radius in chunk pipeline for terrain generation
  world.chunkPipeline.setWorldRadius(worldRadius);

  // Set camera spawn position above ground. Diagnostic views replace only this
  // pose; projection, renderer, materials, post-processing, and light setup
  // remain the exact gameplay path above.
  const spawnPos = findSpawnPosition(world.getSeed(), 0, 0, worldRadius);
  camera.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
  if (diagnosticView) {
    applyDiagnosticCameraPose(camera, diagnosticView, {
      seed: world.getSeed(),
      worldRadius,
    });
  }

  // Build the render-only ocean plane and visual seabed extension. These
  // meshes never enter World, so the existing collision, selection, saves,
  // and water interaction code remain unchanged.
  if (USE_OCEAN_HORIZON) {
    const farOceanDistance = camera.far * 0.98;
    waterSystem = new WaterSystem(scene, {
      bounds,
      waterLevel: WATER_LEVEL,
      farDistance: farOceanDistance,
      color: 0x1a6f8e,
      seed: world.getSeed(),
      worldRadius,
      blockMaterialSource: blockMaterial ?? undefined,
      blockWaterMaterial: waterMaterial ?? undefined,
      seabedAtlas: atlas.getConfig(),
      renderer: baseRenderer,
      stageProfiler: composer?.getStageProfiler(),
      forwardRefractionParticipants,
      registerShadowSamplingMaterial: (material) => composer?.registerShadowSamplingMaterial(material),
      unregisterShadowSamplingMaterial: (material) => composer?.unregisterShadowSamplingMaterial(material),
    });
    waterSystem.setSceneInputs(
      composer?.getSceneColorTexture() ?? null,
      composer?.getDepthTexture() ?? null,
      composer?.getSceneColorResolution() ?? { x: canvasSize.width, y: canvasSize.height },
      camera.near,
      camera.far,
    );
    waterSystem.setForwardRefractionInputs(
      composer?.getForwardRefractionColorTexture() ?? null,
      composer?.getForwardRefractionDepthTexture() ?? null,
      composer?.getForwardRefractionResolution() ?? { x: canvasSize.width, y: canvasSize.height },
      camera.near,
      camera.far,
    );
    waterSystem.setSunVisibility(voxelSunShadowPass?.getTexture() ?? null);
    // Seaweed is a render-only ocean layer. Its per-load random seed is not
    // derived from the saved world seed, so a reload produces a new field
    // while the field remains stable for this running game.
    seaweedSystem = new SeaweedSystem(scene, {
      bounds,
      terrainSeed: world.getSeed(),
      worldRadius,
      waterLevel: WATER_LEVEL,
      forwardRefractionParticipants,
    });
    seaweedSystem.shareVoxelShadowState(blockMaterial);
    composer?.registerShadowSamplingMaterial(seaweedSystem.getMaterial());
    voxelShadowVolume.setSeaweedAnchors(seaweedSystem.getShadowAnchors());
    seaweedSystem.setWaterCausticTexture(
      waterSystem.getCausticTexture(),
      waterSystem.getCausticOrigin(),
      waterSystem.getCausticExtent(),
      waterSystem.getCausticResolution(),
      waterSystem.getCausticReferenceDepth(),
    );
    composer?.setOpaqueCaptureHooks(
      () => waterSystem?.setOpaqueCaptureMode(true),
      () => waterSystem?.setOpaqueCaptureMode(false),
    );
  }

  // Player controller (movement + gravity + collisions)
  playerController = new PlayerController(camera, world, inputSystem, bounds);
  const activeCamera = camera;
  playerBody?.setController(playerController);
  // Diagnostic URLs retain their authored camera pose; use the real rig in
  // first person there so the camera is not moved by the gameplay orbit.
  if (diagnosticMode) playerBody?.setFirstPerson(true);
  
  // Selection system (raycast + debug outline). Pass world bounds so selection highlights don't appear outside.
  selectionSystem = new SelectionSystem(
    camera,
    world,
    scene,
    bounds,
    (target) => playerBody?.isFirstPersonView()
      ? activeCamera.getWorldPosition(target)
      : playerController?.getEyePosition(target) ?? activeCamera.getWorldPosition(target),
  );
  
  // Interaction system (mine/place + re-mesh)
  interactionSystem = new InteractionSystem(
    camera,
    world,
    inputSystem,
    selectionSystem,
    world.chunkPipeline,
    playerController,
    (direction) => playerBody?.faceTowards(direction),
  );
  // Decorative grass system (instanced billboards). Its direct sun visibility
  // uses the same combined screen-space voxel visibility result as terrain.
  grassSystem = new GrassBillboardSystem(
    scene,
    world,
    getBlockIdByName('grass_tuft') ?? 9,
    forwardRefractionParticipants,
  );
  composer?.registerShadowSamplingMaterial(grassSystem.getMaterial());
  if (voxelSunShadowPass) {
    const resolution = voxelSunShadowPass.getDiagnostics().resolution;
    grassSystem.setVoxelShadowTexture(voxelSunShadowPass.getTexture(), resolution.width, resolution.height, !!composer);
    if (composer) grassSystem.setVoxelShadowDepthTexture(composer.getDepthTexture(), camera.near, camera.far);
  }
  
  // Sound effects. The water system owns the live displaced surface used by
  // the renderer, so audio can use the exact same camera waterline.
  sfx = new SoundEffects(
    world,
    inputSystem,
    playerController,
    camera,
    () => waterSystem?.getCameraSurfaceY(),
  );
  
  // Connect world events to chunk renderer
  world.chunkPipeline.on('CHUNK_READY', () => {
    // console.log(`[Engine] Chunk ready: ${data.key}`);
  });
  
  // Connect chunk pipeline to chunk renderer via a queue to avoid mid-frame mutations
  world.chunkPipeline.on('CHUNK_MESH', (data: ChunkPipelineEvents['CHUNK_MESH']) => {
    const { response } = data;
    // Defer application to the top of update() to keep depth and color passes in sync
    // Also allow brief batching with neighbors to avoid 1-frame border holes
    pendingChunkMeshes.set(response.key, { response, receivedAt: frameCounter });
    startupReadiness.markChunkMesh(response.key);
  });
  
  // If a saved snapshot is provided via global, ingest it directly and skip generation
  if (pendingSave && pendingSave.kind === 'MyCraftWorld') {
    try {
      // Require Start Panel to have verified the snapshot
      if (!wasVerified) {
        throw new Error('Save not verified by loader');
      }
      // Validate chunk size compatibility
      const s = pendingSave.settings.chunkSize;
      if (s.x !== CHUNK_SIZE.x || s.y !== CHUNK_SIZE.y || s.z !== CHUNK_SIZE.z) {
        throw new Error(`Chunk size mismatch: save ${s.x}x${s.y}x${s.z}, game ${CHUNK_SIZE.x}x${CHUNK_SIZE.y}x${CHUNK_SIZE.z}`);
      }
      // Set world seed from save
      world.setSeed(pendingSave.settings.seed);
      waterSystem?.setSeed(world.getSeed());
      seaweedSystem?.setTerrainSeed(world.getSeed());
      voxelShadowVolume?.setSeaweedAnchors(seaweedSystem?.getShadowAnchors() ?? []);
      // Ingest chunks
      for (const ch of pendingSave.chunks) {
        const vox = new Uint8Array(atob(ch.voxelsB64).split('').map((c) => c.charCodeAt(0)));
        const chunkData = { size: ch.size, voxels: vox };
        world.chunkPipeline.ingestChunkData(ch.key, chunkData);
      }
      world.chunkPipeline.finishInitialBatch();
    } catch (e) {
      console.error('Failed to load snapshot; returning to Start Panel.', e);
      try { alert('Save file verification failed or is corrupted. Returning to Start Panel.'); } catch { /* ignore */ }
      // Return control to the Start Panel. The public start() wrapper owns
      // cleanup for this rejected initialization path.
      const ui = useUIStore.getState();
      ui.setGameStarted(false);
      ui.setInGame(false);
      throw e;
    } finally {
      // Clear the pending snapshot so restarts don’t reuse
      delete (window as Window & { __WORLD_SNAPSHOT?: WorldSavePayload; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT;
      delete (window as Window & { __WORLD_SNAPSHOT?: WorldSavePayload; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT_VERIFIED;
    }
  } else {
    // Request NxN grid of chunks around origin
    const side = Math.max(1, Math.round(Math.sqrt(totalChunks)));
    const negRadius = Math.floor(side / 2);
    const posRadius = side - 1 - negRadius;
    for (let cx = -negRadius; cx <= posRadius; cx++) {
      for (let cz = -negRadius; cz <= posRadius; cz++) {
        world.ensureChunk(cx, 0, cz);
      }
    }
    world.chunkPipeline.finishInitialBatch();
  }
  
  // Handle window resize through one coalesced frame commit. The renderer
  // owns the logical viewport and DPR; all dependent targets follow that
  // exact commit.
  const handleResize = () => {
    if (renderer && camera && canvas) {
      const size = renderer.onResize();
      if (!size) return;
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      
      if (composer) {
        composer.setSize(size.width, size.height, size.dpr);
      }
      if (waterSystem && camera) {
        waterSystem.setSceneInputs(
          composer?.getSceneColorTexture() ?? null,
          composer?.getDepthTexture() ?? null,
          composer?.getSceneColorResolution() ?? { x: size.width, y: size.height },
          camera.near,
          camera.far,
        );
        waterSystem.setForwardRefractionInputs(
          composer?.getForwardRefractionColorTexture() ?? null,
          composer?.getForwardRefractionDepthTexture() ?? null,
          composer?.getForwardRefractionResolution() ?? { x: size.width, y: size.height },
          camera.near,
          camera.far,
        );
      }
      if (voxelSunShadowPass) {
        const resolution = voxelSunShadowPass.getDiagnostics().resolution;
        blockMaterial?.setVoxelShadowTexture(voxelSunShadowPass.getTexture(), resolution.width, resolution.height, !!composer);
        blockOpaqueMaterial?.setVoxelShadowTexture(voxelSunShadowPass.getTexture(), resolution.width, resolution.height, !!composer);
        grassSystem?.setVoxelShadowTexture(voxelSunShadowPass.getTexture(), resolution.width, resolution.height, !!composer);
        if (seaweedSystem && blockMaterial) seaweedSystem.shareVoxelShadowState(blockMaterial);
        waterSystem?.setSunVisibility(voxelSunShadowPass.getTexture());
      }
    }
  };
  resizeCoordinator?.dispose();
  resizeCoordinator = new ResizeCoordinator(handleResize);
  
  running = true;
  lastPaused = useUIStore.getState().paused;
  lastFrameNow = performance.now();
  fpsCounterFrames = 0;
  fpsLastReportNow = 0;
  rafId = requestAnimationFrame(tick);

  // Keep rendering behind the launch UI while the initial terrain is being
  // generated and meshed. Entry is released only after those meshes have been
  // applied so the first interactive frame already has a usable world.
  setBootStage('world-loading', onBootStage);
  await startupReadiness.promise;
  if (!running) throw new Error('World startup stopped before readiness');
  voxelShadowVolume?.finishBulkUpdate();
  flushPendingChunkMeshes();
  chunkRenderer?.finalizeStaticRegions();
  if (diagnosticMode) {
    // Diagnostics own the camera pose, but still need the character positioned
    // before their first capture.
    playerBody?.update(0, false);
  } else {
    // Snap the default third-person camera into place before the menu fades so
    // the player never sees the temporary eye-level spawn camera.
    playerBody?.update(0, true, true);
  }
  setBootStage('shader-compilation', onBootStage);
  if (scene && camera && renderer) {
    await renderer.getRenderer().compileAsync(scene, camera);
  }
  setBootStage('warmup', onBootStage);
  firstFrameGateOpen = true;
  setBootStage('first-render', onBootStage);
  if (firstFramePromise) await firstFramePromise;
  if (!running) throw new Error('Renderer stopped before the first frame');
  pointerLockWasActiveInGameplay = document.pointerLockElement === canvas;
  gameplayReady = true;
  // Pointer lock can be active from the launch gesture, but input must remain
  // inert until the first usable frame and the gameplay-ready boundary have
  // both been crossed.
  inputSystem?.setEnabled(true);
  setBootStage('ready', onBootStage);
  cancelStartupWait = null;
}

/**
 * Serialize startup. CanvasHost is mounted under React StrictMode in
 * development, and its effect can be invoked twice while atlas/worker setup
 * is still awaiting. Without this gate both starts mutate the same module
 * globals and install duplicate sun lights/visibility passes in one scene.
 */
async function start(canvas: HTMLCanvasElement, options: EngineStartOptions = {}): Promise<void> {
  if (startPromise) return startPromise;
  if (running) return;

  currentBootStage = 'renderer';
  const pending = startInternal(canvas, options);
  startPromise = pending;
  try {
    await pending;
  } catch (error) {
    const rendererEnvironment: Partial<StartupEnvironment> = renderer
      ? {
        viewport: renderer.getCanvasSize(),
        dpr: renderer.getPixelRatio(),
      }
      : {};
    const failure = createStartupError(currentBootStage, error, rendererEnvironment);
    stop();
    throw failure;
  } finally {
    if (startPromise === pending) startPromise = null;
  }
}

function stop() {
  running = false;
  gameplayReady = false;
  rejectFirstFrameIfPending(new Error('Game startup was stopped'));
  firstFrameGateOpen = false;
  firstFramePromise = null;
  resizeCoordinator?.dispose();
  resizeCoordinator = null;
  const cancelStartup = cancelStartupWait;
  cancelStartupWait = null;
  cancelStartup?.();
  diagnosticMode = false;
  diagnosticView = null;
  voxelShadowVolumeReported = false;
  lastPaused = false;
  pendingChunkMeshes.clear();
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  // Clean up input
  if (inputSystem) {
    inputSystem.setEnabled(false);
    inputSystem.exitPointerLock();
    inputSystem.destroy();
    inputSystem = null;
  }
  
  // Clean up chunk renderer
  if (chunkRenderer) {
    chunkRenderer.destroy();
    chunkRenderer = null;
  }

  if (forwardRefractionReceiverMaterials) {
    forwardRefractionReceiverMaterials.opaque.dispose();
    forwardRefractionReceiverMaterials.cutout.dispose();
    forwardRefractionReceiverMaterials = null;
  }

  // Clean up render-only ocean vegetation before the shared block material
  // and scene-owned shadow bindings are released.
  if (seaweedSystem) {
    seaweedSystem.destroy();
    seaweedSystem = null;
  }

  // Clean up block material
  if (blockMaterial) {
    blockMaterial.dispose();
    blockMaterial = null;
  }
  if (blockOpaqueMaterial) {
    blockOpaqueMaterial.dispose();
    blockOpaqueMaterial = null;
  }
  if (waterMaterial) {
    waterMaterial.dispose();
    waterMaterial = null;
  }

  if (composer) {
    composer.dispose();
    composer = null;
    voxelSunShadowPass = null;
  } else if (voxelSunShadowPass) {
    voxelSunShadowPass.dispose();
    voxelSunShadowPass = null;
  }
  if (voxelShadowVolume) {
    voxelShadowVolume.dispose();
    voxelShadowVolume = null;
  }

  // Clean up native sun/light resources
  if (sunController) {
    sunController.dispose();
    sunController = null;
  }

  // Clean up player controller
  playerController = null;
  
  // Clean up selection system
  if (selectionSystem) {
    selectionSystem.destroy();
    selectionSystem = null;
  }
  
  // Clean up interaction system
  interactionSystem = null;
  
  // Clean up grass system
  if (grassSystem) {
    grassSystem.destroy();
    grassSystem = null;
  }
  
  // Clean up sound effects
  if (sfx) {
    sfx.dispose();
    sfx = null;
  }
  
  // Clean up player body rig
  try { playerBody?.dispose(); } catch { /* ignore */ }
  playerBody = null;
  if (scene && playerRigRoot) { try { scene.remove(playerRigRoot); } catch { /* ignore */ } }
  playerRigRoot = null;
  
  // Clean up world
  if (world) {
    world.destroy();
    world = null;
  }
  
  if (skyDome) {
    skyDome.dispose();
    skyDome = null;
  }
  atmosphereModel = null;

  // Clean up ocean horizon
  if (waterSystem) waterSystem.dispose();
  waterSystem = null;

  // Clean up renderer
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  
  scene = null;
  camera = null;
  
  // Reset dynamic aerial-perspective distance
  aerialPerspectiveDistance = 600;
}

// Global function for UI to read current graphics state
function getGraphicsSettings(): GraphicsSettings {
  return {
    timeOfDay: {
      t: sunController ? sunController.getTime() : 0,
      paused: sunController?.isPaused() ?? false,
      cycleSeconds: RENDER_STYLE.dayNightCycleSeconds,
    },
  };
}

// Global function for UI to update the two player-facing graphics controls.
function updateGraphicsSettings(settings: GraphicsSettings) {
  applyGraphicsSettings(settings, {
    setTime: (t: number) => { sunController?.setTime(t); },
    setTimePaused: (p: boolean) => { sunController?.pause(p); },
    // The duration is baked into RenderStyle. Ignore any stale caller value
    // so old saved UI state cannot reintroduce a user-tunable cycle length.
    setCycleSeconds: () => { sunController?.setCycleSeconds(RENDER_STYLE.dayNightCycleSeconds); },
  });
}

function setPlayerCharacter(character: unknown): void {
  const nextCharacter = normalizePlayerCharacter(character);
  useUIStore.getState().setPlayerCharacter(nextCharacter);
  playerBody?.setCharacter(nextCharacter);
}

// Expose to global scope for UI communication
(window as Window & {
  updateGraphicsSettings?: (settings: GraphicsSettings) => void;
  getGraphicsSettings?: () => GraphicsSettings;
}).updateGraphicsSettings = updateGraphicsSettings;
(window as Window & {
  getGraphicsSettings?: () => GraphicsSettings;
}).getGraphicsSettings = getGraphicsSettings;
(window as Window & {
  __setPlayerCharacter?: (character: PlayerCharacterId) => void;
}).__setPlayerCharacter = setPlayerCharacter;

// Expose save function for UI
(window as Window & { __saveWorld?: () => void }).__saveWorld = () => { void saveWorldToFile(); };

// Read-only hook used by the local diagnostics page and validation tooling.
(window as Window & { __getVoxelShadowDiagnostics?: () => unknown }).__getVoxelShadowDiagnostics = () =>
  voxelSunShadowPass?.getDiagnostics() ?? null;

// Read-only hook used by local visual validation. It exposes authored state,
// not mutable controls, so the player-facing settings remain intentionally
// baked into RenderStyle.
(window as Window & { __getRenderDiagnostics?: () => unknown }).__getRenderDiagnostics = () => {
  const material = skyDome?.sky.material as THREE.ShaderMaterial | undefined;
  const atmosphere = atmosphereModel?.state;
  return {
    renderer: renderer ? {
      toneMapping: renderer.getRenderer().toneMapping,
      toneMappingExposure: renderer.getRenderer().toneMappingExposure,
      outputColorSpace: renderer.getRenderer().outputColorSpace,
    } : null,
    sky: skyDome ? {
      visible: skyDome.sky.visible,
      scale: skyDome.sky.scale.x,
      position: skyDome.sky.position.toArray(),
      renderOrder: skyDome.sky.renderOrder,
      materialType: material?.type,
      skyZenith: (material?.uniforms.skyZenith?.value as THREE.Color | undefined)?.toArray(),
      skyHorizon: (material?.uniforms.skyHorizon?.value as THREE.Color | undefined)?.toArray(),
      skyAerosol: (material?.uniforms.skyAerosol?.value as THREE.Color | undefined)?.toArray(),
      skyAerosolStrength: material?.uniforms.skyAerosolStrength?.value,
    } : null,
    atmosphere: atmosphere ? {
      sunDirection: atmosphere.sunDirection.toArray(),
      daylight: atmosphere.daylight,
      sunIntensity: atmosphere.sunIntensity,
      skyZenith: atmosphere.skyZenith.toArray(),
      skyHorizon: atmosphere.skyHorizon.toArray(),
      skyAerosol: atmosphere.skyAerosol.toArray(),
      skyAerosolStrength: atmosphere.skyAerosolStrength,
    } : null,
    water: waterSystem?.getDiagnostics() ?? null,
    forwardRefraction: composer?.getForwardRefractionDiagnostics() ?? null,
    renderStages: composer?.getRenderDiagnostics() ?? null,
    seaweed: seaweedSystem?.getDiagnostics() ?? null,
    exposure: composer?.getExposureDiagnostics() ?? null,
  };
};

// Expose SFX helpers to UI
(window as Window & { __setSfxVolume?: (v: number) => void; __getSfxVolume?: () => number; __primeSfx?: () => void }).__setSfxVolume = (v: number) => {
  sfx?.setVolume(v);
  playerBody?.setSwitchVfxVolume(v);
};
(window as Window & { __setSfxVolume?: (v: number) => void; __getSfxVolume?: () => number; __primeSfx?: () => void }).__getSfxVolume = () => sfx?.getVolume() ?? 0.7;
(window as Window & { __setSfxVolume?: (v: number) => void; __getSfxVolume?: () => number; __primeSfx?: () => void }).__primeSfx = () => { sfx?.tryUnlockOnUserGesture(); };

// Interaction one-shot hooks
(window as Window & { __sfxBreak?: () => void; __sfxPlace?: () => void }).__sfxBreak = () => { sfx?.playBreak(); };
(window as Window & { __sfxBreak?: () => void; __sfxPlace?: () => void }).__sfxPlace = () => { sfx?.playPlace(); };

// Body swing hooks used by InteractionSystem to trigger arm swings in sync with actions
(window as Window & { __bodyPrimary?: () => void; __bodySecondary?: () => void }).__bodyPrimary = () => { playerBody?.onPrimaryClick?.(); };
(window as Window & { __bodyPrimary?: () => void; __bodySecondary?: () => void }).__bodySecondary = () => { playerBody?.onSecondaryClick?.(); };
// Query hook for InteractionSystem to check swing state
(window as Window & { __isBodySwingActive?: () => boolean }).__isBodySwingActive = () => !!playerBody?.isSwingActive?.();

export const engine = { start, stop };
export type Engine = typeof engine;
