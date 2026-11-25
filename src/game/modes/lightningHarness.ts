import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { expect, vi } from 'vitest';
import type { Repo } from '../../data/repo';
import { dayKey } from '../../engine/game';
import { DEFAULT_GAME, DEFAULT_SETTINGS, type CardMap, type CardState, type Kid } from '../../engine/models';
import { FACT_CARDS } from '../../engine/modules/legacy';
import { newCardState } from '../../engine/scheduler';
import { LightningMode } from './LightningMode';

// Shared by the Lightning miss tests. Made-up kid, fake timers, stubbed voice and sounds, a repo that keeps nothing.

const DAY = 86_400_000;

function known(id: string, now: number): CardState {
  const c = newCardState(id, now - DAY);
  return { ...c, attempts: 12, correct: 12, recentMs: [700, 800, 650], lastRating: 3, fsrs: { ...c.fsrs, state: 2, reps: 5, stability: 20, difficulty: 3, scheduled_days: 20, last_review: now - DAY, due: now + 10 * DAY }, day: dayKey(now - DAY), dayGraded: 1, lastResults: [true, true] };
}

function weak(id: string, now: number, delay?: number): CardState {
  const c = newCardState(id, now - 3_600_000);
  return { ...c, attempts: 6, correct: 3, recentMs: [5200, 4800], lastRating: 1, fsrs: { ...c.fsrs, state: 1, reps: 3, lapses: 1, stability: 0.5, last_review: now - 3_600_000, due: now }, day: dayKey(now), dayGraded: 2, lastResults: [true, false], missDay: dayKey(now), ...(delay ? { lightningDelayMs: delay } : {}) };
}

/** 10 weak facts and 100 known ones, all multiplication. */
export function richCards(now: number): CardMap {
  const ids = FACT_CARDS.map((c) => c.id);
  const cards: CardMap = {};
  ids.slice(0, 10).forEach((id) => (cards[id] = weak(id, now)));
  ids.slice(10, 110).forEach((id) => (cards[id] = known(id, now)));
  return cards;
}

export const reader: Kid = { id: 'kidtest000000000001', name: 'Pip', createdAt: 1, settings: { ...DEFAULT_SETTINGS, factGroupsUnlocked: 5 }, game: { ...DEFAULT_GAME } };

export const spoken: string[] = [];

export function makeRepo(cards: CardMap): Repo {
  return {
    loadCards: async () => cards,
    listSessions: async () => [],
    saveCards: async () => undefined,
    applyGameDelta: async () => ({ ...DEFAULT_GAME }),
  } as unknown as Repo;
}

export interface Rig {
  host: HTMLDivElement;
  root: Root;
  onExit: ReturnType<typeof vi.fn>;
  ms(n: number): Promise<void>;
  teardown(): void;
}

export async function mount(kid: Kid = reader, cards?: CardMap): Promise<Rig> {
  vi.useFakeTimers();
  spoken.length = 0;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onExit = vi.fn();
  await act(async () => {
    root.render(createElement(LightningMode, { repo: makeRepo(cards ?? richCards(Date.now())), kid, onExit, onDone: vi.fn() }));
    await vi.advanceTimersByTimeAsync(50);
  });
  return {
    host,
    root,
    onExit,
    ms: async (n: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(n);
      });
    },
    teardown: () => {
      act(() => root.unmount());
      host.remove();
      vi.useRealTimers();
      vi.restoreAllMocks();
    },
  };
}

export const screen = (rig: Rig) => rig.host.querySelector<HTMLElement>('[data-testid="lightning"]');
export const phaseOf = (rig: Rig) => screen(rig)?.getAttribute('data-phase') ?? null;
export const cardKey = (rig: Rig) => (rig.host.querySelector('.math')?.textContent ?? '');
export const ended = (rig: Rig) => !!rig.host.querySelector('[data-testid="lr-end"]');

/** The answer of the card on screen, from its "a × b" tokens. */
export function answerOnScreen(rig: Rig): number {
  const nums = [...rig.host.querySelectorAll('.math-num')].map((n) => Number(n.textContent));
  const op = rig.host.querySelector('.math-op')?.textContent;
  expect(nums).toHaveLength(2);
  return op === '×' ? nums[0]! * nums[1]! : op === '+' ? nums[0]! + nums[1]! : nums[0]! - nums[1]!;
}

export async function type(_rig: Rig, n: number): Promise<void> {
  for (const ch of String(n)) {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      await vi.advanceTimersByTimeAsync(5);
    });
  }
}

/** Let the ring close on the card on screen: the answer shows and the round is in the miss phase. */
export async function letRingClose(rig: Rig): Promise<number> {
  const delay = Number(screen(rig)!.getAttribute('data-delay'));
  await rig.ms(delay + 50);
  expect(phaseOf(rig)).toBe('miss');
  return Number(rig.host.querySelector('[data-testid="lr-answer"]')!.textContent);
}

/** A wrong answer of the same length as the right one, so it submits at once. */
export const wrongOf = (answer: number): number => (answer % 10 === 9 ? answer - 1 : answer + 1);

/** The number the miss prompt tells the kid to type, read from the screen alone. Fails when the screen names none. */
export function promptNumber(rig: Rig): number {
  const text = rig.host.querySelector('[data-testid="lr-copy"]')?.textContent ?? '';
  const m = /^Type (\d+) to keep going$/.exec(text);
  expect(m, `the miss prompt on screen was ${JSON.stringify(text)}`).not.toBeNull();
  return Number(m![1]);
}

export const prereaderKid: Kid = { ...reader, id: 'kidtest000000000002', settings: { ...DEFAULT_SETTINGS, learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false } } };

/** Add-within-10 cards: the first two weak, the rest known. */
export function preCards(now: number): CardMap {
  const cards: CardMap = {};
  for (let a = 1; a <= 4; a++) for (let b = 1; a + b <= 7; b++) cards[`add:${a}+${b}`] = a <= 2 ? weak(`add:${a}+${b}`, now) : known(`add:${a}+${b}`, now);
  return cards;
}
