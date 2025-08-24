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

  // Heads-up display values
  fps: number; // updated periodically by engine
  setFps: (fps: number) => void;

  // Pause state toggles update of engine subsystems (but render continues)
  paused: boolean;
  setPaused: (paused: boolean) => void;

  // Whether the user is in the game control mode (focus owned by game)
  inGame: boolean;
  setInGame: (inGame: boolean) => void;

  // Restart signal: incrementing token triggers restart side-effect in host
  restartToken: number;
  bumpRestartToken: () => void;
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
  fps: 0,
  setFps: (fps: number) => set({ fps }),
  paused: false,
  setPaused: (paused: boolean) => set({ paused }),
  inGame: false,
  setInGame: (inGame: boolean) => set({ inGame }),
  restartToken: 0,
  bumpRestartToken: () => set((s) => ({ restartToken: s.restartToken + 1 })),
}));

export function getSelectedBlockId(): number | null {
  const { selectedSlot, hotbar } = useUIStore.getState();
  return hotbar[selectedSlot] ?? null;
}


