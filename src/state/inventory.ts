/**
 * Module: state/inventory
 * Purpose: Hotbar inventory with 9 slots, stack size 100, Minecraft-like rules
 * Callers: Hotbar UI (read/display), InteractionSystem (add on mine, consume on place)
 */

import { create } from 'zustand';
import { useUIStore } from './ui';

export interface Slot {
  blockId: number | null;
  count: number; // 0..100
}

export interface InventoryState {
  slots: Slot[]; // length 9
  add: (blockId: number, amount?: number) => number; // returns leftover not added
  consumeFromSelected: (amount?: number) => number; // amount actually consumed
  getSelectedBlockId: () => number | null; // null if empty
  clearSelectedIfEmpty: () => void;
}

const SLOT_COUNT = 9;
export const MAX_STACK = 100;

function createEmptySlots(): Slot[] {
  return Array.from({ length: SLOT_COUNT }, () => ({ blockId: null, count: 0 }));
}

export const useInventory = create<InventoryState>((set, get) => ({
  slots: createEmptySlots(),

  add: (blockId: number, amount: number = 1): number => {
    if (blockId <= 0 || amount <= 0) return amount;
    const slots = get().slots.slice();
    let remaining = amount;
    // 1) Fill existing stacks of the same block from left to right
    for (let i = 0; i < slots.length && remaining > 0; i++) {
      const s = slots[i];
      if (s.blockId === blockId && s.count < MAX_STACK) {
        const canAdd = Math.min(MAX_STACK - s.count, remaining);
        s.count += canAdd;
        remaining -= canAdd;
      }
    }
    // 2) Fill empty slots from left to right
    for (let i = 0; i < slots.length && remaining > 0; i++) {
      const s = slots[i];
      if (s.blockId === null || s.count === 0) {
        const toPut = Math.min(MAX_STACK, remaining);
        s.blockId = blockId;
        s.count = toPut;
        remaining -= toPut;
      }
    }
    set({ slots });
    return remaining; // >0 if overflowed
  },

  consumeFromSelected: (amount: number = 1): number => {
    if (amount <= 0) return 0;
    const slots = get().slots.slice();
    const idx = useUIStore.getState().selectedSlot;
    const s = slots[idx];
    if (!s || !s.blockId || s.count <= 0) return 0;
    const take = Math.min(s.count, amount);
    s.count -= take;
    if (s.count === 0) {
      s.blockId = null;
    }
    set({ slots });
    return take;
  },

  getSelectedBlockId: (): number | null => {
    const idx = useUIStore.getState().selectedSlot;
    const s = get().slots[idx];
    if (!s || !s.blockId || s.count <= 0) return null;
    return s.blockId;
  },

  clearSelectedIfEmpty: (): void => {
    const slots = get().slots.slice();
    const idx = useUIStore.getState().selectedSlot;
    const s = slots[idx];
    if (s && s.count <= 0) {
      s.blockId = null;
    }
    set({ slots });
  },
}));

// Helper APIs for engine code (non-hook usage)
export function addToInventory(blockId: number, amount: number = 1): number {
  return useInventory.getState().add(blockId, amount);
}

export function getSelectedPlacementBlockId(): number | null {
  return useInventory.getState().getSelectedBlockId();
}

export function consumeOneFromSelected(): boolean {
  return useInventory.getState().consumeFromSelected(1) === 1;
}


