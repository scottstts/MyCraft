/**
 * Three.js scene and camera factory
 * Inputs: None
 * Outputs: Configured scene with lighting and perspective camera
 */

import * as THREE from 'three';

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  
  // Ambient light for overall illumination
  const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
  scene.add(ambientLight);
  
  // Directional light for sun-like lighting
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(50, 100, 50);
  directionalLight.castShadow = false; // No shadows for v1
  scene.add(directionalLight);
  
  return scene;
}

export function createCamera(aspect: number = 1): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    70,    // fov
    aspect, // aspect ratio
    0.1,   // near
    512    // far - enough to see multiple chunks
  );
  
  camera.position.set(0, 80, 0); // Start well above terrain (BASE_HEIGHT=32 + AMPLITUDE=16)
  
  return camera;
}