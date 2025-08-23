# Dev Plan

* **Architecture & folder map** (who owns what, and who talks to whom)
* **Canonical data model** (types, invariants, and formulas)
* **Rendering + chunk meshing plan** (simple first; optimized later)
* **Game systems** (input, physics, world‑gen, inventory, save/load)
* **Workers & perf strategy** (what runs where; message contracts)
* **Feature flags & debug ergonomics**
* **A step‑by‑step build plan** with \~100 “agent‑sized” tasks, each with clear deliverables and acceptance criteria

No fluff. Just the spine you can feed to the agent.

---

## 0) Scope & Non‑Goals

**Target:** A performant, minimalist voxel sandbox:

* First‑person move/look, jump.
* Place/remove blocks.
* Chunked world with basic terrain (noise heightmap).
* Simple ambient + directional lighting (no dynamic light propagation initially).
* Texture atlas with pixelated look.
* Saving edits locally.
* Basic UI (hotbar, crosshair, fps/debug).

**Non‑Goals (v1):**

* Mobs/AI, redstone, fluids, full crafting, complex shadows, multiplayer.
* Infinite world is “streamed chunks around player” (not literal infinite persistence).

---

## 1) Tech Stack (pragmatic, agent‑friendly)

* **Build**: Vite + React + TypeScript.
* **3D**: Three.js (imperative engine), not react-three-fiber. Reason: keeps rendering loop + engine logic **outside React**, easier for a short‑horizon agent to reason about.
* **State (UI)**: Zustand (tiny, explicit, serializable).
* **Math**: gl‑matrix or tiny self‑rolled vec3 (your choice); we’ll mostly use simple numbers.
* **Noise**: `simplex-noise` (deterministic worldgen).
* **Storage**: IndexedDB via `idb-keyval` (thin wrapper).
* **Workers**: Web Workers for chunk generation/meshing.
* **Testing**: Vitest for unit tests on math + chunk utils.
* **Lint/Format**: ESLint + Prettier, strict TS.

---

## 2) Repo & Folder Layout (hard boundaries)

```
/src
  /app              # React shell + routing + UI
  /engine           # Pure game engine (no React)
    /core           # loop, time, events
    /world          # world, chunks, blocks, registry
    /render         # three.js scene, materials, texture atlas
    /systems        # physics, input, player controller
    /workers        # worker entrypoints + message types
    /utils          # math, coords, debug helpers
  /assets
    /textures       # your atlas image + json mapping
  /types            # shared TS types (DTOs for workers/UI/engine)
  /state            # Zustand stores (UI-facing)
  /config           # tunables (chunk sizes, flags)
  /persist          # save/load wrappers
/tests
```

**Key rule:** React never touches engine internals directly. React only:

* mounts a `<CanvasHost />` which hands the engine a canvas element,
* displays HUD based on Zustand state,
* dispatches simple intents (e.g., “togglePause”).

Engine owns the main loop, world, physics, and rendering. Workers do heavy lifting. UI is a read‑only window into state + simple user intents.

---

## 3) Naming & Conventions

* **Coordinate system**: Right‑handed, `Y+` up, `X+` east, `Z+` south. World positions in integer block units; player/camera in floats.
* **Chunk size**: `CHUNK_SIZE = { x: 16, y: 64, z: 16 }` for v1. (Adjust later.)
* **Block IDs**: `0 = AIR` (always). Keep IDs contiguous small integers. Max 255 → `Uint8Array` for chunk voxels.
* **File conventions**: one module = one responsibility. Avoid “god” files. Every module has a short README block at top (what it is, who calls it).
* **Feature flags** in `/config/flags.ts` (booleans), read once at boot.

---

## 4) Canonical Data Model (critical contracts)

**4.1 Basic types (shared via `/types`):**

```ts
// IDs
type BlockId = number; // 0..255; 0 = AIR
type ChunkKey = string; // `${cx},${cy},${cz}`

// World integer positions (blocks)
interface V3i { x: number; y: number; z: number; }
// World float positions (entities/camera)
interface V3f { x: number; y: number; z: number; }

// Chunk coordinates (integers)
interface C3 { cx: number; cy: number; cz: number; }

// Chunk data payload
interface ChunkData {
  size: V3i;               // {16,64,16}
  voxels: Uint8Array;      // length = size.x * size.y * size.z
  // Optional later: light: Uint8Array;
}

// Block registry entry
interface BlockDef {
  id: BlockId;
  name: string;
  opaque: boolean;         // true → face is hidden by same block adjacent
  solid: boolean;          // true → collides with player
  faces: {
    // atlas tile indices (u, v) per face; or single "all" tile
    top?: [number, number];
    bottom?: [number, number];
    side?: [number, number];
    all?: [number, number];
  };
}

// Worker messaging
interface WorkerReq {
  type: 'GEN_CHUNK' | 'MESH_CHUNK';
  payload: any;
}
interface WorkerRes {
  type: 'CHUNK_DATA' | 'CHUNK_MESH';
  key: ChunkKey;
  payload: any;
}
```

**4.2 Index math (must be exact):**

* **Flatten voxel index** (x,y,z in local chunk coords):

  * `idx = y * (sx * sz) + z * sx + x` where `sx = 16`, `sz = 16`.
* **Chunk mapping** *(Euclidean division is critical for negatives)*:

  * `cx = floorDiv(x, sx)`, `lx = euclidMod(x, sx)` (0..sx-1).
  * `floorDiv(n, d) = Math.floor(n / d)` if `n>=0`; for negatives ensure it rounds down (not toward zero).
  * `euclidMod(n, d) = ((n % d) + d) % d`.

**4.3 Invariants**

* Chunk voxels array length == `sx*sy*sz`.
* Registry has `id=0` as AIR, `opaque=false`, `solid=false`.
* All world → chunk conversions use the same `floorDiv/euclidMod` helpers.
* Worker messages are **immutable** DTOs (cloneable or transferable TypedArrays).

---

## 5) Rendering & Materials (simple first)

* One Three.js `Scene` with:

  * AmbientLight (low), DirectionalLight (sun).
  * A `Group` per loaded chunk holding a `Mesh` (single `BufferGeometry` with indexed triangles).
* **Materials**:

  * `MeshStandardMaterial` with a **single texture atlas**.
  * Texture params: pixel art look

    * `magFilter = NearestFilter`
    * `minFilter = NearestMipmapNearestFilter`
    * `anisotropy = 1`
    * `wrapS/T = RepeatWrapping`
* UVs computed per face using atlas cell size (e.g., 16×16 tiles).
* **Backface culling on**, normals per face, no vertex AO v1.

---

## 6) Chunk Meshing (v1 naive, v2 greedy)

* **V1**: **Naive face culling**: for each solid block, emit a quad for any face where neighbor is “air or transparent” (i.e., neighbor `opaque=false`).
* Build typed arrays for positions, normals, uvs, indices in worker, transfer back to main thread, create `BufferGeometry` from them.
* **V2 (later)**: Greedy meshing to merge same‑material faces into larger quads. This is an optional optimization step.

---

## 7) World Generation (deterministic, cheap)

* Use a seed. Terrain = 2D simplex noise heightmap:

  * `height(x,z) = base + amp * noise2D(x * fx, z * fz)`.
* Block layers:

  * y < bedrockThresh → stone,
  * top 1 → grass, 3 below → dirt, else stone.
* Optional biome variation later by changing amplitude/frequency bands.

---

## 8) Player, Input, Physics

* **Controls**: WASD, Space (jump), Shift (sprint), mouse‑look (pointer lock).
* **Camera**: first person, pitch clamped \[-89°, +89°].
* **Physics**: simple AABB:

  * Player AABB \~ `0.6×1.8×0.6` (centered).
  * Gravity constant.
  * Collisions by **axis‑separated sweep** (resolve X, then Z, then Y).
  * Grounded flag if Y collision from above.
* **Block interaction**:

  * Raycast from camera to max distance (e.g., 5 blocks).
  * Left click remove target block; right click place selected block at adjacent empty cell.
  * Re‑mesh affected chunks (current + neighbor if face is at boundary).

---

## 9) UI & Game State

* **Zustand** store for UI: selected hotbar slot, fps, debug info, pause state, seed, flags.
* HUD overlays: crosshair, hotbar, block tooltip, debug (F3): pos/chunk/fps/loaded chunks.
* Pause menu toggles (noclip, fly, show chunk bounds).

---

## 10) Persistence

* Seed stored once.
* Player‑placed/removed blocks stored as **overrides** (sparse): map chunkKey → list of edits.
* Save on debounce, load on chunk request: apply overrides after gen.

---

## 11) Workers & Messaging

* **Generator Worker**: given `ChunkKey` + seed → returns `ChunkData`.
* **Mesher Worker**: given `ChunkData` + block registry → returns mesh buffers.
* Messages:

  * `GEN_CHUNK { key, cx, cy, cz, seed } → CHUNK_DATA { key, chunkData }`
  * `MESH_CHUNK { key, chunkData } → CHUNK_MESH { key, positions/normals/uvs/indices }`
* Use `postMessage` with transferable buffers to avoid copies.

---

## 12) Feature Flags (config/flags.ts)

* `USE_WORKERS = true`
* `USE_GREEDY_MESH = false`
* `SHOW_CHUNK_BOUNDS = false`
* `ENABLE_NOCLIP = false`
* `CHUNK_RADIUS = 6` (how many chunks from player to load)

---

## 13) Debugging & Ergonomics

* Press F3 → overlay with counters (active chunks, meshes, triangles, ms/frame).
* “Regen World” button resets seed.
* Wireframe toggle per chunk.
* Outline target block during raycast.

---

# Step‑by‑Step Dev Plan (agent‑sized tasks)

**Notes for execution:**

* Each task below is **standalone** and ends with **Acceptance Criteria**.
* Unless specified, avoid external side effects.
* Use strict TypeScript.
* Keep every new module ≤ 200 lines initially; split if larger.
* When adding a module, put a short header comment (what, inputs, outputs).

---

### Phase A — Bootstrapping (project skeleton)

**A1. Scaffold project**

* Create Vite + React + TS project, install deps: `three`, `zustand`, `simplex-noise`, `idb-keyval`.
* Set up ESLint/Prettier/Vitest.
  **Acceptance:** `npm run dev` shows empty page; `npm run test` runs empty test suite; `npm run typecheck` passes.

**A2. Add base folders & config**

* Create folders per layout above.
* Add `/config/constants.ts` with `CHUNK_SIZE`, `PLAYER` constants (speed, aabb dims), `RENDER` constants.
* Add `/config/flags.ts` with defaults from §12.
  **Acceptance:** Imports compile; constants referenced in a sample test.

**A3. CanvasHost React shell**

* Component `/app/CanvasHost.tsx`: renders `<canvas>`; on mount, passes canvas to engine bootstrap; resizes on window resize; hides context menu.
* Render `<CanvasHost />` from `App.tsx`; set a dark background.
  **Acceptance:** Page shows a canvas; no engine yet; no console errors.

**A4. Engine bootstrap**

* `/engine/core/Engine.ts`: class `Engine` with `start(canvas: HTMLCanvasElement)` and `stop()`.
* Owns RAF loop (`update(dt)`), timekeeping, and route to subsystems.
* Stores a reference to renderer (to be added later).
  **Acceptance:** Engine starts/stops cleanly; logs dt to console.

---

### Phase B — Rendering foundation

**B1. Three.js renderer wrapper**

* `/engine/render/Renderer.ts`: create `WebGLRenderer` from provided canvas, set pixel ratio, size, and clear color.
* `getCanvasSize`, `onResize`.
  **Acceptance:** Renderer clears each frame, background color visible.

**B2. Scene & camera**

* `/engine/render/SceneBuilder.ts`: exports `createScene()` and `createCamera()`.

  * Camera: `PerspectiveCamera` (fov 70, near 0.1, far large enough e.g., 512).
  * Lights: ambient + directional.
* Engine holds `scene` + `camera`; in `update`, call `renderer.render(scene, camera)`.
  **Acceptance:** Blank scene renders, no errors.

**B3. Texture atlas loader (stub first)**

* `/engine/render/Atlas.ts`: define interface for atlas config:

  * `tileSize`, `atlasSize`, `tiles[name] -> {u,v}`.
* Stub loads a placeholder 1×1 white texture now; real atlas later.
  **Acceptance:** Material creation can request the atlas texture and gets a valid `THREE.Texture`.

---

### Phase C — Math & Utilities

**C1. Int math helpers**

* `/engine/utils/coords.ts`:

  * `floorDiv(n,d)`, `euclidMod(n,d)`, `worldToChunk(x,y,z) -> {cx,cy,cz, lx,ly,lz}` using constants.
  * `chunkKey(cx,cy,cz) -> string`.
* Unit tests for edge cases (negatives).
  **Acceptance:** Tests cover mapping for ± values; 100% pass.

**C2. Typed array helpers**

* `/engine/utils/typed.ts`: alloc/resize helpers for typed arrays; `reusableBufferPool` (optional); simple benchmarks in tests.
  **Acceptance:** Unit tests confirm flatten index mapping and capacity growth.

---

### Phase D — Block Registry & World data

**D1. Block registry**

* `/engine/world/blocks/BlockRegistry.ts`:

  * Holds `BlockDef[]` by id, lookup by name, and invariants.
  * Preload minimal set: `air(0)`, `grass`, `dirt`, `stone`.
* Export `getBlock(id)`, `getBlockIdByName(name)`.
  **Acceptance:** Unit tests: `0` is `air`, others valid.

**D2. Chunk data structure**

* `/engine/world/chunk/Chunk.ts`:

  * Class holds `ChunkData` with `voxels: Uint8Array`.
  * Methods: `get(lx,ly,lz)`, `set(lx,ly,lz,id)`.
* `/engine/world/chunk/index.ts`: helpers to compute flat index.
  **Acceptance:** Tests validate set/get at edges, including y boundaries.

**D3. World container (manager)**

* `/engine/world/World.ts`:

  * Holds `Map<ChunkKey, Chunk>`; APIs:

    * `ensureChunk(cx,cy,cz)`, `getChunk(cx,cy,cz)`, `setBlock(x,y,z,id)`, `getBlock(x,y,z)`.
  * Emits events (simple EventEmitter) when chunks added/removed/changed.
    **Acceptance:** Unit tests: world set/get across chunk boundaries, events fired.

---

### Phase E — Workers (structure first)

**E1. Define shared message types**

* `/types/workers.ts` contains the Req/Res interfaces (§4.1).
* Write narrow type guards.

**E2. Generator worker skeleton**

* `/engine/workers/generator.worker.ts`: placeholder that returns empty `ChunkData` filled with AIR for a given key/coords.
* `/engine/world/ChunkPipeline.ts`: orchestrator that requests generation, stores `ChunkData`, and emits `CHUNK_READY`.
  **Acceptance:** Request a couple chunks around origin; they arrive (AIR).

**E3. Mesher worker skeleton**

* `/engine/workers/mesher.worker.ts`: accepts `ChunkData` + registry snapshot and returns an empty mesh (for now).
* `/engine/render/ChunkRenderer.ts`: listens to `CHUNK_MESH` and creates a `Mesh` in scene, tracked per chunk key.
  **Acceptance:** Scene shows nothing but no errors; meshes allocated/replaced cleanly.

---

### Phase F — Real world generation

**F1. Heightmap generator**

* In generator worker: deterministic `simplex-noise` seeded instance.
* Implement `height(x,z)`; fill voxels for one chunk using world coords.
* Layers: grass top, 3 dirt below, rest stone; y<3 all stone (bedrock area).
  **Acceptance:** Spawn a grid of chunks; verify heights visually (add temporary vertex colors by height or log histogram).

**F2. Apply overrides**

* In `World.ts`, allow registering a “chunk edits” provider (initially empty).
* After a chunk is generated, apply overrides (no‑op now).
  **Acceptance:** No functional change; plumbing in place.

---

### Phase G — Naive meshing (visible faces)

**G1. Face culling mesh builder (worker)**

* For each voxel:

  * Skip if `id==0`.
  * For each of 6 faces, compare neighbor voxel:

    * If neighbor is outside chunk → query neighbor chunk data if available (pass in a “neighborhood” accessor that returns AIR when missing); **v1**: treat missing as AIR (will pop as you stream neighbors).
    * If neighbor is not opaque → emit quad.
* Build typed arrays: positions, normals, uvs, indices.
* UVs from atlas using block’s face tile.
  **Acceptance:** Chunks render with proper block faces; holes appear temporarily at chunk seams until neighbor mesh arrives (acceptable v1).

**G2. Atlas real texture**

* Replace placeholder with your real atlas image + JSON mapping (`/assets/textures/atlas.png`, `/atlas.json`).
* Apply nearest‑neighbor filters.
  **Acceptance:** Pixelated textures appear; grass top/side/bottom mapped correctly.

---

### Phase H — Player & Camera

**H1. Pointer lock + mouse look**

* Register input handlers for pointer lock, mouse movement; store yaw/pitch; clamp pitch.
* Camera position separate from player AABB center (eye height offset).
  **Acceptance:** You can look around smoothly; escape unlocks pointer.

**H2. Movement & gravity**

* WASD movement applied in camera yaw plane; sprint with Shift.
* Gravity applied; delta‑time aware.
  **Acceptance:** You can move on flat ground (no collisions yet), fall until y=0 clamp (temporary).

**H3. AABB collisions with world**

* Implement axis‑separated sweep against voxel solids.
* Resolve in X, Z, then Y; set grounded when Y hit from above.
  **Acceptance:** You stand on terrain, slide along walls, can’t pass through blocks.

**H4. Jump**

* Space: if grounded, apply upward impulse.
  **Acceptance:** Jumping works; cannot multi‑jump in midair.

---

### Phase I — Block interaction

**I1. Raycast voxel selection**

* Voxel DDA (“grid marching”) from camera position along view dir up to max distance.
* Return hit block cell and adjacent “place” cell.
  **Acceptance:** Draw a debug wireframe box on target cell.

**I2. Mine & place**

* Left click: set hit block to AIR; Right click: set place cell to selected block id.
* After edit: mark involved chunk (and neighbor if boundary face) “dirty” → re‑mesh queue.
  **Acceptance:** Edits appear immediately; adjacent faces appear/disappear as expected.

**I3. Hotbar & selected block**

* UI: show 9 slots; number keys 1–9 switch.
* Default items: grass, dirt, stone.
  **Acceptance:** Selected block changes; right‑click places that block.

---

### Phase J — UI, HUD, Debug

**J1. Zustand store**

* `/state/ui.ts`: fps, crosshair toggle, selectedSlot, debug toggles, pause state.
* Engine updates fps into store every 0.5s.
  **Acceptance:** HUD reads from store; no React ↔ engine cycles.

**J2. HUD overlays**

* Crosshair (simple CSS), hotbar, minimal debug panel (F3).
  **Acceptance:** F3 shows player pos, chunk pos, loaded chunk count, tri count, ms/frame.

**J3. Pause menu**

* ESC toggles pause: stops updating player input but keeps render; show menu with options (noclip, regen world, wireframe).
  **Acceptance:** Paused state blocks movement; toggles apply.

---

### Phase K — Persistence

**K1. Save seed & settings**

* `/persist/settings.ts`: save/load to IndexedDB via `idb-keyval`: `seed`, `flags`.
  **Acceptance:** Refresh keeps seed/flags.

**K2. Save block overrides**

* Sparse format: for each edited block, key by world coord or per‑chunk bucket:

  * `overrides[chunkKey] = Array<{lx,ly,lz,id}>`.
* Load overrides on chunk ready and merge before meshing.
  **Acceptance:** Place/edit few blocks; refresh; edits persist.

---

### Phase L — Streaming & Lifecycle

**L1. Chunk streamer**

* Based on player position, compute a **wanted set** of chunk keys in radius `R`.
* Request gen+mesh for missing; unload far chunks (remove meshes, keep overrides only).
* Budget requests per frame to avoid spikes.
  **Acceptance:** As you walk, new terrain streams in; old chunks unload behind you.

**L2. Neighbor‑aware meshing**

* When a chunk arrives, if neighbors exist, mesh with correct seam checks.
* On neighbor arrival, re‑mesh both to fix seams.
  **Acceptance:** Seam holes largely disappear moments after neighbors load.

---

### Phase M — Performance & Workers

**M1. Worker pool**

* Fixed pool size (e.g., 2 gen, 2 mesh workers).
* Round‑robin or queue based on type.
  **Acceptance:** Under load, UI remains responsive; no long main‑thread stalls.

**M2. Geometry reuse**

* Reuse `BufferGeometry` objects per chunk where possible by updating buffers.
  **Acceptance:** GC pressure drops (verify via perf overlay).

**M3. Backpressure on edits**

* Debounce multiple edits affecting the same chunk into a single re‑mesh.
  **Acceptance:** Spamming place/remove doesn’t freeze the app.

---

### Phase N — Visual polish (lightweight)

**N1. Day/Night cycle (visual only)**

* Animate directional light intensity/color and sky color over a 20‑minute loop. No per‑block light.
  **Acceptance:** Ambient changes over time; toggle in debug.

**N2. Fog**

* Add linear fog matching background to hide far LOD edges.
  **Acceptance:** Chunks fade into fog; far clipping less jarring.

**N3. Transparent blocks (optional)**

* Add `leaves` as `opaque=false`, `solid=true` (or false if you want to walk through).
* Render order: keep a separate material for transparent; draw after opaque. (No sorting per face v1.)
  **Acceptance:** Leaves look okay; minor artifacts acceptable.

---

### Phase O — Optional optimizations

**O1. Greedy meshing toggle**

* Implement greedy merge per face axis for quads of same block/uv.
  **Acceptance:** Triangle count drops significantly on flat areas.

**O2. Frustum culling per chunk**

* Do a simple AABB vs camera frustum test to skip rendering unseen chunks.
  **Acceptance:** Perf improves when looking at the sky/ground.

**O3. Simple LOD (optional)**

* Beyond radius R/2, skip top/bottom faces (or use coarser mesh).
  **Acceptance:** Minor visual change; perf improves on wide views.

---

## Critical Algorithms (minimal pseudocode — safe to hand the agent)

**World ↔ Chunk mapping:**

```
floorDiv(n,d) = Math.floor(n/d) if n>=0 else -Math.ceil(Math.abs(n)/d)
euclidMod(n,d) = ((n % d) + d) % d

cx = floorDiv(x, sx)
lx = euclidMod(x, sx)
... same for y,z
```

**Flatten index:**

```
index(lx,ly,lz) = ly*(sx*sz) + lz*sx + lx
```

**Face visibility check:**

```
emitFace if neighborBlock.opaque === false
```

**Raycast DDA:**

```
tMaxX/Y/Z = next voxel boundary distances from ray origin
tDeltaX/Y/Z = distance between boundaries
stepX/Y/Z = sign(dir)
loop steps up to maxDistance:
  choose axis with smallest tMax*
  advance that axis by 1 voxel and tMax* += tDelta*
  if voxel is solid -> hit
```

---

## Guardrails for the Agent (so it doesn’t drift)

* **Never import React inside `/engine`**.
* **Never reference Three.js from workers** (workers are headless).
* **All chunk math uses the shared helpers** (no ad‑hoc `%`).
* **Block ID 0 is AIR forever**.
* **All public functions documented with Inputs/Outputs/Side‑effects**.
* **Every new module gets a 3‑line header: purpose, callers, invariants**.
* **Add a tiny test** when you add math/coords utils (keeps the floorDiv truth intact).

---

## Concrete Prompts (copy/paste to your coding agent)

Below are granular “do this, then stop” tasks with deliverables & checks. They map to the phases above. Use them one by one.

### Bootstrapping

1. **Task A1**: Initialize Vite React TS project, install deps (`three`, `zustand`, `simplex-noise`, `idb-keyval`, `vitest`, `@types/…`). Add ESLint + Prettier.
   **Deliverables**: working dev server; scripts: `dev`, `build`, `preview`, `test`, `typecheck`.
   **Check**: run all scripts; no TS errors.

2. **Task A2**: Create folder structure exactly as listed. Add `constants.ts` with `CHUNK_SIZE={16,64,16}`, `PLAYER={height:1.8,width:0.6,speed:{walk:4,sprint:6},jump:8,gravity:-24}`; `flags.ts` as in §12.
   **Check**: import constants in a dummy file; `tsc` passes.

3. **Task A3**: Implement `CanvasHost` and engine bootstrap stub (`Engine.start/stop`). Canvas fills viewport; resize on window resize.
   **Check**: console logs `Engine tick dt=…`.

### Rendering

4. **Task B1**: Implement `/engine/render/Renderer.ts` wrapper around `THREE.WebGLRenderer` using the provided canvas. Add `setSize` and `render(scene,camera)`.
   **Check**: background clears each frame.

5. **Task B2**: Add `SceneBuilder` with ambient + directional light; `createCamera` (fov 70). Wire into engine; render loop draws the scene.
   **Check**: no content yet, but running.

6. **Task B3**: Implement `Atlas` with stubbed 1×1 texture; export `loadAtlas()` returning `texture` and atlas metadata.
   **Check**: material can be created from the texture without errors.

### Math & World Core

7. **Task C1**: Implement `coords.ts` with `floorDiv`, `euclidMod`, `worldToChunk`, `chunkKey`. Add Vitest covering negative coords.
   **Check**: tests pass.

8. **Task D1**: Implement `BlockRegistry` with four blocks (`air`, `grass`, `dirt`, `stone`). Invariants: `air.id===0`, `air.opaque=false`, `air.solid=false`.
   **Check**: unit tests for registry lookup.

9. **Task D2**: Implement `Chunk` with `voxels: Uint8Array` and `get/set`. Include flatten index helpers.
   **Check**: set/get edges work.

10. **Task D3**: Implement `World` manager (`Map<ChunkKey, Chunk>`) with events `CHUNK_ADDED`, `BLOCK_CHANGED`.
    **Check**: event fires on set across chunk boundaries.

### Workers & Pipeline

11. **Task E1**: Add `/types/workers.ts` message types and guards.
    **Check**: compile ok.

12. **Task E2**: Add `generator.worker.ts` that creates empty `ChunkData` filled with AIR. Wire `ChunkPipeline` to request gen for `{0,0,0}` on boot.
    **Check**: logs “chunk ready” for origin.

13. **Task E3**: Add `mesher.worker.ts` skeleton returning empty mesh buffers. Add `ChunkRenderer` to listen for `CHUNK_MESH` and insert a placeholder `Mesh` (e.g., a simple BoxGeometry at origin just to validate plumbing).
    **Check**: box visible; then remove the placeholder.

### Real Terrain & Meshing

14. **Task F1**: In generator worker, seed `simplex-noise`, implement heightmap fill for voxels in chunk world coords.
    **Check**: read back a few sample y to ensure layering.

15. **Task G1**: Implement naive meshing with face culling. Build typed arrays for positions/normals/uvs/indices. Transfer buffers.
    **Check**: terrain renders as cubes; fps > 60 on a few chunks.

16. **Task G2**: Replace stub atlas with your real `/assets/textures/atlas.png` + `/atlas.json`. Apply nearest filters; compute UVs from tile coordinates.
    **Check**: grass/dirt/stone textures appear correctly per face.

### Player & Physics

17. **Task H1**: Implement pointer lock and mouse look; yaw/pitch stored in engine; clamp pitch.
    **Check**: free look works.

18. **Task H2**: Implement WASD movement with delta time; temporary floor at y=0.
    **Check**: moves consistently regardless of fps.

19. **Task H3**: Implement AABB collisions against solid blocks using axis‑separated sweep.
    **Check**: stand on terrain, slide on walls.

20. **Task H4**: Implement jump (grounded check).
    **Check**: jump height roughly consistent.

### Interaction & UI

21. **Task I1**: Implement voxel DDA raycast to select target block and adjacent placement cell.
    **Check**: draw wireframe on target cell (debug material).

22. **Task I2**: Left click remove, right click place selected block; schedule re‑mesh for affected chunks (current + neighbor if face on boundary).
    **Check**: edits reflect immediately; seams correct.

23. **Task I3**: Implement Zustand UI store; HUD with crosshair, hotbar, debug F3 overlay.
    **Check**: 9‑slot hotbar; number keys switch selection.

### Persistence & Streaming

24. **Task K1**: Save/load `seed` and UI settings via IndexedDB.
    **Check**: refresh keeps seed.

25. **Task K2**: Implement per‑chunk overrides save/load; merge overrides into `ChunkData` when chunk becomes ready (before meshing).
    **Check**: edits persist across refresh.

26. **Task L1**: Implement chunk streamer: compute wanted set around player; enqueue gen/mesh; unload far chunks (remove mesh; keep overrides).
    **Check**: walking streams terrain; resource usage stable.

27. **Task L2**: Neighbor‑aware re‑meshing when new neighbor arrives on any side.
    **Check**: seam holes vanish after neighbor mesh.

### Perf & Polish

28. **Task M1**: Worker pool for generator/mesher; cap concurrency; simple FIFO queues.
    **Check**: main thread never spikes > 16ms in typical movement.

29. **Task M2**: Reuse geometries; update attribute arrays instead of reallocating.
    **Check**: GC pauses reduced per perf panel.

30. **Task N1**: Day/night: animate directional light & background; toggle via UI.
    **Check**: cycle visible; toggle works.

31. **Task N2**: Add fog matching background; set far plane appropriately.
    **Check**: distant chunks fade.

32. **Task O1 (optional)**: Greedy meshing behind a flag; verify visually + tri count.
    **Check**: triangles reduced; no UV seams.

33. **Task O2 (optional)**: Frustum culling per chunk AABB.
    **Check**: perf improves when looking away from dense terrain.

---

## Common Pitfalls (call these out to the agent)

* **Negative coords**: always use `euclidMod` for local indices; `%` alone is wrong for negatives.
* **Raycast off‑by‑ones**: return both `hitCell` and `placeCell`. Place into `placeCell`, not `hitCell`.
* **Chunk seam visibility**: treat missing neighbors as unknown → either wait or re‑mesh when neighbor arrives.
* **UV bleeding**: add 0.5‑pixel inset when computing UVs from atlas to avoid sampling edges when minifying.
* **Physics tunneling**: with high fps it’s fine; if sprinting causes tunneling, clamp per‑frame max delta or use substeps (2 per frame).

---

## Minimal Block Set (atlas tiles)

* `air` (reserved id 0)
* `grass` (top, bottom=dirt, sides=grass\_side)
* `dirt` (all)
* `stone` (all)
* Optional later: `sand`, `log` (top/bottom bark\_cross, sides bark), `leaves` (transparent).

---

## Definition of Done (v1)

* Move, look, jump with solid collisions.
* Place/remove blocks with immediate visual update.
* Terrain streams within a radius; seams heal when neighbors arrive.
* Texture atlas, pixelated filtering.
* Save/load seed & edits.
* UI: crosshair, hotbar, F3 debug.
* Smooth 60fps on a modest laptop at radius \~6.

---

You’ve got a clean skeleton here: engine outside React, strict data contracts, chunk math that won’t betray you at negative coords, and a worker pipeline that scales. Feed the tasks in order; don’t skip around. If you want, I can tailor the atlas JSON schema or the exact `BlockDef` fields to match the textures you plan to use.