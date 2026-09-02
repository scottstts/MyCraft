# Filmic lens flare

## Purpose and ownership

The sun-linked lens flare is a WebGL post-processing pass owned by `LensFlarePass`. It is inserted by `Composer` after the ordinary bloom pass and before `OutputPass`:

```text
RenderPass → AerialPerspectivePass → UnderwaterPass → Bloom → LensFlare → OutputPass
```

The pass consumes the current scene color, the composer-owned depth texture, the active perspective camera, and the shared `AtmosphereState.sunDirection`. It does not create a second sun, shadow system, or camera. Water remains outside this pass's ownership boundary.

## Reference optical graph

The implementation is the WebGL/GLSL translation of the filmic lens-flare reference in the procedural VFX skill. Its stages are kept separate so they can be inspected and tuned independently:

- plate preparation: linear scene-color sampling, mild RGB separation, neutral lift, and warm film bias;
- source bloom and warm halo bloom: two five-level downsample/blur pyramids with the reference kernel radii, thresholds, and interpolation factors;
- direct flare layer: solar core, veils, four RGB-dispersed radial ghosts, terminal/cool/warm pupil families, bead ghosts, residual haze, spectral ring, and star rays;
- flare bloom: a third five-level pyramid applied to the direct flare layer;
- final film stage: veil and milk scattering, warm shoulder, highlight desaturation, vignette, and animated fine grain.

All flare render targets use half-float linear color where appropriate. The final display transform remains owned by `OutputPass`; the renderer uses ACES filmic tone mapping at the reference exposure of `0.92`.

Each of the three five-level bloom pyramids uses the authored Gaussian coefficients, but adjacent symmetric taps are paired at their weighted bilinear centroid. The center and any odd tail remain explicit; the paired layout reduces texture fetches in both blur directions without changing the pyramid count or thresholds.

## Sun projection and direct visibility

The directional sun is projected into top-origin screen coordinates using the camera's forward, right, and up basis. Above water this is the atmosphere's direct sun direction. Underwater, `LensFlarePass` first refracts the incoming air ray through a flat air-to-water interface and projects the reversed water-side ray. This analytically constrains the apparent source to the canonical Snell window; the surface shader retains ownership of wave-normal deformation and the transmitted solar lobe. The resulting coordinate is shared by the direct disc, every ghost, source/halo seeds, and flare bloom. The flare fades when the sun turns behind the camera, leaves the frame, or falls below the shared atmosphere's solar-energy envelope. At the optical center, the previous finite-axis direction is retained to avoid unstable ghost orientation.

Direct visibility is evaluated from the composer depth target at the projected sun position. The occlusion shader integrates a finite `0.53°` solar disc instead of testing one pixel. Above water, the reserved ocean marker rejects a direct source that would bypass the interface. Underwater, the already-Snell-mapped source treats that interface as its transmissive aperture while water-free scene depth still lets terrain occlude it. Source and halo temporal histories are invalidated when the camera changes medium so no bloom remains at the previous, unrefracted coordinate. This gives a continuous direct-sun fraction as an occluder edge crosses the disc, so the direct ghosts do not jump from zero to full strength.

## Blocker breadth and bloom persistence

Direct flare and broad glare intentionally use different visibility signals:

- direct flare uses the finite solar-disc fraction and therefore disappears when the sun itself is blocked;
- source/halo bloom uses concentric wider screen-space depth rings, weighted toward the outer aperture, to estimate how much bright sky remains around the solar direction;
- a narrow character can block the disc while leaving much of the surrounding glare-producing aperture open;
- terrain filling that aperture drives bloom substantially lower;
- source and halo bloom have a short temporal camera-response tail, with retention scaled by the measured aperture. This prevents a one-frame blocker from causing an artificial zero-to-100 switch without blindly adding bloom behind a broad blocker.

The resulting behavior is deliberately scene-dependent: blocker silhouette, screen size, and coverage determine the remaining bloom. The current game calibration keeps the complete graph at lens intensity `0.32`; the authored source and halo bloom strengths are `0.42` and `0.50`.

## Diagnostics and tests

`Composer.getLensDiagnostics()` exposes the current projected source, camera medium, direct source visibility, field deformation, intensity, and allocated flare targets for local inspection. `LensFlarePass.setLensDebugMode()` supports isolated final, plate, direct flare, source bloom, halo bloom, flare bloom, hot-mask, and visibility views.

The pure regression coverage is in `tests/LensFlarePass.spec.ts`. It protects the reference camera/exposure contract, top-origin projection, behind-camera and off-frame suppression, the three five-level bloom graphs and paired Gaussian layout, the finite-disc occlusion shader, aperture-dependent bloom retention, and the complete ghost/film stage markers.
