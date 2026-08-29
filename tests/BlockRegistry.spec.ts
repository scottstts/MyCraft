/**
 * Unit tests for BlockRegistry
 * Validates block definitions, invariants, and lookup functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BlockRegistry, getBlock, getBlockIdByName } from '../src/engine/world/blocks/BlockRegistry';

const DEFAULT_BLOCK_NAMES = [
  'air',
  'grass',
  'dirt',
  'stone',
  'sand',
  'water',
  'wood',
  'leaves',
  'leaves_maple',
  'grass_tuft',
] as const;

describe('BlockRegistry', () => {
  let registry: BlockRegistry;

  beforeEach(() => {
    registry = new BlockRegistry();
  });

  describe('Basic functionality', () => {
    it('should have AIR block with id 0', () => {
      const air = registry.getBlock(0);
      expect(air).toBeDefined();
      expect(air!.id).toBe(0);
      expect(air!.name).toBe('air');
    });

    it('should have AIR block as non-opaque and non-solid', () => {
      const air = registry.getBlock(0);
      expect(air!.opaque).toBe(false);
      expect(air!.solid).toBe(false);
    });

    it('should have grass, dirt, and stone blocks', () => {
      const grass = registry.getBlock(1);
      const dirt = registry.getBlock(2);
      const stone = registry.getBlock(3);

      expect(grass).toBeDefined();
      expect(grass!.name).toBe('grass');
      expect(grass!.opaque).toBe(true);
      expect(grass!.solid).toBe(true);

      expect(dirt).toBeDefined();
      expect(dirt!.name).toBe('dirt');
      expect(dirt!.opaque).toBe(true);
      expect(dirt!.solid).toBe(true);

      expect(stone).toBeDefined();
      expect(stone!.name).toBe('stone');
      expect(stone!.opaque).toBe(true);
      expect(stone!.solid).toBe(true);
    });

    it('should return undefined for non-existent block IDs', () => {
      const nonExistent = registry.getBlock(999);
      expect(nonExistent).toBeUndefined();
    });
  });

  describe('Name lookup', () => {
    it('should find block ID by name', () => {
      expect(registry.getBlockIdByName('air')).toBe(0);
      expect(registry.getBlockIdByName('grass')).toBe(1);
      expect(registry.getBlockIdByName('dirt')).toBe(2);
      expect(registry.getBlockIdByName('stone')).toBe(3);
    });

    it('should return undefined for non-existent block names', () => {
      expect(registry.getBlockIdByName('nonexistent')).toBeUndefined();
    });
  });

  describe('Registry validation', () => {
    it('should validate successfully with default blocks', () => {
      expect(() => registry.validate()).not.toThrow();
    });

    it('should have correct block count', () => {
      expect(registry.getBlockCount()).toBe(DEFAULT_BLOCK_NAMES.length);
    });

    it('should check if block exists', () => {
      expect(registry.hasBlock(0)).toBe(true);
      expect(registry.hasBlock(1)).toBe(true);
      expect(registry.hasBlock(999)).toBe(false);
    });
  });

  describe('Block faces configuration', () => {
    it('should have different face textures for grass', () => {
      const grass = registry.getBlock(1);
      expect(grass!.faces.top).toBe('grass_top');
      expect(grass!.faces.bottom).toBe('dirt');
      expect(grass!.faces.side).toBe('grass_side');
    });

    it('should have uniform faces for dirt and stone', () => {
      const dirt = registry.getBlock(2);
      const stone = registry.getBlock(3);

      expect(dirt!.faces.all).toBe('dirt');
      expect(stone!.faces.all).toBe('cobblestone');
    });
  });

  describe('Convenience functions', () => {
    it('should work with global getBlock function', () => {
      const air = getBlock(0);
      expect(air).toBeDefined();
      expect(air!.name).toBe('air');
    });

    it('should work with global getBlockIdByName function', () => {
      const grassId = getBlockIdByName('grass');
      expect(grassId).toBe(1);
    });
  });

  describe('getAllBlocks', () => {
    it('should return all registered blocks', () => {
      const allBlocks = registry.getAllBlocks();
      expect(allBlocks).toHaveLength(DEFAULT_BLOCK_NAMES.length);
      
      const names = allBlocks.map(block => block.name);
      expect(names).toEqual(DEFAULT_BLOCK_NAMES);
    });
  });
});
