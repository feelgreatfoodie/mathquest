<!-- Saved verbatim from the Phase 1 handoff. Real kid names are replaced with roles because this repo is public. -->
# Math Quest master PDR: game modes, new modules, and phases
Base: main 610a543. The module registry and pre-reader Addition within 10 are merged (PR #8). Target: rezzed-mathquest (math.rezzed.ai).

## 1. Why
The lead reader (4th grade) plays the multiplication module every day and asked for a Zelda-style world to walk around in. A 5-year-old sibling needs pre-reader math.
Both kids liked the hands-on pieces and games in Synthesis.
The goal is more ways to play, more math, and reasons to come back daily. All of it sits on the review schedule that already works.

## 2. Architecture: three layers on one engine
| Layer | Question it answers | Examples | Code home |
| --- | --- | --- | --- |
| Modules | What math? | facts, division, fraction bars, money | `src/engine/modules/*` (exists) |
| Game modes | How does it play? | Dungeon run, Overworld, Tower defense, Ghost race, Co-op boss | `src/game/modes/*` (Phase 1) |
| Meta progression | Why come back tomorrow? | heroes, world map, creature hatchery, brick builds | `src/game/meta/*` |

Rules every layer follows:
1. **One grader.** Every mode pulls questions from `SessionRunner` and answers through it. A mode never grades on its own. The clock runs only while a question is on screen, never during walking or animation.
2. **One question panel.** A shared `QuestionPanel` component shows the problem, takes input (keypad, fraction, choices, or a hands-on piece like a fraction bar), and shows feedback. A mode decides when the panel opens and what happens around it.
3. **Plan-driven content.** A mode's encounters come from `planSession()` output. Due cards are the enemies; new cards are the chests and new things to find. The schedule stays the single source of truth.
4. **Modules and modes combine freely.** Any live module works in any mode its input fits. Each mode declares the learner types and input kinds it supports.
5. **Saved state per kid.** Mode and meta state live in owner-only subcollections under `families/{uid}/kids/{kidId}/` (`world`, `creatures`, `builds`), each with the field-count guard and a rules test.
6. **Original art only.** All pixel art is original and drawn in code or JSON. No Nintendo, Synthesis, Wings of Fire or other outside characters, names or assets.
7. **The lead reader's progress is protected.** The golden-profile test runs in every PR. Reader timing, card levels and history must not change.

## 3. Phases
| Phase | Theme | Ships | Size | Depends on |
| --- | --- | --- | --- | --- |
| 0 ✅ | Modules | Registry; pre-reader `add10`, plus `sub10` (off) | M | – |
| **1** | **Adventure** | Game mode layer, shared `QuestionPanel`, **Overworld v1** for readers | L | 0 |
| 2 | Fluency | **Division facts** with fact families paired to multiplication; **Ghost race** mode; turn on `sub10` for pre-readers | M | 1 |
| 3 | Together | **Creature hatchery** (one egg per times table or module); **Brothers' co-op boss** (two profiles, one iPad, one shared boss) | L | 1 |
| 4 | Hands-on | Manipulative input framework; **Fraction bars**; **Number line fishing** | L | 1 |
| 5 | Builders | **Area and perimeter** on a brick grid; **Brick builder** progression; **Tower defense** mode | L | 1, 4 |
| 6 | Real world | **Bake shop** (money and making change); **Treasure map** coordinates; **Soccer stats**; **Clocks**; **Story quests** (word problems that also build reading) | XL, split 6a/6b | 1, 4 |
| 7 | Little learners | `count10` (bugs in a jar); more and less (fishing); shapes and patterns; `bonds10`; a pre-reader Overworld with voice | L | 1, 3 |

The order follows the lead reader's demand, what each phase reuses, and the risk:
- The manipulative framework (Phase 4) carries Phases 5 and 6.
- Co-op waits until the mode layer is proven.

## 4. Standing requirements, every phase
- **PDR first,** saved as `docs/pdr/phase-N.md`. One PR per phase, or a few PRs that each deploy on their own.
- **Tests:** vitest for the engine; Playwright at 820×1180, 1180×820 and 390×844; the golden profile test; a rules test for any new collection.
- **Performance:** 60 fps on a 2021 or newer iPad; each phase adds at most 300 KB gzipped.
- **Accessibility:** touch targets at least 48 px (pre-reader at least 120 px); no meaning by colour alone; sound can be muted; voice on for pre-readers.
- **Privacy:** no analytics or third-party SDKs; kid data stays under the parent's uid.
- **Rollout:** each new mode or module is a per-kid parent setting, and the default experience never changes without the parent's say.
- **Deploy timing (Flynn's ruling, 2026-11-21, task LXDOcyuF; grid#1651):**
  - Urgent deploys go out at any hour: a bug that breaks or harms gameplay or kid sign-in, or a security fix.
  - Everything else is batched overnight, after 21:00 PT (05:00Z).
  - Every deploy record says "urgent" with the reason, or "batch".
  - No deploy ever raises `config/app.minVersion`. Merges are never held.
  - The laptop that runs deploys is offline from about 21:00 to 08:00 PT, and the CI deploy job is disabled. Until Flynn rules otherwise, the batch runs at 21:00 PT if the laptop is online, or else in the next morning's first session, before 12:00 PT.
  - Every ship plan states "urgent" (with its reason) or "batch" before any deploy.
  - This replaces the 20:00Z window recorded in #78 and the first draft of this PR.
- **Definition of done:** deployed to math.rezzed.ai, screenshots at iPad size, and a RESULT to TENSOR with the PR link, test counts, and the checks Flynn must do on the iPad.

## 5. Measures (parent area, added in Phase 2)
- **Engagement:** runs per day, minutes per day, streak per kid.
- **Learning:** accuracy on graded first tries; typical fact time falling over weeks; facts reaching Solid and Fluent each week; recall on due reviews near the 90% target.
- **Fit:** which mode each kid picks.

## 6. Defaults (Flynn can change any)
- Overworld is a second choice on the home screen, and the Dungeon run stays.
- Co-op is one iPad with alternating turns.
- Money is USD.
