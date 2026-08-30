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

`WaterSystem` receives the composer’s scene-color texture, shared depth texture, current voxel sun-visibility texture, camera matrices, sun direction/color, atmosphere colors, and caustic state. During that scene capture it hides both the render-only ocean and off-level voxel-water material. Sea-level water geometry is already omitted by the chunk mesher because the continuous ocean owns that interface.

The water-free capture intentionally omits voxel sun-shadow sampling to avoid a render-target feedback loop. Its alpha channel preserves each terrain receiver’s direct-light fraction. The final water shader therefore samples the current-frame visibility mask at the resolved refracted UV, reconstructs uncertain mask edges with depth-aware neighbours, and attenuates only that stored direct-light share. This makes character and terrain shadows remain visible on submerged sand through the interface without darkening ambient light or smearing shadows across shoreline and block-depth discontinuities.

The macro surface is a deterministic directional spectrum: broad primary and crossing swell lobes plus increasingly spread wind-sea bands. Energy is distributed across close-frequency pairs so their interference forms slow wave groups, while no single component can draw a dominant ruler-straight crest train. Every component uses finite-depth gravity/capillary dispersion, a unique phase, and an incommensurate wavelength. The CPU height query, vertex displacement, analytic fragment normal, Jacobian foam signal, and differential-area caustics consume the same components. Their absolute amplitudes are normalized so even the theoretical all-in-phase sum stays within `-0.5 ... +0.5` blocks around `VISUAL_WATER_LEVEL`. Screen-footprint filtering removes unresolved short bands from both displacement and normals instead of letting them alias into regular distant stripes. A lower-energy seven-band detail spectrum and two advected gradient fields break up sub-grid facets without changing the bounded geometry envelope.

Above water, the shader refracts the view ray with water’s index of refraction and projects that transmitted ray back through the active camera. It samples the water-free scene capture, rejects foreground crossings with scene depth, reconstructs the transmitted hit in world space, and uses the resulting underwater distance for Beer-Lambert extinction and in-scatter. Exact unpolarized dielectric Fresnel conserves energy between that transmitted body and the shared analytic sky reflection. Direct sun glitter uses normalized GGX/Smith core and skirt slope lobes with derivative variance, producing a wider, softly resolved path without adding energy; the reflected sky carries only the atmospheric sun halo so a duplicate needle-like disc cannot cut through that path. This remains bounded screen-space refraction: off-screen or fully occluded radiance cannot be recovered, so invalid projected samples fall back to the unrefracted scene location rather than inventing geometry.

Caustics are advanced independently but fed back into block materials and the underwater pass through the same engine update.

The underwater medium pass stays active on both sides of the interface. It resolves the below-water segment per view ray and fades the camera-side contribution around the waterline; toggling the whole pass when the camera crosses the surface would reintroduce a full-screen discontinuity.

`SoundEffects` uses the same authoritative water state for underwater and water-step audio. This keeps movement, visuals, and sound on the gameplay side of the boundary while the ocean horizon remains render-only.
