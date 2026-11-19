import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { availableCards, groupProgress, unlockedGroups } from './mastery';
import { DEFAULT_SETTINGS, PRESETS, modulesOf, withModule, type CardMap, type KidSettings } from './models';
import { MODULES, cardLabel, getCardDef, getModule, moduleOfCard, type ModuleDef, type ModuleId } from './modules';
import { WORDS, add20Id, bondId, dblId, missId, nearId, word } from './modules/early';
import { CHOICE_MAX, generateProblem, mulberry32 } from './problems';
import { newCardState, review } from './scheduler';
import { SessionRunner } from './session';
import { strategyCue } from './support';

const T0 = new Date('2026-11-16T16:00:00').getTime();
const NEW_IDS: ModuleId[] = ['bonds10', 'missing10', 'doubles', 'add20'];
const mod = (id: ModuleId): ModuleDef => getModule(id)!;
const PRE_ON = (...ids: ModuleId[]): KidSettings => ({ ...PRESETS.prereader, modules: { add10: false, ...Object.fromEntries(ids.map((i) => [i, true])) } });

/** Cards seen with a steady last two answers: what the pre-reader unlock ladder counts. */
function steadyCards(ids: string[]): CardMap {
  const out: CardMap = {};
  for (const id of ids) out[id] = { ...review(newCardState(id, T0), Rating.Easy, 2000, true, T0), lastResults: [true, true] };
  return out;
}

describe('the four new modules are in the registry', () => {
  it('are live pre-reader choice modules with groups, in registry order after sub10', () => {
    expect(MODULES.map((m) => m.id).slice(0, 6)).toEqual(['add10', 'sub10', 'bonds10', 'missing10', 'doubles', 'add20']);
    for (const id of NEW_IDS) {
      const m = mod(id);
      expect(m.status).toBe('live');
      expect(m.audience).toBe('prereader');
      expect(m.input).toBe('choices');
      expect(m.groups!.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('are off by default: no preset, no stored doc and no settings default turns them on', () => {
    for (const s of [PRESETS.prereader, PRESETS.reader, DEFAULT_SETTINGS]) for (const id of NEW_IDS) expect(modulesOf(s)[id]).toBe(false);
    expect(availableCards({}, PRESETS.prereader).some((c) => /^(bond|miss|dbl|near|a20):/.test(c.id))).toBe(false);
  });

  it('turn on one at a time with withModule, and only then give cards', () => {
    const on = withModule(PRESETS.prereader, 'bonds10', true);
    expect(modulesOf(on).bonds10).toBe(true);
    expect(modulesOf(on).missing10).toBe(false);
    expect(availableCards({}, on).some((c) => c.id.startsWith('bond:'))).toBe(true);
    expect(availableCards({}, on).some((c) => c.id.startsWith('miss:'))).toBe(false);
  });

  it('look every card up by its id prefix', () => {
    expect(moduleOfCard('bond:3')?.id).toBe('bonds10');
    expect(moduleOfCard('miss:4+_=7')?.id).toBe('missing10');
    expect(moduleOfCard('dbl:6')?.id).toBe('doubles');
    expect(moduleOfCard('near:6')?.id).toBe('doubles');
    expect(moduleOfCard('a20:5+8')?.id).toBe('add20');
    for (const id of NEW_IDS) for (const c of mod(id).cards) expect(moduleOfCard(c.id)?.id, c.id).toBe(id);
  });

  it('have the card counts the plan says, with unique ids, every card in exactly one group', () => {
    expect(mod('bonds10').cards).toHaveLength(11);
    expect(mod('missing10').cards).toHaveLength(45);
    expect(mod('doubles').cards).toHaveLength(19);
    expect(mod('add20').cards).toHaveLength(30);
    const all = MODULES.flatMap((m) => m.cards.map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);
    for (const id of NEW_IDS) {
      const m = mod(id);
      const grouped = m.groups!.flatMap((g) => g.cardIds);
      expect([...grouped].sort()).toEqual(m.cards.map((c) => c.id).sort());
      for (const g of m.groups!) expect(g.cardIds.length, `${id} ${g.id}`).toBeGreaterThan(0);
    }
  });

  it('give doubles and add20 a pad up to 20, and the others a pad up to 10', () => {
    expect(mod('doubles').padMax).toBe(20);
    expect(mod('add20').padMax).toBe(20);
    expect(mod('bonds10').padMax ?? 10).toBe(10);
    expect(mod('missing10').padMax ?? 10).toBe(10);
  });

  it('label their cards: "3 + ? = 10" for a missing addend, "8 + 5" for a sum', () => {
    expect(cardLabel(bondId(3))).toBe('3 + ? = 10');
    expect(cardLabel(missId(4, 7))).toBe('4 + ? = 7');
    expect(cardLabel(dblId(6))).toBe('6 + 6');
    expect(cardLabel(nearId(6))).toBe('6 + 7');
    expect(cardLabel(add20Id(8, 5))).toBe('5 + 8');
  });
});

describe('questions from the new modules', () => {
  const sumOf = (t: { t: string; v?: number }[]) => (t[0]!.v as number) + (t[2]!.v as number);

  it('are right for every card and many seeds, with 4 distinct choices in 0 to 20 that include the answer', () => {
    for (const id of NEW_IDS) {
      for (const c of mod(id).cards) {
        for (let seed = 1; seed <= 6; seed++) {
          const p = generateProblem(c.id, mulberry32(seed * 7 + 1));
          const ans = (p.answer as { value: number }).value;
          if (p.gap) {
            expect(ans, c.id).toBe(p.gap.total - p.gap.a);
            expect(p.gap.total, c.id).toBeLessThanOrEqual(10);
          } else expect(ans, c.id).toBe(sumOf(p.tokens as never));
          expect(p.choices, c.id).toHaveLength(4);
          expect(new Set(p.choices).size, c.id).toBe(4);
          expect(p.choices).toContain(ans);
          for (const v of p.choices!) expect(v >= 0 && v <= CHOICE_MAX && Number.isInteger(v), `${c.id} ${v}`).toBe(true);
          expect(p.speech, c.id).toBeTruthy();
          expect(p.hint, c.id).toBeTruthy();
          expect(p.visual, c.id).toBeTruthy();
        }
      }
    }
  });

  it('show a missing addend with the ten-frame gap, and say what the voice says on a right answer', () => {
    const p = generateProblem(bondId(3), mulberry32(1));
    expect(p.gap).toEqual({ a: 3, total: 10 });
    expect(p.speech).toBe('three plus what makes ten');
    expect(p.confirm).toBe('Three plus seven makes ten');
    const m = generateProblem(missId(4, 7), mulberry32(1));
    expect(m.gap).toEqual({ a: 4, total: 7 });
    expect((m.answer as { value: number }).value).toBe(3);
  });

  it('keep every distractor close: within 2 of the answer, or the one common error', () => {
    const common = (id: string, a: number, b: number, ans: number): number =>
      id.startsWith('bond:') ? a : id.startsWith('miss:') ? a + b : id.startsWith('a20:') ? ans - 10 : Math.max(a, b);
    for (const id of NEW_IDS) {
      for (const c of mod(id).cards) {
        if (c.kind !== 'fact') continue;
        const p = generateProblem(c.id, mulberry32(11));
        const ans = (p.answer as { value: number }).value;
        for (const v of p.choices!) if (v !== ans) expect(Math.abs(v - ans) <= (ans <= 1 ? 3 : 2) || v === common(c.id, c.a, c.b, ans), `${c.id} ${v}`).toBe(true);
      }
    }
  });

  it('read numbers to twenty', () => {
    expect(WORDS).toHaveLength(21);
    expect(word(13)).toBe('thirteen');
    expect(word(20)).toBe('twenty');
    expect(generateProblem(dblId(10), mulberry32(1)).speech).toBe('ten plus ten');
  });
});

describe('strategy cues for the new modules', () => {
  const cue = (id: string) => strategyCue(generateProblem(id, mulberry32(1)));

  it('say "7 + 7, double!" for a double', () => {
    expect(cue(dblId(7))).toMatchObject({ kind: 'double', text: '7 + 7, double!' });
  });
  it('say "6 + 6, and 1 more!" for a near double', () => {
    expect(cue(nearId(6))).toMatchObject({ kind: 'neardouble', text: '6 + 6, and 1 more!' });
  });
  it('split a sum over 10 by making ten: "8 + 5 = 8 + 2 + 3"', () => {
    expect(cue(add20Id(8, 5))).toMatchObject({ kind: 'split10', text: '8 + 5 = 8 + 2 + 3', big: 8, small: 5, gap: 2 });
  });
  it('say "10 + 4" when the bigger number is already ten', () => {
    expect(cue(add20Id(10, 4))).toMatchObject({ kind: 'split10', text: '10 + 4', gap: 0 });
  });
  it('have none for a missing addend: the ten-frame gap is the picture', () => {
    expect(cue(bondId(3))).toBeNull();
    expect(cue(missId(4, 7))).toBeNull();
  });
});

describe('the unlock ladders', () => {
  const firstGroup = (id: ModuleId) => mod(id).groups![0]!.cardIds;

  it('start on group 1 only, for every new module', () => {
    for (const id of NEW_IDS) {
      const s = PRE_ON(id);
      expect(unlockedGroups(mod(id), {}, s)).toBe(1);
      expect(availableCards({}, s).map((c) => c.id)).toEqual(firstGroup(id));
    }
  });

  it('open group 2 when 80% of group 1 is steady, and not at 75%', () => {
    for (const id of NEW_IDS) {
      const g1 = firstGroup(id);
      const need = Math.ceil(g1.length * 0.8 - 1e-9);
      const s = PRE_ON(id);
      expect(unlockedGroups(mod(id), steadyCards(g1.slice(0, need)), s), `${id} at ${need}/${g1.length}`).toBeGreaterThanOrEqual(2);
      expect(unlockedGroups(mod(id), steadyCards(g1.slice(0, need - 1)), s), `${id} at ${need - 1}/${g1.length}`).toBe(1);
      expect(groupProgress(mod(id), 0, steadyCards(g1))).toBe(1);
    }
  });

  it('open every group of doubles in turn', () => {
    const d = mod('doubles');
    const s = PRE_ON('doubles');
    const both = steadyCards([...d.groups![0]!.cardIds, ...d.groups![1]!.cardIds]);
    expect(unlockedGroups(d, both, s)).toBe(3);
  });

  it('honor a parent floor on a new module', () => {
    const s: KidSettings = { ...PRE_ON('add20'), groupsUnlocked: { add20: 2 } };
    expect(unlockedGroups(mod('add20'), {}, s)).toBe(2);
  });

  it('put the new cards in a run only when their module is on, and plan a first run from group 1', () => {
    const s = PRE_ON('bonds10', 'missing10');
    const ids = availableCards({}, s).map((c) => c.id);
    expect(ids.every((i) => i.startsWith('bond:') || i.startsWith('miss:'))).toBe(true);
    expect(ids.some((i) => i.startsWith('bond:'))).toBe(true);
    expect(ids.some((i) => i.startsWith('miss:'))).toBe(true);
    // Every card of group 1 is a real card.
    for (const id of NEW_IDS) for (const c of firstGroup(id)) expect(getCardDef(c)).toBeTruthy();
  });
});

describe('the fade works on the new modules', () => {
  it('moves a new-module fact dots to numerals after 2 right answers, and a miss drops it', () => {
    const s = PRE_ON('bonds10');
    const run = new SessionRunner([{ cardId: bondId(3), isNew: true }, { cardId: bondId(3), isNew: false }], {}, mulberry32(2), () => T0, s);
    const right = () => ({ kind: 'int' as const, value: (run.current()!.problem.answer as { value: number }).value });
    run.answer(right(), 2500);
    run.advance();
    run.answer(right(), 2500);
    expect(run.getCard(bondId(3))).toMatchObject({ supportLevel: 'numerals', supportRun: 0 });
    const miss = new SessionRunner([{ cardId: bondId(4), isNew: true }], { [bondId(4)]: { ...run.getCard(bondId(3))!, id: bondId(4) } }, mulberry32(2), () => T0 + 1000, s);
    miss.answer({ kind: 'int', value: 99 }, 2500);
    expect(miss.getCard(bondId(4))?.supportLevel).toBe('dots');
  });
});
