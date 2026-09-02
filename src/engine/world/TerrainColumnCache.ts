/**
 * Generator-local terrain column cache.
 *
 * The cache owns one immutable terrain sample per integer XZ coordinate and
 * derives the slope from those same cached heights.  Keeping the field in a
 * dense rectangular array makes repeated terrain reads during grass/tree
 * placement deterministic without reconstructing or re-evaluating noise.
 */

export interface TerrainColumnInput {
  height: number;
  isLand: boolean;
}

export interface TerrainColumn extends TerrainColumnInput {
  slope: number;
}

export interface TerrainColumnBounds {
  /** Inclusive integer bounds. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type TerrainColumnSampler = (x: number, z: number) => TerrainColumn;

function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`[TerrainColumnCache] ${name} must be an integer, got ${value}`);
  }
}

/**
 * Build a cache for a chunk's core plus its required placement halo.
 * `sample` is called exactly once for every coordinate in `bounds`.
 */
export function createTerrainColumnCache(
  sample: (x: number, z: number) => TerrainColumnInput,
  bounds: TerrainColumnBounds,
): TerrainColumnSampler {
  assertInteger(bounds.minX, 'minX');
  assertInteger(bounds.maxX, 'maxX');
  assertInteger(bounds.minZ, 'minZ');
  assertInteger(bounds.maxZ, 'maxZ');
  if (bounds.maxX < bounds.minX || bounds.maxZ < bounds.minZ) {
    throw new Error('[TerrainColumnCache] bounds must be ordered');
  }

  const width = bounds.maxX - bounds.minX + 1;
  const depth = bounds.maxZ - bounds.minZ + 1;
  const columns = new Array<TerrainColumn>(width * depth);
  const indexOf = (x: number, z: number): number =>
    (z - bounds.minZ) * width + (x - bounds.minX);

  for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const source = sample(x, z);
      columns[indexOf(x, z)] = {
        height: source.height,
        isLand: source.isLand,
        slope: 0,
      };
    }
  }

  // All generator queries are covered by the +1 terrain halo supplied by the
  // caller. Clamp only the cache's outermost diagnostic edge so the sampler
  // remains total if it is queried there accidentally.
  for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const column = columns[indexOf(x, z)];
      const xNeighbor = columns[indexOf(Math.min(bounds.maxX, x + 1), z)];
      const zNeighbor = columns[indexOf(x, Math.min(bounds.maxZ, z + 1))];
      column.slope = Math.max(
        Math.abs(xNeighbor.height - column.height),
        Math.abs(zNeighbor.height - column.height),
      );
    }
  }

  return (x: number, z: number): TerrainColumn => {
    if (!Number.isInteger(x) || !Number.isInteger(z) ||
        x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
      throw new RangeError(`[TerrainColumnCache] Coordinate outside cache: (${x}, ${z})`);
    }
    return columns[indexOf(x, z)];
  };
}
