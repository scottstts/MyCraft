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
import { InputSystem } from '../systems/Input';
import { PlayerController } from '../systems/PlayerController';
import { SelectionSystem } from '../systems/SelectionSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import { useUIStore } from '../../state/ui';
import { USE_EFFECT_COMPOSER } from '../../config/flags';

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
let postProcessor: SimplePostProcessor | null = null;
let composer: Composer | null = null;
let shadowSystem: ShadowSystem | null = null;
let sunController: SunController | null = null;
let skyDome: SkyDome | null = null;
let starDome: StarDome | null = null;
let clouds: CloudsLayer | null = null;
let inputSystem: InputSystem | null = null;
let playerController: PlayerController | null = null;
let selectionSystem: SelectionSystem | null = null;
let interactionSystem: InteractionSystem | null = null;
let lastFrameNow: number = 0;
let fpsCounterFrames: number = 0;
let fpsLastReportNow: number = 0;
let lastPaused: boolean = false;

function update(dtSeconds: number) {
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
    if (selectionSystem) {
      selectionSystem.update();
    }
    if (interactionSystem) {
      interactionSystem.update();
    }
  }
  
  // Update material uniforms
  if (blockMaterial && camera) {
    blockMaterial.updateUniforms(camera);
  }

  // Time-of-day and lighting
  if (sunController) {
    sunController.update(dtSeconds);
  }
  if (skyDome && sunController) {
    skyDome.setSunDirection(sunController.getSunDirection());
  }
  if (starDome && sunController) {
    starDome.update();
    const elev = sunController.getElevationRadians();
    const vis = THREE.MathUtils.clamp((0.1 - elev) / (0.1 + 0.05), 0, 1); // smoothstep-ish
    starDome.setVisibility(vis);
  }
  if (clouds) clouds.update();

  // Update shadow system
  if (shadowSystem && scene && camera) {
    if (sunController) {
      const sunDir = sunController.getSunDirection();
      shadowSystem.setSunDirection(sunDir);
    }
    shadowSystem.update(camera, scene);
    
    // Update block material with shadow uniforms
    if (blockMaterial) {
      const shadowUniforms = shadowSystem.getShadowUniforms();
      blockMaterial.updateShadowUniforms(shadowUniforms);
    }
  }
  // Update block material with sun uniforms
  if (blockMaterial && sunController) {
    blockMaterial.setSunUniforms(
      sunController.getSunDirection(),
      sunController.getSunColor()
    );
  }
  
  // Update subsystems here (physics, input, etc.)
  if (composer && camera && sunController) {
    composer.update(camera, sunController.getSunDirection());
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
  
  chunkRenderer = new ChunkRenderer(scene, blockMaterial);

  // Initialize post-processing pipeline
  const canvasSize = renderer.getCanvasSize();
  if (USE_EFFECT_COMPOSER) {
    composer = new Composer(renderer.getRenderer(), scene, camera, canvasSize.width, canvasSize.height);
    // Configure composer defaults
    console.log('[Engine] Configuring composer post-processing settings');
    composer.setSSAO(true, 0.3, 0.01);
    composer.setBloom(true, 0.15, 0.3);
    composer.setFog(true, 0.002, 600);
    composer.setVolumetrics(true, 0.1, 32);
  } else {
    postProcessor = new SimplePostProcessor(
      renderer.getRenderer(),
      scene,
      camera,
      canvasSize.width,
      canvasSize.height
    );
    console.log('[Engine] Configuring post-processing settings');
    postProcessor.updateSettings({
      ssaoEnabled: true,
      ssaoIntensity: 0.3,
      ssaoRadius: 0.01,
      bloomEnabled: true,
      bloomStrength: 0.15,
      bloomThreshold: 0.3,
      exposure: 0.9,
      contrast: 1.05,
      saturation: 1.0,
      fogEnabled: true,
      fogBaseDensity: 0.002,
      fogMaxDistance: 600,
      volumetricsEnabled: true,
      volumetricsIntensity: 0.1,
      volumetricsSteps: 32,
    });
  }

  // Initialize shadow system (temporarily disabled to avoid WebGL feedback loops)
  shadowSystem = new ShadowSystem(renderer.getRenderer(), scene);

  // Initialize sun controller (day/night cycle)
  sunController = new SunController(scene, { cycleSeconds: 180, initialTime: 0.25 });

  // Sky dome for physical sky colors
  skyDome = new SkyDome(scene, { turbidity: 2.0, rayleigh: 1.5, mieCoefficient: 0.005, mieDirectionalG: 0.8 });
  starDome = new StarDome(scene, { intensity: 1.2 });
  clouds = new CloudsLayer(scene, { altitude: 200, coverage: 0.45, density: 0.65, windDirection: Math.PI * 0.25, windSpeed: 5 });
  // Temporary global hooks for clouds adjustments from DebugPanel
  (window as unknown as { __setClouds?: (cov?: number, dens?: number) => void }).__setClouds = (cov?: number, dens?: number) => {
    if (!clouds) return;
    if (typeof cov === 'number') clouds.setCoverage(cov);
    if (typeof dens === 'number') clouds.setDensity(dens);
  };
  
  // Configure shadows for optimal minecraft-style visuals
  console.log('[Engine] Configuring shadow settings');
  shadowSystem.updateSettings({
    enabled: true, // Enable shadows by default
    resolution: 1024,
    cascades: 3,
    shadowDistance: 100,
    softness: 2.5,
    bias: 0.0005,
    normalBias: 0.02,
    intensity: 0.6
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
  const sideApprox = Math.max(1, Math.round(Math.sqrt(totalChunks)));
  const side = sideApprox; // UI constrains to odd squares; general handling if not
  const negRadius = Math.floor(side / 2);
  const posRadius = side - 1 - negRadius;

  // Configure world bounds for player (invisible force field)
  const bounds = {
    minX: -negRadius * CHUNK_SIZE.x,
    maxX: (posRadius + 1) * CHUNK_SIZE.x,
    minZ: -negRadius * CHUNK_SIZE.z,
    maxZ: (posRadius + 1) * CHUNK_SIZE.z,
  } as const;

  // Calculate world radius for terrain generation
  const worldRadius = Math.max(
    Math.abs(bounds.maxX - bounds.minX),
    Math.abs(bounds.maxZ - bounds.minZ)
  ) / 2;

  // Set world radius in chunk pipeline for terrain generation
  world.chunkPipeline.setWorldRadius(worldRadius);

  // Set camera spawn position above ground  
  const spawnPos = findSpawnPosition(world.getSeed(), 0, 0, worldRadius);
  camera.position.set(spawnPos.x, spawnPos.y, spawnPos.z);

  // Player controller (movement + gravity + collisions)
  playerController = new PlayerController(camera, world, inputSystem, bounds);
  
  // Selection system (raycast + debug outline)
  selectionSystem = new SelectionSystem(camera, world, scene);
  
  // Interaction system (mine/place + re-mesh)
  interactionSystem = new InteractionSystem(camera, world, inputSystem, selectionSystem, world.chunkPipeline, playerController);
  
  // Connect world events to chunk renderer
  world.chunkPipeline.on('CHUNK_READY', (data: ChunkPipelineEvents['CHUNK_READY']) => {
    console.log(`[Engine] Chunk ready: ${data.key}`);
  });
  
  // Connect chunk pipeline to chunk renderer
  world.chunkPipeline.on('CHUNK_MESH', (data: ChunkPipelineEvents['CHUNK_MESH']) => {
    const { response } = data;
    if (chunkRenderer) {
      chunkRenderer.handleChunkMesh(response);
    }
  });
  
  // Request NxN grid of chunks around origin
  for (let cx = -negRadius; cx <= posRadius; cx++) {
    for (let cz = -negRadius; cz <= posRadius; cz++) {
      world.ensureChunk(cx, 0, cz);
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

  // Clean up renderer
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  
  scene = null;
  camera = null;
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
  console.log('[Engine] Received post-processing settings:', settings);
  if (composer) {
    composer.setSSAO(!!settings.ssaoEnabled, settings.ssaoIntensity, settings.ssaoRadius);
    composer.setBloom(!!settings.bloomEnabled, settings.bloomStrength, settings.bloomThreshold);
    composer.setFog(!!settings.fogEnabled, settings.fogBaseDensity ?? 0.002, settings.fogMaxDistance ?? 600);
    composer.setVolumetrics(!!settings.volumetricsEnabled, settings.volumetricsIntensity ?? 0.1, settings.volumetricsSteps ?? 32);
    console.log('[Engine] Applied composer post-processing settings');
  } else if (postProcessor) {
    postProcessor.updateSettings(settings);
    console.log('[Engine] Applied post-processing settings successfully');
  } else {
    console.error('[Engine] Post-processor not available!');
  }
}

// Global function for UI to update shadow settings
function updateShadowSettings(settings: ShadowSettings) {
  console.log('[Engine] Received shadow settings:', settings);
  if (shadowSystem) {
    shadowSystem.updateSettings(settings);
    console.log('[Engine] Applied shadow settings successfully');
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

console.log('[Engine] Global functions exposed to window:', {
  updatePostProcessingSettings: !!(window as Window & { updatePostProcessingSettings?: unknown }).updatePostProcessingSettings,
  updateShadowSettings: !!(window as Window & { updateShadowSettings?: unknown }).updateShadowSettings,
  updateGraphicsSettings: !!(window as Window & { updateGraphicsSettings?: unknown }).updateGraphicsSettings,
  getGraphicsSettings: !!(window as Window & { getGraphicsSettings?: unknown }).getGraphicsSettings,
});

export const engine = { start, stop };
export type Engine = typeof engine;
