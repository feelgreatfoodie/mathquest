import { readFileSync, writeFileSync } from 'node:fs';
import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { ALL_CARDS, getCardDef } from './content';
import { thresholdsFor } from './grading';
import { availableCards, cardLevel } from './mastery';
import { DEFAULT_GAME, type CardMap, type KidSettings } from './models';
import { generateProblem, mulberry32 } from './problems';
import { newCardState, review } from './scheduler';
import { SessionRunner, planSession } from './session';

/**
 * Back-compat golden. The fixture was recorded on main (before the module registry) from a kid doc
 * shaped like a real one: `tracks` set, no `modules`, no `learner`, a full `game` map. The same
 * inputs must give the same available cards, card levels and thresholds on the registry build.
 * Re-record only on purpose: RECORD_GOLDEN=1 npx vitest run src/engine/backcompat.test.ts
 */
const GOLDEN = new URL('./__golden__/backcompat.json', import.meta.url);
const T0 = new Date('2026-11-16T16:00:00').getTime();
const DAY = 86_400_000;

// A stored kid doc: no `modules`, no `learner`. Made-up name and values.
const kidDoc = (over: Partial<KidSettings> = {}) => ({
  id: 'kidgoldenaaaa00000001',
  name: 'Goldie',
  createdAt: T0 - 90 * DAY,
  settings: {
    tracks: { facts: true, multidigit: true, fractions: true },
    sessionSize: 30,
    maxNew: 8,
    factGroupsUnlocked: 1,
    paceMultiplier: 3,
    ...over,
  },
  game: { ...DEFAULT_GAME, xp: 640, gems: 12, streakDays: 4, lastPlayedDay: '2026-11-15', bestCombo: 9, heroes: ['knight', 'wizard'], hero: 'wizard' },
  hasPin: true,
});

/** Review a card `n` times, ending good, at fixed times and response speed. */
function seen(id: string, n: number, ms: number, rating: 1 | 3 | 4 = Rating.Good as 3): CardMap[string] {
  let c = newCardState(id, T0 - 60 * DAY);
  for (let i = 0; i < n; i++) c = review(c, rating as never, ms, true, T0 - (60 - i * 12) * DAY);
  return c;
}

function progressed(): CardMap {
  const cards: CardMap = {};
  // Group 1 facts well known, group 2 half known, one lapsed, some skills started.
  const ids = ALL_CARDS.map((c) => c.id);
  for (const id of ids) {
    const def = getCardDef(id)!;
    if (def.kind === 'fact' && def.groupIndex === 0) cards[id] = seen(id, 4, 1400, Rating.Easy as 4);
    else if (def.kind === 'fact' && def.groupIndex === 1 && Number(id.charCodeAt(4)) % 2 === 0) cards[id] = seen(id, 3, 2600);
  }
  const lapsed = ids.find((i) => getCardDef(i)!.kind === 'fact' && getCardDef(i)!.groupIndex === 0)!;
  cards[lapsed] = review(cards[lapsed]!, Rating.Again, 9000, false, T0 - 5 * DAY);
  cards['fr:add'] = seen('fr:add', 4, 5000);
  cards['fr:sub'] = seen('fr:sub', 2, 9000);
  cards['md:tens'] = seen('md:tens', 3, 9000);
  return cards;
}

const SETTINGS: [string, KidSettings][] = [
  ['default', kidDoc().settings as KidSettings],
  ['factsOnly', kidDoc({ tracks: { facts: true, multidigit: false, fractions: false } }).settings as KidSettings],
  ['fractionsOnly', kidDoc({ tracks: { facts: false, multidigit: false, fractions: true } }).settings as KidSettings],
  ['multidigitOnly', kidDoc({ tracks: { facts: false, multidigit: true, fractions: false } }).settings as KidSettings],
  ['groups3pace1', kidDoc({ factGroupsUnlocked: 3, paceMultiplier: 1 }).settings as KidSettings],
  ['noPace', (() => { const s = kidDoc().settings as KidSettings; delete s.paceMultiplier; return s; })()],
];

function compute() {
  const out: Record<string, unknown> = {};
  const maps: [string, CardMap][] = [['empty', {}], ['progressed', progressed()]];
  for (const [mapName, cards] of maps) {
    for (const [sName, settings] of SETTINGS) {
      const avail = availableCards(cards, settings);
      const key = `${mapName}/${sName}`;
      out[`available:${key}`] = avail.map((d) => d.id);
      out[`levels:${key}`] = Object.fromEntries(
        Object.keys(cards).map((id) => [id, [1, 1.5, 3].map((p) => cardLevel(cards[id], 3500, p))]),
      );
    }
  }
  const th: Record<string, unknown> = {};
  for (const def of ALL_CARDS) {
    for (const base of [800, 1800, 3500, 6000]) for (const pace of [1, 1.5, 2, 3]) th[`${def.id}@${base}x${pace}`] = thresholdsFor(def, base, pace);
  }
  out.thresholds = th;
  const probs: Record<string, unknown> = {};
  for (const def of ALL_CARDS) {
    const rng = mulberry32(7);
    probs[def.id] = [0, 1, 2].map(() => generateProblem(def.id, rng));
  }
  out.problems = probs;
  // A whole planned run, answered the same way, must save the same cards.
  const cards = progressed();
  const settings = kidDoc().settings as KidSettings;
  const plan = planSession({ cards, available: availableCards(cards, settings), now: T0, size: 30, maxNew: 8, rng: mulberry32(11) });
  out.plan = plan;
  let clock = T0;
  const runner = new SessionRunner(plan, cards, mulberry32(12), () => (clock += 1000), settings);
  const answerRng = mulberry32(13);
  const trace: unknown[] = [];
  let guard = 0;
  while (!runner.done() && guard++ < 200) {
    const e = runner.current()!;
    if (e.kind === 'teach') { runner.acknowledge(); trace.push(['teach', e.cardId]); continue; }
    const right = answerRng() < 0.7;
    const a = e.problem.answer;
    const input = a.kind === 'int'
      ? { kind: 'int' as const, value: right ? a.value : a.value + 1 }
      : { kind: 'mixed' as const, value: right ? { w: a.value.w, n: a.value.n, d: a.value.d } : { w: a.value.w + 1, n: a.value.n, d: a.value.d } };
    const fb = runner.answer(input, 1500 + Math.floor(answerRng() * 9000));
    trace.push([e.kind, e.cardId, fb.verdict, fb.rating, fb.xp, fb.combo]);
    runner.advance();
  }
  out.trace = trace;
  out.summary = runner.summary();
  out.changed = runner.changedCards();
  return JSON.parse(JSON.stringify(out));
}

describe('back-compat golden (recorded on main)', () => {
  it('a kid doc with tracks and no modules/learner reads the same', () => {
    const now = compute();
    if (process.env.RECORD_GOLDEN) {
      writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    expect(Object.keys(now)).toEqual(Object.keys(golden));
    for (const k of Object.keys(golden)) expect(now[k], k).toEqual(golden[k]);
  });
});
