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

## Read-only evidence hooks

The engine exposes two local validation hooks on `window`:

- `__getVoxelShadowDiagnostics()` reports the active voxel shadow resolution and volume/pass state;
- `__getRenderDiagnostics()` reports the renderer color/tone settings, sky transform, atmosphere state, and sun direction.

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
- diagnostics still use the gameplay camera factory and the normal render path.
