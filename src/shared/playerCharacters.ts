/**
 * The authored player appearances available to the game.
 *
 * The ids intentionally match the reference filenames so the selector and
 * renderer share one stable vocabulary. Appearance selection is session UI
 * state; world saves continue to describe the world and inventory only.
 */

export const PLAYER_CHARACTER_IDS = ['Otherys', 'Solvaris', 'Vespera', 'Kaelith'] as const;

export type PlayerCharacterId = typeof PLAYER_CHARACTER_IDS[number];

export interface PlayerCharacterOption {
  id: PlayerCharacterId;
  name: string;
  accent: string;
}

export const DEFAULT_PLAYER_CHARACTER: PlayerCharacterId = 'Otherys';

export const PLAYER_CHARACTER_OPTIONS: readonly PlayerCharacterOption[] = [
  { id: 'Otherys', name: 'Otherys', accent: '#22d3ee' },
  { id: 'Solvaris', name: 'Solvaris', accent: '#f59e0b' },
  { id: 'Vespera', name: 'Vespera', accent: '#f472b6' },
  { id: 'Kaelith', name: 'Kaelith', accent: '#38bdf8' },
];

export function normalizePlayerCharacter(value: unknown): PlayerCharacterId {
  return typeof value === 'string' && PLAYER_CHARACTER_IDS.includes(value as PlayerCharacterId)
    ? value as PlayerCharacterId
    : DEFAULT_PLAYER_CHARACTER;
}

export function getNextPlayerCharacter(value: unknown): PlayerCharacterId {
  const current = normalizePlayerCharacter(value);
  const currentIndex = PLAYER_CHARACTER_IDS.indexOf(current);
  return PLAYER_CHARACTER_IDS[(currentIndex + 1) % PLAYER_CHARACTER_IDS.length] ?? DEFAULT_PLAYER_CHARACTER;
}
