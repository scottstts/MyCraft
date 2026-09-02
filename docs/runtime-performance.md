# Runtime performance

The FPS pass keeps the existing visual contracts—forward Fermat/Snell refraction, nine solar-disc rays, procedural leaf silhouettes, seaweed proxies, and differential-area caustics—while removing repeated discovery work from the frame loop.

## Registration instead of scene-wide discovery

`ShadowSamplingMaterialRegistry` records every material that owns the `voxelShadowEnabled` and `voxelShadowDepth` uniforms. `Composer` toggles that set during the water-free depth capture and restores each previous value before the voxel and color passes. `BlockMaterial`, grass, seaweed, and asynchronously created seabed materials register at creation time, so the feedback-safe prepass does not traverse the whole scene each frame.

`ForwardRefractionParticipantRegistry` records terrain region meshes, seabed meshes, grass and seaweed instanced meshes, and player meshes when they are created or replaced. The forward pass selects them through the private render layer. Underwater, it applies a rejection-only source test to their cached world bounds: the test includes the live wave envelope and a conservative angular Snell window, then restores `visible` and `frustumCulled` immediately after both target draws. Instanced systems compute aggregate bounds once after their instance transforms are authored.

## Voxel shadow hierarchy

`VoxelOccupancyVolume` keeps the CPU arrays authoritative and mirrors them to GPU fields. Opaque, leaf, and grass presence share one world-sized `R8` integer 3D texture, using bits 0, 1, and 2. Discrete field reads use integer `texelFetch`; the filtered leaf-density brick field remains a separate normalized texture because it represents a continuous aggregate rather than a category.

The existing 8³ brick occupancy is retained for exact leaf/detail behavior. A 32³ macro-brick occupancy sits above it, allowing the DDA to skip four brick widths at a time. Brick and macro counts are updated incrementally when a block changes; the full reduction is reserved for startup/bulk commits and explicit seaweed-field replacement. The fixed center-plus-eight-ray solar disc remains unchanged.

## Static terrain regions

`ChunkRenderer` keeps each worker response in an authoritative per-chunk buffer map. After the complete initial mesh set is ready, it compiles neighboring chunks into 2×2 X/Z regions with separate opaque and transparent meshes. The region size is intentionally limited to two chunks because larger batches need a benchmark before they can be justified. A remesh or removal rebuilds only its region, reuses its geometry object where the material bucket remains present, and leaves other region draw objects untouched.

## Edit invalidation

Grass receives the old and new block ids from `World`. If neither side is `grass_tuft`, the 524,288-cell billboard scan is skipped. When a tuft is added or removed, only that chunk's instanced group is rebuilt. Chunk removal unregisters the group without disposing the shared grass geometry/material; those shared resources are disposed once when the system is destroyed.
