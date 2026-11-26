import { GameDeltaError } from '../engine/game';
import type { KidGame } from '../engine/models';
import type { Repo } from '../data/repo';
import type { VaultApi } from './vaultApi';

type Fail = (message: string, err: unknown, retry?: () => Promise<void>) => void;

/**
 * The vault for one kid. Every chunk of a payout saves on its own. The screen shows the game each transaction stored, never a
 * read after it: a read after a transaction could answer from the live listener's copy, one write behind. On 11-26 a break then a
 * deposit 1.6 s later left 63 gems on screen with 53 stored, and the shop refused a 60-gem gift.
 */
export function buildVaultApi(repo: Pick<Repo, 'listVault' | 'vaultDeposit' | 'vaultPay'>, kidId: string, showGame: (kidId: string, game: KidGame) => void, reportFailure: Fail): VaultApi {
  return {
    list: () => repo.listVault(kidId, 50),
    deposit: async (amount, term) => {
      try {
        showGame(kidId, await repo.vaultDeposit(kidId, amount, term));
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
          showGame(kidId, r.game);
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
