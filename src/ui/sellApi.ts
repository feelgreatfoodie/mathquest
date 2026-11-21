import { useCallback, useEffect, useRef, useState } from 'react';

/** What a screen can do with selling. The app builds it from the repo; a screen never touches the repo itself. */
export interface SellApi {
  /** True while the family has selling on. A kid session cannot read the family doc, so it answers true and the first refused sale reports 'off'. */
  on(): Promise<boolean>;
  /** 'ok' when the sale saved. 'off' when the rules refused it because a grown-up turned selling off. 'failed' for anything else (a toast already showed). */
  sell(itemId: string): Promise<'ok' | 'off' | 'failed'>;
}

/**
 * Whether the Sell button shows: false until the family setting is known (no flash of a button that then goes away), false after a
 * refused sale, and false with no api. `sell` runs the sale and turns the button off when the rules say selling is off.
 */
export function useSelling(api: SellApi | undefined) {
  const [on, setOn] = useState(false);
  const live = useRef(true);
  const latest = useRef(api);
  latest.current = api;
  const has = !!api;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!has) {
      setOn(false);
      return;
    }
    void latest.current!.on().then((v) => live.current && setOn(v), () => live.current && setOn(true));
  }, [has]);
  const sell = useCallback(async (itemId: string): Promise<boolean> => {
    if (!latest.current) return false;
    const r = await latest.current.sell(itemId);
    if (r === 'off' && live.current) setOn(false);
    return r === 'ok';
  }, []);
  return { on, sell };
}
