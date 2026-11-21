import { useEffect, useRef, useState } from 'react';
import type { Repo } from '../data/repo';
import { avatarOf, type Family, type Kid } from '../engine/models';
import { giftHeadline, giftHistory, giftingOn, type GiftHistoryRow } from '../game/gifting';
import { itemById } from '../game/shop/catalog';
import { ownedItems } from '../game/shop/shopState';
import { reportFailure } from './failures';
import { AVATAR_SWATCH } from './AvatarPicker';
import { chime } from './early/sounds';
import { speak } from './early/useSpeech';
import type { GiftApi, IncomingGift } from './giftApi';
import { Sprite, UiIcon } from './sprites';

/** The thing being given: a catalog item. */
export interface GiftItem {
  id: string;
  name: string;
  cost: number;
}

/** Siblings who can still get the item, then the ones who own it already. */
function canGet(s: Kid, item: GiftItem): boolean {
  return !ownedItems(s.game).includes(item.id);
}

/** The reader's gift sheet: pick a brother or sister, then one confirm line with the price. */
export function ReaderGiftSheet({ item, siblings, onGive, onClose }: { item: GiftItem; siblings: Kid[]; onGive: (receiverId: string) => Promise<boolean>; onClose: () => void }) {
  const [picked, setPicked] = useState<Kid | null>(null);
  const busy = useRef(false);
  const give = async () => {
    if (busy.current || !picked) return;
    busy.current = true;
    try {
      if (await onGive(picked.id)) onClose();
    } finally {
      busy.current = false;
    }
  };
  return (
    <div className="modal gift-sheet" role="dialog" aria-modal="true" aria-label="Give a gift" data-testid="gift-sheet">
      <div className="panel">
        <h2 className="pixel">Give the {item.name}</h2>
        <Sprite name={item.id} size={72} />
        {picked ? (
          <>
            <p data-testid="gift-confirm-text">Give the {item.name} to {picked.name} for {item.cost} gems?</p>
            <div className="row">
              <button type="button" className="btn shop-btn-48" data-testid="gift-yes" onClick={() => void give()}>Give for {item.cost}</button>
              <button type="button" className="btn btn-ghost shop-btn-48" onClick={() => setPicked(null)}>No</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">It costs you {item.cost} gems. Who gets it?</p>
            <div className="gift-list">
              {siblings.map((s) => (
                <button key={s.id} type="button" className="btn shop-btn-48" data-sibling={s.id} disabled={!canGet(s, item)} onClick={() => setPicked(s)}>
                  {s.name}{canGet(s, item) ? '' : ' (has it)'}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost shop-btn-48" onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The pre-reader gift screen. No words: the item and a gift icon, one big face per brother or sister (tap to hear the name and
 * pick), then one big gift-and-check button. A face for someone who already has the item shows a check and does nothing.
 * Every target is at least 120 px.
 */
export function PrereaderGiftSheet({ item, siblings, onGive, onClose }: { item: GiftItem; siblings: Kid[]; onGive: (receiverId: string) => Promise<boolean>; onClose: () => void }) {
  const [picked, setPicked] = useState<Kid | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    void speak(`Who gets the ${item.name}?`);
  }, [item.name]);
  const give = async () => {
    if (busy.current || !picked) return;
    busy.current = true;
    const who = picked;
    try {
      if (await onGive(who.id)) {
        chime();
        void speak(`You gave the ${item.name} to ${who.name}!`);
        onClose();
      }
    } finally {
      busy.current = false;
    }
  };
  if (picked) {
    const a = avatarOf(picked);
    return (
      <div className="screen center pshop pshop-confirm pshop-gift" aria-label={`Give ${item.name} to ${picked.name}`} data-testid="gift-sheet">
        <div className="gift-pair">
          <Sprite name={item.id} size={160} className="bob" />
          <UiIcon name="gift" size={96} />
          <span className="gift-face" data-color={a.color} style={{ ['--kid-color' as string]: AVATAR_SWATCH[a.color] }}><Sprite name={a.hero} size={128} /></span>
        </div>
        <div className="pshop-price"><UiIcon name="gem" size={72} /><span className="tally-num">{item.cost}</span></div>
        <div className="row pshop-actions">
          <button type="button" className="pshop-btn pshop-buy" aria-label="Give" data-testid="gift-yes" onClick={() => void give()}>
            <UiIcon name="gift" size={72} /><UiIcon name="check" size={72} />
          </button>
          <button type="button" className="pshop-btn pshop-cancel" aria-label="Cancel" onClick={() => setPicked(null)}>
            <UiIcon name="close" size={64} />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="screen center pshop pshop-gift" aria-label={`Give ${item.name}`} data-testid="gift-sheet">
      <div className="gift-pair"><Sprite name={item.id} size={160} className="bob" /><UiIcon name="gift" size={96} /></div>
      <div className="gift-faces">
        {siblings.map((s) => {
          const a = avatarOf(s);
          const ok = canGet(s, item);
          return (
            <button
              key={s.id}
              type="button"
              className={`pshop-btn gift-face-btn ${ok ? '' : 'is-has'}`}
              data-sibling={s.id}
              aria-label={ok ? s.name : `${s.name} has it`}
              style={{ ['--kid-color' as string]: AVATAR_SWATCH[a.color] }}
              onClick={() => {
                void speak(ok ? `${s.name}!` : `${s.name} has it.`);
                if (ok) setPicked(s);
              }}
            >
              <Sprite name={a.hero} size={96} />
              {ok ? null : <UiIcon name="check" size={48} />}
            </button>
          );
        })}
      </div>
      <button type="button" className="pshop-btn pshop-cancel" aria-label="Cancel" onClick={onClose}><UiIcon name="close" size={64} /></button>
    </div>
  );
}

/**
 * The present on Home: a wrapped gift for each gift not opened yet, "A gift from <sibling>!" read aloud (the voice policy keeps mute
 * and a parent's voice off). One tap opens it and shows the item, a second closes it and marks it seen. It renders nothing without a gift.
 */
export function GiftPresent({ api, learner }: { api: GiftApi | undefined; learner: 'reader' | 'prereader' }) {
  const [queue, setQueue] = useState<IncomingGift[]>([]);
  const [opened, setOpened] = useState(false);
  // Read once per Home load. The app builds a new api object on every render, so the effect follows whether there is one.
  const latest = useRef(api);
  latest.current = api;
  const has = !!api;
  useEffect(() => {
    if (!has) return;
    let live = true;
    void latest.current!.incoming().then((list) => live && setQueue(list), () => undefined);
    return () => {
      live = false;
    };
  }, [has]);
  const current = queue[0];
  const currentId = current?.gift.id;
  const fromName = current?.fromName;
  useEffect(() => {
    if (currentId && fromName) void speak(giftHeadline(fromName));
  }, [currentId, fromName]);
  if (!current || !api) return null;
  const item = itemById(current.gift.itemId);
  const px = learner === 'prereader' ? 160 : 96;
  if (!opened) {
    return (
      <div className="modal gift-present" role="dialog" aria-modal="true" aria-label="A present" data-testid="gift-present" data-learner={learner}>
        <div className="panel center-text">
          <h2 className="pixel" data-testid="gift-headline">{giftHeadline(current.fromName)}</h2>
          <button
            type="button"
            className="pshop-btn gift-wrapped"
            aria-label="Open the present"
            data-testid="gift-open"
            onClick={() => {
              setOpened(true);
              chime();
              if (item) void speak(`You got the ${item.name}!`);
            }}
          >
            <span className="bob"><UiIcon name="gift" size={px} /></span>
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="modal gift-present" role="dialog" aria-modal="true" aria-label="Your gift" data-testid="gift-opened" data-learner={learner}>
      <div className="panel center-text">
        <h2 className="pixel">{item ? `You got the ${item.name}!` : 'You got a gift!'}</h2>
        {item ? <Sprite name={item.id} size={px + 64} className="bob" /> : null}
        <button
          type="button"
          className="pshop-btn gift-done"
          aria-label="Done"
          data-testid="gift-done"
          onClick={() => {
            const id = current.gift.id;
            setOpened(false);
            setQueue((q) => q.slice(1));
            void api.open(id).catch(() => undefined);
          }}
        >
          <UiIcon name="check" size={64} />
        </button>
      </div>
    </div>
  );
}

/** The grown-ups' Gifts section: the on/off switch (default on) and the history, newest first. Shown for a family with two or more players. */
export function GiftsPanel({ repo, kids }: { repo: Repo; kids: Kid[] }) {
  const [family, setFamily] = useState<Family | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<GiftHistoryRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void repo.getFamily().then((f) => live && setFamily(f)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [repo]);
  const kidKey = kids.map((k) => k.id).join(',');
  useEffect(() => {
    let live = true;
    void Promise.all(kids.map((k) => repo.listPurchases(k.id, 100).then((p) => [k.id, p] as const, () => [k.id, []] as const))).then((all) => {
      if (live) setRows(giftHistory(kids, Object.fromEntries(all)));
    });
    return () => {
      live = false;
    };
    // The history is read again when the set of players changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, kidKey]);
  const on = giftingOn(family);
  return (
    <section className="panel gifts-panel" aria-label="Gifts" data-testid="gifts-panel">
      <h2><UiIcon name="gift" size={24} /> Gifts</h2>
      <p className="muted">A player can buy an item for a brother or sister and pay for it with their own gems. Turn it off here and the Gift button goes away.</p>
      <label className="check">
        <input
          type="checkbox"
          data-testid="gifting-toggle"
          checked={on}
          disabled={busy || !family}
          onChange={async (e) => {
            const next = e.target.checked;
            setBusy(true);
            try {
              await repo.setGifting(next);
              setFamily((f) => (f ? { ...f, gifting: next } : f));
            } catch (err) {
              reportFailure('The gifts setting was not saved.', err);
            } finally {
              setBusy(false);
            }
          }}
        />
        Gifts between players: {on ? 'On' : 'Off'}
      </label>
      <h3>Gift history</h3>
      {rows === null ? <p className="muted">Loading.</p> : rows.length ? (
        <ul className="gem-history" data-testid="gift-history">
          {rows.map((r) => (
            <li key={`${r.from}-${r.id}`} data-testid="gift-row">
              <span className="gem-delta">−{r.cost}</span>
              <span>{r.fromName} gave {r.toName} the {r.itemName}</span>
              <span className="muted">{new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" data-testid="gift-history-empty">No gifts yet.</p>
      )}
    </section>
  );
}
