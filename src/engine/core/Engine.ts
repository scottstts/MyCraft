/**
 * Module: engine/core/Engine
 * Purpose: Game engine with RAF loop, Three.js rendering, and subsystem management
 * Callers: CanvasHost loads this module and calls start/stop
 * Invariants: Pure TS module; no React imports anywhere under /engine
 */

import * as THREE from 'three';
import { Renderer } from '../render/Renderer';
import { createScene, createCamera } from '../render/SceneBuilder';
import { World } from '../world/World';
import type { ChunkPipelineEvents } from '../world/ChunkPipeline';
import type { ChunkMeshResponse, ChunkKey } from '../../types/workers';
import { ChunkRenderer } from '../render/ChunkRenderer';
import { loadFullAtlas } from '../render/Atlas';
import { Environment } from '../render/Environment';
import { BlockMaterial } from '../render/BlockMaterial';
import { SimplePostProcessor, type PostProcessorSettings } from '../render/SimplePostProcessor';
import { Composer } from '../render/postprocessing/Composer';
import { ShadowSystem, type ShadowSettings } from '../render/ShadowSystem';
import { SunController } from '../render/lighting/SunController';
import { SkyDome } from '../render/atmosphere/SkyDome';
import { StarDome } from '../render/atmosphere/StarDome';
import { CloudsLayer } from '../render/atmosphere/CloudsLayer';
import { applyGraphicsSettings, type GraphicsSettings } from '../render/settings/GraphicsSettings';
import { getBlockRegistry } from '../world/blocks/BlockRegistry';
import { findSpawnPosition } from '../world/TerrainGenerator';
import { CHUNK_SIZE } from '../../config/constants';
import { WATER_LEVEL } from '../world/TerrainGenerator';
import { OceanHorizon } from '../render/water/OceanHorizon';
import { WaterSurfaceMaterial } from '../render/water/WaterSurfaceMaterial';
import { InputSystem } from '../systems/Input';
import { PlayerController } from '../systems/PlayerController';
import { SelectionSystem } from '../systems/SelectionSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import waterTexture from '../../assets/textures/water.png';
import { useUIStore } from '../../state/ui';
import { USE_EFFECT_COMPOSER, USE_OCEAN_HORIZON } from '../../config/flags';
import { SoundEffects } from '../audio/SoundEffects';
import type { WorldSavePayload, SavedChunk, SavedInventory, WorldSaveFile } from '../../types/save';
import { base64FromBytes, signPayload, encryptPayload, SAVE_ENC_ALG, SAVE_SIGNATURE_ALG, SAVE_PUBLIC_KEY_ID } from '../../shared/save';
import { CHUNK_SIZE as CONST_CHUNK_SIZE } from '../../config/constants';
import { getInventorySlots } from '../../state/inventory';
import FirstPersonBody from '../render/FirstPersonBody';

let rafId: number | null = null;
let running = false;

// Engine subsystems
let renderer: Renderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let world: World | null = null;
let chunkRenderer: ChunkRenderer | null = null;
let environment: Environment | null = null;
let blockMaterial: BlockMaterial | null = null;
let waterMaterial: WaterSurfaceMaterial | null = null;
let postProcessor: SimplePostProcessor | null = null;
let composer: Composer | null = null;
let shadowSystem: ShadowSystem | null = null;
let sunController: SunController | null = null;
let skyDome: SkyDome | null = null;
let starDome: StarDome | null = null;
let clouds: CloudsLayer | null = null;
let oceanHorizon: OceanHorizon | null = null;
let inputSystem: InputSystem | null = null;
let playerController: PlayerController | null = null;
let selectionSystem: SelectionSystem | null = null;
let interactionSystem: InteractionSystem | null = null;
let lastFrameNow: number = 0;
let fpsCounterFrames: number = 0;
let fpsLastReportNow: number = 0;
let lastPaused: boolean = false;
let sfx: SoundEffects | null = null;
let dynamicFogDistance = 600; // default, updated based on world size
let playerRigRoot: THREE.Group | null = null;
let playerBody: FirstPersonBody | null = null;
let lastMoveActive = false;
// Frame counter for coordinating mesh swaps
let frameCounter = 0;
// Queue incoming chunk meshes; apply in small batches to avoid border flicker
const pendingChunkMeshes: Map<ChunkKey, { response: ChunkMeshResponse; receivedAt: number }> = new Map();
// Snapshot pending from StartPanel (global handoff)
declare global {
  interface Window {
    __WORLD_SNAPSHOT?: WorldSavePayload;
    __saveWorld?: () => void;
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
  if (inGame && !paused) {
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
  
  // Update material uniforms
  if (blockMaterial && camera) blockMaterial.updateUniforms(camera);

  // Time-of-day and lighting: pause only when UI paused
  if (sunController) {
    if (!paused) {
      sunController.update(dtSeconds);
    }
  }
  if (skyDome && sunController) {
    skyDome.setSunDirection(sunController.getSunDirection());
  }
  if (starDome && sunController) {
    starDome.update();
    // Use dayLight from sun elevation (y component of sun direction) for star visibility
    const dayLight = Math.max(0, sunController.getSunDirection().y);
    const starVis = 1 - THREE.MathUtils.clamp(dayLight / 0.25, 0, 1); // fully visible by dayLight<=0
    starDome.setVisibility(starVis);
    starDome.setIntensity(1.2 + 1.6 * starVis);
  }
  if (clouds) {
    clouds.update();
    if (sunController) {
      const sdir = sunController.getSunDirection();
      const dayLight = Math.max(0, sdir.y);
      clouds.setDayLight(dayLight);
    }
  }

  // Update shadow system
  if (shadowSystem && scene && camera) {
    if (sunController) {
      const sunDir = sunController.getSunDirection();
      shadowSystem.setSunDirection(sunDir);
    }
    shadowSystem.update(camera, scene);
    
    // Update block materials with shadow uniforms (water uses unlit shader)
    if (blockMaterial) {
      const shadowUniforms = shadowSystem.getShadowUniforms();
      blockMaterial.updateShadowUniforms(shadowUniforms);
    }
  }
  // Update block materials with sun uniforms (water uses unlit shader)
  if (blockMaterial && sunController) {
    const sdir = sunController.getSunDirection();
    blockMaterial.setSunUniforms(sdir, sunController.getSunColor());
    // Day/night factor for ambient modulation
    const dayLight = Math.max(0, sdir.y);
    blockMaterial.setDayLight(dayLight);
    // Star light provides a tiny ambient boost at night
    const starVis = 1 - THREE.MathUtils.clamp((dayLight - 0.0) / 0.2, 0, 1);
    blockMaterial.setStarLight(starVis * 0.35);
  }
  
  // Animate far ocean illusion
  if (oceanHorizon) {
    oceanHorizon.update(dtSeconds);
  }

  // Update subsystems here (physics, input, etc.)
  if (composer && camera && sunController) {
    const sdir = sunController.getSunDirection();
    const scol = sunController.getSunColor();
    composer.update(camera, sdir, scol);
    // Darken fog color at night for proper night appearance
    const dayLight = Math.max(0, sdir.y);
    const dayFog = new THREE.Color(0.72, 0.82, 0.92);
    const nightFog = new THREE.Color(0.03, 0.05, 0.08);
    const fogColor = nightFog.clone().lerp(dayFog, dayLight);
    composer.setFogColor(fogColor);
    composer.setFogDayLight(dayLight);
    // Match far-ocean tint to time of day for consistent horizon
    const dayOcean = new THREE.Color(0x4aa3d8);
    const nightOcean = new THREE.Color(0x0a0e16);
    const oceanCol = nightOcean.clone().lerp(dayOcean, THREE.MathUtils.clamp(dayLight, 0, 1));
    if (oceanHorizon) oceanHorizon.setColor(oceanCol);
    if (waterMaterial) waterMaterial.setColor(oceanCol);
    composer.render();
  } else if (postProcessor) {
    if (sunController && camera) {
      postProcessor.setSunLighting(sunController.getSunDirection(), camera);
    }
    postProcessor.render();
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

async function start(canvas: HTMLCanvasElement) {
  if (running) return;
  
  // Initialize renderer
  renderer = new Renderer(canvas);
  
  // Initialize scene and camera
  scene = createScene();
  const aspect = canvas.clientWidth / canvas.clientHeight;
  camera = createCamera(aspect);
  
  // Initialize world
  world = new World();
  
  // Create simple environment mapping (temporarily simplified to avoid WebGL errors)
  environment = new Environment(renderer.getRenderer());
  let envMap: THREE.CubeTexture | null = null;
  try {
    envMap = environment.createEnvironmentMap();
    scene.environment = envMap;
  } catch (error) {
    console.warn('Environment mapping disabled due to WebGL compatibility:', error);
    envMap = null;
  }
  
  // Load atlas and initialize chunk renderer with custom material
  const atlas = await loadFullAtlas();
  blockMaterial = new BlockMaterial(
    atlas.getTexture(),
    envMap
  );
  
  // Configure material properties for natural block materials
  blockMaterial.setMaterialProperties(0.8, 0.0, 0.3);

  // Load raw water texture once for both near water and far ocean
  let waterTex: THREE.Texture | null = null;
  try {
    waterTex = await new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(
        waterTexture,
        (tex) => resolve(tex),
        undefined,
        reject
      );
    });
    waterTex.colorSpace = THREE.SRGBColorSpace;
    waterTex.magFilter = THREE.NearestFilter;
    waterTex.minFilter = THREE.LinearMipMapLinearFilter;
    waterTex.wrapS = THREE.RepeatWrapping;
    waterTex.wrapT = THREE.RepeatWrapping;
    waterTex.generateMipmaps = true;
    // Enable anisotropic filtering if supported
    try {
      const maxAniso = renderer?.getRenderer().capabilities.getMaxAnisotropy?.() ?? 0;
      if (maxAniso && maxAniso > 1) {
        waterTex.anisotropy = Math.min(8, maxAniso);
      }
    } catch { void 0; }
    waterTex.needsUpdate = true;
  } catch (e) {
    console.warn('Water texture load failed, far ocean will fallback to color.', e);
    waterTex = null;
  }

  // Water material uses the same shader as far ocean, but uses vUv on block meshes
  waterMaterial = new WaterSurfaceMaterial({
    map: waterTex,
    tileScale: 1.0,
    useWorldUV: true,
    bounds: {
      minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity,
    },
  });
  // Make block water surfaces slightly translucent
  waterMaterial.setAlpha(0.7);
  // Add subtle refraction and wave perturbation
  waterMaterial.setRefraction(0.18, 0.75, 0.12, 0.035, 0.06);

  chunkRenderer = new ChunkRenderer(scene, { opaque: blockMaterial, transparent: waterMaterial });
  
  // Create player rig root and in-world first-person body
  playerRigRoot = new THREE.Group();
  playerRigRoot.name = 'PlayerRigRoot';
  scene.add(playerRigRoot);
  playerBody = new FirstPersonBody();
  playerBody.init(playerRigRoot, camera);

  // Initialize post-processing pipeline
  const canvasSize = renderer.getCanvasSize();
  if (USE_EFFECT_COMPOSER) {
    composer = new Composer(renderer.getRenderer(), scene, camera, canvasSize.width, canvasSize.height);
    // Configure composer defaults
    // console.log('[Engine] Configuring composer post-processing settings');
    composer.setSSAO(true, 0.3, 0.01);
    // Align defaults with DebugPanel: strength 0.30, threshold 0.05
    composer.setBloom(true, 0.30, 0.05);
    composer.setLens(true, 0.6);
    composer.setFog(true, 0.002, dynamicFogDistance);
    // Default volumetrics off
    composer.setVolumetrics(false, 0.1, 32);
  } else {
    postProcessor = new SimplePostProcessor(
      renderer.getRenderer(),
      scene,
      camera,
      canvasSize.width,
      canvasSize.height
    );
    // console.log('[Engine] Configuring post-processing settings');
    postProcessor.updateSettings({
      ssaoEnabled: true,
      ssaoIntensity: 0.3,
      ssaoRadius: 0.01,
      bloomEnabled: true,
      bloomStrength: 0.30,
      bloomThreshold: 0.05,
      exposure: 0.9,
      contrast: 1.15,
      saturation: 1.1,
      fogEnabled: true,
      fogBaseDensity: 0.002,
      fogMaxDistance: dynamicFogDistance,
      // Default volumetrics off
      volumetricsEnabled: false,
      volumetricsIntensity: 0.1,
      volumetricsSteps: 32,
    });
  }

  // Initialize shadow system (temporarily disabled to avoid WebGL feedback loops)
  shadowSystem = new ShadowSystem(renderer.getRenderer(), scene);

  // Initialize sun controller (day/night cycle)
  sunController = new SunController(scene, { cycleSeconds: 180, initialTime: 0.0 });

  // Sky dome for physical sky colors
  // Reduce solar disc brightness so bloom doesn't blow out the sky
  skyDome = new SkyDome(scene, { turbidity: 2.0, rayleigh: 1.5, mieCoefficient: 0.005, mieDirectionalG: 0.8, sunIntensityScale: 0.5, sunDiscScale: 0.1 });
  starDome = new StarDome(scene, { intensity: 1.2 });
  clouds = new CloudsLayer(scene, { altitude: 200, coverage: 0.45, density: 0.65, windDirection: Math.PI * 0.25, windSpeed: 5 });
  // Default clouds off
  clouds.setEnabled(false);
  // Initialize block material cloud shadow params to match clouds
  if (blockMaterial && clouds) {
    const w = clouds.getWind();
    blockMaterial.setCloudShadowUniforms({
      // Match clouds default state
      enabled: false,
      intensity: 0.35,
      altitude: clouds.getAltitude(),
      scale: 100,
      coverage: clouds.getCoverage(),
      density: clouds.getDensity(),
      wind: w,
    });
  }
  // Temporary global hooks for clouds adjustments from DebugPanel
  (window as unknown as { __setClouds?: (cov?: number, dens?: number) => void }).__setClouds = (cov?: number, dens?: number) => {
    if (!clouds) return;
    if (typeof cov === 'number') clouds.setCoverage(cov);
    if (typeof dens === 'number') clouds.setDensity(dens);
  };
  
  // Configure shadows for strong, crisp sun shadows
  // console.log('[Engine] Configuring shadow settings');
  shadowSystem.updateSettings({
    enabled: true, // Enable shadows by default
    resolution: 1024,
    cascades: 3,
    shadowDistance: 300,
    softness: 1.0,
    bias: 0.0005,
    normalBias: 0.02,
    intensity: 1.0,
    stableExtents: true,
    extentScale: 1.05,
    shadowBlendFraction: 0.2,
    shadowBlendMin: 3,
  });
  
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

  // Update water material edge bounds for consistent seam blend
  if (waterMaterial) {
    waterMaterial.setBounds(bounds);
    waterMaterial.setEdge(0.0, 2.0); // disable edge brightening to avoid visible grid
  }

  // worldRadius computed above

  // Calculate dynamic fog distance to avoid horizon gaps
  const margin = CHUNK_SIZE.x * 2; // small cushion
  dynamicFogDistance = Math.min(camera.far * 0.95, worldRadius + margin);
  // Update fog distance now that world size is known
  if (composer) {
    composer.setFog(true, 0.002, dynamicFogDistance);
    // Add horizon haze above water level only, at far distance, leaving seabed alone
    const hazeStart = Math.max(0, worldRadius - CHUNK_SIZE.x * 1.5);
    const hazeDensity = 0.0045;    // slightly lower extra fog at far distances
    const hazeMaxMix = 0.05;       // reduce horizon washout to avoid white ring
    const hazeAngleBoost = 0.4;    // smaller boost when looking near-horizon
    const hazePlaneBoost = 0.2;    // modest extra boost within a small band over the water plane
    const hazePlaneBand = 6.0;     // meters above water level for extra boost
    composer.setHorizonHaze({ enabled: true, waterLevel: WATER_LEVEL + 1.0, hazeStart, hazeDensity, hazeMaxMix, hazeAngleBoost, hazePlaneBoost, hazePlaneBand });
  } else if (postProcessor) {
    postProcessor.updateSettings({ fogEnabled: true, fogBaseDensity: 0.002, fogMaxDistance: dynamicFogDistance });
  }

  // Set world radius in chunk pipeline for terrain generation
  world.chunkPipeline.setWorldRadius(worldRadius);

  // Set camera spawn position above ground  
  const spawnPos = findSpawnPosition(world.getSeed(), 0, 0, worldRadius);
  camera.position.set(spawnPos.x, spawnPos.y, spawnPos.z);

  // Add far ocean ring outside world bounds to visually extend water to horizon
  if (USE_OCEAN_HORIZON) {
    const farOceanDistance = camera.far * 0.98;

    oceanHorizon = new OceanHorizon(scene, {
      bounds,
      waterLevel: WATER_LEVEL,
      farDistance: farOceanDistance,
      map: waterTex ?? undefined,
      tileScale: 1.0,
      enableSeabed: true,
      seed: world.getSeed(),
      worldRadius,
      blockMaterialSource: blockMaterial ?? undefined,
    });
  }

  // Player controller (movement + gravity + collisions)
  playerController = new PlayerController(camera, world, inputSystem, bounds);
  
  // Selection system (raycast + debug outline). Pass world bounds so selection highlights don't appear outside.
  selectionSystem = new SelectionSystem(camera, world, scene, bounds);
  
  // Interaction system (mine/place + re-mesh)
  interactionSystem = new InteractionSystem(camera, world, inputSystem, selectionSystem, world.chunkPipeline, playerController);
  
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
      renderer.onResize();
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
      
      // Update post-processor size
      if (composer) {
        composer.setSize(canvas.clientWidth, canvas.clientHeight);
      } else if (postProcessor) {
        postProcessor.setSize(canvas.clientWidth, canvas.clientHeight);
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

function stop() {
  running = false;
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

  // Clean up post processor
  if (postProcessor) {
    postProcessor.dispose();
    postProcessor = null;
  }

  // Clean up shadow system
  if (shadowSystem) {
    shadowSystem.dispose();
    shadowSystem = null;
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
  
  // Clean up environment
  if (environment) {
    environment.dispose();
    environment = null;
  }

  // Clean up ocean horizon
  if (oceanHorizon && scene) {
    oceanHorizon.dispose(scene);
  }
  oceanHorizon = null;

  // Clean up renderer
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  
  scene = null;
  camera = null;
  
  // Reset dynamic fog distance
  dynamicFogDistance = 600;
}

// Global function for UI to read current graphics state
function getGraphicsSettings(): GraphicsSettings {
  return {
    timeOfDay: {
      t: sunController ? sunController.getTime() : 0,
      paused: false,
      cycleSeconds: 180,
    },
    renderer: { exposure: renderer ? renderer.getRenderer().toneMappingExposure : 1.0 },
  };
}

// Global function for UI to update post-processing settings
function updatePostProcessingSettings(settings: PostProcessorSettings) {
  // console.log('[Engine] Received post-processing settings:', settings);
  if (composer) {
    composer.setSSAO(!!settings.ssaoEnabled, settings.ssaoIntensity, settings.ssaoRadius);
    composer.setBloom(!!settings.bloomEnabled, settings.bloomStrength, settings.bloomThreshold);
    composer.setFog(!!settings.fogEnabled, settings.fogBaseDensity ?? 0.002, settings.fogMaxDistance ?? dynamicFogDistance);
    composer.setVolumetrics(!!settings.volumetricsEnabled, settings.volumetricsIntensity ?? 0.1, settings.volumetricsSteps ?? 32);
    composer.setColorGrading(settings.exposure, settings.contrast, settings.saturation);
    // console.log('[Engine] Applied composer post-processing settings');
  } else if (postProcessor) {
    postProcessor.updateSettings(settings);
    // console.log('[Engine] Applied post-processing settings successfully');
  } else {
    console.error('[Engine] Post-processor not available!');
  }
}

// Global function for UI to update shadow settings
function updateShadowSettings(settings: ShadowSettings) {
  // console.log('[Engine] Received shadow settings:', settings);
  if (shadowSystem) {
    shadowSystem.updateSettings(settings);
    // console.log('[Engine] Applied shadow settings successfully');
  } else {
    console.error('[Engine] Shadow system not available!');
  }
}

// Global function for UI to update graphics settings (time of day, exposure, etc.)
function updateGraphicsSettings(settings: GraphicsSettings) {
  applyGraphicsSettings(settings, {
    setTime: (t: number) => { sunController?.setTime(t); },
    setTimePaused: (p: boolean) => { sunController?.pause(p); },
    setCycleSeconds: (sec: number) => { sunController?.setCycleSeconds(sec); },
    setRendererExposure: (exp: number) => {
      if (renderer) renderer.getRenderer().toneMappingExposure = exp;
    },
    setClouds: (p) => {
      if (!clouds) return;
      if (p.coverage !== undefined) clouds.setCoverage(p.coverage);
      if (p.density !== undefined) clouds.setDensity(p.density);
      if (p.windDirection !== undefined || p.windSpeed !== undefined) {
        const dir = p.windDirection ?? Math.PI * 0.25;
        const sp = p.windSpeed ?? 5;
        clouds.setWind(dir, sp);
      }
      if (p.enabled !== undefined) clouds.setEnabled(p.enabled);

      // Keep block material cloud shadow params in sync
      if (blockMaterial && clouds) {
        const w = clouds.getWind();
        blockMaterial.setCloudShadowUniforms({
          enabled: p.enabled ?? true,
          coverage: p.coverage ?? clouds.getCoverage(),
          density: p.density ?? clouds.getDensity(),
          altitude: clouds.getAltitude(),
          wind: w,
          // intensity/scale kept as current defaults unless explicitly configured later
        });
      }
    }
  });
}

// Expose to global scope for UI communication
(window as Window & {
  updatePostProcessingSettings?: (settings: PostProcessorSettings) => void;
  updateShadowSettings?: (settings: ShadowSettings) => void;
  updateGraphicsSettings?: (settings: GraphicsSettings) => void;
  getGraphicsSettings?: () => GraphicsSettings;
}).updatePostProcessingSettings = updatePostProcessingSettings;
(window as Window & {
  updatePostProcessingSettings?: (settings: PostProcessorSettings) => void;
  updateShadowSettings?: (settings: ShadowSettings) => void;
  updateGraphicsSettings?: (settings: GraphicsSettings) => void;
}).updateShadowSettings = updateShadowSettings;
(window as Window & {
  updatePostProcessingSettings?: (settings: PostProcessorSettings) => void;
  updateShadowSettings?: (settings: ShadowSettings) => void;
  updateGraphicsSettings?: (settings: GraphicsSettings) => void;
  getGraphicsSettings?: () => GraphicsSettings;
}).updateGraphicsSettings = updateGraphicsSettings;
(window as Window & {
  getGraphicsSettings?: () => GraphicsSettings;
}).getGraphicsSettings = getGraphicsSettings;

// Expose save function for UI
(window as Window & { __saveWorld?: () => void }).__saveWorld = () => { void saveWorldToFile(); };

// console.log('[Engine] Global functions exposed to window:', {
//   updatePostProcessingSettings: !!(window as Window & { updatePostProcessingSettings?: unknown }).updatePostProcessingSettings,
//   updateShadowSettings: !!(window as Window & { updateShadowSettings?: unknown }).updateShadowSettings,
//   updateGraphicsSettings: !!(window as Window & { updateGraphicsSettings?: unknown }).updateGraphicsSettings,
//   getGraphicsSettings: !!(window as Window & { getGraphicsSettings?: unknown }).getGraphicsSettings,
// });

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
