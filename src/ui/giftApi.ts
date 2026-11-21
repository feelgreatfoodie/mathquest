import { useCallback, useEffect, useRef, useState } from 'react';
import type { GiftRecord, Kid } from '../engine/models';

/** A gift the kid has not opened, with the giver's display name read at run time. */
export interface IncomingGift {
  gift: GiftRecord;
  fromName: string;
}

/** What a screen can do with gifts. The app builds it from the repo; a screen never touches the repo itself. */
export interface GiftApi {
  /** The other kids of the family. Empty when the family turned gifting off or the read fails. */
  siblings(): Promise<Kid[]>;
  /** True when the gift saved. A refusal shows a toast and gives false. */
  give(receiverId: string, itemId: string): Promise<boolean>;
  /** The gifts this kid has not opened, oldest first. */
  incoming(): Promise<IncomingGift[]>;
  /** Marks one gift opened. */
  open(giftId: string): Promise<void>;
}

/** The siblings a gift can go to, read on mount and again when `gems` changes (a gift moves gems) or `refresh` runs. */
export function useSiblings(api: GiftApi | undefined, gems: number) {
  const [siblings, setSiblings] = useState<Kid[]>([]);
  const live = useRef(true);
  // The app builds a new api object on every render; the reads follow whether there is one, not which object it is.
  const latest = useRef(api);
  latest.current = api;
  const has = !!api;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!has) return;
    try {
      const list = await latest.current!.siblings();
      if (live.current) setSiblings(list);
    } catch {
      if (live.current) setSiblings([]);
    }
  }, [has]);
  useEffect(() => {
    void refresh();
  }, [refresh, gems]);
  return { siblings, refresh };
}
