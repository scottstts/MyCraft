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
import { SimplePostProcessor } from '../render/SimplePostProcessor';
import { getBlockRegistry } from '../world/blocks/BlockRegistry';
import { findSpawnPosition } from '../world/TerrainGenerator';
import { InputSystem } from '../systems/Input';
import { PlayerController } from '../systems/PlayerController';
import { SelectionSystem } from '../systems/SelectionSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import { useUIStore } from '../../state/ui';

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
  
  // Update subsystems here (physics, input, etc.)
  if (postProcessor) {
    // Use post-processed rendering
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
  postProcessor = new SimplePostProcessor(
    renderer.getRenderer(),
    scene,
    camera,
    canvasSize.width,
    canvasSize.height
  );

  // Configure post-processing for minecraft-style visuals
  postProcessor.updateSettings({
    ssaoEnabled: true,
    ssaoIntensity: 0.4,
    ssaoRadius: 0.15,
    bloomEnabled: true,
    bloomStrength: 0.2,
    exposure: 1.1,
    contrast: 1.15,
    saturation: 1.1
  });
  
  // Set atlas config and block registry in chunk pipeline
  const blockRegistry = getBlockRegistry();
  world.chunkPipeline.setAtlasConfig(atlas.getConfig(), blockRegistry.getAllBlocks());

  // Set camera spawn position above ground  
  const spawnPos = findSpawnPosition(world.getSeed());
  camera.position.set(spawnPos.x, spawnPos.y, spawnPos.z);

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

  // Player controller (movement + gravity + collisions)
  playerController = new PlayerController(camera, world, inputSystem);
  
  // Selection system (raycast + debug outline)
  selectionSystem = new SelectionSystem(camera, world, scene);
  
  // Interaction system (mine/place + re-mesh)
  interactionSystem = new InteractionSystem(camera, world, inputSystem, selectionSystem, world.chunkPipeline);
  
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
  
  // Request a grid of chunks around origin for testing terrain generation
  const gridRadius = 2; // 5x5 grid of chunks
  for (let cx = -gridRadius; cx <= gridRadius; cx++) {
    for (let cz = -gridRadius; cz <= gridRadius; cz++) {
      // Only request chunks at ground level (cy = 0) for now
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
      if (postProcessor) {
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

// Global function for UI to update post-processing settings
function updatePostProcessingSettings(settings: any) {
  if (postProcessor) {
    postProcessor.updateSettings(settings);
  }
}

// Expose to global scope for UI communication
(window as any).updatePostProcessingSettings = updatePostProcessingSettings;

export const engine = { start, stop };
export type Engine = typeof engine;


