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
import { ChunkRenderer } from '../render/ChunkRenderer';
import { loadAtlas } from '../render/Atlas';

let rafId: number | null = null;
let running = false;

// Engine subsystems
let renderer: Renderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let world: World | null = null;
let chunkRenderer: ChunkRenderer | null = null;

function update() {
  // Update subsystems here (physics, input, etc.)
  // For now, just ensure rendering happens
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

function tick() {
  if (!running) return;
  
  update();
  
  rafId = requestAnimationFrame(tick);
}

function start(canvas: HTMLCanvasElement) {
  if (running) return;
  
  // Initialize renderer
  renderer = new Renderer(canvas);
  
  // Initialize scene and camera
  scene = createScene();
  const aspect = canvas.clientWidth / canvas.clientHeight;
  camera = createCamera(aspect);
  
  // Initialize world
  world = new World();
  
  // Initialize chunk renderer with basic material
  const atlasTexture = loadAtlas();
  const material = new THREE.MeshStandardMaterial({ 
    map: atlasTexture,
    side: THREE.DoubleSide // For now, to see faces from both sides
  });
  
  chunkRenderer = new ChunkRenderer(scene, material);
  
  // Connect world events to chunk renderer
  world.on('CHUNK_READY', (data) => {
    console.log(`[Engine] World chunk ready: ${(data as any).key}`);
  });
  
  // Connect chunk pipeline to chunk renderer
  world.chunkPipeline.on('CHUNK_MESH', (data) => {
    const { response } = data as any;
    if (chunkRenderer) {
      chunkRenderer.handleChunkMesh(response);
    }
  });
  
  // Test: request chunk at origin (0,0,0)
  world.ensureChunk(0, 0, 0);
  
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
  rafId = requestAnimationFrame(tick);
}

function stop() {
  running = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  
  // Clean up chunk renderer
  if (chunkRenderer) {
    chunkRenderer.destroy();
    chunkRenderer = null;
  }
  
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


