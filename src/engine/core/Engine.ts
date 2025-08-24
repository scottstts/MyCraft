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
let inputSystem: InputSystem | null = null;
let playerController: PlayerController | null = null;
let selectionSystem: SelectionSystem | null = null;
let interactionSystem: InteractionSystem | null = null;
let lastFrameNow: number = 0;

function update(dtSeconds: number) {
  // Update subsystems here (physics, input, etc.)
  // For now, just ensure rendering happens
  if (inputSystem) {
    inputSystem.update();
  }
  // Handle number key slot selection (UI side-effect is fine here)
  if (inputSystem) {
    const slot = inputSystem.consumeSelectedSlot?.();
    if (slot !== undefined && slot !== null) {
      useUIStore.getState().setSelectedSlot(slot);
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
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

function tick(now: number) {
  if (!running) return;
  // Compute clamped delta time
  const dtSeconds = Math.min(0.1, Math.max(0, (now - lastFrameNow) / 1000));
  lastFrameNow = now;

  update(dtSeconds);
  
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
  
  // Load atlas and initialize chunk renderer
  const atlas = await loadFullAtlas();
  const material = new THREE.MeshStandardMaterial({ 
    map: atlas.getTexture(),
    side: THREE.FrontSide // Use front-face culling for proper performance
  });
  
  chunkRenderer = new ChunkRenderer(scene, material);
  
  // Set atlas config and block registry in chunk pipeline
  const blockRegistry = getBlockRegistry();
  world.chunkPipeline.setAtlasConfig(atlas.getConfig(), blockRegistry.getAllBlocks());

  // Set camera spawn position above ground  
  const spawnPos = findSpawnPosition(world.getSeed());
  camera.position.set(spawnPos.x, spawnPos.y, spawnPos.z);

  // Input system (pointer lock + mouse look)
  inputSystem = new InputSystem(canvas, camera);

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
    }
  };
  window.addEventListener('resize', handleResize);
  
  running = true;
  lastFrameNow = performance.now();
  rafId = requestAnimationFrame(tick);
}

function stop() {
  running = false;
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
  
  // Clean up renderer
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  
  scene = null;
  camera = null;
}

export const engine = { start, stop };
export type Engine = typeof engine;


