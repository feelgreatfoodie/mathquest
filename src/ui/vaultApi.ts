import { useCallback, useEffect, useRef, useState } from 'react';
import type { VaultDeposit, VaultTerm } from '../game/vault';

/** What a screen can do with the vault. The app builds it from the repo; a screen never touches the repo itself. */
export interface VaultApi {
  list(): Promise<VaultDeposit[]>;
  /** True when the gems went in. A refusal shows a toast and gives false. */
  deposit(amount: number, term: VaultTerm): Promise<boolean>;
  /**
   * Pays a deposit back chunk by chunk until it is done. `early` means the server refused a collect because the term
   * has not ended on the server's clock. `failed` means a chunk did not save: call again and it continues.
   */
  pay(id: string, mode: 'collect' | 'break'): Promise<'done' | 'early' | 'failed'>;
}

/** The kid's deposits, loaded on mount and again whenever `refresh` runs or `gems` changes (a deposit or a payout moves gems). */
export function useDeposits(vault: VaultApi | undefined, active: boolean, gems: number) {
  const [deposits, setDeposits] = useState<VaultDeposit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!vault || !active) return;
    try {
      const list = await vault.list();
      if (live.current) {
        setDeposits(list);
        setLoaded(true);
      }
    } catch {
      if (live.current) setLoaded(true);
    }
  }, [vault, active]);
  useEffect(() => {
    void refresh();
  }, [refresh, gems]);
  return { deposits, loaded, refresh };
}
