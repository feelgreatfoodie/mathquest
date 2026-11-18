<!-- Saved verbatim from the Phase 1 handoff. Real kid names are replaced with roles because this repo is public. -->
# Phase 1 PDR: game mode layer and Overworld v1

## 1. Goal
The lead reader walks a top-down pixel world in the Zelda style. Monsters met, chests opened and bosses challenged all ask math from the reader's own review schedule.
This phase also builds the game mode layer, so later modes (Ghost race, Tower defense, Co-op) are cheap to add.

## 2. Scope
In scope:
- `GameMode` registry; Dungeon run and pre-reader run become modes, with no behavior change.
- A shared `QuestionPanel` taken out of `ReaderRun` and `PrereaderRun`.
- Overworld v1 for **reader** profiles: 3 regions, tap-to-move, monsters, chests, gates, a boss, a home camp, and saved state.
- A mode picker on the reader home screen, and a parent setting that turns the Overworld on for each kid.

Out of scope: a pre-reader Overworld (Phase 7), generated maps, music, co-op, a map editor.

## 3. Architecture
### 3.1 Game modes (`src/game/modes/`)
```ts
export type GameModeId = 'dungeon' | 'prereader' | 'overworld';   // later: 'ghost' | 'tower' | 'coop'
export interface GameModeDef { id: GameModeId; name: string; learners: Array<'reader'|'prereader'>; inputs: InputKind[]; status: 'live'|'beta'; Component: React.FC<GameModeProps> }
export interface GameModeProps { repo: Repo; kid: Kid; onDone(summary: RunSummary, kid: Kid): void; onExit(): void }
```
- `Run.tsx` becomes a lookup: `getMode(kid.settings.lastMode ?? defaultModeFor(kid)).Component`.
- `loadRunner` and `saveRun` in `runShared.ts` stay the only way to load and save a run.

### 3.2 QuestionPanel (`src/game/QuestionPanel.tsx`)
- Props: `runner`, `entry`, `learner`, `onResolved(feedback)`, `display` ('inline' | 'modal').
- It holds problem rendering (MathView, FracView, ObjectGroups, TenFrame), input (Keypad, fraction fields, ChoiceButtons, peek), timing (`shownAt` set when the panel becomes visible), `runner.answer()`, saving the card, feedback, the miss and almost flows, and teach entries.
- Dungeon and pre-reader runs must look the same after the extraction. Prove it with Playwright screenshot diffs.

### 3.3 Overworld (`src/game/overworld/`)
| Piece | File | Notes |
| --- | --- | --- |
| Tile maps | `maps/{meadow,forest,castle}.ts` | Text grids, about 40×30 tiles. Legend: grass, path, tree, water, rock, bridge, gate, chest spot, spawn zone, boss lair, camp |
| Tileset and sprites | `tiles.ts`, `sprites.tsx` | Original 12×12 pixel tiles; the hero has 4 directions × 2 walk frames; monsters reuse slime, bat, ghost, skeleton, boss |
| Renderer | `Renderer.tsx` | Canvas 2D, nearest-neighbour scaling, camera follows the hero, 60 fps with rAF; pauses while the panel is open |
| Movement | `movement.ts` | Tap a tile and the hero walks there by A*; an optional on-screen D-pad; arrow and WASD keys; 4 tiles per second |
| World state | `worldState.ts` | Pure reducer: position, opened chests, defeated bosses, keys, region |
| Encounters | `encounters.ts` | Pure: turns the run's queue into entities |
| Screen | `Overworld.tsx` | HUD, map, panel modal, camp |

### 3.4 Encounters come from the schedule
- At trip start, `loadRunner()` builds the queue as today, so `sessionSize` graded questions make one trip.
- Entries map to entities in the current region:
  - A graded review becomes a **monster** on a free spawn tile 6 to 15 tiles from the hero. At most 6 show at once; the rest wait.
  - A new card (teach plus graded) becomes a **chest**: teach card, then question, and a correct first answer gives 1 gem.
  - A practice retry becomes the same monster reappearing **within 3 tiles**.
- Touching an entity opens the QuestionPanel as a modal and pauses the world.
  - Correct: the monster is defeated.
  - Wrong: the hint shows as today, the monster hops back 2 tiles, and the runner has already queued the retry.
- The kid chooses the order, so add `SessionRunner.answerEntry(entryId, input, ms, opts)`.
  - Its grading must be identical to `answer()`.
  - Test that answering out of order gives the same card states as answering in order.
- When every graded entry is resolved, a **campfire** lights at the camp. Walking to it ends the trip, saves through `saveRun`, and shows the summary.
- Holding the camp icon for 1 second quits early and saves the answered cards.

### 3.5 Regions, gates, boss
- Regions follow the main module's unlock ladder. For the lead reader, on `facts`:

  | Region | Groups |
  | --- | --- |
  | Meadow | g1 to g2 |
  | Forest | g3 |
  | Castle | g4 to g5 |

- A gate opens when `unlockedFactGroups()` reaches its region. A closed gate shows a lock and a progress bar, "17 of 22 learned".
- Modules without groups get a single region; `ModuleDef.regions?` can override that later.
- Monsters spawn in the current region and can be any due card from any enabled module. Each module has a monster look: facts are slimes and bats, multidigit are skeletons, fractions are ghosts.
- **Boss lair:** the door opens when the region's groups are at least 80% Reviewing.
  - A fight is 5 questions in a row from cards already seen in that region, weakest first.
  - Each counts as graded only if the card is due; otherwise it is practice.
  - Winning 4 of 5 gives a key, 10 gems and a home-screen badge. A loss carries no penalty; retry next trip.

### 3.6 Saved state
- Path: `families/{uid}/kids/{kidId}/world/main`.
- Document: `{ region, x, y, facing, openedChests: string[] (card ids), bossesDefeated: string[], keys, version: 1, updatedAt }`.
- Save on region change, camp and trip end, plus a 5-second debounce while walking.
- Rules: owner-only, field count under 20, `openedChests.size() <= 500`, with a rules test.
- LocalRepo mirror: `mathquest:v1:world:{kidId}`.

### 3.7 Settings and picker
- `KidSettings.modes?: Partial<Record<GameModeId, boolean>>`. Defaults: `{dungeon: true}` for readers, `{prereader: true}` for pre-readers.
- `KidSettings.lastMode?` remembers the last choice.
- Reader home shows 2 big cards, "Dungeon Run" and "Adventure", with sprite previews when 2 or more modes are on; otherwise it looks as it does today.
- Parent settings get a "Game modes" checklist.

### 3.8 Art and feel
- Zelda-like spirit, but every tile and sprite is original. No Nintendo names, music or assets.
- WebAudio sound effects (chest, hit, gate, boss intro); mute lives in the HUD.
- HUD:
  - Hearts are decoration only; there is no health loss.
  - Gems, keys, and questions left as monster icons.
  - The camp icon.
- A tap marker shows the target tile. The D-pad is 64 px buttons at bottom left.

## 4. Non-functional
- 60 fps on a 2021 or newer iPad; map drawing under 4 ms a frame on a single canvas.
- At most 300 KB gzipped added; maps code-split behind Adventure.
- Offline after the first load; the service worker precaches the new chunk.
- Walking time is never counted: `shownAt` is set when the panel opens.

## 5. Tests and acceptance
**Unit:**
- A* takes the shortest path and never crosses blocked tiles or closed gates.
- Every plan entry maps to exactly one entity, none on a blocked tile, with retries within 3 tiles.
- `answerEntry` out of order matches in order.
- Gates open exactly at the unlock threshold.
- Boss questions grade only due cards.
- `worldState` persists in both directions.
- The golden profile is unchanged.

**Playwright (820×1180, 1180×820, 390×844):**
- Two mode cards show when Adventure is on, and one when it is off.
- Tap a monster: the hero walks, the panel opens, a correct answer defeats it, and the card saves.
- A chest gives a teach card, a question and a gem.
- A closed gate blocks walking and shows progress.
- Clearing every entry lights the campfire, which leads to the summary and a saved session log.
- Holding the camp icon mid-trip quits and saves.
- Dungeon and pre-reader screenshot diffs show no change.

**Manual (Flynn's iPad, Safari):** tap-to-move feels right, 60 fps, works offline, the lead reader finishes 2 trips, and the heatmap updates the same as after Dungeon runs.

## 6. Delivery
1. PR 1a: mode registry and QuestionPanel extraction, with no visible change. Deploy it.
2. PR 1b: Overworld behind `modes.overworld`. Deploy it, and turn it on for the lead reader only after Flynn says yes.
3. Send a RESULT to TENSOR for each PR (details in point 4 at the top).
4. Phase 2 (Division with fact families, plus Ghost race) gets its PDR once 1b is live.
