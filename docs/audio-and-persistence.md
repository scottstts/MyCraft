# Audio and persistence

## Music

`src/app/BgMusic.ts` discovers music assets with Vite’s eager glob, shuffles them into a playlist, and lazily creates one `HTMLAudioElement`. Playback is gated by game state through `setDesiredPlaying()`. `primeForGameStart()` and `tryPlayOnUserGesture()` handle browser autoplay policies without making the launch click produce audible music before world readiness.

`AudioPanel` is the player-facing controller for play/pause, previous/next track, progress, and volume. `MusicController.tsx` is retained as a compatibility export but is intentionally a no-op; it is not another music owner.

## Sound effects

`SoundEffects` is an engine subsystem driven by the player, input, and authoritative world. It manages:

- cadence-based footstep looping plus serialized event/cadence water-step one-shots;
- a continuous underwater loop;
- ocean ambience whose volume is sampled from nearby surface water and smoothed over time;
- break, place, and landing one-shots.

Underwater ambience is gated by the active gameplay camera, not the player's physics head or swim state. A 0.4-block camera audio envelope uses a 50% submersion threshold, so first- and third-person views switch at the same waterline; the ocean loop uses the same camera result for its underwater dimming. Character switching plays the supplied `src/assets/sounds/sound_effects/switch_sound.mp3` one-shot at the shared SFX volume.

Ocean distance is the shortest verified ray distance to continuous surface water. Its gain follows inverse-square sound intensity from a 12-block reference distance and reaches exactly zero at the 96-block audibility boundary, with a final smooth cutoff. Water-step audio is driven by movement input or vertical action while the character touches the surface layer; standing still is inactive even if the character remains in water, and residual horizontal drift does not keep the action active. Only one `water_step.mp3` clip may play at a time; repeated contact updates do not restart it, an ended clip immediately chains when the trigger remains active, and trigger inactivity allows the current clip to continue through `1.280s` before stopping. Continuous surface collision while an action continues is not treated as a middle inactivity, so walking playback is not interrupted. Jumping creates the expected active/inactive contact phases for takeoff, landing, and entering or leaving shallow water.

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
