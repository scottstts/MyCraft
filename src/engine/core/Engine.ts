/**
 * Module: engine/core/Engine
 * Purpose: Game engine with RAF loop, Three.js rendering, and subsystem management
 * Callers: CanvasHost loads this module and calls start/stop
 * Invariants: Pure TS module; no React imports anywhere under /engine
 */

import * as THREE from 'three';
import { Renderer } from '../render/Renderer';
import { createScene, createCamera } from '../render/SceneBuilder';

let rafId: number | null = null;
let running = false;

// Engine subsystems
let renderer: Renderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

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


