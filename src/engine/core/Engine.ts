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
import { InputSystem } from '../systems/Input';
import { PlayerController } from '../systems/PlayerController';
import { SelectionSystem } from '../systems/SelectionSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import { GrassBillboardSystem } from '../render/GrassBillboardSystem';
import { getBlockIdByName } from '../world/blocks/BlockRegistry';
import { useUIStore } from '../../state/ui';
import { USE_OCEAN_HORIZON } from '../../config/flags';
import { SoundEffects } from '../audio/SoundEffects';
import type { WorldSavePayload, SavedChunk, SavedInventory, WorldSaveFile } from '../../types/save';
import { base64FromBytes, signPayload, encryptPayload, SAVE_ENC_ALG, SAVE_SIGNATURE_ALG, SAVE_PUBLIC_KEY_ID } from '../../shared/save';
import { CHUNK_SIZE as CONST_CHUNK_SIZE } from '../../config/constants';
import { getInventorySlots } from '../../state/inventory';
import FirstPersonBody from '../render/FirstPersonBody';
import { applyDiagnosticCameraPose, type DiagnosticCameraId } from '../../diagnostics/cameras';
import { VoxelOccupancyVolume } from '../render/lighting/VoxelOccupancyVolume.js';
import { VoxelSunShadowPass } from '../render/lighting/VoxelSunShadowPass.js';

let rafId: number | null = null;
let running = false;
let startPromise: Promise<void> | null = null;

// Engine subsystems
let renderer: Renderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let world: World | null = null;
let chunkRenderer: ChunkRenderer | null = null;
let blockMaterial: BlockMaterial | null = null;
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
let lastFrameNow: number = 0;
let fpsCounterFrames: number = 0;
let fpsLastReportNow: number = 0;
let lastPaused: boolean = false;
let sfx: SoundEffects | null = null;
let aerialPerspectiveDistance = 600; // default, updated based on world size
let playerRigRoot: THREE.Group | null = null;
let playerBody: FirstPersonBody | null = null;
let lastMoveActive = false;
let diagnosticMode = false;
let diagnosticView: DiagnosticCameraId | null = null;
let voxelShadowVolumeReported = false;
let voxelShadowVolume: VoxelOccupancyVolume | null = null;
let voxelSunShadowPass: VoxelSunShadowPass | null = null;
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
    // UI can set this before triggering save to make the browser show a native save dialog.
    // We avoid tight typing here to keep DOM lib compatibility across environments.
    __nextSaveFileHandle?: unknown;
  }
}

function computeBoundsFromChunkCount(totalChunks: number) {
  const sideApprox = Math.max(1, Math.round(Math.sqrt(totalChunks)));
  const side = sideApprox;
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
    const totalChunks = Math.max(1, Math.floor(ui.chunkCount || 9));
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
        chunkSize: { ...CONST_CHUNK_SIZE },
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

function update(dtSeconds: number) {
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
    // Feed right-click peeks to body animator; left clicks are driven by InteractionSystem to stay in sync
    if (playerBody && inputSystem) {
      if (inputSystem.peekRightClick?.()) playerBody.onSecondaryClick();
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
    // Movement edge notifications for body rig
    if (playerBody && inputSystem) {
      const mv = inputSystem.getMoveInput?.() || { x: 0, z: 0 };
      const active = (Math.hypot(mv.x, mv.z) > 0.01) || !!inputSystem.isJumpHeld?.();
      if (active && !lastMoveActive) playerBody.onMovementInputStart?.();
      if (!active && lastMoveActive) playerBody.onMovementInputEnd?.();
      lastMoveActive = !!active;
    }
    if (selectionSystem) {
      selectionSystem.update();
    }
    if (interactionSystem) {
      interactionSystem.update();
    }
  }
  // Update sound effects after movement/collision updates
  if (sfx) {
    sfx.update(dtSeconds, paused, inGame);
  }
  // Update in-world body rig after movement update, before render
  if (playerBody && inGame && !paused) {
    playerBody.update(dtSeconds);
  }
  
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
    skyDome?.setAtmosphereState(atmosphereState);
    if (camera) skyDome?.setCameraPosition(camera.position);
  }

  // Update block materials with sun uniforms
  if (blockMaterial && sunController && atmosphereState) {
    const sdir = sunController.getSunDirection();
    blockMaterial.setSunUniforms(sdir, atmosphereState.sunColor);
    // Day/night factor for ambient modulation with a small night floor to avoid total darkness
    const NIGHT_MIN_LIGHT = 0.10; // keep nights faintly lit
    const dayLight = Math.max(NIGHT_MIN_LIGHT, atmosphereState.daylight);
    blockMaterial.setDayLight(dayLight);
    blockMaterial.setStarLight(atmosphereState.starVisibility * 0.35);
    blockMaterial.setSkyAmbient(atmosphereState.skyIrradiance);
    blockMaterial.setWaterCaustics(true, VISUAL_WATER_LEVEL, 0.80, waterSystem?.getTime() ?? 0);
    if (grassSystem) grassSystem.setSunUniforms(sdir, atmosphereState.sunColor);
    if (grassSystem) grassSystem.setDayNight(dayLight, atmosphereState.starVisibility * 0.35);
    if (grassSystem) grassSystem.setSkyAmbient(atmosphereState.skyIrradiance);
    if (playerBody) playerBody.setLighting(sdir, atmosphereState.sunColor, dayLight, atmosphereState.starVisibility * 0.35);
    if (playerBody) playerBody.setSkyAmbient(atmosphereState.skyIrradiance);
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
      waterSystem.setSun(sdir, atmosphereState.sunColor);
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
    waterMaterial?.setTime(waterSystem.getTime());
    waterMaterial?.setCameraUnderwater(waterSystem.isCameraUnderwater());
    composer?.setUnderwater(waterSystem.isCameraUnderwater());
    if (composer) {
      composer.setUnderwaterCaustics(
        waterSystem.getCausticTexture(),
        waterSystem.getCausticOrigin(),
        waterSystem.getCausticExtent(),
        waterSystem.getCausticResolution(),
      );
    }
  }

  // Update subsystems here (physics, input, etc.)
  if (composer && camera && sunController && atmosphereState) {
    const sdir = sunController.getSunDirection();
    composer.update(camera, sdir, atmosphereState.sunColor, atmosphereState);
    // Feed the same bounded frame delta used by the simulation into the
    // composer. EffectComposer otherwise measures its own uncapped clock;
    // after a hitch or tab resume that would let exposure adapt in one jump.
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
  
  rafId = requestAnimationFrame(tick);
}

export interface EngineStartOptions {
  /** When set, render a fixed local diagnostics pose through the normal pipeline. */
  diagnosticView?: DiagnosticCameraId;
  /** Optional normalized time-of-day used by local validation captures. */
  diagnosticTime?: number;
}

async function startInternal(canvas: HTMLCanvasElement, options: EngineStartOptions = {}) {

  diagnosticView = options.diagnosticView ?? null;
  diagnosticMode = diagnosticView !== null;
  voxelShadowVolumeReported = false;
  
  // Initialize renderer
  renderer = new Renderer(canvas);
  const baseRenderer = renderer.getRenderer();
  const isWebGPU = (baseRenderer as { isWebGPURenderer?: boolean }).isWebGPURenderer === true;
  
  // Initialize scene and camera
  scene = createScene();
  const aspect = canvas.clientWidth / canvas.clientHeight;
  // This is the same camera instance used by gameplay. Diagnostics only apply
  // a different world-space pose after the normal world/render setup exists.
  camera = createPlayerCamera(aspect);
  
  // Initialize world
  world = new World();
  
  // Load atlas and initialize chunk renderer with custom material
  const atlas = await loadFullAtlas();
  blockMaterial = new BlockMaterial(
    atlas.getTexture(),
    null,
    undefined,
    { tileSize: atlas.getConfig().tileSize, atlasSize: atlas.getConfig().atlasSize }
  );
  // Mild in-shader AA to reduce texture shimmer on distant blocks
  blockMaterial.setAntialiasing(true, 0.9);
  
  // Configure material properties for natural block materials
  blockMaterial.setMaterialProperties(0.8, 0.0, 0.3);
  blockMaterial.setWaterCaustics(true, VISUAL_WATER_LEVEL, 0.80);

  // Determine anisotropy support for any textures that can benefit (e.g., seabed sand)
  let maxAniso = 0;
  if ('capabilities' in baseRenderer) {
    const caps = (baseRenderer as THREE.WebGLRenderer).capabilities;
    if (caps?.getMaxAnisotropy) {
      maxAniso = caps.getMaxAnisotropy() ?? 0;
    }
  }

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

  chunkRenderer = new ChunkRenderer(scene, { opaque: blockMaterial, transparent: waterMaterial });
  
  // Create player rig root and in-world first-person body
  playerRigRoot = new THREE.Group();
  playerRigRoot.name = 'PlayerRigRoot';
  scene.add(playerRigRoot);
  playerBody = new FirstPersonBody();
  playerBody.init(playerRigRoot, camera);

  // Initialize the single active post-processing pipeline.
  const canvasSize = renderer.getCanvasSize();
  if (!isWebGPU) {
    const glRenderer = baseRenderer as THREE.WebGLRenderer;
    composer = new Composer(glRenderer, scene, camera, canvasSize.width, canvasSize.height);
    composer.setSSAO(RENDER_STYLE.ssao.enabled, RENDER_STYLE.ssao.intensity, RENDER_STYLE.ssao.radius);
    composer.setBloom(RENDER_STYLE.bloom.enabled, RENDER_STYLE.bloom.strength, RENDER_STYLE.bloom.threshold);
    composer.setLens(RENDER_STYLE.lens.enabled, RENDER_STYLE.lens.intensity);
    composer.setAerialPerspective(true, aerialPerspectiveDistance);
    composer.setSSAOWaterLevel(VISUAL_WATER_LEVEL);
    composer.setUnderwaterWaterLevel(VISUAL_WATER_LEVEL);
  } else {
    composer = null;
  }

  // Initialize the continuous sun illumination. WebGL voxel visibility is
  // resolved by VoxelSunShadowPass; WebGPU remains outside this path.
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
    enableShadows: !isWebGPU,
  });
  if (diagnosticMode) console.info('[AtmosphereInit]', JSON.stringify({ requestedTime: options.diagnosticTime, actualTime: sunController.getTime(), paused: sunController.isPaused() }));

  atmosphereModel = new AtmosphereModel();
  skyDome = new SkyDome(scene);
  
  // Set atlas config and block registry in chunk pipeline
  const blockRegistry = getBlockRegistry();
  world.chunkPipeline.setAtlasConfig(atlas.getConfig(), blockRegistry.getAllBlocks());

  // Input system (pointer lock + mouse look)
  inputSystem = new InputSystem(canvas, camera);
  // Track pointer lock -> set inGame accordingly
  inputSystem.onPointerLockChanged((locked: boolean) => {
    const ui = useUIStore.getState();
    if (locked) {
      ui.setInGame(true);
    } else {
      // If pointer lock was released by browser (e.g., Esc), leave inGame only if not paused
      if (!ui.paused) ui.setInGame(false);
      // If paused, remain inGame so UI can handle clicks
    }
  });

  // Determine world size (total chunks -> NxN grid)
  const totalChunks = Math.max(1, Math.floor(useUIStore.getState().chunkCount || 9));
  const { bounds, worldRadius } = computeBoundsFromChunkCount(totalChunks);

  // The voxel shadow volume is the sole caster representation. It is fixed to
  // the generated world bounds, so sun motion never changes a projection grid.
  if (!isWebGPU) {
    const glRenderer = baseRenderer as THREE.WebGLRenderer;
    voxelShadowVolume = new VoxelOccupancyVolume({
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: 0,
      maxY: CHUNK_SIZE.y,
      minZ: bounds.minZ,
      maxZ: bounds.maxZ,
    });
    voxelSunShadowPass = new VoxelSunShadowPass(glRenderer, canvasSize.width, canvasSize.height, voxelShadowVolume);
    const shadowResolution = voxelSunShadowPass.getDiagnostics().resolution;
    blockMaterial?.setVoxelShadowTexture(voxelSunShadowPass.getTexture(), shadowResolution.width, shadowResolution.height, !!composer);
    if (composer) blockMaterial?.setVoxelShadowDepthTexture(composer.getDepthTexture(), camera.near, camera.far);
    composer?.setVoxelSunShadowPass(voxelSunShadowPass);
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
  }
  sunController?.setShadowSettings({
    enabled: RENDER_STYLE.shadows.enabled && !isWebGPU,
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
      anisotropy: maxAniso ? Math.min(8, maxAniso) : 8,
      renderer: !isWebGPU ? (baseRenderer as THREE.WebGLRenderer) : undefined,
    });
    waterSystem.setSceneInputs(
      composer?.getSceneColorTexture() ?? null,
      composer?.getDepthTexture() ?? null,
      composer?.getSceneColorResolution() ?? { x: canvasSize.width, y: canvasSize.height },
      camera.near,
      camera.far,
    );
    composer?.setOpaqueCaptureHooks(
      () => waterSystem?.setOpaqueCaptureMode(true),
      () => waterSystem?.setOpaqueCaptureMode(false),
    );
  }

  // Player controller (movement + gravity + collisions)
  playerController = new PlayerController(camera, world, inputSystem, bounds);
  
  // Selection system (raycast + debug outline). Pass world bounds so selection highlights don't appear outside.
  selectionSystem = new SelectionSystem(camera, world, scene, bounds);
  
  // Interaction system (mine/place + re-mesh)
  interactionSystem = new InteractionSystem(camera, world, inputSystem, selectionSystem, world.chunkPipeline, playerController);
  // Decorative grass system (instanced billboards). Its direct sun visibility
  // uses the same screen-space voxel result as terrain; the caster side uses
  // the matching crossed-card proxy inside VoxelSunShadowPass.
  grassSystem = new GrassBillboardSystem(scene, world, getBlockIdByName('grass_tuft') ?? 9);
  if (voxelSunShadowPass) {
    const resolution = voxelSunShadowPass.getDiagnostics().resolution;
    grassSystem.setVoxelShadowTexture(voxelSunShadowPass.getTexture(), resolution.width, resolution.height, !!composer);
    if (composer) grassSystem.setVoxelShadowDepthTexture(composer.getDepthTexture(), camera.near, camera.far);
  }
  
  // Sound effects
  sfx = new SoundEffects(world, camera, inputSystem, playerController);
  
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
  });
  
  // If a saved snapshot is provided via global, ingest it directly and skip generation
  const pendingSave = (window as Window & { __WORLD_SNAPSHOT?: WorldSavePayload; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT;
  const wasVerified = (window as Window & { __WORLD_SNAPSHOT?: WorldSavePayload; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT_VERIFIED;
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
      // Ingest chunks
      for (const ch of pendingSave.chunks) {
        const vox = new Uint8Array(atob(ch.voxelsB64).split('').map((c) => c.charCodeAt(0)));
        const chunkData = { size: ch.size, voxels: vox };
        world.chunkPipeline.ingestChunkData(ch.key, chunkData);
      }
    } catch (e) {
      console.error('Failed to load snapshot; returning to Start Panel.', e);
      try { alert('Save file verification failed or is corrupted. Returning to Start Panel.'); } catch { /* ignore */ }
      // Clean up and return control to Start Panel
      stop();
      const ui = useUIStore.getState();
      ui.setGameStarted(false);
      ui.setInGame(false);
      return; // abort start
    } finally {
      // Clear the pending snapshot so restarts don’t reuse
      delete (window as Window & { __WORLD_SNAPSHOT?: WorldSavePayload; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT;
      delete (window as Window & { __WORLD_SNAPSHOT?: WorldSavePayload; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT_VERIFIED;
    }
  } else {
    // Request NxN grid of chunks around origin
    const negRadius = Math.floor(Math.sqrt(totalChunks) / 2);
    const posRadius = Math.sqrt(totalChunks) - 1 - negRadius;
    for (let cx = -negRadius; cx <= posRadius; cx++) {
      for (let cz = -negRadius; cz <= posRadius; cz++) {
        world.ensureChunk(cx, 0, cz);
      }
    }
  }
  
  // Handle window resize
  const handleResize = () => {
    if (renderer && camera && canvas) {
      const size = renderer.onResize();
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      
      if (composer) {
        composer.setPixelRatio(size.dpr);
        composer.setSize(size.width, size.height);
      }
      if (waterSystem && camera) {
        waterSystem.setSceneInputs(
          composer?.getSceneColorTexture() ?? null,
          composer?.getDepthTexture() ?? null,
          composer?.getSceneColorResolution() ?? { x: size.width, y: size.height },
          camera.near,
          camera.far,
        );
      }
      if (voxelSunShadowPass) {
        const resolution = voxelSunShadowPass.getDiagnostics().resolution;
        blockMaterial?.setVoxelShadowTexture(voxelSunShadowPass.getTexture(), resolution.width, resolution.height, !!composer);
        grassSystem?.setVoxelShadowTexture(voxelSunShadowPass.getTexture(), resolution.width, resolution.height, !!composer);
      }
    }
  };
  window.addEventListener('resize', handleResize);
  
  running = true;
  lastPaused = useUIStore.getState().paused;
  lastFrameNow = performance.now();
  fpsCounterFrames = 0;
  fpsLastReportNow = 0;
  rafId = requestAnimationFrame(tick);
}

/**
 * Serialize startup. CanvasHost is mounted under React StrictMode in
 * development, and its effect can be invoked twice while atlas/worker setup
 * is still awaiting. Without this gate both starts mutate the same module
 * globals and install duplicate sun lights/visibility passes in one scene.
 */
async function start(canvas: HTMLCanvasElement, options: EngineStartOptions = {}): Promise<void> {
  if (running) return;
  if (startPromise) return startPromise;

  const pending = startInternal(canvas, options);
  startPromise = pending;
  try {
    await pending;
  } finally {
    if (startPromise === pending) startPromise = null;
  }
}

function stop() {
  running = false;
  diagnosticMode = false;
  diagnosticView = null;
  voxelShadowVolumeReported = false;
  lastPaused = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  // Clean up input
  if (inputSystem) {
    inputSystem.destroy();
    inputSystem = null;
  }
  
  // Clean up chunk renderer
  if (chunkRenderer) {
    chunkRenderer.destroy();
    chunkRenderer = null;
  }

  // Clean up block material
  if (blockMaterial) {
    blockMaterial.dispose();
    blockMaterial = null;
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

// Expose to global scope for UI communication
(window as Window & {
  updateGraphicsSettings?: (settings: GraphicsSettings) => void;
  getGraphicsSettings?: () => GraphicsSettings;
}).updateGraphicsSettings = updateGraphicsSettings;
(window as Window & {
  getGraphicsSettings?: () => GraphicsSettings;
}).getGraphicsSettings = getGraphicsSettings;

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
    exposure: composer?.getExposureDiagnostics() ?? null,
  };
};

// Expose SFX helpers to UI
(window as Window & { __setSfxVolume?: (v: number) => void; __getSfxVolume?: () => number; __primeSfx?: () => void }).__setSfxVolume = (v: number) => { sfx?.setVolume(v); };
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
