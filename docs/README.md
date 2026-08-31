# MyCraft engineering notes

This directory documents the implemented runtime boundaries and the contracts between them. Each subsystem has its own page so a change can be reviewed against the owner of the behavior instead of against one large project manual.

## Subsystems

- [Application shell and boot](application-shell-and-boot.md) — React entry, lazy engine loading, staged startup, first-frame readiness, failure reporting, and cancellation.
- [Rendering](rendering.md) — the WebGL renderer, drawing-buffer policy, resize coordination, post-processing, and GPU resource ownership.
- [Filmic lens flare](lens-flare.md) — the sun-linked optical graph, finite-disc visibility, blocker-breadth bloom response, and diagnostics.
- [Atmosphere, lighting, and shadows](atmosphere-lighting-and-shadows.md) — time of day, sky radiance, aerial perspective, and the voxel visibility pass.
- [Water](water.md) — authoritative water blocks, rendered water surfaces, the far ocean, caustics, and underwater medium effects.
- [Water medium and caustics](water-medium-and-caustics.md) — participating-water integration, air/water pass ownership, differential-area transport, and receiver invariants.
- [World and chunks](world-and-chunks.md) — voxel storage, terrain generation, worker orchestration, meshing, and mesh publication.
- [World sizing](world-sizing.md) — named world footprints, the direct start-screen picker, and the fixed large chunk contract.
- [Player and interaction](player-and-interaction.md) — pointer lock, movement, collision, selection, mining, placing, and inventory handoff.
- [Player characters](player-characters.md) — reference-matched appearances, shared rig contract, swapping, and selection ownership.
- [Audio and persistence](audio-and-persistence.md) — music, spatially driven sound effects, save files, and load validation.
- [UI and state](ui-and-state.md) — the React shell, Zustand state, HUD ownership, pause semantics, and entry controls.
- [Diagnostics and validation](diagnostics-and-validation.md) — local-only camera routes, read-only diagnostics, and the checks that protect the runtime contracts.

## Reading the code

`src/engine/core/Engine.ts` is the composition root. It wires the systems together, owns the frame loop, and owns startup/shutdown sequencing; individual systems keep their behavior in their own modules. React components live under `src/app`, and communicate with the engine through the Zustand store or narrow window hooks where a browser gesture is required.

The project-level rules live in [.codex/AGENTS.md](../.codex/AGENTS.md). This documentation describes implementation choices and subsystem contracts; it is not a second copy of those rules.
