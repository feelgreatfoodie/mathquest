import { useEffect, useRef, useState } from 'react';
import type { Repo } from '../data/repo';
import type { Family } from '../engine/models';
import { sellQuestion, sellingOn } from '../game/selling';
import { reportFailure } from './failures';
import { chime } from './early/sounds';
import { speak } from './early/useSpeech';
import { Sprite, UiIcon } from './sprites';

/** The thing being sold: a catalog item the kid owns, with what it pays. */
export interface SellItem {
  id: string;
  name: string;
  refund: number;
  /** True when the item is worn: the sale takes it off first. */
  worn: boolean;
}

/** The reader's one confirm: "Sell the Bow for 27 gems?". Nothing moves before Yes. */
export function ReaderSellSheet({ item, onSell, onClose }: { item: SellItem; onSell: () => Promise<boolean>; onClose: () => void }) {
  const busy = useRef(false);
  const sell = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (await onSell()) onClose();
    } finally {
      busy.current = false;
    }
  };
  return (
    <div className="modal sell-sheet" role="dialog" aria-modal="true" aria-label="Sell an item" data-testid="sell-sheet">
      <div className="panel">
        <h2 className="pixel">Sell the {item.name}</h2>
        <Sprite name={item.id} size={72} />
        <p data-testid="sell-confirm-text">{sellQuestion(item.name, item.refund)}</p>
        {item.worn ? <p className="muted">It comes off your hero first.</p> : null}
        <p className="muted">You can buy it again later at the full price.</p>
        <div className="row">
          <button type="button" className="btn shop-btn-48" data-testid="sell-yes" onClick={() => void sell()}>Sell for {item.refund}</button>
          <button type="button" className="btn btn-ghost shop-btn-48" data-testid="sell-no" onClick={onClose}>No</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The pre-reader's one confirm. No words: the item, a gem and the refund numeral, then one big check-and-gem button and a close button.
 * The voice asks "Sell the Bow for 27 gems?" (it stays quiet while muted or while a grown-up has voice off). Every target is at least 120 px.
 */
export function PrereaderSellSheet({ item, onSell, onClose }: { item: SellItem; onSell: () => Promise<boolean>; onClose: () => void }) {
  const busy = useRef(false);
  useEffect(() => {
    void speak(sellQuestion(item.name, item.refund));
  }, [item.name, item.refund]);
  const sell = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (await onSell()) {
        chime();
        void speak(`You sold the ${item.name}!`);
        onClose();
      }
    } finally {
      busy.current = false;
    }
  };
  return (
    <div className="screen center pshop pshop-confirm pshop-sell" aria-label={`Sell ${item.name}`} data-testid="sell-sheet">
      <Sprite name={item.id} size={220} className="bob" />
      <div className="pshop-price" data-testid="sell-refund"><UiIcon name="gem" size={72} /><span className="tally-num">{item.refund}</span></div>
      <div className="row pshop-actions">
        <button type="button" className="pshop-btn pshop-buy" aria-label="Sell" data-testid="sell-yes" onClick={() => void sell()}>
          <UiIcon name="check" size={84} /><UiIcon name="gem" size={64} />
        </button>
        <button type="button" className="pshop-btn pshop-cancel" aria-label="Cancel" data-testid="sell-no" onClick={onClose}>
          <UiIcon name="close" size={64} />
        </button>
      </div>
    </div>
  );
}

/** The grown-ups' Selling section: one switch (on at first). Kids see Sell next to an owned item only while it is on. */
export function SellingPanel({ repo }: { repo: Repo }) {
  const [family, setFamily] = useState<Family | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void repo.getFamily().then((f) => live && setFamily(f)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [repo]);
  const on = sellingOn(family);
  return (
    <section className="panel selling-panel" aria-label="Selling" data-testid="selling-panel">
      <h2><UiIcon name="gem" size={24} /> Selling</h2>
      <p className="muted">A player can sell a shop item back for half its price, rounded down. Heroes and legendary items cannot be sold, and a gift waits 7 days. Turn it off here and the Sell button goes away.</p>
      <label className="check">
        <input
          type="checkbox"
          data-testid="selling-toggle"
          checked={on}
          disabled={busy || !family}
          onChange={async (e) => {
            const next = e.target.checked;
            setBusy(true);
            try {
              await repo.setSelling(next);
              setFamily((f) => (f ? { ...f, selling: next } : f));
            } catch (err) {
              reportFailure('The selling setting was not saved.', err);
            } finally {
              setBusy(false);
            }
          }}
        />
        Selling items back: {on ? 'On' : 'Off'}
      </label>
    </section>
  );
}
