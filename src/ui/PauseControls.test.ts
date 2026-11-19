// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Repo } from '../data/repo';
import { DEFAULT_GAME, DEFAULT_SETTINGS, type Kid } from '../engine/models';
import { PauseCard, PauseEveryone, SignOutAsk } from './PauseControls';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Made-up fixtures. The repo is a stub that records setKidPause.
const kid = (id: string, name: string, pause?: object): Kid => ({ id, name, createdAt: 1, settings: { ...DEFAULT_SETTINGS, ...(pause ? { pause } : {}) } as Kid['settings'], game: { ...DEFAULT_GAME } });
const stubRepo = () => {
  const calls: { ids: string[]; pause: { until?: number } | null }[] = [];
  const repo = { mode: 'local', setKidPause: vi.fn(async (ids: string[], pause: { until?: number } | null) => void calls.push({ ids, pause })) } as unknown as Repo;
  return { repo, calls };
};
const mount = (el: ReturnType<typeof createElement>) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(el));
  return host;
};
const click = (el: Element | null) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));
const flush = () => act(async () => void (await Promise.resolve()));

describe('SignOutAsk', () => {
  it('asks "Sign out grown-up?" and the yes button has focus by default', () => {
    const onYes = vi.fn();
    const onStay = vi.fn();
    const host = mount(createElement(SignOutAsk, { onYes, onStay }));
    expect(host.textContent).toContain('Sign out grown-up?');
    const yes = host.querySelector<HTMLButtonElement>('[data-testid="signout-yes"]')!;
    expect(yes.hasAttribute('autofocus') || document.activeElement === yes || yes.autofocus).toBe(true);
    click(yes);
    expect(onYes).toHaveBeenCalledTimes(1);
    click(host.querySelector('[data-testid="signout-stay"]'));
    expect(onStay).toHaveBeenCalledTimes(1);
  });
});

describe('PauseCard and PauseEveryone call onResumed only after a resume write', () => {
  it('Resume on a paused kid writes null for that kid, then calls onResumed', async () => {
    const { repo, calls } = stubRepo();
    const onResumed = vi.fn();
    const host = mount(createElement(PauseCard, { repo, kid: kid('kid1', 'Pip', { on: true, setAt: 1 }), onResumed }));
    click(host.querySelector('[data-testid="resume-kid"]'));
    await flush();
    expect(calls).toEqual([{ ids: ['kid1'], pause: null }]);
    expect(onResumed).toHaveBeenCalledTimes(1);
  });
  it('starting a pause does not call onResumed', async () => {
    const { repo, calls } = stubRepo();
    const onResumed = vi.fn();
    const host = mount(createElement(PauseCard, { repo, kid: kid('kid1', 'Pip'), onResumed }));
    click(host.querySelector('[data-testid="pause-kid"]'));
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Until I resume')!);
    await flush();
    expect(calls).toEqual([{ ids: ['kid1'], pause: {} }]);
    expect(onResumed).not.toHaveBeenCalled();
  });
  it('Pause everyone writes every kid in one call; Resume everyone calls onResumed', async () => {
    const { repo, calls } = stubRepo();
    const onResumed = vi.fn();
    const host = mount(createElement(PauseEveryone, { repo, kids: [kid('kid1', 'Pip'), kid('kid2', 'Wren')], onResumed }));
    click(host.querySelector('[data-testid="pause-everyone"]'));
    click([...host.querySelectorAll('button')].find((b) => b.textContent === '30 minutes')!);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ids).toEqual(['kid1', 'kid2']);
    expect(calls[0]!.pause!.until).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(onResumed).not.toHaveBeenCalled();
    click(host.querySelector('[data-testid="pause-everyone"]'));
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Resume everyone')!);
    await flush();
    expect(calls[1]).toEqual({ ids: ['kid1', 'kid2'], pause: null });
    expect(onResumed).toHaveBeenCalledTimes(1);
  });
});
