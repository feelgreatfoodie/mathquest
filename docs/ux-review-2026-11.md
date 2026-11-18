# Math Quest UX review, November 2026

From Flynn, through the TENSOR key (CacheBash task eQK1okxTrxm6zRysSWsD). Flynn asked for a usability and kid-friendliness review. TENSOR ran main c36c18f as a local build (VITE_DATA_MODE=local, vite preview on Flynn's MacBook Pro, port 5199, since stopped), with two test profiles in Flynn's Chrome. No real data was touched.

The review below is saved verbatim. VECTOR's rulings (dispatch_01a1ec4f) and the shipping status are at the end of this file.

## Keep (already good)
- The parent PIN gate.
- No ads, purchases or outside links.
- Offline play.
- Pre-reader: voice and replay, 3 big choices with dot patterns, errorless correction, hold-to-exit, 10 path dots.
- No timers, lives or failing.
- Clear end-of-run stars and gems.

## Findings
**1. P0 — Save & quit hangs.** In ReaderRun `finish()`, `newId()` calls `crypto.randomUUID`, which is undefined on insecure http origins. That throws after `finishing.current = true`. Every later tap is a silent no-op, and the kid is stuck mid-run. (Console showed `TypeError: crypto.randomUUID is not a function` at http://10.0.0.34:5199.) Production https is fine today, but any thrown save freezes the same way.
- Fix: `newId()` falls back to `crypto.getRandomValues`. `finish()` uses try/catch/finally, always exits, and shows a toast: "Saved!" or "Saved on this iPad, will sync later".
- Test: a Playwright or unit run with a repo that throws on save still exits.

**2. P0 — The progress bar goes backwards** when retries are spliced in, because it uses position over a growing length. Make progress graded answered ÷ graded planned; retries can appear as bonus pips that never move the bar back. Test that the bar never decreases.

**3. P1 — On a miss, the wrong number stays big** in the equation, and the correct answer is small text below with a hint of about 14 px. Put the correct answer in the equation, large, with a check; show the kid's answer small and struck through. Make the hint at least 20 px, with a "read it to me" speaker.

**4. P1 — Hit feedback is quiet:** a small "Hit! +10 XP", no sound, and Combo ×6 tiny in the corner. Add a hero lunge, a monster hit flash with star burst and knockback, and WebAudio sounds for hit, defeat and level up. Put the combo badge near the monster and make it big; make FAST a big bolt. Mute goes in the top bar.

**5. P1 — Reader mode has no audio and no read-aloud.** Reuse `sounds.ts` and `useSpeech`. Add a speaker on teach cards, hints and the summary. Sound is on by default, with mute per kid in parent settings.

**6. P1 — Landscape layout:** the keypad floats top-right with a lot of empty space below, and the question panel is short. In landscape, center the keypad vertically with keys at least 80 px. The question panel fills the left column, numerals at least 72 px.

**7. P1 — Fraction input needs 3 taps** (Whole, Top, Bottom) before typing, it's easy to type into the wrong box, and Whole shows even when no whole number is possible.
- Hide Whole unless the problem family can give a whole or mixed answer.
- GO jumps to the next empty box first, then submits.
- The active box pulses, and tapping a box selects it.

**8. P1 — "Save & quit" is small text next to the progress bar,** easy to tap by accident. Use a house icon with hold-to-exit, as in pre-reader mode, or a sheet: "Stop now? Your progress is saved." with Keep playing and Stop.

**9. P1 — Picker: both kids show the same knight,** and the cards sit top-left with empty space; a pre-reader can't tell them apart. Each player picks a hero and a color when added (free). Center the cards, make them larger, and make the whole card the tap target.

**10. P1 — The Kid sign-in tab asks for a typed first name plus PIN,** which is hard for a 5-year-old. On a device that has seen the family before, show hero faces to tap, then the PIN. Offer a picture PIN (4 of 9 animal icons) for pre-readers. This needs a functions change: hash the picture PIN like the digit PIN, rate-limited the same way.

**11. P1 — Reader home stat labels** ("day streak", "gems", "best combo") are about 12 px muted grey. Use icons (flame, gem, bolt) with big numbers and labels at least 16 px, and check 4.5:1 contrast.

**12. P1 — Pre-reader screen sizes:** icons are about 36 px (the spec says 48 to 64), the gap between the equation and the answers is large, and the dots under the numerals are small. The correct-answer moment is a small check. Make icons 56 px, move the answers up, make dots at least 12 px, and add a sparkle burst and hero hop on a correct answer.

**13. P1 — The streak resets to 1 after a missed day,** which can feel like failure. Make a weekly star chart (days played this week) the main habit display; keep the streak secondary, with one free rest day a week.

**14. P2 — Healthy limits.** A parent setting for a daily goal and a soft cap. After the goal: "Great job today! Come back tomorrow." The parent can override. No guilt messages.

**15. P2 — Pre-reader collection.** A sticker book of earned creatures, tied to the Phase 3 hatchery. Tapping a sticker says its name.

**16. P2 — Accessibility.** Follow `prefers-reduced-motion` with a parent toggle, and audit muted text for 4.5:1 contrast.

**17. P2 — First-run onboarding.** For pre-readers, 3 voice screens on how to play. For readers, one tooltip on the keypad and fraction boxes. Show it once, replayable from home.

## Tests to add
- The progress bar never decreases.
- Quit with a repo that throws still exits.
- A miss shows the correct answer in the equation.
- Picker cards show distinct heroes.
- Screenshot diffs at 820×1180 and 1180×820.

## Shipping plan (from the task)
- UX-1 ships right after Phase 1a: items 1, 2, 3, 8, 9.
- UX-2 ships with or after 1b: items 4, 5, 6, 7, 10, 11, 12, 13. The new QuestionPanel carries all of these, so the Overworld inherits them.
- P2 items 14 to 17 fold into later phase PDRs.

## Status (UX-1)
| Item | Status |
|---|---|
| 1 Save & quit hang | Done in UX-1. `newId()` fallback, `finishRun` shared by both run screens, failure toast, sweep below. The `finish()` try/finally and the save-first outbox shipped earlier (#11, #21). |
| 2 Progress bar | Done in UX-1. `SessionRunner.progress()` counts graded entries only. |
| 3 Wrong number stays big | Done in UX-1. |
| 8 Hold-to-exit | Already shipped in #12 (hold-button). Both run screens use `HoldButton`. No change in UX-1. |
| 9 Picker heroes and colors | Done in UX-1. `avatar` in the kid doc, set by the parent on add and edit. No rules change. |

### Sweep: await after a latch in the run and teach screens
| Where | Result |
|---|---|
| `DungeonMode.finish`, `PrereaderMode.finish` | Bug. `left = true` was set before `onDone`; an `onDone` that throws skipped `onExit`, so the kid stayed on the run screen with `finishing` latched and every tap a no-op. Fixed: `finishRun` sets `left` after `onDone`, and exits when `onDone` throws. |
| `saveRun` (via `newId`) | Throw before the outbox write on an http origin. Fixed by the `newId` fallback. A throw now exits and shows "This round was not saved." |
| `PrereaderMode` "Saved!" toast | Shown before the save finished. Left as it was (it shows while saving); a failed save adds the failure toast. |
| `ReaderPanel.resolve` (`resolved` latch) | Safe. No await between the latch and `onResolved`; `onResolved` is sync. |
| `PrereaderPanel.choose` and `next` (`resolved` latch) | Safe. The correct path awaits `speak`, which always resolves (fallback timer), then a timeout; unmount sets `alive` false. |
| `PrereaderPanel.countUp` | Safe. Guarded by `countTurn`; no latch; `speak` always resolves. |
| Teach card "Let me try one!" | Safe. Sync: `acknowledge()` then `resolve(null)`. |
| `PinPad` `busyRef` | Safe. Reset after the await; a throw counts as refused. |
| `HeroShop` `busy` (tap, confirm) | Safe. `try/finally` resets it; a failed buy leaves the confirm open to retry. |
| `PrereaderSummary.retry` | Safe. `finally` clears `retrying`. |
