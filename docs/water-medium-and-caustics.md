# Underwater medium and caustics

This page records the optical contract behind the underwater-volume work. The visible interface shader remains owned by `WaterSurfaceMaterial`; the participating medium and seabed light transport are separate render stages.

## Medium ownership

The active order is:

```text
RenderPass → AerialPerspectivePass (air segment) → UnderwaterPass (water segment) → Bloom → LensFlare → OutputPass
```

`UnderwaterPass` reconstructs a world ray and solves its interval below the nominal visual water plane. A camera below the plane integrates from the camera to the receiver or water surface. A camera above the plane integrates only after a valid downward crossing, except for the opaque ocean's zero-alpha marker: that marker already contains an interface Fresnel mix and is left untouched when the camera is above.

Each of eight fixed samples evaluates a world-anchored particulate field. The local extinction is:

```text
sigma_t = (absorption + scattering) * density
T       = exp(-sigma_t * segmentLength)
```

The segment adds single scattering from the evaluated sky irradiance and sun irradiance. Sun light is attenuated from the interface to the sample, receives dielectric air-to-water transmission, and is shaped by a relative Henyey-Greenstein phase function. The density field is slow, coherent, and advected in world space; it is not a screen-space noise layer. Debug modes 1–6 expose water path, transmittance, scatter, caustic field, particulate density, and sun phase.

`AerialPerspectivePass` uses the same water-plane crossing solve but integrates only the air-side distance. This prevents submerged receivers from receiving atmospheric extinction for the same path that `UnderwaterPass` is about to integrate.

## Caustic transport

`WaterCaustics` renders a world-anchored, repeating tile from an analytic surface patch. For each live wave sample:

1. A flat air-to-water Snell ray establishes the undeformed projected patch.
2. The same ray is bent by the analytic macro normal plus the short `OCEAN_CAUSTIC_WAVES` slope spectrum.
3. The old/new projected-area ratio becomes irradiance concentration.

No independent phase, ridge, scrolling decal, or color mask is added after the area ratio. The field is encoded as `concentration / CAUSTIC_FIELD_SCALE` and decoded by every receiver. The target is centered so its flat projection is aligned to world origin, and all receivers project their world position to the same `CAUSTIC_REFERENCE_DEPTH` using the flat refracted sun ray. This keeps one field coherent between the visible seabed extension, authoritative block terrain, and the underwater volume.

The block receiver changes only direct sun. It combines concentration with interface transmission, water absorption along the refracted light path, receiver-angle correction, sun altitude, and the existing voxel shadow visibility. Ambient sky, stars, material albedo, and shadows are not brightened by the caustic texture. If the render target is unavailable, the sampler is neutral and no synthetic caustic pattern is invented.

## Review invariants

- `WaterSurfaceMaterial` remains the owner of visible interface Fresnel, reflection, and refraction.
- `UnderwaterPass` does not use a camera-depth dimmer or fixed ambient floor in place of medium transport.
- `AerialPerspectivePass` never applies air extinction to the below-water part of a finite ray.
- `WaterCaustics` contains differential-area concentration and shared analytic wave/Snell geometry, not a detached line generator.
- Block and seabed receivers share reference depth, field encoding, sun transport, and texture coordinates.
- Surface receivers use derivative-aware filtering and the volume uses the target's linear filtering, converging toward stable low-frequency transport instead of a screen-locked stripe.
