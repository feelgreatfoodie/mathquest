// Shared seed for the first-screen emulator specs (project demo-e2e). Not a spec: Playwright runs only *.emulator.ts.
// Names, ids, the email and the passcodes are made up.
export const PROJECT = 'demo-e2e';
export const AUTH = 'http://127.0.0.1:9099';
export const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
export const FN = `http://127.0.0.1:5001/${PROJECT}/us-west1`;
export const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

export const PIP = { id: 'kidpip000000000000002', name: 'Pip', username: 'pip_runner', pin: '4821', learner: 'reader' };
export const MAYA = { id: 'kidmaya0000000000003', name: 'Maya', username: 'maya_stars', picture: 'abcd', pin: '1357', learner: 'prereader' };

const settings = (learner: string) => ({ learner, modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 });
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
export const fields = (o: object): Fv => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fv(x)]));

export async function call(name: string, token: string, data: object) {
  const res = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ data }) });
  if (!res.ok) throw new Error(`${name} ${res.status} ${await res.text()}`);
}

const put = (path: string, o: object) => fetch(`${FS}/${path}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields(o) }) });

/** config/app.signin2: true, 'pilot', false, or absent. The Admin-style owner token skips the rules, like the release script. */
export async function setSignin2(value: boolean | 'pilot' | null) {
  await put('config/app', { minVersion: 1, ...(value === null ? {} : { signin2: value }) });
}

/** A fake Google parent, registered, with Pip (digits, a username) and Maya (pictures, a username). Returns the family uid. */
export async function seedFamily(): Promise<string> {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const idp = JSON.stringify({ sub: 'parent-door-sub', email: 'parent-door@example.com', email_verified: true });
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idp)}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true, returnIdpCredential: true }),
  });
  const { idToken, localId } = (await res.json()) as { idToken: string; localId: string };
  await call('registerParent', idToken, {});
  await put(`families/${localId}`, { pinHash: 'x', createdAt: 1 });
  await put(`parentPins/${localId}`, { verifiedAt: Date.now() });
  for (const k of [PIP, MAYA]) {
    await put(`families/${localId}/kids/${k.id}`, { id: k.id, name: k.name, createdAt: 1, hasPin: true, username: k.username, settings: settings(k.learner), game: GAME });
    await call('setKidPin', idToken, { kidId: k.id, pin: k.pin });
    // The username index is server-only, so this seed writes it with the owner token. L3 adds the callable that does it.
    await put(`usernames/${k.username}`, { familyUid: localId, kidId: k.id, createdAt: 1 });
  }
  await call('setKidPicturePin', idToken, { kidId: MAYA.id, picture: MAYA.picture });
  return localId;
}

export async function devices(fam: string): Promise<string[]> {
  const res = (await (await fetch(`${FS}/families/${fam}/devices`, { headers: OWNER })).json()) as { documents?: { name: string }[] };
  return (res.documents ?? []).map((d) => d.name.split('/').pop()!);
}
