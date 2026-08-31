# Player characters

The selectable appearances are `Otherys`, `Solvaris`, `Vespera`, and `Kaelith`; the ids intentionally match the four files under `ref/`. Otherys is the default. `playerCharacterRigs.ts` owns each reference's pixel textures, material recipes, and named decorative box subassemblies.

All appearances compile to the same moving rig contract: head pivot and eye anchor, torso, backpack, two arm pivots, two leg pivots, and the shared pickaxe. `PlayerCharacter` owns the common animation, first-/third-person visibility, camera follow, feet/eye alignment, and shadow-box registration. Switching appearance disposes the old geometry/materials/textures, creates the new authored subtree, and carries the current rig pose across the swap.

The selected id is UI/session state in `useUIStore`; it is not part of a world save. The settings panel calls the engine's narrow `__setPlayerCharacter` bridge so React never imports engine objects. Pressing `R` calls the same switch boundary directly from the trusted keydown event, advances in `PLAYER_CHARACTER_IDS` order, and wraps from `Kaelith` back to `Otherys`. The HUD repeats this affordance with a small `R` keycap hint.

Every successful appearance swap triggers `CharacterSwitchVFX`, a character-local port of the authored scan/sweep shader in `ref/character_switch_vfx.html`. The active rig is flattened into character space for the reference's animated scan band, fresnel response, strands, sparks, and trail. The effect never owns or shakes the camera. Its one-shot audio is the supplied `src/assets/sounds/sound_effects/switch_sound.mp3`, with volume following the player-facing sound-effects volume.

A new appearance must preserve the shared pivot names and dimensions, use a deterministic texture seed, and be included in `PLAYER_CHARACTER_OPTIONS` so it is both renderable and selectable.
