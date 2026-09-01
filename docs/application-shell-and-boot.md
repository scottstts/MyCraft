# Application shell and boot

## Ownership

- `src/App.tsx` chooses between the normal game shell and the local diagnostics shell.
- `src/app/CanvasHost.tsx` owns the canvas element and the browser-facing engine lifecycle.
- `src/engine/core/Engine.ts` owns the engine composition root, RAF loop, startup gate, and teardown.
- `src/shared/startup.ts` owns the stage vocabulary and the serializable startup error shape.
- `src/state/ui.ts` carries the stage and terminal error to the entry UI.

The engine is lazy-loaded so the initial React shell can render before the Three.js runtime and its worker graph are imported. `CanvasHost` does not reach into engine internals; it loads the exported `engine.start` and `engine.stop` API.

## Startup contract

`Engine.start()` resolves only when the first usable frame has been rendered. Starting the RAF loop is an intermediate step, not success. The sequence is:

| Stage | Work owned by the stage | Release condition |
| --- | --- | --- |
| `engine-import` | Dynamic import from `CanvasHost` | The engine module is available |
| `renderer` / `scene` / `world` | Create the WebGL renderer, scene, camera, and world | Core objects exist |
| `assets` / `render-pipeline` | Load the atlas and construct materials, chunk renderer, and composer | The render graph is wired |
| `systems` | Create lighting, atmosphere, input, player, selection, interaction, water, grass, and audio systems | All runtime systems are connected |
| `world-loading` | Generate or ingest the expected chunks and produce their meshes | Every expected chunk has data and a mesh; initial meshes are applied |
| `shader-compilation` | Ask `WebGLRenderer.compileAsync()` to prepare the active scene | Shader compilation settles |
| `warmup` / `first-render` | Open the first-frame gate and let the RAF loop render | The first successful frame completes |
| `ready` | Mark gameplay ready, enable the already-constructed input system, and return from `Engine.start()` | `CanvasHost` releases the entry UI |

Generated worlds wait for both `CHUNK_READY` and `CHUNK_MESH` for the expected set. Saved worlds bypass generation by ingesting their verified chunk payloads into the same pipeline. The initial mesh queue is flushed before the player is positioned for entry, which prevents the user from entering a scene that is still visually empty.

## Failure handling

The complete startup promise is observed by `CanvasHost`, including the dynamic import, engine startup, and the final UI handoff. Failures are normalized into `StartupErrorInfo` with:

- the failing stage and human-readable stage label;
- CSS viewport dimensions and the renderer DPR;
- the browser platform/user agent;
- the original error name, message, and stack when available.

The failure path stops the engine, cancels workers and pending readiness, clears gameplay/loading state, and leaves the start panel visible with an expandable diagnostics block. Worker `error` events and malformed worker responses reject the world-loading gate rather than allowing the UI to wait forever.

The RAF tick also has a terminal frame-error path. If an update or render throws, the engine logs the active stage, rejects a pending first-frame gate, and stops. `stop()` is idempotent in practice: it cancels RAF, disposes systems and GPU resources, terminates workers, and removes input/resize listeners.

## React lifecycle and cancellation

`CanvasHost` uses a lifecycle token because React Strict Mode can mount, clean up, and mount the effect again while an import or worker request is still pending. A stale effect cannot start a second engine, and a navigation during startup tears down a completed engine before the next lifecycle owns the canvas.

The entry screen uses `loading` for startup and save/load UI state. Startup progress is displayed on the active start/load button; the full-screen loading blocker is reserved for in-game operations such as saving.
