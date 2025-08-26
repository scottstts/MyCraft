/**
 * Three.js scene and camera factory
 * Inputs: None
 * Outputs: Configured scene with lighting and perspective camera
 */

import * as THREE from 'three';

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  
  // Keep a faint ambient to ensure non-block debug meshes remain visible.
  // Sun/sky lighting is provided by SunController.
  const ambientLight = new THREE.AmbientLight(0x404866, 0.1);
  scene.add(ambientLight);
  
  return scene;
}

export function createCamera(aspect: number = 1): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    70,    // fov
    aspect, // aspect ratio
    0.1,   // near
    1024    // far - increased to comfortably see larger worlds
  );
  
  camera.position.set(0, 80, 0); // Start well above terrain (BASE_HEIGHT=32 + AMPLITUDE=16)
  
  return camera;
}
