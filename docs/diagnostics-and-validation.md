# Diagnostics and validation

## Local-only render routes

Diagnostics are enabled only when the browser host is local (`localhost`, `127.0.0.1`, or `::1`) and the query contains `debug=1` plus a valid view. Supported views are:

| View | Purpose |
| --- | --- |
| `overview` | A deterministic elevated terrain composition |
| `player-spawn` | The grounded spawn pose |
| `player-ridge` | A second authored terrain location |
| `player-gully` | A lower terrain composition |
| `sky` | A steep upward sky/atmosphere view |

Optional `time` accepts a normalized cycle value or `sunrise`, `noon`, `sunset`, or `midnight`. Invalid requests fall through to the normal game, and a non-local host can never enable the route by adding query parameters.

Every diagnostic view uses `createPlayerCamera()` and the ordinary `Engine` renderer, materials, world, atmosphere, water, shadow, and first-frame readiness. The diagnostic module supplies only a deterministic world-space pose and optional clock value; it does not create a second camera or render pipeline.

## Ocean evidence modes

`WaterSystem.setDebugMode()` is the local validation hook for the render-only ocean. Modes 1–7 cover height, resolved normal, Fresnel/path state, transmittance, foam/crest, and forward-layer coverage. Mode 7 must show one coherent coverage silhouette in red/green; an offset duplicate, vertically repeated edge, or camera-pan sparkle at a terrain boundary is a rejection condition. Modes 8 and 9 are the spectral/glint checks: mode 8 visualizes shared unresolved slope variance, local roughness, and sun-lobe response; mode 9 visualizes the undeformed base-plane pixel footprint and retained long/short-band LOD. The expected evidence is continuous band retention across the inner/outer mesh transition, spatially varied roughness that follows the normal field, and no color-only stripe or independent glint mask.

The ocean field is deterministic: the visible field's fixed phases, directional components, finite-depth dispersion, and normalized half-block envelope are shared by CPU sampling, vertex displacement, fragment normals/optical carrier reconstruction, and the forward interface solve. The bounded caustic projection uses its own explicit short optical slope spectrum with integer tile cycles; its shader does not carry the incommensurate macro declarations that cannot repeat seamlessly. Captures should keep the same camera pose, time, resolution, and sun direction when comparing changes. Use the no-post baseline when isolating water; lens flare and aerial perspective can otherwise make a water seam appear to belong to the surface. The active post-process contract is that the forward target carries opposite-medium color/depth/coverage at one apparent pixel, the ocean applies Fresnel once, and the internal ocean marker makes aerial perspective use water-surface depth instead of the water-free seabed capture.

Underwater validation uses `Composer.setUnderwaterDebugMode()` to reach `UnderwaterPass`. Modes 1–3 show water path length, transmittance, and scattering; mode 4 shows the decoded differential-area caustic field; mode 5 shows world-space particulate density; mode 6 shows the sun phase response. A good fixed-view capture has non-zero blue-green scatter at depth, spatially coherent density variation that does not stick to the screen, and caustic field values centered around neutral energy with localized concentration. Compare a shallow and deep receiver at the same XZ position to verify the reference-depth projection rather than a world-height decal. Sweep a grazing seabed view across several 64-block terrain chunks: sun-visible receivers must not reveal square caustic islands, a 17 m repetition, a horizontal/vertical cross at the 53 m wrap, or a phase reset at chunk boundaries; real voxel and character shadows remain valid suppressors. The field may blur as its footprint grows, but it must not form black/unbound islands or jump to a uniform patch at a fixed texel threshold. In grazing views, modes 4 and 5 must converge smoothly as their represented footprint grows: repeated tile seams, radial march slices, and atmospheric airlight on a zero-air-path underwater ray are rejection conditions. `WaterCaustics.getDiagnostics()` must report half-period-quantized guard coverage, a multiple-of-four integer `segmentsPerPeriod`, and matching receiver-edge mesh columns.

## Read-only evidence hooks

The engine exposes two local validation hooks on `window`:

- `__getVoxelShadowDiagnostics()` reports the active voxel shadow resolution and volume/pass state;
- `__getRenderDiagnostics()` reports the renderer color/tone settings, sky transform, atmosphere state, sun direction, and the active seaweed field diagnostics.

The render diagnostics also report the forward-refraction target size, participating object count, `forward-fermat-snell` projection label, alpha-coverage ownership, and `source-world-rgb32f` receiver space. The target dimensions must match the drawing buffer after every resize. In an above-water orbit, submerged block faces must not develop coordinate-aligned dark bars, and a character shadow must keep a stable subpixel edge on the same receiver surface. Either symptom rejects the receiver representation or its refracted pixel-footprint reconstruction even if the unrefracted view remains clean.

`renderStages` adds read-only frame accounting for the twelve named render stages. Each stage reports renderer draw calls and triangles for the current frame, plus the most recent available GPU elapsed sample when `EXT_disjoint_timer_query_webgl2` is present. A `null` GPU time means that no non-disjoint query has completed yet; it is not a zero-cost claim. Compare stage samples only after several stable frames at a fixed camera, resolution, time, and sun direction. The profiler must remain non-blocking: no `gl.finish()` or synchronous timer-result readback is part of the runtime path.

They are observation hooks for local tooling, not player controls.

## Contract tests and checks

Small pure tests cover the renderer sizing math and startup error normalization in `tests/rendererSizing.spec.ts` and `tests/startup.spec.ts`. The project-level verification commands are:

```text
npm run typecheck
npm run lint
npm run test:run
```

When changing rendering or startup, also inspect these invariants manually in the source:

- `Renderer` remains WebGL-only and owns the one drawing-buffer commit;
- no subsystem adds a second device-pixel-ratio policy;
- startup cannot resolve before initial terrain meshes and the first frame;
- dynamic-import, worker, shader, and first-frame errors reach the start UI;
- resize commits are coalesced and zero-sized transient layouts do not resize GPU targets;
- diagnostics still use the gameplay camera factory and the normal render path;
- direct-sun-disabled frames keep voxel visibility white without repeatedly clearing either target;
- the X/Z caster-height hierarchy remains conservative after block edits and seaweed replacement;
- medium-separated terrain uses minimal source-world receiver draws and full terrain materials for forward color draws.
- seaweed diagnostics show a fresh per-load distribution seed, ocean-only accepted anchors, submerged height caps, and the separate caster-field count.
