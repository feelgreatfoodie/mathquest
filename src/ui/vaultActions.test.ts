import { describe, expect, it, vi } from 'vitest';
import { GameDeltaError } from '../engine/game';
import type { Kid, KidGame } from '../engine/models';
import { giftProblem } from '../game/gifting';
import { buildVaultApi } from './vaultActions';

// 2026-11-26, a pre-reader: 53 gems stored, 3 deposits of 10 in the vault. He broke one (stored 63) and put 10 back 1.6 s later
// (stored 53). The screen showed 63 and offered a 60-gem lantern, and the gift was refused: "Not enough gems." A refresh showed 53.
// The app keeps a live listener on the kid doc (the pause). getDoc on a doc with a live listener answers from that listener's copy,
// which can be one write behind a transaction that just committed. The fake getKid below is that copy: the stored game before the last write.
function laggingRepo(start: number) {
  let stored: KidGame = { xp: 0, gems: start, heroes: ['knight'], hero: 'knight' } as KidGame;
  let previous = stored;
  const commit = (g: KidGame) => {
    previous = stored;
    stored = g;
    return g;
  };
  let deps = 3;
  const repo = {
    getKid: vi.fn(async (id: string) => ({ id, game: previous }) as unknown as Kid),
    listVault: vi.fn(async () => []),
    vaultDeposit: vi.fn(async (_k: string, amount: number) => {
      if (amount > stored.gems) throw new GameDeltaError('Not enough gems.');
      deps++;
      return commit({ ...stored, gems: stored.gems - amount });
    }),
    vaultPay: vi.fn(async () => {
      deps--;
      const game = commit({ ...stored, gems: stored.gems + 10 });
      return { paid: 10, done: true, game };
    }),
  };
  return { repo, stored: () => stored, deposits: () => deps };
}

describe('the gems on screen after a vault write', () => {
  it('a break then a quick deposit shows 53, the stored total, and a 60-gem gift is not offered', async () => {
    const r = laggingRepo(53);
    let shown = 53;
    const api = buildVaultApi(r.repo, 'k1', (_id, g) => (shown = g.gems), () => {});
    expect(await api.pay('d1', 'break')).toBe('done');
    expect(shown).toBe(63);
    expect(await api.deposit(10, 3)).toBe(true);
    expect(r.stored().gems).toBe(53);
    expect(shown).toBe(53);
    // The gift screen checks the gems on screen; the server checks the stored gems. They must agree.
    const sibling = { id: 'k2', game: { xp: 0, gems: 0, heroes: ['knight'], hero: 'knight' } as KidGame };
    expect(giftProblem({ id: 'k1', game: { ...r.stored(), gems: shown } }, sibling, 'a-lantern')).toBe('Not enough gems.');
  });
  it('every chunk of a payout shows the gems that chunk stored', async () => {
    const r = laggingRepo(20);
    const seen: number[] = [];
    const api = buildVaultApi(r.repo, 'k1', (_id, g) => seen.push(g.gems), () => {});
    await api.pay('d1', 'break');
    await api.deposit(10, 3);
    await api.pay('d2', 'break');
    expect(seen).toEqual([30, 20, 30]);
  });
});
