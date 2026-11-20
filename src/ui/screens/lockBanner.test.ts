import { describe, expect, it } from 'vitest';
import type { Kid } from '../../engine/models';
import { lockedNames } from './Parent';

const kid = (id: string, name: string) => ({ id, name }) as Kid;

describe('lockedNames', () => {
  const kids = [kid('kid-id-1', 'Pip'), kid('kid-id-2', 'Renée')];

  it('maps a locked name key to the display name', () => {
    expect(lockedNames(['pip', 'renée'], kids)).toEqual(['Pip', 'Renée']);
  });

  it('never returns an id: an unknown name key reads "a player"', () => {
    const out = lockedNames(['zzz'], kids);
    expect(out).toEqual(['a player']);
    expect(out.join(' ')).not.toContain('kid-id');
  });
});
