import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Each run screen tells finishRun its mode, so every new session log carries the tag. The Dungeon and the Picture Run
// are pinned here by source (their screens need a browser); the Adventure's tag is covered by adventureTrip.test.ts and the e2e.
describe('the mode tag reaches finishRun from every run screen', () => {
  it.each([
    ['src/game/modes/DungeonMode.tsx', "mode: 'dungeon'"],
    ['src/game/modes/PrereaderMode.tsx', "mode: 'prereader'"],
    ['src/game/overworld/Overworld.tsx', "mode: 'overworld'"],
  ])('%s passes %s', (file, tag) => {
    expect(readFileSync(file, 'utf8')).toContain(tag);
  });
});
