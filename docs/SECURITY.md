# Security: trust boundary

Math Quest keeps its game economy on the device. This file names what Firestore rules enforce and what they leave to the client.

## What the rules enforce

- A family tree `families/{uid}/...` is readable and writable only by that parent, who must have a verified Google email and a `parents/{uid}` doc.
- A kid token (custom token from the `kidSignIn` function, claims `role`, `familyUid`, `kidId`) reaches only its own kid doc, cards and sessions. It writes only the `game` field of the kid doc. Name, settings, pace and PIN flag are parent-only.
- `game.xp`, `game.bestCombo` and the hero list never go down (`gameMonotonicOk`). One write drops gems by at most 100 unless a hero is added (`gemsDropOk`).
- A kid token that adds a hero adds exactly one, a hero in the catalog, and pays exactly its catalog price (`heroPrices`, kept equal to `HEROES` by a unit test). The free knight may come with any gem change.
- A kid token raises `game.gems` by at most 50 and `game.xp` by at most 2000 per write (`kidRaiseOk`). The bounds come from 58 stored sessions (3 kids, 1 family) whose largest run earned 504 xp and 9 gems.
- The purchases log `families/{uid}/kids/{kidId}/purchases/{id}` is readable by the parent only. It has no update and no delete. An entry is created only in the write that adds the hero and spends its price.
- Parent and Admin SDK writes are not bounded by the kid rules. Support corrections run through the Admin SDK.

## What the rules do not enforce (the remaining trust boundary)

- Grading runs on the device. A kid token can claim any run, so it can earn gems and xp up to the bound on every write, and it can repeat writes. The bound limits one tampered write, not the rate.
- A kid token can buy a hero at the catalog price directly on the kid doc, without writing a purchases entry. The purchases log is complete only for purchases made through `applyGameDelta`.
- Deleting a kid leaves its purchases docs behind, since the rules forbid deletes. They stay readable by the parent only.

## Why

The product is a family practice app. Moving grading server-side would add a service to run and does not change who can play. The bounds make a tampered write cost a few gems, not a whole economy. Raise or lower them in `kidRaiseOk` when session size or rewards change, and re-measure first.
