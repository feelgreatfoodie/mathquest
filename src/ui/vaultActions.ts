import { GameDeltaError } from '../engine/game';
import type { KidGame } from '../engine/models';
import type { Repo } from '../data/repo';
import type { VaultApi } from './vaultApi';

type Fail = (message: string, err: unknown, retry?: () => Promise<void>) => void;

/** The vault for one kid. Every chunk of a payout saves on its own, and the screen shows the stored gems after each. */
export function buildVaultApi(repo: Pick<Repo, 'getKid' | 'listVault' | 'vaultDeposit' | 'vaultPay'>, kidId: string, showGame: (kidId: string, game: KidGame) => void, reportFailure: Fail): VaultApi {
  const refreshGame = async () => {
    const k = await repo.getKid(kidId);
    if (k) showGame(kidId, k.game);
  };
  return {
    list: () => repo.listVault(kidId, 50),
    deposit: async (amount, term) => {
      try {
        await repo.vaultDeposit(kidId, amount, term);
        await refreshGame();
        return true;
      } catch (e) {
        if (e instanceof GameDeltaError) reportFailure(e.message, e);
        else reportFailure('That was not saved.', e);
        return false;
      }
    },
    pay: async (id, mode) => {
      try {
        for (;;) {
          const r = await repo.vaultPay(kidId, id, mode);
          await refreshGame();
          if (r.done) return 'done';
        }
      } catch (e) {
        // The server refuses a collect before the term ends on its own clock. That is "not ready", not a failure.
        const code = (e as { code?: string }).code;
        if (code === 'permission-denied' || (e instanceof GameDeltaError && /not ready/i.test(e.message))) return 'early';
        reportFailure('That was not saved.', e);
        return 'failed';
      }
    },
  };
}
