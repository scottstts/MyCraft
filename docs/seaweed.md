# Seaweed

Seaweed is a render-only ocean vegetation layer owned by `SeaweedSystem`. It is deliberately not a block: it has no registry entry, voxel storage, generator output, collision, selection, interaction, inventory, save data, or world event listener. The player cannot harvest or otherwise interact with it.

## Habitat and distribution

`TerrainGenerator.createTerrainSampler()` exposes the same island-mask classification used by terrain generation. `SeaweedField` accepts a candidate only when that sample is ocean, so an inland lake or other land-mask depression cannot receive seaweed merely because its height is below the water level. The height is sampled from the candidate's integer terrain column—the same column used to generate the exposed top block—then the root is placed at that column's center. The field allows gentle descending seabed terrain and rejects only abrupt steps; roots remain at least `SEAWEED_MIN_DEPTH` (five blocks) below the visual water center, keeping them off shallow beach shelves.

The field uses a weighted Poisson-disk sample:

1. A jittered coarse lattice bounds the candidate work and randomly selects candidate blocks.
2. Candidate acceptance is weighted by ocean depth and low-frequency habitat patches.
3. Candidates receive weighted random priorities and are dart-thrown through a spatial rejection grid with a hard minimum distance.
4. The two-block plant height is fixed; per-instance yaw/phase variation is derived from the same field seed.

The jitter is only used to choose which integer block is sampled. Every accepted root is snapped to
`(floor(blockX) + 0.5, floor(blockZ) + 0.5)`, the exact center of that block's top face; there is no
random sub-block placement. The per-load field seed is fresh, so the selected blocks change on reload,
but the accepted roots and their animation anchors stay fixed until the next load.

The distribution seed is generated afresh when `SeaweedSystem` is constructed for a game load. It is not derived from the saved world seed and is not serialized. Therefore a new load/restart produces a different arrangement, while the arrangement and its animation anchors remain unchanged for the duration of that running game. Loading a different terrain seed only regenerates the same session field against the new terrain.

Every accepted plant is exactly two blocks high and is still capped against the lowest possible ocean wave trough plus a small clearance. The cap is applied before instancing, and animation only bends the upper portion horizontally, so no alpha card can cross the water surface.

## Geometry, animation, and material

`BillboardGeometry.createXBillboardGeometry()` is the shared grass/seaweed geometry builder. Each seaweed instance is the same two planes crossing at 90 degrees. The seaweed system waits for `src/assets/textures/seaweed.png` to load, reads its actual pixel width and height, and passes that native width-to-height ratio to the geometry builder; it never assumes the asset is square. The instance transform scales all three axes uniformly by the selected plant height, so the loaded image aspect remains the physical card aspect. The root transform is compensated around the card's local `(0.5, 0, 0.5)` hinge, keeping it exactly on the block center. The texture is nearest-filtered and alpha-cut out in `SeaweedMaterial`, which writes depth, is double-sided, and keeps the texture alpha as the silhouette authority.

The vertex shader applies world-anchored, per-instance phase variation. Four vertical segments turn the crossed cards into a rooted hinge chain: a traveling phase moves through the blade from base to tip, while a smooth envelope keeps the root fixed and prevents downward terrain clipping. The bounded horizontal displacement is intentionally small so centered roots remain safe on gentle descending shelves. The material receives the atmosphere/sun uniforms used by grass, applies water depth tint, and replaces only direct sunlight with the shared Snell/Fresnel, Beer-Lambert, and differential-area caustic transport. Ambient, stars, backscatter, and albedo remain separate.

The field is deliberately cheap at scale. Accepted plants in each 64×64 chunk share one loaded geometry and one material through a single `THREE.InstancedMesh`; transforms and seeds are static GPU buffers, and the aggregate instance bounds are computed once for forward-source culling. Chunk groups are culled by horizontal distance, and the spacing is wide enough to control alpha-card overdraw. Seaweed caustics use one filtered lookup per visible fragment, while the full-screen sun pass checks one compact root-cell seaweed proxy only for underwater receivers. It does not scan neighboring cells or trace the source alpha texture per DDA step.

## Shadows and diagnostics

The renderer’s native Three.js shadow map is intentionally disabled. Seaweed meshes still set `castShadow` and `receiveShadow` and participate in the project’s authoritative screen-space voxel sun visibility path. `VoxelOccupancyVolume` stores their compact render-only caster field in a separate RGBA XZ texture; it never marks seaweed as an occupied gameplay voxel. `VoxelSunShadowPass` traces a small crossed-blade proxy from the root cell only, and underwater seabed materials share the same receiver mask/depth binding. The proxy is intentionally conservative and block-local for performance; the visible cards remain texture-alpha cutouts.

`window.__getRenderDiagnostics()` reports the active seaweed field, including its random distribution seed, accepted count, depth/height ranges, loaded texture aspect, chunk-group count, instance count, instancing flag, and shadow flags. The voxel diagnostics also report the number of seaweed caster anchors and the compact texture byte count.
