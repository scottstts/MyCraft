## Phase A — Implementation Notes

What I added:

- Scripts in `package.json` for `test`, `test:run`, and `typecheck`.
- Vitest config embedded in `vite.config.ts`.
- `src/config/constants.ts` and `src/config/flags.ts` per plan.
- `tests/sanity.spec.ts` validating constants import.
- `src/app/CanvasHost.tsx` that mounts a `<canvas>` and starts the engine.
- `src/engine/core/Engine.ts` with RAF loop and dt logging.
- `src/App.tsx` renders `<CanvasHost />`.
- Global CSS to ensure fullscreen canvas and dark background.

Acceptance:

- Dev server renders a full-viewport dark canvas without errors.
- Console shows `Engine tick dt=…` each frame.
- `vitest` discovers and runs tests; `typecheck` passes with strict TS.

