# Water

Water is intentionally split into gameplay data and visual presentation.

## Authoritative water blocks

The terrain generator and `World` own water blocks at `WATER_LEVEL`. These blocks participate in collision, swimming, ray selection, mining, placing, save files, and flooded-air tracking. `InteractionSystem` can fill a newly opened surface cell and propagate a thin water surface through connected cavities.

## Rendered water

`WaterSurfaceMaterial` shades water faces that come from voxel chunk meshes. Render-only optics use the visual center:

```text
VISUAL_WATER_LEVEL = WATER_LEVEL + OCEAN_WATER_CENTER_OFFSET
```

The half-block offset is a visual envelope for refraction, caustics, and screen-space masking; it does not change the gameplay interaction plane.

When `USE_OCEAN_HORIZON` is enabled, `WaterSystem` adds the far ocean surface and its visual seabed extension. These meshes never enter `World`, so they cannot be selected, mined, placed on, or serialized into a save. The system uses the generated seed and world bounds to keep the far field continuous with the local terrain. The seabed material shares the authoritative terrain's screen-space sun-visibility state, allowing the animated character caster to project onto the underwater extension without introducing a second shadow pipeline.

## Optical inputs and frame behavior

`WaterSystem` receives the composer’s scene-color texture, shared depth texture, camera near/far planes, sun direction/color, atmosphere colors, and caustic state. The water field uses shared wave declarations for displacement and normals. Caustics are advanced independently but fed back into block materials and the underwater pass through the same engine update.

The underwater medium pass stays active on both sides of the interface. It resolves the below-water segment per view ray and fades the camera-side contribution around the waterline; toggling the whole pass when the camera crosses the surface would reintroduce a full-screen discontinuity.

`SoundEffects` uses the same authoritative water state for underwater and water-step audio. This keeps movement, visuals, and sound on the gameplay side of the boundary while the ocean horizon remains render-only.
