# World sizing

## Player-facing choices

The start screen exposes six named world footprints through `WorldSizePicker`,
not a native selector menu:

| Name | Footprint | Total chunks |
| --- | ---: | ---: |
| tiny | 3×3 | 9 |
| small | 5×5 | 25 |
| medium | 7×7 | 49 |
| large | 9×9 | 81 |
| extra large | 11×11 | 121 |
| full world | 13×13 | 169 |

The picker is a responsive radio grid. Each tile shows the footprint directly,
supports pointer and keyboard selection, and keeps the current choice visible
while the new-world flow is idle.

## Fixed chunk contract

Chunk dimensions are no longer player-configurable. The build uses the large
`64×128×64` `CHUNK_SIZE` from `src/config/constants.ts` for generation,
meshing, coordinates, rendering, and save validation. Save payloads retain
`settings.chunkSize` so the loader can reject files produced by an incompatible
build, but the UI does not store or change that value.

`src/shared/worldSizes.ts` is the single source of truth for the named choices.
The Zustand store normalizes its internal chunk count to that set, the engine
uses the same mapping for bounds and startup keys, and the load path rejects
save files whose world footprint is not one of the six supported choices.
