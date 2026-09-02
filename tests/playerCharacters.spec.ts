import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_CHARACTER,
  getNextPlayerCharacter,
  PLAYER_CHARACTER_IDS,
} from '../src/shared/playerCharacters';

describe('player character selection', () => {
  it('cycles in authored order and wraps back to the default', () => {
    expect(getNextPlayerCharacter(DEFAULT_PLAYER_CHARACTER)).toBe('Solvaris');
    expect(getNextPlayerCharacter('Solvaris')).toBe('Eryndor');
    expect(getNextPlayerCharacter('Eryndor')).toBe('Vespera');
    expect(getNextPlayerCharacter('Vespera')).toBe('Kaelith');
    expect(getNextPlayerCharacter('Kaelith')).toBe(DEFAULT_PLAYER_CHARACTER);
  });

  it('normalizes an invalid current selection before cycling', () => {
    expect(getNextPlayerCharacter('missing-character')).toBe(PLAYER_CHARACTER_IDS[1]);
  });
});
