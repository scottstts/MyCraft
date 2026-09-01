# Player and interaction

## Input and camera

`InputSystem` owns browser keyboard/mouse listeners, pointer lock, yaw/pitch, movement state, queued actions, pause, hotbar selection, and view toggles. It is created after the camera exists and destroyed with the engine, but remains disabled while the world, shaders, and first frame are loading. Pointer lock may be granted during the launch gesture without accepting mouse or keyboard input; the engine enables input only after gameplay is ready. Pointer-lock changes are reported to the engine, which maps loss of lock to pause only after gameplay has actually become ready.

The camera uses the `YXZ` FPS rotation order. `createPlayerCamera()` is the canonical projection factory for gameplay and diagnostics, including the close `0.01` near plane needed by the first-person arms. First-person uses each authored rig's anatomical `EyeAnchor`, which is positioned just forward of the head face, and sweeps that anchor from the controller eye through solid voxels before committing the camera pose. View toggles re-seed the shared look heading from the character's current body heading: third-to-first faces forward, while first-to-third compensates for the third-person orbit offset and snaps directly behind the character. The untouched initial third-person state retains its authored front-facing composition. In third-person mode, the visual character can move the camera independently of physics, but selection still derives from the exact center ray of the active camera. The selectable reference appearances all use the same camera and animation path; only the authored appearance subtree changes.

## Movement and collision

`PlayerController` owns the eye-position physics state, gravity, walking/sprinting, jumping, swimming, water hysteresis, AABB collision queries, world bounds, and smooth emerge/elevation behavior. It queries `World.isBlockSolid()` rather than reading chunk arrays directly. Camera placement and the visual player rig consume the controller’s position, so physics remains independent of the rendered body.

The horizontal swim pose is lifted relative to the rig root so its lowest rendered geometry stays on the controller's feet plane when the body volume contacts a solid seabed. First-person camera collision uses a small swept volume around the eye anchor; third-person camera collision uses a larger conservative swept sphere against radius-expanded solid voxel boxes. Both sweeps catch diagonal corners on stepped underwater terrain.

While moving underwater, collision uses the normal body volume plus separate pose volumes for the horizontal swim legs, torso, arms, and head. Their centers and extents follow the authored rig and are projected into the voxel axes. The full X/Z displacement is swept as one vector, stopping at the earliest voxel face (including diagonal corners) and sliding only along the unblocked component. This blocks seabed steps and side walls without treating trailing shoreline geometry as a wall. There is no post-collision search that relocates the player to a higher “safe” position.

The frame loop updates gameplay only while the UI says the session is in-game and not paused. Rendering continues while paused so the scene, sky, water, and pause menu remain visually stable.

## Selection, mining, and placing

`SelectionSystem` casts one voxel ray from the center of the active camera. It applies the interaction reach and world-bounds checks, stores the hit and placement cells, and updates a lightweight wireframe selection box. `InteractionSystem` consumes that result and the queued input:

- left click/hold starts a cadence-synchronized swing and accumulates strikes for the targeted block;
- a successful break removes the block, updates water connectivity when relevant, adds the drop to inventory, and remeshes the affected area;
- right click places the selected inventory block when collision/placement checks allow it, consumes one item, and remeshes;
- arm animation and sound hooks are triggered only when an action is actually accepted.

The selection ray and the interaction reach are separate concerns in third-person: the camera ray finds the visible target, while the player-origin distance still limits whether the action is valid.

## Inventory

`src/state/inventory.ts` owns the nine-slot hotbar inventory. Stacks are unlimited in the current rules. Engine-side helpers (`addToInventory`, `getSelectedPlacementBlockId`, `consumeOneFromSelected`) avoid React hooks in the engine. Save/load uses deep-copied slot data and normalizes restored inventories to exactly nine slots.
