import { useEffect, useRef, useState } from 'react';
import { HEROES, type GameDelta } from '../engine/game';
import { shop2On, type Kid, type Learner } from '../engine/models';
import { vaultOn } from '../game/vault';
import { ITEMS, type EquipSlot, type ItemTier } from '../game/shop/catalog';
import { equippedOf, ownedItems } from '../game/shop/shopState';
import { chime } from './early/sounds';
import { speak } from './early/useSpeech';
import { GoalJar, goalName } from './GoalJar';
import { Sprite, UiIcon } from './sprites';
import { PrereaderVault, ReaderVault } from './VaultPanel';
import { ShopStall, VaultDoor } from './pixel';
import { useDeposits, type VaultApi } from './vaultApi';

export type OnGame = (delta: GameDelta) => Promise<boolean>;

interface Props {
  kid: Kid;
  learner: Learner;
  onGame: OnGame;
  /** The vault, when the app has one. The Vault tab shows only when a parent turned the vault on for this kid. */
  vault?: VaultApi;
  /** Open on the Vault tab (the home chest does). */
  openVault?: boolean;
  onClose: () => void;
}

type Tab = 'hero' | EquipSlot | 'adventure' | 'camp';
type ShopTab = Tab | 'vault';

/** One thing for sale: a hero or a catalog item. */
interface Entry {
  id: string;
  name: string;
  cost: number;
  kind: 'hero' | 'item';
  tier?: ItemTier;
  slot?: EquipSlot;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'hero', label: 'Heroes', icon: 'knight' },
  { id: 'weapon', label: 'Weapons', icon: 'w-sword' },
  { id: 'gear', label: 'Gear', icon: 'g-helm' },
  { id: 'pet', label: 'Pets', icon: 'p-dog' },
  { id: 'adventure', label: 'Adventure', icon: 'a-lantern' },
  { id: 'camp', label: 'Camp', icon: 'c-tent' },
];
const VAULT_TAB = { id: 'vault' as const, label: 'Vault', icon: 'chest' };

/** Legendary pieces sit in the tab of their slot, after the others. */
export function entriesFor(tab: Tab): Entry[] {
  if (tab === 'hero') return HEROES.map((h) => ({ id: h.id, name: h.name, cost: h.cost, kind: 'hero' as const }));
  return ITEMS.filter((i) => (tab === 'adventure' || tab === 'camp' ? i.category === tab : i.slot === tab)).map((i) => ({
    id: i.id, name: i.name, cost: i.cost, kind: 'item' as const, tier: i.tier, ...(i.slot ? { slot: i.slot } : {}),
  }));
}

type CardState = 'active' | 'owned' | 'locked' | 'poor';

function stateOf(kid: Kid, e: Entry): CardState {
  const g = kid.game;
  if (e.kind === 'hero') {
    if (g.hero === e.id) return 'active';
    if (g.heroes.includes(e.id)) return 'owned';
  } else {
    if (equippedOf(g)[e.slot as EquipSlot] === e.id) return 'active';
    if (ownedItems(g).includes(e.id)) return 'owned';
  }
  return g.gems >= e.cost ? 'locked' : 'poor';
}

/** An owned item with no slot (adventure, camp) has nothing to equip. */
const wearable = (e: Entry) => e.kind === 'hero' || Boolean(e.slot);

/** One shop for both modes: a text modal for readers, a picture-and-voice screen for pre-readers. */
export function HeroShop({ kid, learner, onGame, vault, openVault, onClose }: Props) {
  return learner === 'prereader' ? <PrereaderShop kid={kid} onGame={onGame} vault={vault} openVault={openVault} onClose={onClose} /> : <ReaderShop kid={kid} onGame={onGame} vault={vault} openVault={openVault} onClose={onClose} />;
}

const TIER_LABEL: Record<ItemTier, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

function ReaderShop({ kid, onGame, vault, openVault, onClose }: Omit<Props, 'learner'>) {
  const full = shop2On(kid.settings);
  const hasVault = !!vault && vaultOn(kid.settings);
  const [tab, setTab] = useState<ShopTab>(openVault && hasVault ? 'vault' : 'hero');
  const [confirming, setConfirming] = useState<string | null>(null);
  const dep = useDeposits(vault, hasVault, kid.game.gems);
  const tabs: { id: ShopTab; label: string; icon: string }[] = [...(full ? TABS : []), ...(hasVault ? [VAULT_TAB] : [])];
  const onVault = hasVault && tab === 'vault';
  const entries = entriesFor(full && tab !== 'vault' ? tab : 'hero');
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Hero shop">
      <div className="panel shop">
        <h2 className="pixel">{full ? 'Shop' : 'Hero Shop'}</h2>
        {onVault ? <VaultDoor /> : <ShopStall />}
        <p className="muted">You have {kid.game.gems} gems. Earn gems by finishing quests.</p>
        {tabs.length ? (
          <div className="shop-tabs" role="tablist" aria-label="Shop sections">
            {[...(full ? [] : [{ id: 'hero' as const, label: 'Heroes', icon: 'knight' }]), ...tabs].map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-tab={t.id} className={`shop-tab ${tab === t.id ? 'is-on' : ''}`} onClick={() => { setTab(t.id); setConfirming(null); }}>
                {t.id === 'vault' ? <UiIcon name="chest" size={28} /> : <Sprite name={t.icon} size={28} />}{t.label}
              </button>
            ))}
          </div>
        ) : null}
        {full && !onVault ? <GoalJar game={kid.game} learner="reader" /> : null}
        {full && tab === 'adventure' ? <p className="muted">Adventure items are used out on the map. Buy them now and they are ready.</p> : null}
        {onVault ? <ReaderVault kid={kid} vault={vault!} deposits={dep.deposits} refresh={dep.refresh} /> : null}
        <div className="shop-grid" style={onVault ? { display: 'none' } : undefined}>
          {entries.map((e) => {
            const state = stateOf(kid, e);
            const isGoal = kid.game.goal === e.id;
            return (
              <div key={e.id} className={`shop-item ${state === 'active' ? 'is-active' : ''} ${e.tier === 'legendary' ? 'is-legendary' : ''}`} data-item={e.id} data-state={state}>
                <Sprite name={e.id} size={72} />
                <span>{e.name}</span>
                {e.tier && full ? <span className={`tier tier-${e.tier}`}>{TIER_LABEL[e.tier]}</span> : null}
                {state === 'active' || state === 'owned' ? (
                  wearable(e) ? (
                    <button
                      type="button"
                      className="btn btn-small shop-btn-48"
                      disabled={e.kind === 'hero' && state === 'active'}
                      onClick={() => void onGame(state === 'active' && e.slot ? { unequip: e.slot } : { equip: e.id })}
                    >
                      {state === 'active' ? (e.kind === 'hero' ? 'Equipped' : 'Take off') : 'Equip'}
                    </button>
                  ) : (
                    <span className="owned-tag">Owned</span>
                  )
                ) : confirming === e.id ? (
                  <span className="confirm-row">
                    <button type="button" className="btn btn-small shop-btn-48" onClick={() => { setConfirming(null); void onGame({ purchase: e.id }); }}>Buy for {e.cost}</button>
                    <button type="button" className="btn btn-small btn-ghost shop-btn-48" onClick={() => setConfirming(null)}>No</button>
                  </span>
                ) : (
                  <>
                    <button type="button" className="btn btn-small shop-btn-48" disabled={state === 'poor'} onClick={() => (full ? setConfirming(e.id) : void onGame({ purchase: e.id }))}>
                      {e.cost} gems
                    </button>
                    {full && state === 'poor' ? (
                      <button type="button" className="btn btn-small btn-ghost shop-btn-48" onClick={() => void onGame({ goal: isGoal ? null : e.id })}>
                        {isGoal ? 'Saving' : 'Save for this'}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" className="btn shop-btn-48" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

const SPARKLE_MS = 1100;

/**
 * The pre-reader shop. No words: a gem icon and a numeral for prices, a check for owned things, and the voice.
 * Six picture tabs. Tap a thing to hear its name. Tap an owned one to wear it. Tap one you can afford, then one
 * big confirm. Tap one you cannot afford yet and it goes in the jar. Every target is at least 120 px.
 */
function PrereaderShop({ kid, onGame, vault, openVault, onClose }: Omit<Props, 'learner'>) {
  const full = shop2On(kid.settings);
  const hasVault = !!vault && vaultOn(kid.settings);
  const [tab, setTab] = useState<ShopTab>(openVault && hasVault ? 'vault' : 'hero');
  const dep = useDeposits(vault, hasVault, kid.game.gems);
  const tabs: { id: ShopTab; label: string; icon: string }[] = [...(full ? TABS : [{ id: 'hero' as const, label: 'Heroes', icon: 'knight' }]), ...(hasVault ? [VAULT_TAB] : [])];
  const onVault = hasVault && tab === 'vault';
  const [confirming, setConfirming] = useState<Entry | null>(null);
  const [spark, setSpark] = useState<string | null>(null);
  const busy = useRef(false);
  const sparkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (sparkTimer.current && clearTimeout(sparkTimer.current)), []);

  const sparkle = (id: string) => {
    setSpark(id);
    if (sparkTimer.current) clearTimeout(sparkTimer.current);
    sparkTimer.current = setTimeout(() => setSpark(null), SPARKLE_MS);
  };

  const tap = async (e: Entry) => {
    if (busy.current) return;
    const state = stateOf(kid, e);
    void speak(`${e.name}!`);
    if (state === 'owned' || (state === 'active' && e.slot)) {
      if (!wearable(e)) return;
      busy.current = true;
      try {
        const delta: GameDelta = state === 'active' && e.slot ? { unequip: e.slot } : { equip: e.id };
        if (await onGame(delta)) {
          chime();
          sparkle(e.id);
        }
      } finally {
        busy.current = false;
      }
    } else if (state === 'locked') {
      setConfirming(e);
    } else if (state === 'poor' && full) {
      busy.current = true;
      try {
        const clear = kid.game.goal === e.id;
        if (await onGame({ goal: clear ? null : e.id })) {
          sparkle(e.id);
          if (!clear) void speak(`Saving for the ${e.name}!`);
        }
      } finally {
        busy.current = false;
      }
    }
  };

  // The one confirm. The ref closes before the first await, so a double tap reaches the repo once.
  const confirm = async () => {
    if (busy.current || !confirming) return;
    busy.current = true;
    const e = confirming;
    try {
      const ok = await onGame({ purchase: e.id });
      setConfirming(null);
      if (ok) {
        chime();
        sparkle(e.id);
        void speak(`You got the ${e.name}!`);
      }
    } finally {
      busy.current = false;
    }
  };

  if (confirming) {
    return (
      <div className="screen center pshop pshop-confirm" aria-label={`Buy ${confirming.name}`}>
        <Sprite name={confirming.id} size={220} className="bob" />
        <div className="pshop-price"><UiIcon name="gem" size={72} /><span className="tally-num">{confirming.cost}</span></div>
        <div className="row pshop-actions">
          <button type="button" className="pshop-btn pshop-buy" aria-label="Buy" onClick={() => void confirm()}>
            <UiIcon name="check" size={84} /><UiIcon name="gem" size={64} />
          </button>
          <button type="button" className="pshop-btn pshop-cancel" aria-label="Cancel" onClick={() => setConfirming(null)}>
            <UiIcon name="close" size={64} />
          </button>
        </div>
      </div>
    );
  }

  const goal = kid.game.goal;
  const entries = entriesFor(full && tab !== 'vault' ? tab : 'hero');
  return (
    <div className="screen center pshop" aria-label="Hero shop">
      {onVault ? <VaultDoor /> : <ShopStall />}
      <div className="pshop-top">
        <button type="button" className="pshop-btn pshop-home" aria-label="Home" onClick={onClose}><UiIcon name="house" size={64} /></button>
        {full ? (
          <GoalJar
            game={kid.game}
            learner="prereader"
            onClick={() => void speak(`Saving for the ${goalName(goal ?? '')}! You have ${kid.game.gems}.`)}
          />
        ) : null}
        <div className="pshop-purse" role="img" aria-label={`${kid.game.gems} gems`}>
          <UiIcon name="gem" size={56} /><span className="tally-num">{kid.game.gems}</span>
        </div>
      </div>
      {tabs.length > 1 ? (
        <div className={`pshop-tabs ${tabs.length > 6 ? 'is-wide' : ''}`} role="tablist" aria-label="Shop sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-label={t.label} data-tab={t.id} className={`pshop-tab ${tab === t.id ? 'is-on' : ''}`} onClick={() => { setTab(t.id); void speak(t.label); }}>
              {t.id === 'vault' ? <UiIcon name="chest" size={72} /> : <Sprite name={t.icon} size={72} />}
            </button>
          ))}
        </div>
      ) : null}
      {onVault ? <PrereaderVault kid={kid} vault={vault!} deposits={dep.deposits} refresh={dep.refresh} /> : null}
      <div className="pshop-grid" style={onVault ? { display: 'none' } : undefined}>
        {entries.map((e) => {
          const state = stateOf(kid, e);
          const pinned = goal === e.id;
          return (
            <button
              key={e.id}
              type="button"
              className={`pshop-card is-${state} ${pinned ? 'is-goal' : ''} ${e.tier === 'legendary' ? 'is-legendary' : ''}`}
              data-item={e.id}
              data-hero={e.kind === 'hero' ? e.id : undefined}
              data-state={state}
              aria-label={e.name}
              onClick={() => void tap(e)}
            >
              <Sprite name={e.id} size={104} className={state === 'active' ? 'bob' : undefined} />
              <span className="pshop-tag">
                {state === 'active' || state === 'owned' ? (
                  <UiIcon name="check" size={44} />
                ) : (
                  <>
                    <UiIcon name="gem" size={40} />
                    <span className="tally-num">{e.cost}</span>
                    {pinned ? <UiIcon name="chest" size={36} /> : null}
                  </>
                )}
              </span>
              {spark === e.id ? <span className="pshop-sparkle" aria-hidden="true"><UiIcon name="sparkle" size={48} /><UiIcon name="sparkle" size={32} /><UiIcon name="sparkle" size={40} /></span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
