// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repo } from '../../data/repo';
import { DEFAULT_GAME, DEFAULT_SETTINGS, type Kid } from '../../engine/models';
import { clearFailures, getFailures } from '../../ui/failures';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// saveRun throws (as it did when newId threw on an http origin). The run must still end and the kid must see why.
vi.mock('../../ui/runShared', async (orig) => ({ ...(await orig<typeof import('../../ui/runShared')>()), saveRun: vi.fn(async () => { throw new Error('boom'); }) }));
import { DungeonMode } from './DungeonMode';
import { PrereaderMode } from './PrereaderMode';

const reader: Kid = { id: 'kidtest000000000001', name: 'Pip', createdAt: 1, settings: { ...DEFAULT_SETTINGS }, game: { ...DEFAULT_GAME } };
const early: Kid = { ...reader, settings: { ...DEFAULT_SETTINGS, learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false } } };
const repo = { loadCards: async () => ({}), saveCards: async () => undefined } as unknown as Repo;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  clearFailures();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function holdHouse() {
  const btn = host.querySelector<HTMLButtonElement>('.hold-btn')!;
  await act(async () => {
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }));
    await vi.advanceTimersByTimeAsync(1300);
  });
}

describe.each([
  ['Dungeon (reader)', DungeonMode, reader],
  ['Pre-reader', PrereaderMode, early],
] as const)('%s: a save that throws', (_name, Mode, kid) => {
  it('still leaves the run once, and shows a toast that says the round was not saved', async () => {
    const onExit = vi.fn();
    const onDone = vi.fn();
    await act(async () => {
      root.render(createElement(Mode, { repo, kid, onExit, onDone }));
      await vi.advanceTimersByTimeAsync(50);
    });
    await holdHouse();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(getFailures().map((f) => f.message)).toEqual(['This round was not saved.']);
  });

  it('still leaves the run when onDone itself throws', async () => {
    const run = await import('../../ui/runShared');
    (run.saveRun as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ summary: {}, updated: kid, saved: true, info: { saved: true } });
    const onExit = vi.fn();
    const onDone = vi.fn(() => { throw new Error('summary broke'); });
    await act(async () => {
      root.render(createElement(Mode, { repo, kid, onExit, onDone }));
      await vi.advanceTimersByTimeAsync(50);
    });
    await holdHouse();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
