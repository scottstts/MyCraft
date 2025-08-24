/**
 * Module: state/ui
 * Purpose: Global UI state via Zustand (hotbar selection, simple HUD toggles)
 * Callers: React HUD components, InteractionSystem (read selected block id)
 * Invariants: Serializable state; engine reads but does not import React
 */

import { create } from 'zustand';

export interface UIState {
  selectedSlot: number; // 0..8
  setSelectedSlot: (slot: number) => void;

  // Simple hotbar: list of block ids per slot
  hotbar: number[]; // length 9
  setHotbar: (ids: number[]) => void;
}

const DEFAULT_HOTBAR: number[] = [
  // 0..8 default: grass, dirt, stone, sand, wood, leaves, glass, water, cobblestone (ids must exist)
  1,  // grass (example id; real id from registry may differ)
  2,  // dirt
  3,  // stone
  4,  // sand
  5,  // wood
  6,  // leaves
  7,  // glass
  8,  // water
  9,  // cobblestone
];

export const useUIStore = create<UIState>((set) => ({
  selectedSlot: 0,
  setSelectedSlot: (slot: number) => set({ selectedSlot: Math.max(0, Math.min(8, Math.floor(slot))) }),
  hotbar: DEFAULT_HOTBAR.slice(),
  setHotbar: (ids: number[]) => set({ hotbar: ids.slice(0, 9) }),
}));

export function getSelectedBlockId(): number | null {
  const { selectedSlot, hotbar } = useUIStore.getState();
  return hotbar[selectedSlot] ?? null;
}


