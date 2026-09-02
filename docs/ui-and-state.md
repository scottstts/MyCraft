# UI and state

## React shell

The normal app mounts `CanvasHost` plus the start panel, HUD, pause menu, settings/debug panel, audio panel, and loading overlay. The canvas is a fixed full-window surface. UI overlays decide their own visibility from shared state; the engine does not import React.

The local diagnostics route intentionally returns only `CanvasHost` with a deterministic camera pose, so visual captures contain the normal renderer output without the gameplay HUD.

## Zustand contract

`useUIStore` is the bridge between the React shell and engine-side behavior. It contains:

- session state: `gameStarted`, `loading`, `inGame`, and `paused`;
- hotbar selection and display values;
- restart signaling and the normalized world-size choice;
- FPS reporting from the engine;
- `startupStage` and `startupError` for terminal boot feedback;
- settings/debug/audio panel visibility;
- the selected player appearance (`Otherys` by default).

The engine reads the store with `useUIStore.getState()` inside its frame loop and event callbacks. React components subscribe to small selectors so HUD updates do not require engine objects to be exposed as React state.

`WorldSizePicker` presents the six supported footprints as an accessible radio
grid (`tiny` through `full world`). The store keeps only the normalized total
chunk count used by the engine; chunk dimensions are fixed by the build and are
not UI state.

The settings panel presents the five authored player appearances as an accessible 3x2 radio grid. Selecting one updates the store and calls the engine's narrow appearance bridge; the renderer swaps the live appearance without restarting the world. The selection is session UI state and is not serialized into world saves. During active gameplay, `R` advances through the same ordered list and wraps at the end; the HUD shows the key as a compact button-shaped hint.

## Pause and entry semantics

Startup uses the selected start/load button as the progress surface. Once the engine resolves, `CanvasHost` marks the session in-game, releases the loading state, requests pointer lock when possible, and enables music. Pointer-lock loss during a ready gameplay session sets `paused` while keeping `inGame` true; the pause menu then owns resume.

The full-screen `LoadingOverlay` is deliberately limited to in-game operations such as saving. A startup failure clears `gameStarted` and `loading`, so the start panel remains available and shows the captured error instead of leaving a permanent spinner or black canvas.

## Browser-gesture bridges

Two narrow window hooks exist because browser APIs require a trusted gesture or because a UI action must call an engine-owned operation without importing engine internals:

- `__requestGameEntryPointerLock` lets the start button request lock before async startup consumes the gesture;
- `__saveWorld` and the one-use `__nextSaveFileHandle` connect the save UI to engine serialization.

They are lifecycle-scoped and are not general-purpose application state.
