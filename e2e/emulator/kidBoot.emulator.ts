import { expect, test, type Page } from '@playwright/test';

/**
 * A device that is already signed in as a KID must start Auth and Firestore at boot, even though src/authHint.ts skips both
 * for a device with no firebase:authUser key. Runs against the Auth, Firestore and Functions emulators (project demo-e2e)
 * and a dev server in firestore mode wired to them: `npm run test:e2e:emulator`. Names, ids, the email and the PIN are made up.
 *
 * Flow: a fake parent registers, a kid doc gets a PIN (the real setKidPin), the kid signs in through the PIN pad (the real
 * kidSignIn and custom token), an outbox entry is queued, the page reloads, and the boot must (1) show the PIN pad, never Home, until the PIN is typed again,
 * (2) draw the pause screen when settings.pause is written by another client, (3) drain the queued outbox entry.
 */
const PROJECT = 'demo-e2e';
const AUTH = 'http://127.0.0.1:9099';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN = `http://127.0.0.1:5001/${PROJECT}/us-west1`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const KID = { id: 'kidpip000000000000001', name: 'Pip' };
const PIN = '4821';
const RUN_ID = 'run-boot-e2e-0001';

const SETTINGS = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const GAME = { xp: 100, gems: 10, streakDays: 1, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' };

type Fv = Record<string, unknown>;
const fv = (v: unknown): Fv => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fv) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, fv(x)])) } };
};
const fields = (o: object): Fv => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fv(x)]));

async function call(name: string, token: string | null, data: object) {
  const res = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`${name} ${res.status} ${await res.text()}`);
}

/** A fake Google parent in the Auth emulator, registered, with one kid doc that has a PIN. Returns the family uid. */
async function seedFamily(): Promise<string> {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const idp = JSON.stringify({ sub: 'parent-e2e-sub', email: 'parent-e2e@example.com', email_verified: true });
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idp)}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true, returnIdpCredential: true }),
  });
  const { idToken, localId } = (await res.json()) as { idToken: string; localId: string };
  await call('registerParent', idToken, {});
  await fetch(`${FS}/families/${localId}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ pinHash: 'x', createdAt: 1 }) }) });
  // The parent typed the Grown-up PIN a moment ago, which setKidPin needs when a PIN exists.
  await fetch(`${FS}/parentPins/${localId}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ verifiedAt: Date.now() }) }) });
  await fetch(`${FS}/families/${localId}/kids/${KID.id}`, {
    method: 'PATCH',
    headers: OWNER,
    body: JSON.stringify({ fields: fields({ id: KID.id, name: KID.name, createdAt: 1, hasPin: true, settings: SETTINGS, game: GAME }) }),
  });
  await call('setKidPin', idToken, { kidId: KID.id, pin: PIN });
  return localId;
}

const kidDoc = async (fam: string) => (await (await fetch(`${FS}/families/${fam}/kids/${KID.id}`, { headers: OWNER })).json()) as { fields: Record<string, Fv> };

async function queuedRuns(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('mathquest-outbox', 2);
        open.onerror = () => resolve(-1);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('runs')) return resolve(0);
          const r = db.transaction('runs', 'readonly').objectStore('runs').count();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve(-1);
        };
      }),
  );
}

test('a device signed in as a kid starts Auth and Firestore at boot: pause arrives and the outbox drains', async ({ page }) => {
  const fam = await seedFamily();

  // 1. Sign in through the real kid PIN flow, so Firebase Auth writes a real firebase:authUser key.
  await page.goto('/');
  await expect(page.getByTestId('title-play').or(page.getByPlaceholder('First name'))).toBeVisible();
  if (await page.getByTestId('title-play').isVisible()) await page.getByTestId('title-play').click();
  await page.getByPlaceholder('First name').fill(KID.name);
  for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).first().click();
  await expect(page.getByPlaceholder('First name')).toHaveCount(0, { timeout: 20_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const open = indexedDB.open('firebaseLocalStorageDb');
              open.onerror = () => resolve(false);
              open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains('firebaseLocalStorage')) return resolve(false);
                const r = db.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAllKeys();
                r.onsuccess = () => resolve(r.result.some((k) => String(k).startsWith('firebase:authUser:')));
                r.onerror = () => resolve(false);
              };
            }),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);

  // 2. Queue a finished run in the outbox, as a tab that closed before the save landed.
  await page.evaluate(
    ({ kidId, runId }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('mathquest-outbox', 2);
        open.onupgradeneeded = () => {
          const names = open.result.objectStoreNames;
          if (!names.contains('runs')) open.result.createObjectStore('runs', { keyPath: 'runId' });
          if (!names.contains('parked')) open.result.createObjectStore('parked', { keyPath: 'runId' });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const now = Date.now();
          const entry = {
            runId,
            kidId,
            savedAt: now,
            sessionLog: { id: runId, startedAt: now - 60_000, endedAt: now, answered: 5, graded: 5, correct: 5, fast: 0, newLearned: 0, medianMs: 2000, xp: 5, gems: 0, bestCombo: 3, missed: [], mode: 'prereader' },
            gameDelta: { xp: 5 },
          };
          const t = open.result.transaction('runs', 'readwrite');
          t.objectStore('runs').put(entry);
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        };
      }),
    { kidId: KID.id, runId: RUN_ID },
  );
  expect(await queuedRuns(page)).toBe(1);

  // 3. Reload. Auth must start at boot and finds the stored kid session. The PIN is required on every app open, so the app signs it
  // out and shows the pad (never Home). The kid types the PIN again, which is what lets the queued run save.
  const authCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(AUTH)) authCalls.push(r.url());
  });
  await page.reload();
  await expect(page.getByTestId('title-play').or(page.getByPlaceholder('First name')).or(page.locator('.keypad').first())).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Adventure' })).toHaveCount(0);
  await expect.poll(() => authCalls.length, { timeout: 15_000 }).toBeGreaterThan(0);
  if (await page.getByTestId('title-play').isVisible()) await page.getByTestId('title-play').click();
  if (!(await page.getByPlaceholder('First name').isVisible())) {
    const typed = page.getByRole('button', { name: 'Type a name instead' });
    if (await typed.isVisible()) await typed.click();
  }
  await page.getByPlaceholder('First name').fill(KID.name);
  for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).first().click();
  await expect(page.getByRole('button', { name: 'Adventure' })).toBeVisible({ timeout: 20_000 });

  // 4. The queued outbox entry drains: the entry leaves IndexedDB and the server holds the XP and the session log.
  await expect.poll(() => queuedRuns(page), { timeout: 15_000 }).toBe(0);
  await expect
    .poll(async () => (await kidDoc(fam)).fields.game?.mapValue?.fields?.xp?.integerValue, { timeout: 15_000 })
    .toBe('105');
  const log = await fetch(`${FS}/families/${fam}/kids/${KID.id}/sessions/${RUN_ID}`, { headers: OWNER });
  expect(log.status).toBe(200);

  // 5. A pause written by another client (the parent's phone, here the emulator admin) reaches the kid device in 10 s.
  await fetch(`${FS}/families/${fam}/kids/${KID.id}?updateMask.fieldPaths=settings.pause`, {
    method: 'PATCH',
    headers: OWNER,
    body: JSON.stringify({ fields: { settings: fv({ pause: { on: true, setAt: Date.now() } }) } }),
  });
  await expect(page.getByTestId('pause-screen')).toBeVisible({ timeout: 10_000 });
});
