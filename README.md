# Math Quest

An adaptive math practice game for iPad. Kids fight through a retro dungeon by answering
times tables, multi-digit multiplication and fraction problems. Behind the game, a
spaced-repetition engine (FSRS) decides what each kid sees, and how soon, based on
whether they were right and how fast they answered.

- **Stack:** React 19 + TypeScript + Vite, installable PWA, Firebase Hosting + Auth (Google) + Firestore
- **Live:** https://math.rezzed.ai (also https://rezzed-mathquest.web.app, kept for existing installs).
- **Kids:** multiple profiles per family. A kid signs in on any device with a first name and a 4-digit PIN that a parent sets.
- **Offline:** Firestore's IndexedDB cache plus a service worker. It plays without Wi-Fi and syncs later.
- **Privacy:** no analytics or third-party SDKs beyond Firebase. Data lives in your GCP project
  under your Google account's uid. The only personal data is the kid's first name.

## Quick start (no Firebase needed)

```bash
npm install
npm run dev:local      # progress is saved in this browser only
npm test               # engine tests
```

Open the printed URL on the iPad (same network) or in a desktop browser at iPad size.

## Deploy to GCP (Firebase)

You need the Firebase CLI: `npm i -g firebase-tools && firebase login`.

1. **Add Firebase to a GCP project** (new or existing):
   `firebase projects:addfirebase YOUR_GCP_PROJECT_ID`
2. **Turn on Google sign-in:** Firebase console → Authentication → Sign-in method → Google → Enable.
3. **Create Firestore:** Firebase console → Firestore → Create database → Native mode. Pick a
   region near you (e.g. `us-west1`). The rules file below locks it down, so start in production mode.
4. **Register a web app:** Project settings → Your apps → Web. Copy the config into `.env.local`:
   ```bash
   cp .env.example .env.local   # fill in API key, auth domain, project id, app id
   cp .firebaserc.example .firebaserc   # set your project id
   ```
5. **Parent sign-up is open, capped at 20.** Any verified Google account can sign in. On first sign-in
   the app calls the `registerParent` function, which writes `parents/{uid}` and bumps
   `meta/parentCount` in one transaction. At 20 it answers "Math Quest is full right now." and the app
   signs the visitor out. Raise `MAX_PARENTS` in `functions/src/core.ts` to let more families in.
   Firestore rules let only a registered parent (a `parents/{uid}` doc) touch `families/{uid}`.
   Nobody can read or write `parents/`, `meta/` or `nameKeys/` from a client. Kid names are unique
   across all families (case-insensitive); a taken name is refused with a last-initial hint.
6. **Deploy hosting + functions + rules + indexes.** `firestore.rules` is the deployed file and no
   secret config remains. The functions runtime service account needs
   `roles/iam.serviceAccountTokenCreator` on itself, so `createCustomToken` can sign:
   ```bash
   npm run deploy
   ```
   Moving an existing project to the registry: deploy the functions first, run the backfill
   (`node scripts/backfill-parents.mjs --project YOUR_PROJECT`, then again with `--apply`), then
   deploy the rules. The backfill registers every existing family from Firestore and Auth and claims
   the names of existing kids. It commits no uids or emails.
   After every functions deploy, run the live probe (ADC with Firestore access):
   `node scripts/deploy-probe.mjs --project YOUR_PROJECT`. It seeds a throwaway parent, family and kid,
   calls the deployed `kidSignIn` with the right PIN (expects a kid token) and a wrong PIN (expects the
   generic error), then deletes everything. Exit 0 = pass. The emulator needs no IAM, so only this catches
   a missing runtime role (11-17: `firebaseauth.viewer`).
   The probe also fetches the served page and its scripts (`--url https://your-live-site`, default
   `https://YOUR_PROJECT.web.app`) and fails unless a script contains the project id, so a bundle built
   with no Firebase config cannot pass.
   `npm run build` refuses to run when `VITE_FIREBASE_PROJECT_ID` or `VITE_FIREBASE_API_KEY` is empty
   (set them in `.env.local` or the shell; a fresh worktree has no `.env.local`). Set
   `VITE_DATA_MODE=local` for a local-mode build on purpose.
7. **On the iPad:** open `https://YOUR_PROJECT.web.app` in Safari, sign in with Google, set a parent
   PIN, add each kid. Then Share → **Add to Home Screen** so it opens full screen like an app.

A custom domain works too (Hosting → Add custom domain). Add it under Authentication → Settings →
Authorized domains.

### Local emulators

```bash
npm run emulators                       # auth, firestore, hosting on localhost
VITE_USE_EMULATORS=true npm run dev     # app talks to the emulators
```

### Production project setup (rezzed-mathquest, 2026-11-17)

Deploys run by hand with `npm run deploy` on application default credentials of an org account
(`GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/application_default_credentials.json`). The org
blocks gmail project owners. These one-time settings exist in `rezzed-mathquest` only:

- **Custom domain** `math.rezzed.ai`: Firebase Hosting custom domain on site `rezzed-mathquest`, Cloudflare
  CNAME `math` to `rezzed-mathquest.web.app` with proxy off (DNS only), so Firebase issues the certificate.
  It is also listed in Firebase Auth authorized domains. `rezzed-mathquest.web.app` serves the same app, with
  no redirect.
- **Domain restricted sharing** (`iam.allowedPolicyMemberDomains`) is overridden to allow all on this
  project. The callables need the `allUsers` invoker, because `kidSignIn` runs before anyone signs in.
  The other four check the caller in code.
- **Functions runtime service account** `mathquest-fn@rezzed-mathquest.iam.gserviceaccount.com`
  (set in `functions/src/index.ts`). It has `roles/datastore.user` on the project and
  `roles/iam.serviceAccountTokenCreator` on itself, so `createCustomToken` can sign kid tokens.
- **Build service account.** The project's default compute account runs the functions build. It has
  `roles/cloudbuild.builds.builder`. The org turns off automatic role grants, and without that role
  every functions build fails.

### Stale bundles and the release gate (minVersion)

A tablet can keep an old bundle for days. An old bundle's writes can be refused by newer rules, and before this gate
the player saw nothing. Now:

- Every build has a number (seconds since the epoch at build time), baked into the bundle and written to `dist/version.json`.
- `config/app` in Firestore holds `{ minVersion }`. Rules: any signed-in account reads it, no client writes it.
- The app reads it after sign-in and when it comes back to the front. A bundle behind `minVersion` offers the update
  on the home screen (one big picture button and a voice for a pre-reader, two lines of text for everyone else) and
  starts no new run. It never interrupts a round and never blocks a save: the summary saves first, then shows an
  update prompt. The server rules guard the data. A missing doc, a bad value or no network lets the app run.
- A write that the server refuses (`permission-denied`) shows "Couldn't save. Tap to update or try again." with an
  Update button. The Update button asks the service worker for the new release and reloads. A second tap drops the
  worker and every cache, then reloads. A bundle at or above `minVersion` clears that state after the reload.
- **A finished run is kept in IndexedDB (the outbox) until the server confirms it.** Each run's session log, game delta
  and run id (the session log id) are stored before the writes. The outbox entry is removed once `applyGameDelta`
  (session log and game totals in one transaction) succeeds. A refused or offline save stays in the outbox. The next
  launch and the Try again button replay it, in order, idempotent by run id: a run whose session log is already stored
  writes nothing.
- **A deploy does not touch minVersion.** `npm run deploy` builds and deploys only. Raise minVersion by hand, only when
  a release breaks older clients (a rules or schema change that would refuse their writes):
  `node scripts/set-min-version.mjs --from-firebaserc --force` after the deploy. The script waits until the live site
  serves this build in `/version.json`, refuses to lower an existing minVersion without `--force`, writes `config/app`
  through the Admin SDK (application default credentials), and reads it back. `--dry-run` shows what it would write.
  Every bump turns every open device stale, so batch it with a release that needs it.
- To open the gate again by hand, delete `config/app` or set `minVersion` to 0 with the Admin SDK.
- A bundle built before this release has no gate. Those are covered only by the rules and the service worker's auto
  update; the first tap of Update on any newer bundle fixes the rest.

### CI/CD (GitHub Actions)

`.github/workflows/deploy.yml` runs typecheck and tests on every push and PR. Its deploy job is off
(`if: false`) until Workload Identity Federation is approved and configured. To turn it on, set these
repository **variables** and remove the `if: false`:

| Variable | Value |
| --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Web app config |
| `GCP_WIF_PROVIDER` | `projects/NUM/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` |
| `GCP_DEPLOY_SA` | Deploy service account email |

Deploy service account roles: Firebase Hosting Admin, Firebase Rules Admin,
Cloud Datastore Index Admin, Service Usage Consumer.

## How the adaptive engine works

All of it lives in `src/engine/` as pure TypeScript with no UI or Firebase imports, and is covered by `engine.test.ts`.

**Cards.** There are two kinds (`content.ts`):

- **Fact cards:** one per unordered pair, 0–12 (91 cards). Each review asks the same fact, in a random order.
- **Skill cards:** one per problem family (`md:2x1r` = 2-digit × 1-digit with regrouping,
  `fr:msubr` = subtract mixed numbers with regrouping, …). Each review generates a fresh problem
  (`problems.ts`), so the kid practices the method instead of memorizing one answer.

**Grading** (`grading.ts`). Each first attempt per run is turned into an FSRS grade:

| Result | Grade |
| --- | --- |
| Wrong | Again |
| Right amount, wrong form (e.g. `3 10/8` instead of `4 2/8`) | Hard |
| Right and slow | Hard |
| Right, normal speed | Good |
| Right and fast | Easy |

The speed limits for facts adapt to the kid's own typical time (median of recent correct answers).
"Fast" starts at 3 s and tightens toward 1.5 s as the kid speeds up. Skills have fixed limits per family.

**Scheduling** (`scheduler.ts`). `ts-fsrs` aims for 90% recall, with a 120-day maximum interval
and fuzz turned on. FSRS's short-term steps are off. Within a run, misses and slow answers come back
3 questions later as ungraded practice, so FSRS only sees one grade per card per day.

**Runs** (`session.ts`). Each run, in order:

1. Due cards, the ones the kid is most likely to have forgotten first.
2. New cards in curriculum order, up to the parent's limit, with at most 2 new skills.
3. "Practice ahead" on the weakest cards if there is still room.

Early on, when there is little history, the rest of the run is filled with probes of unseen facts.
A fast, correct answer on a never-seen fact means the kid already knows it, so the first runs
work as a placement test. A new skill opens with a worked example before the first try.

**Unlocking** (`mastery.ts`). Times tables come in 5 groups:

1. 0s, 1s, 2s, 5s, 10s
2. 3s and 4s
3. 9s and 11s
4. 6s, 7s, 8s
5. 12s

The next group opens when 80% of the current one is past "learning." Skills open when their
prerequisites are solid, for example fraction × whole needs adding fractions and the 3s and 4s.
A parent can open fact groups early.

**Mastery levels** (shown in the parent heatmap):

| Level | Meaning |
| --- | --- |
| Not started | Never seen |
| Learning | Seen, but the last answer was a miss or the memory is still weak |
| Reviewing | Remembered for about 2 days or more |
| Solid | Remembered for about 7 days or more, after at least 2 good reviews |
| Fluent | Solid, and the kid's typical time is under the fast limit |

**Game layer** (`game.ts`, `ui/`). XP, levels, gems, daily streaks, combos, and a hero shop.
Every 5 questions is a new monster and the last 5 are the boss. There are no countdown timers:
speed earns a bonus but never costs anything.

## Parent area

Behind a 4-digit PIN (stored as a salted SHA-256 hash). It shows, per kid:

- A 0–12 heatmap of fact mastery, with facts missed 3 or more times outlined.
- Lists of "keeps slipping" and "right but slow" facts.
- Skill status, recent runs, and minutes this week.
- Settings: tracks, questions per run, new cards per run, starting fact group.

## Kid sign-in (name + PIN, any device)

Opening the site with no session shows "Who's playing?": a first name (any capitalization) and a
4-digit PIN. The `kidSignIn` Cloud Function checks them and returns a custom token with
`role: kid`, `familyUid` and `kidId`. Rules let that token reach only that kid's doc, cards and
sessions. Parents set each kid's PIN in the parent area (`setKidPin`). PIN hashes (scrypt, per-kid
salt) and attempt counters live in `pinIndex/*`, which no client can read.

Limits: 5 wrong PINs per IP in 15 min, 10 per name in 1 h, 20 per family in 1 h. The parent area
shows the lock and an Unlock button.

Tests: `npm test` (engine), `npm run test:emulator` (rules + functions; needs Java for the Firestore emulator).

## Data model (Firestore)

```
families/{uid}                              { pinHash, createdAt }
families/{uid}/kids/{kidId}                 { id, name, createdAt, settings, game, hasPin }
families/{uid}/kids/{kidId}/cards/{cardId}  { id, fsrs: {due, stability, difficulty, reps, lapses, state, …}, attempts, correct, recentMs[], lastRating, updatedAt }
families/{uid}/kids/{kidId}/sessions/{id}   { startedAt, endedAt, graded, correct, fast, newLearned, medianMs, xp, gems, missed[] }
```

Each card is saved after every answer, and the changed cards are saved together again at the end of
the run. A 30-question run is about 60 small writes, which is well inside Firestore's free tier.

## Project layout

```
src/engine/     curriculum, generators, fractions, FSRS wrapper, grading, session planner/runner, game rules (+ tests)
src/data/       Repo interface, FirestoreRepo, LocalRepo
src/ui/         keypad, fraction entry, pixel sprites (SVG), screens: kid, run, parent
firestore.rules owner-only access, registered parents only (parents/{uid})
```

## Tuning knobs

| What | Where |
| --- | --- |
| Target recall, max interval | `scheduler.ts` (`request_retention`, `maximum_interval`) |
| Fact speed limits | `grading.ts` (`factThresholds`) |
| Skill speed limits, prerequisites, strategy tips | `content.ts` (`SKILL_CARDS`) |
| Group unlock share, level cutoffs | `mastery.ts` |
| Retry gap, XP and gem rules | `session.ts` |
| Hero prices | `game.ts` |

## Ideas for next

- Division facts, tied to their multiplication facts.
- Equivalent and comparing fractions, needed before unlike denominators.
- A weekly parent email from a scheduled Cloud Function.
- Export review logs to BigQuery to fit per-kid FSRS parameters once there are a few hundred reviews.
