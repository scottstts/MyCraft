/**
 * Block Registry - Manages block definitions and provides lookup functionality.
 * 
 * Maintains invariants:
 * - Block ID 0 is always AIR (non-opaque, non-solid)
 * - All block IDs are contiguous integers 0..n
 * - Thread-safe for read operations
 */

import type { BlockDef, BlockId } from '../../../types/index.js';

export class BlockRegistry {
  private blocks: Map<BlockId, BlockDef> = new Map();
  private nameToId: Map<string, BlockId> = new Map();

  constructor() {
    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    // Define the minimal block set as specified in the dev plan
    const defaultBlocks: BlockDef[] = [
      {
        id: 0,
        name: 'air',
        opaque: false,
        solid: false,
        faces: { all: 'air' } // Placeholder - air doesn't render
      },
      {
        id: 1,
        name: 'grass',
        opaque: true,
        solid: true,
        faces: {
          top: 'grass_top',
          bottom: 'dirt',
          side: 'grass_side'
        }
      },
      {
        id: 2,
        name: 'dirt',
        opaque: true,
        solid: true,
        faces: { all: 'dirt' }
      },
      {
        id: 3,
        name: 'stone',
        opaque: true,
        solid: true,
        faces: { all: 'cobblestone' }
      },
      {
        id: 4,
        name: 'sand',
        opaque: true,
        solid: true,
        faces: { all: 'sand' }
      },
      {
        id: 5,
        name: 'water',
        opaque: false,
        solid: false,
        faces: { all: 'water' }
      },
      {
        id: 6,
        name: 'wood',
        opaque: true,
        solid: true,
        faces: {
          top: 'wood_top',
          bottom: 'wood_top',
          side: 'wood_side',
        }
      },
      {
        id: 7,
        name: 'leaves',
        opaque: true,
        solid: true,
        faces: { all: 'tree_leaves' }
      }
    ];

    // Register all default blocks
    for (const blockDef of defaultBlocks) {
      this.registerBlock(blockDef);
    }

    // Verify AIR invariant
    const air = this.getBlock(0);
    if (!air || air.opaque || air.solid) {
      throw new Error('Block registry invariant violated: AIR (id=0) must be non-opaque and non-solid');
    }
  }

  private registerBlock(blockDef: BlockDef): void {
    // Validate block definition
    if (blockDef.id < 0 || blockDef.id > 255) {
      throw new Error(`Invalid block ID: ${blockDef.id}. Must be 0-255.`);
    }

    if (this.blocks.has(blockDef.id)) {
      throw new Error(`Block ID ${blockDef.id} already registered`);
    }

    if (this.nameToId.has(blockDef.name)) {
      throw new Error(`Block name '${blockDef.name}' already registered`);
    }

    // Register the block
    this.blocks.set(blockDef.id, blockDef);
    this.nameToId.set(blockDef.name, blockDef.id);
  }

  /**
   * Get block definition by ID
   */
  getBlock(id: BlockId): BlockDef | undefined {
    return this.blocks.get(id);
  }

  /**
   * Get block ID by name
   */
  getBlockIdByName(name: string): BlockId | undefined {
    return this.nameToId.get(name);
  }

  /**
   * Get all registered blocks (for iteration)
   */
  getAllBlocks(): BlockDef[] {
    return Array.from(this.blocks.values());
  }

  /**
   * Check if a block ID is registered
   */
  hasBlock(id: BlockId): boolean {
    return this.blocks.has(id);
  }

  /**
   * Get the total count of registered blocks
   */
  getBlockCount(): number {
    return this.blocks.size;
  }

  /**
   * Validate that the registry maintains required invariants
   */
  validate(): void {
    // Check AIR block invariant
    const air = this.getBlock(0);
    if (!air) {
      throw new Error('Registry validation failed: AIR block (id=0) not found');
    }
    if (air.opaque || air.solid) {
      throw new Error('Registry validation failed: AIR block must be non-opaque and non-solid');
    }

    // Check ID contiguity (all IDs from 0 to max should be present)
    const maxId = Math.max(...this.blocks.keys());
    for (let id = 0; id <= maxId; id++) {
      if (!this.blocks.has(id)) {
        throw new Error(`Registry validation failed: Missing block ID ${id} - IDs must be contiguous`);
      }
    }
  }
}

// Global singleton instance
let registry: BlockRegistry | null = null;

/**
 * Get the global block registry instance
 */
export function getBlockRegistry(): BlockRegistry {
  if (!registry) {
    registry = new BlockRegistry();
  }
  return registry;
}

/**
 * Convenience function to get a block by ID
 */
export function getBlock(id: BlockId): BlockDef | undefined {
  return getBlockRegistry().getBlock(id);
}

/**
 * Convenience function to get a block ID by name
 */
export function getBlockIdByName(name: string): BlockId | undefined {
  return getBlockRegistry().getBlockIdByName(name);
}
