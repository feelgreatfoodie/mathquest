import type { Level } from '../../engine/mastery';

export type DisplayMode = 'groups' | 'frame' | 'numerals';

/**
 * What a pre-reader sees, by card level: pictures for new and learning cards, a ten-frame once the
 * card is reviewing, numerals with a peek button once it is solid. Practice retries always show pictures.
 */
export function displayModeFor(level: Level, kind: 'teach' | 'graded' | 'practice'): DisplayMode {
  if (kind === 'practice') return 'groups';
  return level <= 1 ? 'groups' : level === 2 ? 'frame' : 'numerals';
}
