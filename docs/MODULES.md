# Math Quest modules: architecture and Phase 1 (Early Addition for pre-readers)
Base: ~/_mainframe/apps/mathquest main (910b9b1).

## 1. Goal
Turn Math Quest's three hard-coded tracks into a registry of modules. Each module is a self-contained curriculum: its cards, a problem generator, an unlock ladder, timing bars, and how it is shown and answered.
A kid profile picks modules and a learner mode. Pre-reader mode swaps the reading-and-keypad screen for pictures, sound and big tap targets.
The FSRS scheduler, planner, runner, Firestore layout, auth, kid sign-in and pace setting all stay as they are.

## 2. Architecture
### 2.1 ModuleDef (src/engine/modules/types.ts)
```ts
export type ModuleId = 'add10'|'sub10' /*P1*/ | 'count10'|'bonds10' /*P2*/ | 'add20'|'sub20'|'add2d'|'sub2d' /*P3*/ | 'facts'|'multidigit'|'fractions' /*live, same ids as old Track*/;
export type Audience = 'prereader'|'reader'|'any';
export type InputKind = 'choices'|'keypad'|'fraction';
export interface GroupDef { id: string; label: string; cardIds: string[] }
export interface ModuleDef {
  id: ModuleId; name: string; gradeBand: string; audience: Audience; status: 'live'|'planned';
  cards: CardDef[];            // curriculum order
  groups?: GroupDef[];         // fact-style unlock ladder (80% rule)
  generate(cardId: string, rng: Rng): Problem;
  baseBars(def: CardDef, ctx: { baselineMs: number }): Thresholds;  // pre-pace; grading multiplies by paceOf()
  input: InputKind; presentation: 'symbolic'|'visual-first';
}
```
- `modules/index.ts` exports `MODULES`, `getModule`, and `moduleOfCard` (looked up by id prefix).
- `facts`, `multidigit` and `fractions` wrap today's content with no behavior change. The `mul:`, `md:` and `fr:` ids stay, so stored progress is untouched.
- `getCardDef`, `cardLabel` and `generateProblem` become registry lookups.
- `thresholdsFor(def, baseline, pace)` keeps its signature and becomes `scale(module.baseBars(def, ctx), pace)`. The #1 pace semantics are unchanged.
- `groupProgress` and `unlockedFactGroups` take a `ModuleDef`, so every module with `groups` gets the 80% rule. Cross-module prerequisites keep working (`facts:g2`).
- `availableCards` loops over the kid's enabled modules in registry order.
- The planner and runner stay as they are, with two changes:
  - Every `d.kind === 'fact'` check becomes "not a skill card".
  - The retry gap and monster block size come from learner mode. Pre-readers get a gap of 2 and blocks of 3.
### 2.2 Settings and migration (models.ts)
- Add `learner?: 'prereader'|'reader'`; missing reads as reader.
- Add `modules?: Partial<Record<ModuleId, boolean>>`.
- Add `learnerOf()` and `modulesOf()`. `modulesOf` uses `modules`, or derives them from `tracks`; new ids default to false. Keep writing `tracks` for old clients.
- `PRESETS.prereader` = { learner: 'prereader', modules: { add10: true }, sessionSize: 10, maxNew: 4, paceMultiplier: 3 }.
- `PRESETS.reader` = today's `DEFAULT_SETTINGS`.
- Firestore paths are unchanged. New card ids are `add:a+b` and `sub:a-b`. No rules, index or Functions changes are needed.
### 2.3 Problem additions (problems.ts)
- Add `speech?: string`, for example "three plus two".
- Add `visual?: {kind:'groups'; op:'+'|'−'; a; b; icon: IconId}`.
- Add `choices?: number[]`, built by `choicesFor(answer, max, rng)`. It returns 3 unique values in 0..max: the answer plus its nearest neighbours, ±1 then ±2. It is pure and seeded.
- `IconId` is apple, star, fish, bug or dino. Change the icon each question, and use the same icon on both sides of one problem.
### 2.4 UI shell
`Run.tsx` picks `ReaderRun` (today's screen) or the new `PrereaderRun`, using `learnerOf()`. Both drive the same `SessionRunner`. The picker, Kid tab and summary also branch on `learnerOf()`.

## 3. Catalog and build order
| Phase | Module | Grade | Audience | Cards | Input |
| --- | --- | --- | --- | --- | --- |
| 1 | `add10`, Addition within 10 | K | prereader | 36 | choices |
| 1b | `sub10`, Subtraction within 10 | K–1 | prereader | 66 | choices |
| 2 | `count10`, How many? (1–10) | Pre-K–K | prereader | 10 | choices |
| 2 | `bonds10`, Make 10 | K–1 | prereader | 11 | choices |
| 3 | `add20`, `sub20`, within 20 with doubles, near doubles and make 10 | 1–2 | reader | ~120 | keypad |
| 3 | `add2d`, `sub2d`, 2-digit with regrouping | 2–3 | reader | skill cards | keypad |
| live | `facts`, `multidigit`, `fractions` | 3–5 | reader | 91 + 12 skills | keypad / fraction |

`sub10` ships in Phase 1, off by default. Backlog after Phase 3: `div`, `fracEq`, `money`, `clock`.

## 4. Phase 1: add10 plus the pre-reader shell
### 4.1 Cards and ladder
- One card per unordered pair a ≤ b with a + b ≤ 10, id `add:a+b`: 36 cards. Show the two numbers in random order each review.
- G1: sums of 5 or less, 12 cards. Order: +0 and +1, then doubles, then the rest.
- G2: sums from 6 to 10, 24 cards. Order: +1 and +2, doubles, the rest, then the pairs that make 10.
- Base bars are fast 2000 ms and slow 6000 ms, which pace 3 turns into 6 s and 18 s.
- Guessing guard: a correct first exposure caps the grade at Good, and a peek grades Hard at best.
- `sub10` follows the same pattern: `sub:a-b` with 0 ≤ b ≤ a ≤ 10, G1 for a ≤ 5 and G2 for 6 to 10.
### 4.2 Problem
- `tokens` [a, +, b]; `answer` a + b; `choices` `choicesFor(a + b, 10)`.
- `speech`: "three plus two".
- Spoken hint on a miss: "Let's count them all. One, two, three, four, five. Three plus two is five."
- `visual`: groups.
### 4.3 What the kid sees, by card level
| Card level | Shown |
| --- | --- |
| New or Learning (0–1) | Icon groups plus numerals |
| Reviewing (2) | Ten-frame dots plus numerals |
| Solid or Fluent (3–4) | Numerals plus an "eye" peek button (peek grades Hard at best) |

Practice retries always show the pictures.
### 4.4 Pre-reader screen (iPad)
Nothing needs reading. Every instruction is speech plus an icon, and numerals are the only text.

Layout:
- Top bar:
  - Exit: a house icon you hold for 2 s.
  - Progress: 10 path dots.
  - Replay: a speaker button.
- Picture row: group A, a big +, group B. Icons in rows of 5, 48–64 px.
- Numeral row: "3 + 2 = ?" at 72 px or more.
- Answers: 3 buttons, at least 140 × 140 px. Each has the numeral with a dot pattern under it, so a kid can match by counting.

Audio:
- `speechSynthesis`, en-US, rate 0.85.
- iOS needs a first tap to unlock audio. After that, each problem is spoken automatically; replay is always available.

Feedback:
- Correct: a WebAudio chime (no asset files), a monster hit, the voice says "Yes! Three plus two is five.", then advance after 1.2 s.
- Wrong: a soft tone and an arrow, not a red X. Icons count up one by one, on screen and out loud. The correct button pulses, and the kid taps it to go on; that tap is ungraded practice.

Game and safety:
- No timers, lives or failing.
- A new monster every 3 questions, and the boss for the last 3.
- Colour never carries meaning alone.

Home and summary:
- Home is the hero, a huge Play triangle, and streak flames as icons.
- The summary shows stars and gems, and the voice says "Great job! You got eight stars!"
### 4.5 Parent side
- Add player gets a "Player type" choice, Reader (7+) or Pre-reader (4–6), which applies the matching preset.
- Settings:
  - The learner switch.
  - A module checklist grouped by grade band, live modules only, with pace kept.
- Progress grids:
  - `add10`: a triangle grid, a = 0..10 by b = 0..10, with cells where a + b ≤ 10. Same colours and "missed 3+" outline as today.
  - `sub10`: a minuend by subtrahend triangle.
- Kid-tab sign-in: show the hero sprite next to each name. Pre-readers mostly play on a parent-signed-in iPad.
### 4.6 Tests
Unit:
- `add10` has 36 unique ids.
- Generator answers match the tokens.
- `choicesFor` includes the answer, returns 3 unique in-range values, and is deterministic per seed.
- G1 unlocks G2 at 80%.
- `modulesOf` migrates from `tracks`, and a missing `learner` reads as reader.
- Guessing guard caps at Good, and a peek caps at Hard.
- All existing tests still pass.

Playwright at iPad size, on a pre-reader profile with only `add10`:
- A first run of 10 questions shows only sums of 5 or less.
- No keypad.
- The speaker button calls `speechSynthesis` (stub it).
- A wrong answer requires tapping the correct one.
- The summary appears, the session saves, and the parent grid fills.

Manual check on Flynn's iPad in Safari: the voice plays after the first tap, the run works offline, and the targets are easy to hit.
### 4.7 Files
- New:
  - `src/engine/modules/{types,index,facts,multidigit,fractions,add10,sub10}.ts`
  - `src/ui/early/{PrereaderRun,ObjectGroups,ChoiceButtons,TenFrame}.tsx`
  - `src/ui/early/{useSpeech,sounds}.ts`
  - icons in `sprites.tsx`
- Edited:
  - `content.ts`, `problems.ts`, `grading.ts`, `mastery.ts`, `models.ts`
  - `session.ts` (minimal)
  - `Run.tsx`, `KidScreens.tsx`, `Parent.tsx`, `styles.css`
  - tests

## 5. Delivery
1. One PR through the usual Basher worktree flow and CI, then deploy to rezzed-mathquest (math.rezzed.ai).
2. After deploy, Flynn creates a Pre-reader profile in his parent account, with only Addition within 10 on.
3. Send a RESULT with the PR link, the URL, test counts, and iPad-size screenshots of the pre-reader run and the parent grid.
4. Phase 2 (`count10`, `bonds10`) waits for Flynn's go-ahead after about a week of use.

## 7. Pre-reader recall (prereader-fade and prereader-new-facts)
- Every pre-reader fact has a support level on its card: `dots`, `numerals` or `pad` (`support.ts`). A missing value reads as dots.
- Two right answers in a row without help move a fact from dots to numerals. A Solid fact answered right without help moves to the pad. A miss steps down one level. Help (strategy cue first, then dots) is right-with-help: rated Hard, never advances the fade, resets the fact to dots.
- 4 choices (`closeChoices`): answer ±1 and ±2 plus one common error, in 0 to 20, positions shuffled.
- New modules, all off until a parent turns them on (`settings.modules`):

| Module | Cards | Card ids | Input | Groups |
| --- | --- | --- | --- | --- |
| `bonds10` | 11 | `bond:a` (a + ? = 10) | choices, pad to 10 | a of 5 or more, then 4 or less |
| `missing10` | 45 | `miss:a+_=s` (a + ? = s, s up to 10) | choices, pad to 10 | totals to 5, then 6 to 10 |
| `doubles` | 19 | `dbl:a`, `near:a` | choices, pad to 20 | doubles to 5 + 5, doubles to 10 + 10, near doubles |
| `add20` | 30 | `a20:a+b` (sums 11 to 20) | choices, pad to 20 | sums 11 to 15, then 16 to 20 |

- A missing addend shows one ten-frame with the gap lit (`Problem.gap`). Doubles, near doubles and add20 name their cue in `Problem.strategy` (`double`, `neardouble`, `split10`: "8 + 5 = 8 + 2 + 3").
- Firestore rules are unchanged: card ids only need to match the doc id, and `settings.modules` is an ordinary settings field.
