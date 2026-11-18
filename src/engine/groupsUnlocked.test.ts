import { describe, expect, it } from 'vitest';
import { availableCards, prereqMet, unlockedGroups } from './mastery';
import { DEFAULT_SETTINGS, PRESETS, type KidSettings } from './models';
import { getModule as maybeModule } from './modules';
import { mulberry32 } from './problems';
import { planSession } from './session';

// The parent floor settings.groupsUnlocked, per module. Every value is made up.
const getModule = (id: Parameters<typeof maybeModule>[0]) => maybeModule(id)!;
const prereader = (over: Partial<KidSettings> = {}): KidSettings => ({
  ...PRESETS.prereader,
  modules: { add10: true, sub10: true },
  ...over,
});
const ids = (s: KidSettings) => availableCards({}, s).map((c) => c.id);
const groupIds = (mod: 'add10' | 'sub10', index: number) => getModule(mod).groups![index]!.cardIds;

describe('groupsUnlocked: a parent floor per module', () => {
  it('add10 {add10: 2} opens group 2 on an empty card map; without it only group 1 is open', () => {
    const without = ids(prereader());
    for (const id of groupIds('add10', 0)) expect(without).toContain(id);
    for (const id of groupIds('add10', 1)) expect(without).not.toContain(id);
    const withFloor = ids(prereader({ groupsUnlocked: { add10: 2 } }));
    for (const id of groupIds('add10', 0)) expect(withFloor).toContain(id);
    for (const id of groupIds('add10', 1)) expect(withFloor).toContain(id);
  });

  it('sub10 {sub10: 2} opens group 2 on an empty card map; without it only group 1 is open', () => {
    const without = ids(prereader());
    for (const id of groupIds('sub10', 1)) expect(without).not.toContain(id);
    const withFloor = ids(prereader({ groupsUnlocked: { sub10: 2 } }));
    for (const id of groupIds('sub10', 0)) expect(withFloor).toContain(id);
    for (const id of groupIds('sub10', 1)) expect(withFloor).toContain(id);
  });

  it('the floor is per module: {add10: 2} leaves sub10 group 2 closed, and the reverse', () => {
    const a = ids(prereader({ groupsUnlocked: { add10: 2 } }));
    for (const id of groupIds('sub10', 1)) expect(a).not.toContain(id);
    const b = ids(prereader({ groupsUnlocked: { sub10: 2 } }));
    for (const id of groupIds('add10', 1)) expect(b).not.toContain(id);
  });

  it('both floors together open both group 2s', () => {
    const both = ids(prereader({ groupsUnlocked: { add10: 2, sub10: 2 } }));
    for (const id of [...groupIds('add10', 1), ...groupIds('sub10', 1)]) expect(both).toContain(id);
  });

  it('a floor on a module that is off opens nothing', () => {
    const s = prereader({ modules: { add10: true }, groupsUnlocked: { sub10: 2 } });
    for (const id of groupIds('sub10', 1)) expect(ids(s)).not.toContain(id);
  });

  it('a floor never closes a group that progress opened, and 1 equals no floor', () => {
    expect(ids(prereader({ groupsUnlocked: { add10: 1, sub10: 1 } }))).toEqual(ids(prereader()));
  });

  it('a bad floor is ignored or clamped: 0, negative, above the group count, NaN, a string, null', () => {
    const base = ids(prereader());
    for (const bad of [0, -3, Number.NaN, '2', null, undefined, {}]) {
      expect(ids(prereader({ groupsUnlocked: { add10: bad as never } })), String(bad)).toEqual(base);
    }
    const total = getModule('add10').groups!.length;
    expect(unlockedGroups(getModule('add10'), {}, prereader({ groupsUnlocked: { add10: 99 } }))).toBe(total);
  });

  it('prereqMet treats groups below the floor as known', () => {
    const open = prereader({ groupsUnlocked: { add10: 2 } });
    expect(prereqMet('add10:g1', {}, open)).toBe(true);
    expect(prereqMet('add10:g1', {}, prereader())).toBe(false);
  });

  it('times tables still use factGroupsUnlocked, and groupsUnlocked.facts overrides it', () => {
    const reader = (over: Partial<KidSettings>): KidSettings => ({ ...DEFAULT_SETTINGS, ...over });
    const facts = getModule('facts');
    expect(unlockedGroups(facts, {}, reader({ factGroupsUnlocked: 3 }))).toBe(3);
    expect(unlockedGroups(facts, {}, reader({ factGroupsUnlocked: 1, groupsUnlocked: { facts: 2 } }))).toBe(2);
  });
});

describe('a kid doc with no groupsUnlocked behaves as before', () => {
  const settings = prereader();
  it('availableCards is identical with the field missing, undefined or empty', () => {
    const missing = ids(settings);
    expect(ids({ ...settings, groupsUnlocked: undefined })).toEqual(missing);
    expect(ids({ ...settings, groupsUnlocked: {} })).toEqual(missing);
    expect(missing.length).toBeGreaterThan(0);
  });

  it('planSession output is identical with the field missing, undefined or empty', () => {
    const plan = (s: KidSettings) => planSession({ cards: {}, available: availableCards({}, s), now: 1_700_000_000_000, size: 10, maxNew: 4, rng: mulberry32(7) });
    const base = plan(settings);
    expect(plan({ ...settings, groupsUnlocked: undefined })).toEqual(base);
    expect(plan({ ...settings, groupsUnlocked: {} })).toEqual(base);
  });

  it('with a floor, every planned card comes from the available cards', () => {
    const s = prereader({ groupsUnlocked: { add10: 2, sub10: 2 }, maxNew: 4 });
    const available = availableCards({}, s);
    const plan = planSession({ cards: {}, available, now: 1_700_000_000_000, size: 10, maxNew: 4, rng: mulberry32(7) });
    const open = new Set(available.map((c) => c.id));
    expect(plan.length).toBe(10);
    for (const p of plan) expect(open.has(p.cardId)).toBe(true);
  });
});
