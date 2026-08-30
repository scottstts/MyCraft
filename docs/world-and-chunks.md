# World and chunks

## World authority

`World` owns the loaded `Map<ChunkKey, Chunk>`, the world seed, coordinate conversion, block reads/writes, chunk events, and flooded-air marks. `worldToChunk()` and `chunkKey()` are the only coordinate mapping used by the world-facing systems. A missing chunk is not silently created by a block read; reads return air, while collision treats an unloaded region conservatively to avoid falling through during streaming.

`Chunk` stores a validated flat `Uint8Array` using the build-time `CHUNK_SIZE` from `src/config/constants.ts` (currently 48×96×48). Local coordinate validation and flattening live in `src/engine/world/chunk`. Save loading rejects a payload whose chunk dimensions do not match this constant.

## Worker pipeline

`ChunkPipeline` owns two module workers:

- the generator worker produces `ChunkData` from coordinates, seed, and world radius;
- the mesher worker turns chunk data plus available neighbors into renderable geometry using the atlas and block registry.

The pipeline caches chunk data so neighboring chunks can be remeshed when a shared boundary becomes available. Its public events are:

| Event | Meaning |
| --- | --- |
| `CHUNK_READY` | Voxel data is available to `World` |
| `CHUNK_MESH` | Worker geometry is ready for `ChunkRenderer` |
| `WORKER_ERROR` | A worker failed or returned data that could not be handled |

Saved chunks use `ingestChunkData()` and follow the same meshing/event path as generated chunks. This avoids maintaining a separate renderer for restored worlds.

## Mesh publication and edits

`Engine` queues `CHUNK_MESH` responses and applies selected responses at the beginning of a frame. Neighboring pending meshes are co-applied where possible; otherwise an item is released after a short frame-age threshold. This prevents a worker response from mutating geometry between the depth and color passes.

Mining and placing update `World` first, then request remeshes for the affected chunk and relevant neighbors. `ChunkRenderer` reuses its scene group and resident mesh resources when possible, so an edit replaces geometry without rebuilding unrelated render state.

## Startup and cleanup

The engine derives the expected square chunk set from the configured total count and world bounds. Startup waits for both data and mesh events for that set, then flushes the initial render queue before exposing gameplay. A worker error rejects this gate with stage context. `World.destroy()` terminates both workers and clears its loaded chunks; the engine calls it during every stop path.
