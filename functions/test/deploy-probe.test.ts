import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no types
import { probe } from '../../scripts/deploy-probe.mjs';
import { kidSignIn, type Deps } from '../src/core.js';

// Runs the probe against the emulator, with fetch replaced by a direct call to core.kidSignIn.
let db: Firestore;

beforeAll(() => {
  if (!getApps().length) initializeApp({ projectId: 'demo-mathquest' });
  db = getFirestore();
});

async function snapshot() {
  const out: string[] = [];
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'nameKeys']) {
    const walk = async (ref: FirebaseFirestore.CollectionReference) => {
      for (const doc of await ref.listDocuments()) {
        if ((await doc.get()).exists) out.push(`${doc.path}=${JSON.stringify((await doc.get()).data())}`);
        for (const sub of await doc.listCollections()) await walk(sub);
      }
    };
    await walk(db.collection(col));
  }
  return out.sort();
}

beforeEach(async () => {
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'nameKeys']) await db.recursiveDelete(db.collection(col));
});

const deps = (): Deps => ({ db, auth: { createCustomToken: async (uid, claims) => `h.${Buffer.from(JSON.stringify({ uid, claims })).toString('base64url')}.s` } });

/** Stands in for the deployed function: same core code, wrapped in the callable HTTP shape. */
const fakeFetch = (override?: (name: string, pin: string) => Response | undefined) =>
  (async (_url: string, init: { body: string }) => {
    const { name, pin } = JSON.parse(init.body).data;
    const o = override?.(name, pin);
    if (o) return o;
    try {
      const result = await kidSignIn(deps(), { name, pin, ip: '10.9.9.9' });
      return new Response(JSON.stringify({ result }), { status: 200 });
    } catch (e) {
      const err = e as { message: string; code: string };
      return new Response(JSON.stringify({ error: { message: err.message, status: err.code } }), { status: 403 });
    }
  }) as unknown as typeof fetch;

describe('deploy-probe against the emulator', () => {
  it('passes, and leaves the database as it found it (docs, attempts rows, parent count)', async () => {
    await db.doc('meta/parentCount').set({ count: 7 });
    await db.doc('parents/real-parent').set({ email: 'x@example.com', createdAt: 1 });
    const before = await snapshot();
    const r = await probe({ db, project: 'demo-mathquest', fetchImpl: fakeFetch() });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(await snapshot()).toEqual(before);
  });

  it('leaves nothing behind when the parent count doc did not exist', async () => {
    const r = await probe({ db, project: 'demo-mathquest', fetchImpl: fakeFetch() });
    expect(r.ok).toBe(true);
    expect(await snapshot()).toEqual([]);
  });

  it('works at the 20-parent cap (it writes as the Admin SDK, not through registerParent)', async () => {
    await db.doc('meta/parentCount').set({ count: 20 });
    const r = await probe({ db, project: 'demo-mathquest', fetchImpl: fakeFetch() });
    expect(r.ok).toBe(true);
    expect((await db.doc('meta/parentCount').get()).data()).toEqual({ count: 20 });
  });

  it('fails, and still cleans up, when the deployed function refuses the right PIN (the 11-17 symptom)', async () => {
    const before = await snapshot();
    const refuse = fakeFetch(() => new Response(JSON.stringify({ error: { message: "That name and PIN didn't match", status: 'PERMISSION_DENIED' } }), { status: 403 }));
    const r = await probe({ db, project: 'demo-mathquest', fetchImpl: refuse });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain('right PIN: HTTP 403');
    expect(await snapshot()).toEqual(before);
  });

  it('fails when a wrong PIN signs in', async () => {
    const allow = fakeFetch((name) => new Response(JSON.stringify({ result: { token: `h.${Buffer.from(JSON.stringify({ uid: 'x', claims: {} })).toString('base64url')}.s` } }), { status: 200 }));
    const r = await probe({ db, project: 'demo-mathquest', fetchImpl: allow });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain('wrong PIN: sign-in succeeded');
    expect(await snapshot()).toEqual([]);
  });

  it('fails and cleans up when the network call throws', async () => {
    const boom = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const r = await probe({ db, project: 'demo-mathquest', fetchImpl: boom });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain('ECONNRESET');
    expect(await snapshot()).toEqual([]);
  });
});
