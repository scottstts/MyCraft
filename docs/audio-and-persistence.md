# Audio and persistence

## Music

`src/app/BgMusic.ts` discovers music assets with Vite’s eager glob, shuffles them into a playlist, and lazily creates one `HTMLAudioElement`. Playback is gated by game state through `setDesiredPlaying()`. `primeForGameStart()` and `tryPlayOnUserGesture()` handle browser autoplay policies without making the launch click produce audible music before world readiness.

`AudioPanel` is the player-facing controller for play/pause, previous/next track, progress, and volume. `MusicController.tsx` is retained as a compatibility export but is intentionally a no-op; it is not another music owner.

## Sound effects

`SoundEffects` is an engine subsystem driven by the player, input, and authoritative world. It manages:

- cadence-based footstep and water-step one-shot loopers;
- a continuous underwater loop;
- ocean ambience whose volume is sampled from nearby surface water and smoothed over time;
- break, place, and landing one-shots.

Audio playback failures are treated as optional browser capability failures. The game continues when autoplay is blocked and retries on a later user gesture.

## Save format

The current envelope is `WorldSaveFile` version 2. The plaintext `WorldSavePayload` contains:

- the `MyCraftWorld` kind and version;
- creation metadata;
- seed, named-footprint chunk count, fixed chunk size, bounds, and world radius;
- loaded chunks as keys plus base64 voxel arrays;
- the nine inventory slots and selected slot.

The engine serializes loaded authoritative chunks, signs the payload with the project’s fixed HMAC helper, and encrypts the JSON with AES-GCM using the embedded application key. This is an integrity/tamper-evidence format for local game files, not a security boundary: the signing secret and encryption key ship with the client.

`SaveWorldButton` first attempts the browser File System Access picker when available and passes a one-use handle to the engine. The engine writes to that handle or falls back to a JSON download. Save failures are reported through the existing browser alert/console path rather than changing startup state.

## Loading

`StartPanel` reads the selected JSON file, validates the envelope identifiers,
decrypts and verifies the payload, checks the named world footprint and fixed
chunk dimensions against the current build, normalizes inventory state, and
places the verified payload in a short-lived window handoff. `Engine` consumes
that handoff once, ingests each chunk into `ChunkPipeline`, and clears it in a
`finally` block so a restart cannot reuse stale save data.

Day/night UI state is not part of the save payload. A loaded world restores terrain, seed, bounds, and inventory; the render clock starts from the normal engine/diagnostic initialization path.
