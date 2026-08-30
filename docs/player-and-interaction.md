# Player and interaction

## Input and camera

`InputSystem` owns browser keyboard/mouse listeners, pointer lock, yaw/pitch, movement state, queued actions, pause, hotbar selection, and view toggles. It is created after the camera exists and destroyed with the engine. Pointer-lock changes are reported to the engine, which maps loss of lock to pause only after gameplay has actually become ready.

The camera uses the `YXZ` FPS rotation order. `createPlayerCamera()` is the canonical projection factory for gameplay and diagnostics. In third-person mode, the visual character can move the camera independently of physics, but selection still derives from the exact center ray of the active camera.

## Movement and collision

`PlayerController` owns the eye-position physics state, gravity, walking/sprinting, jumping, swimming, water hysteresis, AABB collision queries, world bounds, and smooth emerge/elevation behavior. It queries `World.isBlockSolid()` rather than reading chunk arrays directly. Camera placement and the visual player rig consume the controller’s position, so physics remains independent of the rendered body.

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
