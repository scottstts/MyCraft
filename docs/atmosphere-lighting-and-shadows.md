# Atmosphere, lighting, and shadows

## Shared atmosphere state

`SunController` owns the continuous time-of-day clock and one conventional directional light plus a hemisphere light. It computes a normalized sun direction and illumination color; it does not own a native shadow map. The authored cycle is 1,200 seconds and the player-facing controls expose time and pause state, not arbitrary render-style tuning.

`AtmosphereModel.evaluate()` converts the sun direction into one shared `AtmosphereState`. The state contains daylight, twilight, night, sun transmittance, sky zenith/horizon colors, aerosol color and strength, irradiance, moon/star visibility, and Rayleigh/Mie coefficients. `SkyDome`, aerial perspective, block materials, water, and the composer consume this state so their horizon, direct light, and distant attenuation stay calibrated to one clock.

The values in `src/engine/render/settings/RenderStyle.ts` are authored image-pipeline parameters. They are not persisted player settings. The debug/settings panel can change the clock position and pause it, but it does not fork the rendering style.

## Voxel visibility pass

The direct-sun visibility path consists of:

1. `VoxelOccupancyVolume`, which stores a bounded occupancy representation of authoritative world chunks.
2. `VoxelSunShadowPass`, which traces bounded solar visibility through that volume and combines it with the shared scene depth.
3. Terrain, grass, and seaweed materials, which sample the result during their final color shading.

The occupancy volume is updated from `World` chunk and block events, not from mesh arrival. This keeps shadows tied to gameplay state after mining, placing, chunk replacement, and save ingestion. The animated player is supplied separately as exact shadow boxes each frame, so the character does not need to be rasterized into the terrain occupancy volume. One world-sized R8 integer field packs opaque, leaf, and grass presence bits; categorical voxel, 8³ brick, and 32³ macro-brick lookups use nearest `texelFetch`, while leaf density remains a filtered aggregate. Leaf bits stay out of solid occupancy: mixed and sparse leaf bricks trace the exact procedural leaf atlas alpha for non-leaf receivers. Dense leaf-only 8³ bricks retain the first three intersected leaf layers exactly, then integrate deeper canopy from a trilinearly sampled density field; this preserves near-field terrain dapple without paying for a full canopy walk. The macro hierarchy skips empty four-brick spans before the detailed DDA resumes. Reconstructed receivers that touch foliage but not opaque terrain use a separate interior-foliage rule: cells sharing the receiver boundary are excluded and subsequent leaf-on-leaf occlusion uses smooth canopy transmission rather than projecting one binary cutout onto another nearly parallel face. This prevents unstable diagonal moire while preserving the compounded shade of the crown. A fixed nine-ray solar-disc kernel keeps the work bounded, and fractional leaf visibility receives a depth-aware screen reconstruction that removes discrete sample levels without softening opaque casts. Seaweed remains outside gameplay occupancy and contributes a compact render-only XZ caster field that the same DDA pass expands into a block-local crossed-blade proxy. The pass performs that lookup only for underwater receivers and reads one root cell per traversed DDA cell; it does not scan a 3×3 neighborhood. Both authoritative terrain and the render-only seabed/seaweed receivers share the same visibility-mask, receiver-depth, and resolution uniforms, which keeps the character and vegetation shadows continuous when the player swims beyond the authored terrain boundary.

The composer owns the depth target used by aerial perspective, underwater effects, lens effects, and voxel-shadow reconstruction. During the depth capture, the registered voxel-shadow materials are temporarily disabled and their depth sampler is detached to avoid a WebGL feedback loop; materials are restored before the visibility and final color passes.

## Diagnostic lighting

The normal game starts at its authored dawn time. A local diagnostic capture can request a different time, and the diagnostics shell defaults to a sun angle that gives useful direct light and readable cast shadows. This changes only the initial clock value and pause state; it does not create a second lighting or camera model.
