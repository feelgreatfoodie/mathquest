# Math Quest PDR: sign-in, two doors

Approved by Flynn on 2026-11-20 at 01:04Z (relayed by TENSOR, CacheBash task ZcvW6h7dqkHvhPB1rTKB). This PDR covers L1 to L4. L0, the urgent fixes, ships separately: #65 (passcode on every open), #67 (a PIN reset clears the lock) and L0c (no kid reaches Home without a PIN).

The design starts from TENSOR's outline (`claude/math-quest-pdr-login.md`, held on TENSOR's side). It adds VECTOR's review of the code on main 9c25eea and Flynn's corrections. Code references are to that commit.

## 1. Goal

Two doors only.

- **Grown-up door.** A grown-up taps Sign in with Google once and lands in the Grown-ups portal. Teachers use this door and register their students there.
- **Player door.** A player types a unique username plus a passcode and lands on their own Home.

Nobody who is not signed in sees a player's name. The design must hold for 1,000 players on shared school devices.

## 2. Flynn's decisions (fixed)

1. The passcode is required on **every app open, on every device**, personal iPads included.
2. **Every player has a passcode**: 4 digits or 4 pictures. The wizard makes it mandatory, and no path reaches Home without one.
3. **Remember a player on a device** after the first sign-in, as a picture tile. The tile skips typing the username, never the passcode. A grown-up can forget the device.
4. Player sign-in works on a device where **no grown-up ever signed in**.
5. The grown-up sets the username and passcode. The app can suggest a username.
6. A **setup wizard** registers players.
7. **Usernames are globally unique. Passcodes are not.**
8. **Offline cold start is dropped.** A player needs the network to sign in, and the offline verifier (outline 4.8) is not built.
9. **Flynn sets the existing players' usernames** before L4.
10. **L4's minVersion raise is manual**, at a time Flynn picks. No other PR raises minVersion.

## 3. What exists today (review of main 9c25eea)

| Outline item | Today | Status |
|---|---|---|
| `kidSignIn` returns a custom token | `{name, pin}` in, token `kid_{kidId}` with claims `role`, `familyUid`, `kidId` out (`functions/src/core.ts:274-306`) | exists, takes a display name |
| Kid token reaches only its own subtree | `isKid` in `firestore.rules:42-47`; a kid cannot read `families/{uid}` | exists |
| Grown-up areas need Google | `isParent` needs a verified email plus `parents/{uid}` | exists |
| Grown-up PIN | client-side SHA-256 of `mathquest:{uid}:{pin}` in `families/{uid}.pinHash`, checked in the client with no lockout (`src/data/repo.ts:111-115`, `src/App.tsx:456`) | differs: brute-forceable from devtools |
| Passcode hashes server-only | scrypt with a 16-byte salt per PIN in `pinIndex/{familyUid}/kids/{kidId}`; rules deny all client access | exists |
| Pepper in Secret Manager | none | missing |
| App Check | none, in the client or the functions | missing |
| One generic error | "That name and PIN didn't match", with a dummy scrypt for unknown names | exists |
| Lockout | per IP 5/15 min, per name 10/h, per family 20/h, fixed window (`core.ts:29-33`) | differs: no doubling, no per-device limit, and an IP cap that locks a classroom |
| Unique usernames | `nameKeys` makes display names globally unique | partly: the display name is the username |
| Name lookup | `findRows` runs one query per registered family, one after another (`core.ts:249-262`) | differs: cost grows with the number of families |
| Remember device | localStorage `mathquest:v1:device-kids`, up to 8 faces with names (`src/data/deviceKids.ts`) | differs: names show to anyone |
| Forget device | `forgetDeviceKids` exists and nothing calls it | missing |
| School mode, wizard, printable card, username suggestion | none | missing |
| Function capacity | `maxInstances: 5`, no `minInstances` (`functions/src/index.ts:14`) | differs: a class of 30 queues at the bell |
| Parent cap | `MAX_PARENTS = 20` (`core.ts:27`) | to raise when schools join |

## 4. Design

### 4.1 Usernames and display names

- **Username:** 3 to 20 characters, letters, digits and `_` only, compared lowercase. It is globally unique, and the grown-up sets it. It is not secret: a player types it and the printable card shows it.
- **Display name:** the existing `kids/{kidId}.name`. It is private. Only the family's grown-ups and the signed-in player see it.
- **Index:** `usernames/{usernameLower}` holds `{familyUid, kidId, createdAt}`. It is server-only: rules deny all client reads and writes. `kidSignIn` reads it with one `get`, so cost stays flat at any number of families.
- The kid doc carries `username` so the portal can show it. A kid token can read it on its own doc.
- **Suggestion:** a callable `suggestUsername()` returns 3 free names built from a word list (animal plus color plus 2 digits). It never uses the display name. `checkUsername(name)` answers free or taken. Both are parent-only and rate limited per parent (30 per minute).
- **Reserved names:** a server list blocks offensive words and impersonation words (admin, teacher, grownup, parent, mathquest).

### 4.2 Passcodes and hashing

- 4 digits or 4 pictures (letters a to i), as today. The picture passcode stays an alternative on the same player row.
- **Hash v2:** scrypt with the per-row salt, keyed with a pepper held in Secret Manager (`MQ_PIN_PEPPER`) and bound to the functions as a secret. Rows carry `v: 2`.
- **Lazy migration from v1:** `kidSignIn` verifies a v1 row with the old scrypt. On a match, it rewrites the row as v2 in the same call. A wrong passcode never rewrites. No player gets locked out by the migration, and no batch job touches hashes.
- The pepper rotates only by a planned v3. The PDR does not cover rotation.

### 4.3 Player sign-in: `kidSignIn(username, passcode, deviceId)`

1. Validate the input shape. Normalize the username to lowercase.
2. Count the attempt in every bucket below **before** checking the passcode, as today, and refund on success.
3. Read `usernames/{lower}`. On a miss, run one dummy scrypt so timing matches, then return the generic error.
4. Verify the hash (v1 or v2), migrating v1 on a match.
5. Mint the custom token `kid_{kidId}` with the existing claims. Record the device (4.6).
6. Return `{token, remember}`. `remember` is false when the family has school mode on.

**Legacy path during L1 to L3:** when the username index has no entry and the input matches a display name, fall back to today's `findRows` path. Existing players keep signing in with their names until Flynn sets their usernames. L4 deletes the fallback.

**Errors:** one generic message for a wrong username or a wrong passcode: "That username and passcode didn't match." The lock message stays "Too many wrong tries. Ask a grown-up to open Grown-ups and tap Unlock." (#67).

### 4.4 Lockout and rate limits

| Bucket | Limit | On lock |
|---|---|---|
| per username | 5 wrong in a row | locked 5 min, doubling per repeat lock to a 1 h cap; reset by a success or a grown-up Unlock or passcode reset |
| per device (`deviceId`) | 20 wrong per 15 min | locked 15 min |
| per network (client IP) | 50 wrong per 15 min | locked 15 min; sized for a classroom behind one NAT |
| per family | 100 wrong per hour | locked 1 h; Unlock in the portal |

- The per-username and per-device buckets carry the load. The network cap is a backstop against spraying.
- `deviceId` is a random 128-bit id that the client stores in localStorage and sends on each call. From L2 on, the client always sends one. Until L4, a missing or malformed id skips the device bucket, because clients from before L2 send none; the username, network and family buckets still apply. After L4's minVersion raise, a missing id counts against a shared "no device" bucket at the per-device limit.
- The portal Unlock (`unlockKidSignIn`) and a passcode reset (#67) clear the username, family and device buckets. They clear the network bucket only when that bucket has counted this family alone, as #67 does.
- `kidLockStatus` returns locked players by display name to their own grown-ups only.

### 4.5 Grown-up PIN as a callable

- New callable `checkParentPin(pin)`. It is parent-only and returns `{ok}`. It locks 5 min after 5 wrong tries, doubling to a 1 h cap, per parent uid. Unlock is by Google sign-in again, which happens on a new device anyway.
- The hash moves to a server-only `parentPins/{uid}` row (scrypt v2 with the pepper). `setParentPin(pin)` writes it.
- **Migration:** on the first `checkParentPin` for a parent with no `parentPins` row, the server reads `families/{uid}.pinHash` and compares the SHA-256 server-side. On a match it writes the v2 row and deletes `pinHash`. After L1, rules deny client reads of `pinHash`.
- The client stops computing or comparing any PIN hash.

### 4.6 Devices, remembered tiles, Forget device

- After a successful sign-in, the server writes `families/{uid}/devices/{deviceId}`: `{firstSeen, lastSeen, kids: [kidId], label}`. The label is the user-agent family, for example "iPad Safari". Grown-ups can read the collection and rename a device. Clients cannot create devices.
- **Tiles** on the first screen show the player's hero and color only, with **no name**. A tile holds the username in localStorage. Tapping a tile opens the passcode pad directly.
- **Forget device:** the portal lists devices with Forget. Forget sets `revoked: true`. The next `kidSignIn` from that device returns `failed-precondition` "This device was forgotten. Ask a grown-up." The client then clears its tiles. Every open already needs a passcode, so a forgotten device's tiles expose a hero picture at most.
- **School mode:** a family setting, off by default. When on, `kidSignIn` returns `remember: false`, the client writes no tile, and Back on Home signs out to a blank username form.

### 4.7 Passcode on every open

#65's client rule stays the law: a kid session restored from storage signs out and shows the pad. L2 keeps #65's emulator test and adds the tile path to it. Token TTL alone does not enforce this, because refresh tokens persist.

### 4.8 App Check

- The client uses App Check with reCAPTCHA Enterprise on web. iPad Safari and the installed PWA both support it.
- L1 deploys it in **monitor mode**: functions log verdicts and do not enforce.
- L3 turns on `enforceAppCheck: true` for `kidSignIn`, `checkParentPin`, `suggestUsername` and `checkUsername`, after 7 days of monitor logs show the kids' devices passing.

### 4.9 Capacity

`kidSignIn` gets `minInstances: 1` and `maxInstances: 20`. The other callables get `maxInstances: 10`. `MAX_PARENTS` rises from 20 to 200 when Flynn admits a school. That number is his call, and the PDR only makes it a config value.

### 4.10 First screen

- Two buttons: "I'm a player" and "Grown-ups". Below them sit the remembered tiles, with pictures only.
- "I'm a player" opens the username form, then the passcode pad (digits, or pictures for pre-readers, chosen per player on the server and returned by a public `passcodeKind(username)` callable). That callable is rate limited and answers the same for unknown names.
- No list of names anywhere before sign-in.

### 4.11 Wizard (Grown-ups)

Welcome, then a player's display name and hero, then a username (with the suggestion button), then a passcode typed twice (digits or pictures, mandatory), then the starting point (reader or pre-reader, modules), then a printable sign-in card showing the username and hero but never the passcode, then "add another". Teachers use the same wizard and can add many players in a row.

## 5. Delivery, each PR deployable on its own

| PR | Scope | Gate |
|---|---|---|
| **L1a server core** | `usernames` index; `kidSignIn` v2 with the legacy fallback; the 4 buckets in 4.4; pepper and lazy migration; device records; instance settings; App Check in monitor mode | 3-voter panel (functions and rules) |
| **L1b grown-up PIN** | `checkParentPin`, `setParentPin`, `parentPins`, server-side SHA-256 migration, rules deny `pinHash` reads, client switched to the callable | 3-voter panel |
| **L2 first screen** | two doors, picture-only tiles, username form, `passcodeKind`, deviceId, behind `config/app.signin2` (default off, Flynn's family first) | review; panel if rules change |
| **L3 wizard and portal** | wizard, `suggestUsername`, `checkUsername`, username set and reset, Forget device, school mode, App Check enforced | 3-voter panel (reset and username writes) |
| **L4 migration and removal** | after Flynn sets every existing username: remove the legacy name path, `nameKeys` lookups, the open name list and `signin2` flag; then the manual minVersion raise at Flynn's time | 3-voter panel; Flynn picks the time |

Order: L1a, then L1b and L2 in parallel, then L3, then L4. Sign-in work does not displace the item-powers queue (M8siKQbS) beyond what ISO schedules.

## 6. Tests every PR carries

- Each new test runs red on the code before the fix, as the house rule requires.
- Emulator tests (CI does not run them, so the builder and ISO paste local counts in the PR): username sign-in, legacy fallback, generic error and equal timing on a miss, each bucket's lock and unlock, doubling, lazy migration (v1 then v2, and a wrong passcode never rewrites), `checkParentPin` lockout, Forget device, school mode.
- e2e: no path reaches a player's Home without the pad (cold start, reload, tile, player switch, Grown-ups and back). No player name is visible before sign-in at any viewport. Tap targets stay at 120 px for pre-readers. The iPad fit guard passes.
- Rules tests: clients cannot read `usernames`, `pinIndex`, `parentPins`, the attempt counters or `pinHash` after L1b.

## 7. Rules for the whole project

- No kid's real name or id in the repo, PR text, tests, logs or screenshots. Use fixture players.
- Never rewrite or reduce any player's XP, gems, cards, sessions or world.
- No minVersion change outside L4's planned raise.
- Every functions or rules PR goes through a 3-voter panel before merge.

## 8. Open questions for Flynn (not blocking L1)

1. The `MAX_PARENTS` number for the first school.
2. Whether a teacher's class is one "family" (one grown-up account, many players) or one family per teacher with a class label. Today's rules model one family per grown-up account. L3 assumes one teacher account holds the class.
