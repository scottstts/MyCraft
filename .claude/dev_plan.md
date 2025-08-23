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
    /textures       # your atlas images
    /material_icons # the icon images for materials (shown in hotbar)
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

**G0. Prereqs & fixes (do first)**

* In `Engine.start`, wire:

  ```ts
  world!.chunkPipeline.on('CHUNK_MESH', ({ response }) => {
    chunkRenderer!.handleChunkMesh(response)
  })
  ```

  (Your file currently stops at `world.`).&#x20;
* In `ChunkRenderer.ts`:

  * Remove the local `CHUNK_SIZE` constant and `import { CHUNK_SIZE } from '../../config/constants'`.
  * Parse `cx,cy,cz` from `response.key` and set the group position to `{cx*CHUNK_SIZE.x, cy*CHUNK_SIZE.y, cz*CHUNK_SIZE.z}` when inserting meshes. (You already create `BufferGeometry` from worker buffers—keep that; just add the group positioning.)&#x20;
* Switch material to front-face culling now (it matters immediately once faces exist):

  ```ts
  new THREE.MeshStandardMaterial({ map: atlas, side: THREE.FrontSide })
  ```



**G1. Face-culling mesh builder (worker)**
Implement a pure function `buildChunkMesh(chunkData, neighborhood, registry, atlasMeta)` and call it from the mesher worker. Keep the worker message shape you have; fill the payload arrays instead of returning empties. (You already transfer buffers—keep that.)&#x20;
Rules:

* Skip `AIR` (id 0). Opaque neighbors hide faces. (Registry provides `opaque`.)&#x20;
* **Neighbor policy (fix):** treat **missing neighbor chunk as AIR** so borders render fully and you don’t get holes at edges. When the neighbor arrives, re-mesh both chunks to remove the now-internal faces. (Your plan text said “treat missing as AIR” but the acceptance claimed “holes appear” — that’s inverted; holes only happen if you treat missing as SOLID.)&#x20;
* Emit per-quad: 4 verts, 6 indices, flat normal, and UVs from atlas tile. Build as tightly-packed typed arrays.

Buffers & types:

* Positions, normals, uvs: `Float32Array`. Indices: **`Uint32Array`** to be safe against pathological cases. (Three will use 32-bit indices via WebGL2 or the extension.) Keep your transfer logic.&#x20;
* Use your typed helpers where it actually simplifies growth (optional; correctness over cleverness).&#x20;

Atlas UVs (for G1; you’ll refine in G2):

* Use atlas-tile uv in `[0,1]` normalized space. Add a half-texel inset: `eps = 0.5 / atlasSizePx` to avoid bleeding, and clamp UVs to `[eps, 1-eps]`. (You’ll finalize filters in G2.)

Events:

* Keep your current pipeline: `GEN_CHUNK → CHUNK_DATA → MESH_CHUNK → CHUNK_MESH`. (You already route data to mesher and emit.)

**Acceptance (corrected):** spawn a grid; chunk borders **render** without holes. When a neighbor arrives, you may momentarily have redundant interior faces until a re-mesh. No crashes; buffers transfer. (Originally this acceptance mentioned “holes” — that would imply treating missing as SOLID, which we are not doing.)&#x20;

---

**G2. Atlas: real texture (nearest-neighbor, no bleed)**

* Implement `loadAtlas()` to return a `THREE.Texture` and metadata `{ tileSizePx, atlasSizePx, tiles: Record<string,{u,v}> }`.

  * Set: `minFilter = NearestFilter`, `magFilter = NearestFilter`, `generateMipmaps = false`, `anisotropy = 1`, `wrapS = wrapT = ClampToEdge`.
  * Ensure correct color space (`SRGBColorSpace`) to avoid washed colors in `MeshStandardMaterial`.
  * Keep stub fallback if the image can’t load. (Your stub path exists.)&#x20;
* Define tiles for `grass` (`top`, `side`, `bottom`), `dirt`, `stone`. Map block faces to tiles in the registry so the mesher can pick per-face UVs.&#x20;

**Acceptance:** blocks show correct per-face textures; no shimmering; no seams at tile edges when the camera moves.

---

**G3. ChunkRenderer completion**

* In `handleChunkMesh` you already create `BufferGeometry` from the arrays; ensure:

  * `geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))` et al;
  * `geometry.setIndex(new THREE.BufferAttribute(indices, 1))`;
  * Call `geometry.computeBoundingSphere()` (cheap) and cache a `Box3` per-chunk for culling later.&#x20;
* Create (or reuse) a `THREE.Group` per chunk key. Set group position using parsed `cx,cy,cz` and `CHUNK_SIZE`.
* Emit your own `MESH_CREATED/MESH_UPDATED/MESH_REMOVED` events (you’ve scaffolded the types) so streaming/culling can listen.&#x20;

**Acceptance:** geometry appears at the correct world position for each chunk; replacing a mesh doesn’t leak old objects; no WebGL warnings.

---

### Phase H — Greedy meshing (optional; behind flag)

**H1. Greedy merge in worker (per face-axis)**

* Under `USE_GREEDY_MESH` (already in flags), switch meshing to greedy: for each of the 3 face orientations, build a 2D mask of exposed faces, merge maximal rectangles with identical **block id, face tile, and normal**. Don’t merge across chunk boundaries; don’t merge transparent blocks.&#x20;
* Preserve UVs: for a merged rectangle of size `w×h` tiles, scale UV span accordingly with the same `eps` insetting.
* Keep `Uint32Array` indices. Reuse your transfer code.&#x20;

**H2. Validation**

* Unit-test the pure meshing function (not the worker):

  * Single cube → 6 quads, 12 tris.
  * `2×1×1` touching → 10 quads naive, but **8** with greedy (two faces merged).
  * Solid layer → 2 giant quads top/bottom.
* Visual: toggle flag at runtime (rebuild) and compare draw calls/chunk.

**Acceptance:** vertex/tri count drops materially on typical terrain; visuals identical.

---

### Phase I — Streaming, visibility & remesh hygiene

**I1. View-dependent chunk set**

* From camera world pos → chunk `C3`. Maintain a desired set within `CHUNK_RADIUS` (config). Schedule gen requests; honor your `pendingRequests` set. Evict far chunks (destroy meshes, delete from world).

**I2. Frustum culling**

* Compute frustum from camera each frame; toggle `chunkGroup.visible` based on precomputed `Box3` per chunk (from G3). Keep this cheap; no per-face culling.

**I3. Seam hygiene (neighbor events)**

* When chunk **A** or any of its 6 neighbors become available or change, enqueue a **re-mesh** for **A** (and the changed neighbor) so interior seam faces are culled. Throttle to avoid stampedes while moving.

**Acceptance:** walking around streams chunks smoothly without holes; when you linger at a seam, interior faces get cleaned up within a beat; GPU time remains stable with culling on.

---

### Phase J — Player camera & controls (minimal)

**J1. FPS camera**

* Pointer lock + WASD + mouse look; clamp pitch; smoothing optional.
* Start camera above ground; recenter on chunk changes to avoid tunneling.

**J2. Basic pause & resize**

* Handle escape to unlock; on resize, call renderer `setSize` (you already have a helper) and update camera aspect.&#x20;

**Acceptance:** you can look and move; no runaway delta on tab switches; aspect stays correct.

---

### Phase K — Interaction (raycast DDA) & block edits

**K1. Voxel DDA**

* Implement DDA exactly as specced in the plan (use `worldToChunk`/`localToIndex`—no ad-hoc `%`). Return hit block id and face normal.

**K2. Break/place**

* Left-click: set hit block to AIR; right-click: place held block on the face hit (offset by normal). Apply via `World.setBlock`, then enqueue re-mesh for hit chunk and any affected neighbor if the edit touched an edge.

**Acceptance:** crosshair targets the expected block; break/place updates the mesh within the affected chunk; no desync.

---

### Phase L — Polish (still scoped, no sugar)

**L1. Lighting placeholder**

* Flat vertex colors per face (constant ambient term) to give some depth without real lightmaps. Keep `MeshStandardMaterial` or swap to `MeshLambertMaterial` if you prefer cheaper shading; consistent color space with the atlas.

**L2. Debug HUD & toggles**

* Draw tri/vertex counts per visible chunk; flag to flip naive/greedy; show chunk coords under crosshair.

**L3. Performance passes**

* Verify WebGL2 path uses 32-bit indices; if WebGL1, ensure `OES_element_index_uint` is present; otherwise chunk-split fallback (only if you actually hit the limit).

**Acceptance:** terrain feels alive, no visual crawl/bleed, stable FPS in a 13×13×1 ring.

---

## Notes on risky spots (so you don’t trip later)

* If you leave `DoubleSide` on, you’ll tank fill-rate and fight lighting as soon as normals exist. Flip it now.&#x20;
* Don’t keep a shadow copy of chunk size; import the constant everywhere, including the renderer. Your local constant in `ChunkRenderer.ts` is a silent mismatch risk.
* Your pipeline already fans out `CHUNK_DATA → MESH_CHUNK` and emits `CHUNK_MESH`; finish the last 5% wiring in Engine so chunks actually show up once G1 lands.