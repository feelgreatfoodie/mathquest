// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repo } from '../data/repo';
import { DEFAULT_GAME, DEFAULT_SETTINGS, type Kid } from '../engine/models';
import { mulberry32 } from '../engine/problems';
import { SessionRunner, type Entry } from '../engine/session';
import { QuestionPanel } from './QuestionPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kid: Kid = { id: 'kidtest000000000001', name: 'Pip', createdAt: 1, settings: { ...DEFAULT_SETTINGS }, game: { ...DEFAULT_GAME } };
const repo = { saveCards: async () => undefined } as unknown as Repo;

let now = 0;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function mount(runner: SessionRunner, entry: Entry, display: 'inline' | 'modal', onResolved = vi.fn()) {
  act(() => {
    root.render(createElement(QuestionPanel, { key: entry.id, runner, entry, kid, repo, learner: 'reader', display, onResolved }));
  });
  return onResolved;
}

function typeAndGo(answer: number) {
  for (const d of String(answer)) {
    const key = [...host.querySelectorAll<HTMLButtonElement>('.keypad .key')].find((b) => b.textContent === d)!;
    act(() => key.click());
  }
  act(() => host.querySelector<HTMLButtonElement>('.key-go')!.click());
}

describe('QuestionPanel timing', () => {
  it('starts the clock when the panel becomes visible: 10 s of walking adds 0 ms to the graded time', () => {
    const runner = new SessionRunner([{ cardId: 'mul:7x8', isNew: false }], {}, mulberry32(1), () => 0, kid.settings);
    const entry = runner.current()!;
    // The kid walks for 10 s with the question already in the runner's queue; nothing is on screen.
    now = 10_000;
    mount(runner, entry, 'modal');
    now = 10_450; // 450 ms after the panel appeared
    typeAndGo(56);
    expect(runner.getCard('mul:7x8')!.recentMs).toEqual([450]);
  });

  it('a second question gets its own clock, not the time since the first one opened', () => {
    const runner = new SessionRunner(
      [{ cardId: 'mul:7x8', isNew: false }, { cardId: 'mul:3x4', isNew: false }],
      {},
      mulberry32(1),
      () => 0,
      kid.settings,
    );
    const [first, second] = runner.queue as [Entry, Entry];
    now = 5_000;
    mount(runner, first, 'inline');
    now = 5_300;
    typeAndGo(56);
    expect(runner.getCard('mul:7x8')!.recentMs).toEqual([300]);
    now = 30_000; // walking to the next one
    mount(runner, second, 'inline');
    now = 30_700;
    // The runner still points at `first` in the position sense; answer the second through its own entry.
    runner.advance();
    typeAndGo(12);
    expect(runner.getCard('mul:3x4')!.recentMs).toEqual([700]);
  });

  it('the modal display wraps the same panel in a dialog', () => {
    const runner = new SessionRunner([{ cardId: 'mul:7x8', isNew: false }], {}, mulberry32(1), () => 0, kid.settings);
    mount(runner, runner.current()!, 'modal');
    expect(host.querySelector('[role="dialog"] .panel.question')).not.toBeNull();
    expect(host.querySelector('[role="dialog"] .keypad')).not.toBeNull();
  });
});

describe('QuestionPanel miss (UX review item 3)', () => {
  it('puts the correct answer large in the equation with a check, the kid answer small and struck through, and a read-aloud hint', () => {
    const runner = new SessionRunner([{ cardId: 'mul:7x8', isNew: false }], {}, mulberry32(1), () => 0, kid.settings);
    mount(runner, runner.current()!, 'inline');
    typeAndGo(54);
    const eq = host.querySelector('.panel.question .math-answer-slot, .panel.question')!;
    expect(eq.querySelector('.answer-fixed')?.textContent).toContain('56');
    expect(eq.querySelector('.answer-fixed .answer-check')).not.toBeNull();
    const was = eq.querySelector('.answer-was');
    expect(was?.textContent).toBe('54');
    expect(was?.tagName).toBe('S');
    expect(host.querySelector('.int-entry')).toBeNull(); // the wrong number is no longer the big one
    expect(host.querySelector('button[aria-label="Read it to me"]')).not.toBeNull();
  });

  it('leaves the answer box alone on a hit', () => {
    const runner = new SessionRunner([{ cardId: 'mul:7x8', isNew: false }], {}, mulberry32(1), () => 0, kid.settings);
    mount(runner, runner.current()!, 'inline');
    typeAndGo(56);
    expect(host.querySelector('.answer-fixed')).toBeNull();
    expect(host.querySelector('.int-entry')?.textContent).toBe('56');
  });
});
