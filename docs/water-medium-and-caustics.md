# Underwater medium and caustics

This page records the optical contract behind the underwater-volume work. The visible interface shader remains owned by `WaterSurfaceMaterial`; the participating medium and seabed light transport are separate render stages.

## Medium ownership

The active order is:

```text
RenderPass → AerialPerspectivePass (air segment) → UnderwaterPass (water segment) → Bloom → LensFlare → OutputPass
```

`UnderwaterPass` reconstructs a world ray and solves its interval below the nominal visual water plane. A camera below the plane integrates from the camera to the receiver or water surface. A camera above the plane integrates only after a valid downward crossing, except for the opaque ocean's zero-alpha marker: that marker already contains an interface Fresnel mix and is left untouched when the camera is above.

Each of eight fixed samples evaluates a world-anchored particulate field. Sample detail is filtered against both the represented ray-segment length and the pixel's world-space ray footprint, so long grazing segments converge to mean density rather than exposing march slices. The local extinction is:

```text
sigma_t = (absorption + scattering) * density
T       = exp(-sigma_t * segmentLength)
```

The segment adds single scattering from the evaluated sky irradiance and sun irradiance. Sun light is attenuated from the interface to the sample, receives dielectric air-to-water transmission, and is shaped by a relative Henyey-Greenstein phase function. The density field is slow, coherent, and advected in world space; it is not a screen-space noise layer. Debug modes 1–6 expose water path, transmittance, scatter, caustic field, particulate density, and sun phase.

`AerialPerspectivePass` uses the same water-plane crossing solve but integrates only the air-side distance. An underwater ocean-marker pixel bypasses this pass because the surface shader has already evaluated atmospheric sky through its Snell/Fresnel window and there is no camera-side air segment; `UnderwaterPass` integrates the camera-to-interface water path next. Other sky/horizon airlight is weighted by actual air-path length: a far-depth sentinel on a ray that remains underwater has zero atmospheric contribution. This prevents submerged receivers from receiving atmospheric extinction for the same path that `UnderwaterPass` is about to integrate or from acquiring a false bright horizon band.

## Caustic transport

`WaterCaustics` renders a world-anchored, repeating tile from an analytic surface patch. For each live wave sample:

1. A flat air-to-water Snell ray establishes the undeformed projected patch.
2. The same ray is bent by the short `OCEAN_CAUSTIC_WAVES` optical slope spectrum.
3. The old/new projected-area ratio becomes irradiance concentration.

No independent phase, ridge, scrolling decal, or color mask is added after the area ratio. Every optical wave has an integer X/Z cycle count over `CAUSTIC_TILE_SIZE`, making displacement, slope, and concentration continuous where the bounded target repeats. The 53 m domain is deliberately incommensurate with the 64-block terrain chunks and carries twelve co-prime directional modes spanning broad folds through fine filaments. This distributes the physical interference realization across the domain instead of repeating one concentrated 17 m packet as apparent square projector islands. The visible macro spectrum is intentionally excluded from this bounded target because its incommensurate wavelengths cannot wrap without a false seam; it remains owned by the visible surface, while the unresolved periodic slope spectrum owns the caustic transport field. The source mesh spans a 1.5-period guarded patch and uses 216 cells per period, a multiple-of-four lattice that puts both one-period receiver edges on matching source-mesh columns. A fractional cell count per period is forbidden because it produces cross-shaped repeat seams even when the analytic wave field is periodic. Uncovered guard texels clear to neutral transmitted irradiance rather than zero light. The field is encoded as `concentration / CAUSTIC_FIELD_SCALE`, mip-filtered as irradiance, and decoded by every receiver. The target is centered so its flat projection is aligned to world origin, and all receivers project their world position to the same `CAUSTIC_REFERENCE_DEPTH` using the flat refracted sun ray. This keeps one field coherent between the visible seabed extension, authoritative block terrain, and the underwater volume.

The block receiver changes only direct sun. It combines concentration with interface transmission, water absorption along the refracted light path, receiver-angle correction, sun altitude, and the existing voxel shadow visibility. Ambient sky, stars, material albedo, and shadows are not brightened by the caustic texture. If the render target is unavailable, the sampler is neutral and no synthetic caustic pattern is invented.

## Review invariants

- `WaterSurfaceMaterial` remains the owner of visible interface Fresnel, reflection, and refraction.
- `UnderwaterPass` does not use a camera-depth dimmer or fixed ambient floor in place of medium transport.
- `AerialPerspectivePass` never applies air extinction to the below-water part of a finite ray.
- `WaterCaustics` contains differential-area concentration and shared analytic wave/Snell geometry, not a detached line generator.
- The caustic source lattice uses a multiple-of-four integer cell count per transport period and places both receiver wrap edges on matching mesh columns.
- Block and seabed receivers share reference depth, field encoding, sun transport, and texture coordinates.
- Surface receivers use seamless derivative-aware sampling plus the field's irradiance mip chain; they do not switch valid multi-texel footprints to a hard-coded uniform value. The volume additionally filters caustic and particulate frequencies against ray-segment and pixel footprints, converging toward neutral irradiance and mean density instead of repeated seams or screen-radiating slices.
