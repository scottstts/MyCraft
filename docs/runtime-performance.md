# Runtime performance

The FPS pass keeps the existing visual contracts—forward Fermat/Snell refraction, nine solar-disc rays, procedural leaf silhouettes, seaweed proxies, and differential-area caustics—while removing repeated discovery work from the frame loop.

## Registration instead of scene-wide discovery

`ShadowSamplingMaterialRegistry` records every material that owns the `voxelShadowEnabled` and `voxelShadowDepth` uniforms. `Composer` toggles that set during the water-free depth capture and restores each previous value before the voxel and color passes. `BlockMaterial`, grass, seaweed, and asynchronously created seabed materials register at creation time, so the feedback-safe prepass does not traverse the whole scene each frame.

`ForwardRefractionParticipantRegistry` records terrain region meshes, seabed meshes, grass and seaweed instanced meshes, and player meshes when they are created or replaced. The forward pass selects them through the private render layer. Underwater, it applies a rejection-only source test to their cached world bounds: the test includes the live wave envelope and a conservative angular Snell window, then restores `visible` and `frustumCulled` immediately after both target draws. Instanced systems compute aggregate bounds once after their instance transforms are authored.

## Frame accounting

`RenderStageProfiler` owns the shared renderer counter reset and exposes per-stage draw calls, triangles, and asynchronous GPU elapsed time through `window.__getRenderDiagnostics().renderStages`. It uses `EXT_disjoint_timer_query_webgl2` when the WebGL2 context exposes it; query results are polled on later frames, disjoint samples are discarded, and unavailable extensions still retain CPU-side renderer counters. The instrumented stages are caustic update, water-free capture, direct and forward voxel shadows, forward receiver/color draws, the normal render pass, aerial perspective, underwater, bloom, lens flare, and output. No stage performs a blocking GPU readback or `gl.finish()`.

## Voxel shadow hierarchy

`VoxelOccupancyVolume` keeps the CPU arrays authoritative and mirrors them to GPU fields. Opaque, leaf, and grass presence share one world-sized `R8` integer 3D texture, using bits 0, 1, and 2. Discrete field reads use integer `texelFetch`; the filtered leaf-density brick field remains a separate normalized texture because it represents a continuous aggregate rather than a category.

The existing 8³ brick occupancy is retained for exact leaf/detail behavior. A 32³ macro-brick occupancy sits above it, allowing the DDA to skip four brick widths at a time. Brick and macro counts are updated incrementally when a block changes; the full reduction is reserved for startup/bulk commits and explicit seaweed-field replacement. The fixed center-plus-eight-ray solar disc remains unchanged.

An orthogonal X/Z max-caster-height hierarchy accompanies the volumetric fields at 8-, 32-, and 64-cell tiles. Each tile stores the highest opaque, leaf, grass, or render-only seaweed proxy top in its columns. During traversal, the shader compares the ray's lowest Y over the tile to the cached maximum and advances directly to the next X/Z boundary only when the whole tile is provably clear; detailed brick and voxel tests remain the correctness fallback. Opaque terrain receivers whose reconstructed normal has `N·L <= 0` skip the solar-disc/DDA resolve entirely. When direct sun intensity is zero, both visibility targets are cleared white once and then left untouched until daylight returns.

Caustic receivers use four phase samples for block terrain and one explicit prefiltered sample for the underwater volume (with a neutral result once the represented footprint has converged). All three lens-flare bloom pyramids pair adjacent symmetric Gaussian taps at their weighted bilinear centroids, retaining the authored kernel while reducing texture fetches in each blur direction.

## Static terrain regions

`ChunkRenderer` keeps each worker response in an authoritative per-chunk buffer map. After the complete initial mesh set is ready, it compiles neighboring chunks into 2×2 X/Z regions with separate opaque and transparent meshes. The region size is intentionally limited to two chunks because larger batches need a benchmark before they can be justified. A remesh or removal rebuilds only its region, reuses its geometry object where the material bucket remains present, and leaves other region draw objects untouched.

## Edit invalidation

Grass receives the old and new block ids from `World`. If neither side is `grass_tuft`, the 524,288-cell billboard scan is skipped. When a tuft is added or removed, only that chunk's instanced group is rebuilt. Chunk removal unregisters the group without disposing the shared grass geometry/material; those shared resources are disposed once when the system is destroyed.

Static terrain forward-refraction indices are emitted into six conservative buckets: above/below/boundary medium, each split into opaque and atlas-cutout faces. The wave envelope owns the boundary bucket, so classification can only create extra work, never remove a silhouette. The receiver target uses dedicated geometry-only source-world shaders; the same meshes switch to the full terrain material for the color target and restore their prior material after the pass. This keeps normal terrain shading intact while removing the full block-lighting fragment from the receiver draw.
