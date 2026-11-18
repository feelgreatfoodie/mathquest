# Security: trust boundary

Math Quest keeps its game economy on the device. This file names what Firestore rules enforce and what they leave to the client.

## What the rules enforce

- A family tree `families/{uid}/...` is readable and writable only by that parent, who must have a verified Google email and a `parents/{uid}` doc.
- A kid token (custom token from the `kidSignIn` function, claims `role`, `familyUid`, `kidId`) reaches only its own kid doc, cards and sessions. It writes only the `game` field of the kid doc. Name, settings, pace and PIN flag are parent-only.
- `game.xp`, `game.bestCombo` and the hero list never go down (`gameMonotonicOk`).
- `game.gems` goes down only in the write that buys one hero (`gemsDropBacked`, kid and parent branches). That write sets `game.lastPurchaseId` to a new id, creates the purchases doc with that id, adds exactly one hero, and the doc's cost equals the drop and its heroId is the hero added. A stale full-doc copy, a reused id, a wrong cost or a drop with no hero is refused.
- `game.hero` changes only to a hero in `game.heroes` (`heroChangeOk`).
- A kid token that adds a hero adds exactly one, a hero in the catalog, and pays exactly its catalog price (`heroPrices`, kept equal to `HEROES` by a unit test). The free knight (price 0) may be added with a gem rise, never with a drop.
- A kid token raises `game.gems` by at most 10 and `game.xp` by at most 2000 per write (`kidRaiseOk`). 10 is `GEM_RUN_MAX`, the most `gemsForRun` returns at any speed or tier. The xp bound comes from 58 stored sessions whose largest run earned 504 xp. There is no check against gems earned today: the throttle slows the rate in the app and never refuses a save.
- The purchases log `families/{uid}/kids/{kidId}/purchases/{id}` is readable by the parent only. It has no update and no delete. An entry is created only in the write that adds the hero and spends its price, and its id must be that write's `game.lastPurchaseId`, so one buy has exactly one entry.
- Parent and Admin SDK writes are not bounded by the kid rules. Support corrections run through the Admin SDK.

## What the rules do not enforce (the remaining trust boundary)

- Grading runs on the device. A kid token can claim any run, so it can earn gems and xp up to the bound on every write, and it can repeat writes. The bound limits one tampered write, not the rate.
- Every gem drop has a purchases entry, so the log is complete for gems spent. Gems earned have no log: sessions record runs, and a kid token can still raise gems up to the bound per write.
- Deleting a kid leaves its purchases docs behind, since the rules forbid deletes. They stay readable by the parent only.

## Why

The product is a family practice app. Moving grading server-side would add a service to run and does not change who can play. The bounds make a tampered write cost a few gems, not a whole economy. Raise or lower them in `kidRaiseOk` when session size or rewards change (keep the gem bound equal to `GEM_RUN_MAX`), and re-measure first.

## Rules for this public repo

- No real names, kid doc ids or family ids in code, tests, fixtures, filenames, commit messages or PR text. Use made-up values.
- Real card or session copies live only in the gitignored `.private-eval/`, under generic filenames.
- CI runs `scripts/check-private-ids.mjs` on every PR. It compares SHA-256 hashes of added lines, paths and commit
  messages with `scripts/private-id-hashes.txt` (hashes only) and fails on a match.

## Known exposures

- **11-18, a dangling commit.** An early push of the coverage-1 branch (PR 17) named a test data file after two real
  kid document ids. The commit was replaced within minutes by an amended commit on the same branch. The old commit
  is no longer on any branch or in the PR, but GitHub can still serve it by its hash to anyone who knows the hash,
  and it may remain cached. Decision: no GitHub Support request. What the commit exposes: two random kid document
  ids (no names, no pin data, no game data). A kid doc id is not a credential: Firestore rules need a signed-in
  parent of that family or a kid token for that exact kid. The ids are not repeated here.
- **A first name in an old test.** `functions/test/kidpin.test.ts` uses a real first name as test data. It predates
  these rules. Replace it with a made-up name in a later change; the CI check only looks at lines a PR adds.
