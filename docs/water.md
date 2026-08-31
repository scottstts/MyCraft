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

When `USE_OCEAN_HORIZON` is enabled, `WaterSystem` adds the far ocean surface and its visual seabed extension. These meshes never enter `World`, so they cannot affect collision or swimming, be selected, mined, placed on, or serialized into a save. The island generator is radial while gameplay bounds are rectangular, so render-only samples outside those bounds are clamped below the lowest wave trough; a generated land-height sample must never cross the optical interface. The one-block ring preserves the voxel boundary, while the far representation averages coarse samples into a continuous heightfield and closes both its inner seam and outer perimeter with skirts.

The gameplay/extension boundary follows a complementary-face contract. Authoritative edge chunks expose their outward faces when they are taller; when an outside extension column is taller, the extension samples the authoritative neighbour height and emits the missing inward wall one voxel at a time. The far closure skirts remain visible in direct rendering and in the water-free color/depth capture because they are real boundary faces. Their 16-block LOD edges are split into one-world-block wall segments with local U coordinates, preserving the same sand-tile density on outer sides as in the near voxel ring. Hiding any of these faces opens the seabed topology and makes its top surface appear as a hanging plane through the water.

The extension extracts the sand tile from the live voxel atlas and uses the same nearest, no-mipmap sampling response and base ambient visibility as authoritative sand. Its lighting, material response, shadows, and caustics remain synchronized with the shared block material. Real water-path extinction can still change sand appearance with depth, but crossing the invisible gameplay boundary alone must not change its base material.

## Optical inputs and frame behavior

`WaterSystem` receives the composer’s scene-color texture, shared depth texture, current voxel sun-visibility texture, camera matrices, sun direction/color, atmosphere colors, and caustic state. During that scene capture it hides both the render-only ocean and off-level voxel-water material. Sea-level water geometry is already omitted by the chunk mesher because the continuous ocean owns that interface.

The water-free capture intentionally omits voxel sun-shadow sampling to avoid a render-target feedback loop. Its alpha channel preserves each terrain receiver’s direct-light fraction. The final water shader therefore samples the current-frame visibility mask at the resolved refracted UV, reconstructs uncertain mask edges with depth-aware neighbours, and attenuates only that stored direct-light share. This makes character and terrain shadows remain visible on submerged sand through the interface without darkening ambient light or smearing shadows across shoreline and block-depth discontinuities.

The macro surface is a deterministic directional spectrum: broad primary and crossing swell lobes plus increasingly spread wind-sea bands. Energy is distributed across close-frequency pairs so their interference forms slow wave groups, while no single component can draw a dominant ruler-straight crest train. Every component uses finite-depth gravity/capillary dispersion, a unique phase, and an incommensurate wavelength. The CPU height query, vertex displacement, analytic fragment normal, Jacobian foam signal, and differential-area caustics consume the same components. Their absolute amplitudes are normalized so even the theoretical all-in-phase sum stays within `-0.5 ... +0.5` blocks around `VISUAL_WATER_LEVEL`. Screen-footprint filtering removes unresolved short bands from both displacement and normals instead of letting them alias into regular distant stripes. A lower-energy seven-band detail spectrum and two advected gradient fields break up sub-grid facets without changing the bounded geometry envelope.

Above water, the shader refracts the view ray with water’s index of refraction and projects that transmitted ray back through the active camera. Each projected receiver is checked against scene depth, the water interface, and its matching ray cone. When full refraction crosses a shoreline or foreground silhouette, a five-tap segment search walks back toward the incident pixel. Receiver validity remains derivative-smoothed at depth discontinuities and acts as soft distortion coverage: valid samples retain more projected displacement, while rejected samples blend toward the original incident screen pixel. A failed screen-space lookup therefore keeps the physical Fresnel split and never creates extra sky reflection. The resolved underwater distance drives Beer-Lambert extinction and in-scatter. Exact unpolarized dielectric Fresnel owns the energy split, with the geometric carrier surface providing a conservative filtered Fresnel floor when sub-pixel normals tilt toward a grazing camera. Because bounded screen-space refraction becomes ill-conditioned at the horizon, its transmission coverage fades out only over that reflection-dominated grazing interval. Debug mode 7 exposes projection coverage, soft receiver coverage, and grazing transmission coverage.

Direct sun glitter uses normalized GGX/Smith core and skirt slope lobes with derivative variance, producing a wider, softly resolved path without adding energy; the reflected sky carries only the atmospheric sun halo so a duplicate needle-like disc cannot cut through that path.

Coastal foam is terrain-gated but never emitted from the shoreline mask alone. It requires both a sparse world-space patch and a wave-arrival signal derived from the shared displaced height, crest, and Jacobian fold. There is no unconditional residual swash term: that term read as a thin, continuous blue-white outline after final compositing instead of as physical foam.

The ocean surface chooses its optical side per fragment from the grid’s actual front/back face. It does not use the thresholded camera-height state that a third-person orbit could change merely by pitching, so every underside view remains on the underwater Snell-window path. That path has no boolean TIR material branch: it always evaluates a numerically safe transmitted direction, while exact Fresnel and derivative-filtered critical-angle coverage continuously reduce transmission outside the physical window. Total internal reflection remains an energy result around the window rather than a second material mode.

Caustics are advanced independently but fed back into block materials and the underwater pass through the same engine update.

The underwater medium pass stays active on both sides of the interface. It resolves the below-water segment per view ray and fades the camera-side contribution around the waterline; toggling the whole pass when the camera crosses the surface would reintroduce a full-screen discontinuity.

`SoundEffects` uses the same authoritative water state for underwater and water-step audio. This keeps movement, visuals, and sound on the gameplay side of the boundary while the ocean horizon remains render-only.
