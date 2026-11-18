import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { PICTURE_ICONS, forgetDeviceKids, pictureCode, readDeviceKids, rememberKids } from './deviceKids';

// The device-local kid cache: hero faces for the Kid tab. It is written only by code that runs after a parent or kid
// sign-in on this device, and read with no network. Names, ids and colors below are made up.
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
let store: ReturnType<typeof mem>;
beforeEach(() => {
  store = mem();
});
const kid = (n: number, over = {}) => ({ kidId: `kid-${n}`, name: `Kid${n}`, hero: 'knight', color: 'blue', ...over });

describe('device kid cache', () => {
  it('starts empty and reads back what was remembered, in order', () => {
    expect(readDeviceKids(store)).toEqual([]);
    rememberKids([kid(1), kid(2, { picture: true })], store);
    expect(readDeviceKids(store).map((k) => k.kidId)).toEqual(['kid-1', 'kid-2']);
    expect(readDeviceKids(store)[1]!.picture).toBe(true);
    expect(readDeviceKids(store)[0]!.picture).toBeUndefined();
  });
  it('keeps only the five fields it needs: no PIN, hash, game, email or family id can be stored', () => {
    rememberKids([{ ...kid(1), pinHash: 'x', hash: 'y', game: { gems: 9 }, email: 'a@example.com', familyUid: 'fam', picturePin: 'abcd' } as never], store);
    const raw = store.m.get([...store.m.keys()][0]!)!;
    expect(Object.keys(JSON.parse(raw)[0]).sort()).toEqual(['color', 'hero', 'kidId', 'name']);
    expect(raw).not.toMatch(/pinHash|hash|gems|example\.com|familyUid|abcd/);
  });
  it('a new list replaces the old one for that device (a removed kid disappears)', () => {
    rememberKids([kid(1), kid(2)], store);
    rememberKids([kid(2)], store);
    expect(readDeviceKids(store).map((k) => k.kidId)).toEqual(['kid-2']);
  });
  it('merging one signed-in kid updates that entry and keeps the others', () => {
    rememberKids([kid(1), kid(2)], store);
    rememberKids([kid(2, { hero: 'wizard', picture: true })], store, { merge: true });
    expect(readDeviceKids(store).map((k) => [k.kidId, k.hero])).toEqual([['kid-1', 'knight'], ['kid-2', 'wizard']]);
  });
  it('reads junk, wrong types and a broken value as empty or skips the bad entries', () => {
    store.setItem('mathquest:v1:device-kids', '{not json');
    expect(readDeviceKids(store)).toEqual([]);
    store.setItem('mathquest:v1:device-kids', JSON.stringify([kid(1), { kidId: 5 }, null, 'x', { kidId: 'ok', name: '', hero: 'knight', color: 'red' }]));
    expect(readDeviceKids(store).map((k) => k.kidId)).toEqual(['kid-1']);
  });
  it('caps the list at 8 kids and the name at 20 characters', () => {
    rememberKids(Array.from({ length: 12 }, (_, i) => kid(i)), store);
    expect(readDeviceKids(store)).toHaveLength(8);
    rememberKids([kid(1, { name: 'N'.repeat(60) })], store);
    expect(readDeviceKids(store)[0]!.name).toHaveLength(20);
  });
  it('forget clears it, and a full or blocked store never throws', () => {
    rememberKids([kid(1)], store);
    forgetDeviceKids(store);
    expect(readDeviceKids(store)).toEqual([]);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => rememberKids([kid(1)], blocked)).not.toThrow();
    expect(readDeviceKids(blocked)).toEqual([]);
    expect(() => forgetDeviceKids(blocked)).not.toThrow();
  });
  it('the module reaches no network and no Firebase: it cannot fetch a family\'s kids', () => {
    const src = readFileSync(new URL('./deviceKids.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/fetch\(|firebase|httpsCallable|XMLHttpRequest|navigator\.sendBeacon/);
  });
});

describe('picture code', () => {
  it('maps 4 icon numbers 0 to 8 to the string a to i the server hashes, repeats allowed', () => {
    expect(PICTURE_ICONS).toBe(9);
    expect(pictureCode([0, 3, 6, 1])).toBe('adgb');
    expect(pictureCode([8, 8, 8, 8])).toBe('iiii');
    expect(pictureCode([0, 0, 0, 0])).toBe('aaaa');
  });
  it('refuses a wrong length or an icon outside 0 to 8', () => {
    expect(() => pictureCode([0, 1, 2])).toThrow();
    expect(() => pictureCode([0, 1, 2, 9])).toThrow();
    expect(() => pictureCode([0, 1, 2, -1])).toThrow();
    expect(() => pictureCode([0, 1, 2, 1.5])).toThrow();
  });
});
