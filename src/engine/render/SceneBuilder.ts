/**
 * Three.js scene and camera factory
 * Inputs: None
 * Outputs: Configured scene with lighting and perspective camera
 */

import * as THREE from 'three';

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  
  // Enhanced ambient lighting - increased from 0.4 to 0.7 for better base illumination
  const ambientLight = new THREE.AmbientLight(0x404866, 0.7);
  scene.add(ambientLight);
  
  // Hemisphere light for natural outdoor lighting (sky + ground)
  const hemisphereLight = new THREE.HemisphereLight(
    0x87CEEB, // Sky color (light blue)
    0x8B7355, // Ground color (earth brown)  
    0.3
  );
  hemisphereLight.position.set(0, 100, 0);
  scene.add(hemisphereLight);
  
  // Main directional light (sun) - warmer and slightly reduced intensity
  const sunLight = new THREE.DirectionalLight(0xfff4e6, 0.9);
  sunLight.position.set(50, 120, 50);
  sunLight.castShadow = false; // Shadows will be added in Phase 4
  scene.add(sunLight);
  
  // Secondary fill light to soften harsh shadows
  const fillLight = new THREE.DirectionalLight(0xe6f3ff, 0.3);
  fillLight.position.set(-30, 50, -30);
  scene.add(fillLight);
  
  // Rim light for better edge definition
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
  rimLight.position.set(0, 50, -100);
  scene.add(rimLight);
  
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