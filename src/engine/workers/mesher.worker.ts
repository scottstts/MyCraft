/**
 * Mesher Worker - Creates mesh data from cached chunk voxels using naive face culling
 * Input: INIT_MESHER, STORE_CHUNK, and key-only MESH_CHUNK requests
 * Output: Mesh buffers (positions, normals, uvs, indices)
 */

import type { 
  WorkerRequest, 
  MesherInitRequest,
  StoreChunkRequest,
  MeshChunkRequest,
  RemoveChunkRequest,
  ChunkMeshResponse
} from '../../types/workers.js';
import type { BlockDef, BlockId } from '../../types/index.js';
import type { AtlasConfig } from '../render/Atlas.js';
import {
  isMesherInitRequest,
  isStoreChunkRequest,
  isMeshChunkRequest,
  isRemoveChunkRequest,
} from '../../types/workers.js';
import { CHUNK_SIZE } from '../../config/constants.js';
import { localToIndex } from '../utils/coords.js';
import { MeshBufferWriter } from '../world/MeshBufferWriter.js';
import {
  classifyForwardRefractionMedium,
  FORWARD_REFRACTION_WATER_LEVEL_OFFSET,
  getForwardRefractionIndexBucket,
  type ForwardRefractionIndexBucket,
} from '../world/ForwardRefractionMeshing.js';

// The unified WaterSystem owns the continuous sea-level plane. Water blocks
// remain in World for swimming/flooding/placement, but their duplicate sea
// level top faces must not be rasterized into the chunk mesh.
const WATER_LEVEL = 42;

// Immutable mesher configuration is initialized once per worker.
let blockRegistry = new Map<BlockId, BlockDef>();
let atlasConfig: AtlasConfig | null = null;
const chunkCache = new Map<string, Uint8Array>();

// Face directions (normal vectors)
const FACES = [
  { name: 'front',  dir: [ 0,  0,  1], normal: [ 0,  0,  1] }, // +Z
  { name: 'back',   dir: [ 0,  0, -1], normal: [ 0,  0, -1] }, // -Z
  { name: 'right',  dir: [ 1,  0,  0], normal: [ 1,  0,  0] }, // +X
  { name: 'left',   dir: [-1,  0,  0], normal: [-1,  0,  0] }, // -X
  { name: 'top',    dir: [ 0,  1,  0], normal: [ 0,  1,  0] }, // +Y
  { name: 'bottom', dir: [ 0, -1,  0], normal: [ 0, -1,  0] }, // -Y
];

// Handle messages from main thread
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  
  if (isMesherInitRequest(request)) {
    handleMesherInit(request);
  } else if (isStoreChunkRequest(request)) {
    handleStoreChunk(request);
  } else if (isMeshChunkRequest(request)) {
    handleMeshChunk(request);
  } else if (isRemoveChunkRequest(request)) {
    handleRemoveChunk(request);
  } else {
    console.warn('[MesherWorker] Unknown request type:', request);
  }
};

function handleMesherInit(request: MesherInitRequest): void {
  atlasConfig = request.payload.atlasConfig;
  blockRegistry = new Map();
  for (const block of request.payload.blockRegistry) {
    blockRegistry.set(block.id, block);
  }
  assertMesherConfig();
}

function handleStoreChunk(request: StoreChunkRequest): void {
  const { key, voxels } = request.payload;
  const expectedLength = CHUNK_SIZE.x * CHUNK_SIZE.y * CHUNK_SIZE.z;
  if (voxels.length !== expectedLength) {
    throw new Error(`[MesherWorker] Invalid voxel length for ${key}: expected ${expectedLength}, got ${voxels.length}`);
  }
  // The message is intentionally cloned once into worker-owned storage. The
  // main thread retains its own authoritative Chunk copy for World systems.
  chunkCache.set(key, voxels);
}

function handleRemoveChunk(request: RemoveChunkRequest): void {
  chunkCache.delete(request.payload.key);
}

function handleMeshChunk(request: MeshChunkRequest): void {
  const { key } = request.payload;
  const voxels = chunkCache.get(key);
  if (!voxels) throw new Error(`[MesherWorker] Cannot mesh unsynchronized chunk: ${key}`);

  const neighbors = buildNeighborsForKey(key);
  assertMesherConfig();

  // Build mesh from worker-owned chunk data and its worker-owned neighbours.
  const mesh = buildChunkMesh({ voxels }, neighbors, key);

  const response: ChunkMeshResponse = {
    type: 'CHUNK_MESH',
    key,
    payload: mesh,
  };

  // Transfer the output buffers for performance.
  self.postMessage(response, {
    transfer: [
      ...getMeshTransferBuffers(mesh.opaque),
      ...getMeshTransferBuffers(mesh.cutout),
      ...getMeshTransferBuffers(mesh.transparent),
    ],
  });
}

function getMeshTransferBuffers(mesh: ReturnType<MeshBufferWriter['toBuffers']>): ArrayBuffer[] {
  return [
    mesh.positions.buffer,
    mesh.normals.buffer,
    mesh.uvs.buffer,
    mesh.ao.buffer,
    mesh.indices.buffer,
    mesh.colors.buffer,
    ...Object.values(mesh.forwardIndices ?? {}).map((indices) => indices.buffer),
  ];
}

function assertMesherConfig(): void {
  // Assert atlas config is available and valid
  if (!atlasConfig) {
    throw new Error('[MesherWorker] Atlas config is required but not provided');
  }
  if (!atlasConfig.atlasSize || !atlasConfig.tileSize || !atlasConfig.tiles) {
    throw new Error('[MesherWorker] Invalid atlas config - missing required properties');
  }
}

function buildNeighborsForKey(key: string): {
  posX?: { voxels: Uint8Array };
  negX?: { voxels: Uint8Array };
  posY?: { voxels: Uint8Array };
  negY?: { voxels: Uint8Array };
  posZ?: { voxels: Uint8Array };
  negZ?: { voxels: Uint8Array };
} {
  const [cxText, cyText, czText] = key.split(',');
  const cx = parseInt(cxText, 10) || 0;
  const cy = parseInt(cyText, 10) || 0;
  const cz = parseInt(czText, 10) || 0;
  const data = (cxOffset: number, cyOffset: number, czOffset: number): { voxels: Uint8Array } | undefined => {
    const voxels = chunkCache.get(`${cx + cxOffset},${cy + cyOffset},${cz + czOffset}`);
    return voxels ? { voxels } : undefined;
  };
  return {
    posX: data(1, 0, 0),
    negX: data(-1, 0, 0),
    posY: data(0, 1, 0),
    negY: data(0, -1, 0),
    posZ: data(0, 0, 1),
    negZ: data(0, 0, -1),
  };
}

function buildChunkMesh(chunkData: { voxels: Uint8Array }, neighbors: {
  posX?: { voxels: Uint8Array };
  negX?: { voxels: Uint8Array };
  posY?: { voxels: Uint8Array };
  negY?: { voxels: Uint8Array };
  posZ?: { voxels: Uint8Array };
  negZ?: { voxels: Uint8Array };
} | undefined, key: string) {
  // Count visible faces without allocating mesh storage, then fill exact-size
  // typed arrays in a second pass. Both passes use the same topology rules.
  const opaqueCounts = new MeshBufferWriter();
  const cutoutCounts = new MeshBufferWriter();
  const transparentCounts = new MeshBufferWriter();
  meshChunkPass(chunkData, neighbors, key, opaqueCounts, cutoutCounts, transparentCounts);

  const opaque = new MeshBufferWriter(
    opaqueCounts.getFaceCount(),
    opaqueCounts.getForwardIndexCounts(),
  );
  const cutout = new MeshBufferWriter(
    cutoutCounts.getFaceCount(),
    cutoutCounts.getForwardIndexCounts(),
  );
  const transparent = new MeshBufferWriter(
    transparentCounts.getFaceCount(),
    transparentCounts.getForwardIndexCounts(),
  );
  meshChunkPass(chunkData, neighbors, key, opaque, cutout, transparent);
  return {
    opaque: opaque.toBuffers(),
    cutout: cutout.toBuffers(),
    transparent: transparent.toBuffers(),
  };
}

function meshChunkPass(
  chunkData: { voxels: Uint8Array },
  neighbors: {
    posX?: { voxels: Uint8Array };
    negX?: { voxels: Uint8Array };
    posY?: { voxels: Uint8Array };
    negY?: { voxels: Uint8Array };
    posZ?: { voxels: Uint8Array };
    negZ?: { voxels: Uint8Array };
  } | undefined,
  key: string,
  opaqueWriter: MeshBufferWriter,
  cutoutWriter: MeshBufferWriter,
  transparentWriter: MeshBufferWriter,
): void {
  const [cxStr, cyStr, czStr] = key.split(',');
  const cx = parseInt(cxStr, 10) || 0;
  const cy = parseInt(cyStr, 10) || 0;
  const cz = parseInt(czStr, 10) || 0;

  for (let ly = 0; ly < CHUNK_SIZE.y; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE.z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE.x; lx++) {
        const voxelIndex = localToIndex(lx, ly, lz);
        const blockId = chunkData.voxels[voxelIndex];
        if (blockId === 0) continue;

        const block = blockRegistry.get(blockId);
        if (!block || block.name === 'grass_tuft') continue;
        const currentIsLeaf = isLeafBlock(block);
        const gx = cx * CHUNK_SIZE.x + lx;
        const gy = cy * CHUNK_SIZE.y + ly;
        const gz = cz * CHUNK_SIZE.z + lz;
        if (block.name === 'water' && gy === WATER_LEVEL) continue;

        const tint = getTintJitter(gx, gy, gz);
        for (const face of FACES) {
          if (block.name === 'water' && face.name !== 'top') continue;
          const rot = getUVRotation(block.name, face.name, gx, gy, gz);
          const neighborX = lx + face.dir[0];
          const neighborY = ly + face.dir[1];
          const neighborZ = lz + face.dir[2];
          let shouldRenderFace = false;

          if (neighborX < 0 || neighborX >= CHUNK_SIZE.x ||
              neighborY < 0 || neighborY >= CHUNK_SIZE.y ||
              neighborZ < 0 || neighborZ >= CHUNK_SIZE.z) {
            let neighborOpaque = false;
            let neighborIsLeaf = false;
            if (neighbors) {
              if (neighborX === -1 && neighbors.negX) {
                const nIndex = localToIndex(CHUNK_SIZE.x - 1, ly, lz);
                const nDef = blockRegistry.get(neighbors.negX.voxels[nIndex]);
                neighborOpaque = !!(nDef && nDef.opaque);
                neighborIsLeaf = isLeafBlock(nDef);
              } else if (neighborX === CHUNK_SIZE.x && neighbors.posX) {
                const nIndex = localToIndex(0, ly, lz);
                const nDef = blockRegistry.get(neighbors.posX.voxels[nIndex]);
                neighborOpaque = !!(nDef && nDef.opaque);
                neighborIsLeaf = isLeafBlock(nDef);
              } else if (neighborZ === -1 && neighbors.negZ) {
                const nIndex = localToIndex(lx, ly, CHUNK_SIZE.z - 1);
                const nDef = blockRegistry.get(neighbors.negZ.voxels[nIndex]);
                neighborOpaque = !!(nDef && nDef.opaque);
                neighborIsLeaf = isLeafBlock(nDef);
              } else if (neighborZ === CHUNK_SIZE.z && neighbors.posZ) {
                const nIndex = localToIndex(lx, ly, 0);
                const nDef = blockRegistry.get(neighbors.posZ.voxels[nIndex]);
                neighborOpaque = !!(nDef && nDef.opaque);
                neighborIsLeaf = isLeafBlock(nDef);
              } else if (neighborY === -1 && neighbors.negY) {
                const nIndex = localToIndex(lx, CHUNK_SIZE.y - 1, lz);
                const nDef = blockRegistry.get(neighbors.negY.voxels[nIndex]);
                neighborOpaque = !!(nDef && nDef.opaque);
                neighborIsLeaf = isLeafBlock(nDef);
              } else if (neighborY === CHUNK_SIZE.y && neighbors.posY) {
                const nIndex = localToIndex(lx, 0, lz);
                const nDef = blockRegistry.get(neighbors.posY.voxels[nIndex]);
                neighborOpaque = !!(nDef && nDef.opaque);
                neighborIsLeaf = isLeafBlock(nDef);
              }
            }
            shouldRenderFace = !neighborOpaque || currentIsLeaf || neighborIsLeaf;
          } else {
            const neighborIndex = localToIndex(neighborX, neighborY, neighborZ);
            const neighborBlock = blockRegistry.get(chunkData.voxels[neighborIndex]);
            shouldRenderFace = !neighborBlock || !neighborBlock.opaque ||
              currentIsLeaf || isLeafBlock(neighborBlock);
          }

          if (!shouldRenderFace) continue;
          if (block.opaque) {
            const forwardBucket = getForwardRefractionBucket(face.name, gy, currentIsLeaf);
            addFaceQuad(
              lx, ly, lz, gx, gy, gz, face, block,
              currentIsLeaf ? cutoutWriter : opaqueWriter,
              chunkData,
              neighbors,
              rot, tint, forwardBucket,
            );
          } else {
            addFaceQuad(
              lx, ly, lz, gx, gy, gz, face, block,
              transparentWriter,
              chunkData,
              neighbors,
              0, 1.0,
            );
          }
        }
      }
    }
  }
}

interface Face {
  name: string;
  dir: number[];
  normal: number[];
}

function addFaceQuad(
  lx: number, ly: number, lz: number,
  gx: number, gy: number, gz: number,
  face: Face,
  block: BlockDef,
  writer: MeshBufferWriter,
  chunkData: { voxels: Uint8Array },
  neighbors: {
    posX?: { voxels: Uint8Array };
    negX?: { voxels: Uint8Array };
    posY?: { voxels: Uint8Array };
    negY?: { voxels: Uint8Array };
    posZ?: { voxels: Uint8Array };
    negZ?: { voxels: Uint8Array };
  } | undefined,
  uvRotation: number,
  tintJitter: number,
  forwardBucket?: ForwardRefractionIndexBucket,
): void {
  if (writer.isCounting) {
    writer.addFaceCount(forwardBucket);
    return;
  }

  const [nx, ny, nz] = face.normal;
  
  // Get UV coordinates for this face
  const [tileU, tileV] = getFaceUV(block, face.name, gx, gy, gz);
  
  // Define quad vertices based on face direction
  let quad: Array<readonly [number, number, number]>;
  
  switch (face.name) {
    case 'front': // +Z
      quad = [
        [lx,     ly,     lz + 1],
        [lx + 1, ly,     lz + 1],
        [lx + 1, ly + 1, lz + 1],
        [lx,     ly + 1, lz + 1]
      ];
      break;
    case 'back': // -Z
      quad = [
        [lx + 1, ly,     lz],
        [lx,     ly,     lz],
        [lx,     ly + 1, lz],
        [lx + 1, ly + 1, lz]
      ];
      break;
    case 'right': // +X
      quad = [
        // Reordered for correct CCW winding when viewed from +X
        [lx + 1, ly,     lz + 1],
        [lx + 1, ly,     lz],
        [lx + 1, ly + 1, lz],
        [lx + 1, ly + 1, lz + 1]
      ];
      break;
    case 'left': // -X
      quad = [
        // Reordered for correct CCW winding when viewed from -X
        [lx, ly,     lz],
        [lx, ly,     lz + 1],
        [lx, ly + 1, lz + 1],
        [lx, ly + 1, lz]
      ];
      break;
    case 'top': // +Y
      quad = [
        [lx,     ly + 1, lz + 1],
        [lx + 1, ly + 1, lz + 1],
        [lx + 1, ly + 1, lz],
        [lx,     ly + 1, lz]
      ];
      break;
    case 'bottom': // -Y
      quad = [
        [lx,     ly, lz],
        [lx + 1, ly, lz],
        [lx + 1, ly, lz + 1],
        [lx,     ly, lz + 1]
      ];
      break;
    default:
      return;
  }
  
  // Add UVs using atlas config
  if (!atlasConfig) {
    throw new Error('[MesherWorker] Atlas config required for UV calculation');
  }
  
  // Our atlas is laid out as atlasSize tiles horizontally and 1 tile vertically
  const tileSizeU = 1 / atlasConfig.atlasSize;
  const tileSizeV = 1; // single row atlas
  const epsilonU = 0.5 / (atlasConfig.atlasSize * atlasConfig.tileSize); // half pixel in U
  const epsilonV = 0.5 / (1 * atlasConfig.tileSize); // half pixel in V
  const u0 = tileU * tileSizeU + epsilonU;
  const v0 = tileV * tileSizeV + epsilonV;
  const u1 = u0 + tileSizeU - 2 * epsilonU;
  const v1 = v0 + tileSizeV - 2 * epsilonV;
  
  // UV coordinates for quad (counter-clockwise), with optional 0/90/180/270 rotation per block
  // Base corners
  const uvBL: [number, number] = [u0, v1];
  const uvBR: [number, number] = [u1, v1];
  const uvTR: [number, number] = [u1, v0];
  const uvTL: [number, number] = [u0, v0];
  let uvOrder: Array<[number, number]> = [uvBL, uvBR, uvTR, uvTL];
  const rot = uvRotation & 3;
  if (rot === 1) {
    // 90 deg: BL->TL, BR->BL, TR->BR, TL->TR
    uvOrder = [uvTL, uvBL, uvBR, uvTR];
  } else if (rot === 2) {
    // 180 deg
    uvOrder = [uvTR, uvTL, uvBL, uvBR];
  } else if (rot === 3) {
    // 270 deg
    uvOrder = [uvBR, uvTR, uvTL, uvBL];
  }
  // Per-vertex ambient occlusion for solid blocks only (skip water)
  const isSolid = !!block.solid && block.name !== 'water';
  const aoTable = [1.0, 0.8, 0.6, 0.45];

  // Neighbor 'air' block position just outside this face
  const bnX = lx + face.dir[0];
  const bnY = ly + face.dir[1];
  const bnZ = lz + face.dir[2];

  // Tangent axes for this face (indices into [x=0,y=1,z=2])
  const t1Axis = (face.name === 'front' || face.name === 'back' || face.name === 'top' || face.name === 'bottom')
    ? (face.name === 'top' || face.name === 'bottom' ? 0 : 0) // X for Z faces; X for Y faces
    : 2; // for left/right faces, t1 is Z
  const t2Axis = (face.name === 'top' || face.name === 'bottom') ? 2
    : (face.name === 'front' || face.name === 'back' ? 1 : 1);

  // Helper to read component by axis
  const comp = (arr: number[], axis: number) => arr[axis];

  // Precompute bn vector
  const bn = [bnX, bnY, bnZ];
  const aoValues: number[] = [];

  // For each vertex, compute AO count from 3 samples (two sides + corner), map to factor
  for (let i = 0; i < 4; i++) {
    // Vertex world-ish coordinates (local to chunk)
    const vx = quad[i][0];
    const vy = quad[i][1];
    const vz = quad[i][2];
    const v = [vx, vy, vz];

    // Decide signs based on which side of the bn this vertex lies along the tangent axes
    const uSign = comp(v, t1Axis) > comp(bn, t1Axis) ? 1 : -1;
    const vSign = comp(v, t2Axis) > comp(bn, t2Axis) ? 1 : -1;

    // Sample positions around bn (the outside cell) in voxel space
    const s1 = [...bn] as number[]; s1[t1Axis] += uSign;
    const s2 = [...bn] as number[]; s2[t2Axis] += vSign;
    const sc = [...bn] as number[]; sc[t1Axis] += uSign; sc[t2Axis] += vSign;

    let aoFactor = 1.0;
    if (isSolid) {
      const oc1 = isOccluding(s1[0], s1[1], s1[2], chunkData, neighbors);
      const oc2 = isOccluding(s2[0], s2[1], s2[2], chunkData, neighbors);
      const ocC = isOccluding(sc[0], sc[1], sc[2], chunkData, neighbors);
      let occ = 0;
      if (oc1) occ++;
      if (oc2) occ++;
      if (ocC && !(oc1 && oc2)) occ++;
      aoFactor = aoTable[occ];
    }

    // Keep tint separate from ambient visibility so direct sun lighting is
    // not darkened by the baked term. The legacy mesher applied a 0.7
    // skylight factor to every opaque voxel; retain that ambient contribution
    // without letting it multiply the direct light.
    aoValues.push(aoFactor * (isSolid ? 0.7 : 1.0));
  }

  writer.addFace(
    quad,
    [nx, ny, nz],
    uvOrder,
    aoValues,
    isSolid ? tintJitter : 1.0,
    forwardBucket,
  );
}

function getForwardRefractionBucket(
  faceName: string,
  blockY: number,
  cutout: boolean,
): ForwardRefractionIndexBucket {
  const minY = faceName === 'top' ? blockY + 1 : blockY;
  const maxY = faceName === 'bottom' ? blockY : blockY + 1;
  const medium = classifyForwardRefractionMedium(
    minY,
    maxY,
    WATER_LEVEL + FORWARD_REFRACTION_WATER_LEVEL_OFFSET,
  );
  return getForwardRefractionIndexBucket(medium, cutout);
}

function getFaceUV(block: BlockDef, faceName: string, gx: number, gy: number, gz: number): [number, number] {
  if (!atlasConfig) {
    throw new Error('[MesherWorker] Atlas config required for UV lookup');
  }

  // Determine which tile key to use for this face
  let tileKey: string;
  switch (faceName) {
    case 'top':
      tileKey = block.faces.top || block.faces.all || 'air';
      break;
    case 'bottom':
      tileKey = block.faces.bottom || block.faces.all || 'air';
      break;
    case 'front':
    case 'back':
    case 'left':
    case 'right':
      tileKey = block.faces.side || block.faces.all || 'air';
      break;
    default:
      tileKey = block.faces.all || 'air';
      break;
  }

  // The base key remains the public material contract. Additional numbered
  // keys are deterministic pattern variants emitted by the procedural atlas.
  // Older atlas configurations with only the base key continue to work.
  const variantKeys = [tileKey];
  for (let variant = 1; variant < 16; variant += 1) {
    const candidate = `${tileKey}_${variant}`;
    if (!atlasConfig.tiles[candidate]) break;
    variantKeys.push(candidate);
  }
  const variantSalt = faceName === 'top' ? 17
    : faceName === 'bottom' ? 31
      : faceName === 'front' ? 43
        : faceName === 'back' ? 59
          : faceName === 'right' ? 71
            : 83;
  const variantHash = isLeafBlock(block)
    ? leafHash32(gx + variantSalt, gy + variantSalt * 3, gz + variantSalt * 7)
    : hash32(gx + variantSalt, gy + variantSalt * 3, gz + variantSalt * 7)
  const variantIndex = variantKeys.length > 1
    ? variantHash % variantKeys.length
    : 0;
  const tileCoords = atlasConfig.tiles[variantKeys[variantIndex]];
  if (!tileCoords) {
    console.warn(`[MesherWorker] Tile key '${tileKey}' not found in atlas config, using fallback`);
    return [0, 0];
  }

  return tileCoords;
}

// --- Helpers for ambient visibility/variation ---

function localInside(x: number, y: number, z: number): boolean {
  return x >= 0 && x < CHUNK_SIZE.x && y >= 0 && y < CHUNK_SIZE.y && z >= 0 && z < CHUNK_SIZE.z;
}

function isLeafBlock(block: BlockDef | undefined): boolean {
  return block?.name === 'leaves' || block?.name === 'leaves_maple';
}

// (helpers removed if unused)

// Lookup occupancy across current chunk and the 6 axis-adjacent neighbors. If the coordinate lies
// in a diagonal neighbor (i.e., needs more than one axis outside), we return false (non-occluding).
function isOccluding(x: number, y: number, z: number, chunkData: { voxels: Uint8Array }, neighbors: {
  posX?: { voxels: Uint8Array };
  negX?: { voxels: Uint8Array };
  posY?: { voxels: Uint8Array };
  negY?: { voxels: Uint8Array };
  posZ?: { voxels: Uint8Array };
  negZ?: { voxels: Uint8Array };
} | undefined): boolean {
  // First, try current chunk if inside; else determine which single-axis neighbor contains it
  let id = -1;
  if (localInside(x, y, z)) {
    id = chunkData.voxels[localToIndex(x, y, z)];
  } else {
    // Determine which axis is out of bounds
    const outX = x < 0 ? -1 : (x >= CHUNK_SIZE.x ? 1 : 0);
    const outY = y < 0 ? -1 : (y >= CHUNK_SIZE.y ? 1 : 0);
    const outZ = z < 0 ? -1 : (z >= CHUNK_SIZE.z ? 1 : 0);
    const outs = Math.abs(outX) + Math.abs(outY) + Math.abs(outZ);
    if (outs > 1) return false; // diagonal neighbor not available
    if (outX === -1 && neighbors?.negX) {
      const lx = CHUNK_SIZE.x - 1;
      const idx = localToIndex(lx, Math.max(0, Math.min(CHUNK_SIZE.y - 1, y)), Math.max(0, Math.min(CHUNK_SIZE.z - 1, z)));
      id = neighbors.negX.voxels[idx];
    } else if (outX === 1 && neighbors?.posX) {
      const lx = 0;
      const idx = localToIndex(lx, Math.max(0, Math.min(CHUNK_SIZE.y - 1, y)), Math.max(0, Math.min(CHUNK_SIZE.z - 1, z)));
      id = neighbors.posX.voxels[idx];
    } else if (outZ === -1 && neighbors?.negZ) {
      const lz = CHUNK_SIZE.z - 1;
      const idx = localToIndex(Math.max(0, Math.min(CHUNK_SIZE.x - 1, x)), Math.max(0, Math.min(CHUNK_SIZE.y - 1, y)), lz);
      id = neighbors.negZ.voxels[idx];
    } else if (outZ === 1 && neighbors?.posZ) {
      const lz = 0;
      const idx = localToIndex(Math.max(0, Math.min(CHUNK_SIZE.x - 1, x)), Math.max(0, Math.min(CHUNK_SIZE.y - 1, y)), lz);
      id = neighbors.posZ.voxels[idx];
    } else if (outY === -1 && neighbors?.negY) {
      const ly = CHUNK_SIZE.y - 1;
      const idx = localToIndex(Math.max(0, Math.min(CHUNK_SIZE.x - 1, x)), ly, Math.max(0, Math.min(CHUNK_SIZE.z - 1, z)));
      id = neighbors.negY.voxels[idx];
    } else if (outY === 1 && neighbors?.posY) {
      const ly = 0;
      const idx = localToIndex(Math.max(0, Math.min(CHUNK_SIZE.x - 1, x)), ly, Math.max(0, Math.min(CHUNK_SIZE.z - 1, z)));
      id = neighbors.posY.voxels[idx];
    } else {
      return false;
    }
  }
  const def = id >= 0 ? blockRegistry.get(id) : undefined;
  return !!(def && def.opaque);
}

function hash32(x: number, y: number, z: number): number {
  // 32-bit mix (xorshift-like)
  let h = (x * 374761393) ^ (y * 668265263) ^ (z * 2147483647);
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

function leafHash32(x: number, y: number, z: number): number {
  // Keep leaf atlas selection bit-identical with the GLSL shadow pass. The
  // generic material hash predates leaf shadow matching and its second
  // multiply is not Math.imul, so its low bits can diverge after rounding.
  let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function getUVRotation(blockName: string, faceName: string, gx: number, gy: number, gz: number): number {
  const faceSalt = faceName === 'top' ? 17
    : faceName === 'bottom' ? 31
      : faceName === 'front' ? 43
        : faceName === 'back' ? 59
          : faceName === 'right' ? 71
            : 83;
  const h = blockName === 'leaves' || blockName === 'leaves_maple'
    ? leafHash32(gx + faceSalt, gy + faceSalt * 3, gz + faceSalt * 7)
    : hash32(gx + faceSalt, gy + faceSalt * 3, gz + faceSalt * 7);

  // Directional materials keep their structural axis. Grass cap and wood
  // growth rings can rotate freely, while their vertical side grain only
  // mirrors by 180 degrees. Unconstrained materials use all quarter turns.
  if (blockName === 'grass' && faceName !== 'top' && faceName !== 'bottom') return 0;
  if (blockName === 'wood' && faceName !== 'top' && faceName !== 'bottom') return (h & 1) * 2;
  return h & 3;
}

function getTintJitter(gx: number, gy: number, gz: number): number {
  const h = hash32(gx + 11, gy + 121, gz + 211);
  const r = (h & 0xffff) / 0xffff; // 0..1
  // ±3% brightness jitter around 1.0
  return 1.0 + (r * 0.06 - 0.03);
}
