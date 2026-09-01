# Rendering

## Backend and composition

MyCraft has one rendering backend: `THREE.WebGLRenderer`, created by `src/engine/render/Renderer.ts`. The engine constructs the same WebGL path for gameplay and local diagnostics. There is no runtime backend selector or WebGPU fallback branch.

The active post-processing chain is owned by `src/engine/render/postprocessing/Composer.ts`:

```text
RenderPass → AerialPerspectivePass → UnderwaterPass → Bloom → LensFlare → OutputPass
```

`OutputPass` owns the final scene-linear-to-display transform. The renderer uses ACES filmic tone mapping at a fixed exposure of `0.92`, and sRGB output. The sun-linked [filmic lens flare](lens-flare.md) is documented separately. Screen-space AO and adaptive exposure are not in the active chain; voxel/per-vertex AO and the authored exposure calibration remain the chosen image treatment.

## Drawing-buffer policy

The logical viewport is the browser viewport, clamped to at least one CSS pixel. The renderer uses one shared policy from `src/engine/render/rendererSizing.ts`:

```ts
const maxPixels = 1_600_000;
const dpr = Math.min(
  window.devicePixelRatio,
  1.7,
  Math.sqrt(maxPixels / (width * height)),
);
```

The final DPR is allowed to be below `1` on large displays. Only invalid or non-positive results fall back to `1`. This keeps the physical drawing buffer under the pixel budget while preserving as much device detail as the budget allows.

`Renderer` applies the logical size and DPR together with one `setDrawingBufferSize(width, height, dpr)` call. It does not pair separate renderer `setPixelRatio()` and `setSize()` calls for a resize. `ResizeCoordinator` coalesces browser resize notifications into one animation-frame commit, ignores transient zero-sized resize states, and then updates the camera, composer targets, water inputs, and shadow textures from that exact commit.

The composer has its own internal render targets, so its atomic resize method updates the EffectComposer ratio, depth texture, effect passes, and voxel-shadow target from the renderer’s already-committed DPR. No subsystem reads `window.devicePixelRatio` independently.

## Scene and material ownership

`SceneBuilder` creates the scene, a small ambient floor light, and the canonical first-person perspective camera. `ChunkRenderer` owns the scene meshes produced from worker responses. `BlockMaterial` shades opaque voxel faces, while `WaterSurfaceMaterial` shades water faces. `GrassBillboardSystem` owns decorative instanced grass, and `SeaweedSystem` owns the render-only ocean vegetation layer.

The native Three.js shadow-map rasterizer is disabled. Direct-sun visibility is supplied by the shared voxel shadow pass described in [Atmosphere, lighting, and shadows](atmosphere-lighting-and-shadows.md), so terrain, grass, seaweed, and the player do not receive two competing shadow models. Seaweed uses a compact separate caster field because it is not gameplay voxel occupancy.

## Frame and resize order

The engine applies queued chunk mesh swaps at the beginning of a frame, then consumes input, updates gameplay systems, advances atmosphere/water state, and renders through the composer. Chunk swaps are deferred from worker events so depth and color passes see a stable scene for the whole frame.

On shutdown, `Composer`, materials, chunk meshes, shadow resources, water resources, and the renderer are disposed by the engine. A new start constructs a fresh scene graph rather than reusing partially disposed GPU state.
