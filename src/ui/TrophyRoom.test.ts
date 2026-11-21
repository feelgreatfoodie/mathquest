// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Repo } from '../data/repo';
import { DEFAULT_GAME, DEFAULT_SETTINGS, type Kid } from '../engine/models';
import { TrophyRoom } from './TrophyRoom';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Made-up kid. The repo is a stub; any write method it gets called with is a failure of the read-only rule.
const kid: Kid = { id: 'kidtrophy000000000001', name: 'Pip', createdAt: 1, settings: { ...DEFAULT_SETTINGS } as Kid['settings'], game: { ...DEFAULT_GAME, items: ['w-bow'] } };
const writes = ['saveWorld', 'saveCards', 'addSession', 'saveKid', 'updateKidGame', 'setWorldLastMode', 'saveCamp'];
const stub = (fail: () => boolean) => {
  const repo: Record<string, unknown> = {
    mode: 'local',
    listSessions: vi.fn(async () => { if (fail()) throw new Error('offline'); return []; }),
    loadWorld: vi.fn(async () => null),
    loadCards: vi.fn(async () => ({})),
  };
  for (const w of writes) repo[w] = vi.fn();
  return repo as unknown as Repo & Record<string, ReturnType<typeof vi.fn>>;
};
const mount = (repo: Repo, learner: 'reader' | 'prereader') => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(createElement(TrophyRoom, { kid, repo, learner, onClose: () => undefined })));
  return host;
};
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe('TrophyRoom load', () => {
  for (const learner of ['reader', 'prereader'] as const) {
    it(`${learner}: a failed read shows a retry state with no zero counts, and Try again loads`, async () => {
      let failing = true;
      const repo = stub(() => failing);
      const host = mount(repo, learner);
      await flush();
      expect(host.querySelector('[data-testid="trophy-error"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="trophy-counts"]')).toBeNull();
      expect(host.querySelector('[data-value]')).toBeNull();
      failing = false;
      await act(async () => void (host.querySelector('[data-testid="trophy-retry"]') as HTMLElement).click());
      await flush();
      expect(host.querySelector('[data-testid="trophy-error"]')).toBeNull();
      expect(host.querySelector('[data-region]')).not.toBeNull();
    });

    it(`${learner}: reads only, never writes`, async () => {
      const repo = stub(() => false);
      mount(repo, learner);
      await flush();
      for (const w of writes) expect((repo as unknown as Record<string, ReturnType<typeof vi.fn>>)[w]).not.toHaveBeenCalled();
    });
  }
});
