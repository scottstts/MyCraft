# World and chunks

## World authority

`World` owns the loaded `Map<ChunkKey, Chunk>`, the world seed, coordinate conversion, block reads/writes, chunk events, and flooded-air marks. `worldToChunk()` and `chunkKey()` are the only coordinate mapping used by the world-facing systems. A missing chunk is not silently created by a block read; reads return air, while collision treats an unloaded region conservatively to avoid falling through during streaming.

`Chunk` stores a validated flat `Uint8Array` using the build-time `CHUNK_SIZE` from `src/config/constants.ts` (currently 64×128×64, the fixed large chunk layout). Local coordinate validation and flattening live in `src/engine/world/chunk`. Save loading rejects a payload whose chunk dimensions do not match this constant.

The player selects one of six named odd-square world footprints (3×3 through
13×13 chunks). The mapping lives in `src/shared/worldSizes.ts`; `Engine` uses
it to derive world bounds and the expected startup chunk keys.

## Worker pipeline

`ChunkPipeline` owns two module workers:

- the generator worker produces `ChunkData` from coordinates, seed, and world radius;
- the mesher worker turns worker-owned chunk data plus available neighbors into renderable geometry using the atlas and block registry.

The mesher receives one `INIT_MESHER` message for immutable atlas/registry state,
one `STORE_CHUNK` message per synchronized voxel array, and then key-only
`MESH_CHUNK` messages. It owns the neighbor cache, so mesh jobs no longer
structured-clone the current chunk, six neighbors, or configuration. Removed
chunks receive `REMOVE_CHUNK` and loaded-neighbour boundaries are refreshed.
The main-thread pipeline keeps only the loaded key set; `World` remains the
authoritative mutable `Chunk` store.

Its public events are:

| Event | Meaning |
| --- | --- |
| `CHUNK_READY` | Voxel data is available to `World` |
| `CHUNK_MESH` | Worker geometry is ready for `ChunkRenderer` |
| `WORKER_ERROR` | A worker failed or returned data that could not be handled |

Saved chunks use `ingestChunkData()` and follow the same meshing/event path as generated chunks. This avoids maintaining a separate renderer for restored worlds. Generated chunks may include compact local grass-tuft positions; `Chunk` uses that metadata for billboard instancing until a voxel edit invalidates it, then the grass system falls back to its direct array.

## Mesh publication and edits

`Engine` queues `CHUNK_MESH` responses and applies selected responses at the beginning of a frame. Neighboring pending meshes are co-applied where possible; otherwise an item is released after a short frame-age threshold. This prevents a worker response from mutating geometry between the depth and color passes.

Mining and placing update `World` first, then request remeshes for the affected chunk and relevant neighbors. Before startup is exposed, `ChunkRenderer` compiles the complete initial terrain into 2×2 chunk render regions. It retains the authoritative response buffers by chunk, so an edit rebuilds only the one affected region while neighboring regions keep their mesh resources and draw identity.

The mesher performs a count pass followed by an exact typed-array fill pass.
Face visibility and AO/topology rules are shared by both passes; output buffers
are allocated once at their final sizes.

## Startup and cleanup

The engine derives the expected square chunk set from the configured total count and world bounds. It opens an initial batch, ingests all expected data, and only then posts one mesh job per chunk. Startup waits for both data and mesh events for that set, flushes the initial render queue, and compiles the loaded chunks into 2×2 render regions before exposing gameplay. The authoritative chunk buffers remain indexed for edits and the affected region is rebuilt after a remesh. The voxel shadow volume uses the same startup window to coalesce its full-world brick and macro-brick reduction into one commit; runtime block updates refresh only their touched brick and its macro ancestor. A worker error rejects this gate with stage context. `World.destroy()` terminates both workers and clears its loaded chunks; the engine calls it during every stop path.
