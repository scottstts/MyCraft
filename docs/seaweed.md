# Seaweed

Seaweed is a render-only ocean vegetation layer owned by `SeaweedSystem`. It is deliberately not a block: it has no registry entry, voxel storage, generator output, collision, selection, interaction, inventory, save data, or world event listener. The player cannot harvest or otherwise interact with it.

## Habitat and distribution

`TerrainGenerator.createTerrainSampler()` exposes the same island-mask classification used by terrain generation. `SeaweedField` accepts a candidate only when that sample is ocean, so an inland lake or other land-mask depression cannot receive seaweed merely because its height is below the water level. The field also rejects steep transitions and roots at least `SEAWEED_MIN_DEPTH` below the visual water center, keeping it off shallow beach shelves.

The field uses a weighted Poisson-disk sample:

1. A jittered coarse lattice bounds the candidate work while preserving random positions.
2. Candidate acceptance is weighted by ocean depth and low-frequency habitat patches.
3. Candidates receive weighted random priorities and are dart-thrown through a spatial rejection grid with a hard minimum distance.
4. Height and per-instance variation are random draws from the same field seed.

The distribution seed is generated afresh when `SeaweedSystem` is constructed for a game load. It is not derived from the saved world seed and is not serialized. Therefore a new load/restart produces a different arrangement, while the arrangement and its animation anchors remain unchanged for the duration of that running game. Loading a different terrain seed only regenerates the same session field against the new terrain.

Every accepted plant is capped against the lowest possible ocean wave trough plus a small clearance. The cap is applied before instancing, and animation only bends the upper portion horizontally, so no alpha card can cross the water surface.

## Geometry, animation, and material

`BillboardGeometry.createXBillboardGeometry()` is the shared grass/seaweed geometry builder. Each seaweed instance is the same two planes crossing at 90 degrees. The seaweed system waits for `src/assets/textures/seaweed.png` to load, reads its actual pixel width and height, and passes that native width-to-height ratio to the geometry builder; it never assumes the asset is square. The texture is nearest-filtered and alpha-cut out in `SeaweedMaterial`, which writes depth, is double-sided, and keeps the texture alpha as the silhouette authority.

The vertex shader applies world-anchored, per-instance phase variation. A height-weighted bend and a smaller flutter term keep the root fixed while the blades flow with a coherent underwater current. The material receives the atmosphere/sun uniforms used by grass, applies water depth tint, and replaces only direct sunlight with the shared Snell/Fresnel, Beer-Lambert, and differential-area caustic transport. Ambient, stars, backscatter, and albedo remain separate.

## Shadows and diagnostics

The renderer’s native Three.js shadow map is intentionally disabled. Seaweed meshes still set `castShadow` and `receiveShadow` and participate in the project’s authoritative screen-space voxel sun visibility path. `VoxelOccupancyVolume` stores their compact render-only caster field in a separate RGBA XZ texture; it never marks seaweed as an occupied gameplay voxel. `VoxelSunShadowPass` traces a small crossed-blade proxy from that field, and underwater seabed materials share the same receiver mask/depth binding.

`window.__getRenderDiagnostics()` reports the active seaweed field, including its random distribution seed, accepted count, depth/height ranges, loaded texture aspect, chunk-group count, and shadow flags. The voxel diagnostics also report the number of seaweed caster anchors and the compact texture byte count.
