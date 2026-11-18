import { useEffect, useRef, useState } from 'react';
import { HEROES, type GameDelta, type Hero } from '../engine/game';
import type { Kid, Learner } from '../engine/models';
import { chime } from './early/sounds';
import { speak } from './early/useSpeech';
import { Sprite, UiIcon } from './sprites';

export type OnGame = (delta: GameDelta) => Promise<boolean>;

interface Props {
  kid: Kid;
  learner: Learner;
  onGame: OnGame;
  onClose: () => void;
}

/** One shop for both modes: a text modal for readers, a picture-and-voice screen for pre-readers. */
export function HeroShop({ kid, learner, onGame, onClose }: Props) {
  return learner === 'prereader' ? <PrereaderShop kid={kid} onGame={onGame} onClose={onClose} /> : <ReaderShop kid={kid} onGame={onGame} onClose={onClose} />;
}

function ReaderShop({ kid, onGame, onClose }: Omit<Props, 'learner'>) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Hero shop">
      <div className="panel shop">
        <h2 className="pixel">Hero Shop</h2>
        <p className="muted">You have {kid.game.gems} gems. Earn gems by finishing quests.</p>
        <div className="shop-grid">
          {HEROES.map((h) => {
            const owned = kid.game.heroes.includes(h.id);
            const active = kid.game.hero === h.id;
            const canBuy = !owned && kid.game.gems >= h.cost;
            return (
              <div key={h.id} className={`shop-item ${active ? 'is-active' : ''}`}>
                <Sprite name={h.id} size={72} />
                <span>{h.name}</span>
                {owned ? (
                  <button type="button" className="btn btn-small" disabled={active} onClick={() => void onGame({ equip: h.id })}>
                    {active ? 'Equipped' : 'Equip'}
                  </button>
                ) : (
                  <button type="button" className="btn btn-small" disabled={!canBuy} onClick={() => void onGame({ purchase: h.id })}>
                    {h.cost} gems
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

const SPARKLE_MS = 1100;

type CardState = 'active' | 'owned' | 'locked' | 'poor';

function stateOf(kid: Kid, h: Hero): CardState {
  if (kid.game.hero === h.id) return 'active';
  if (kid.game.heroes.includes(h.id)) return 'owned';
  return kid.game.gems >= h.cost ? 'locked' : 'poor';
}

/**
 * The pre-reader shop. No words: a gem icon and a numeral for prices, a check for owned heroes, and the voice.
 * Tap a hero to hear its name. Tap an owned hero to wear it. Tap a hero you can afford, then one big confirm.
 */
function PrereaderShop({ kid, onGame, onClose }: Omit<Props, 'learner'>) {
  const [confirming, setConfirming] = useState<Hero | null>(null);
  const [spark, setSpark] = useState<string | null>(null);
  const busy = useRef(false);
  const sparkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (sparkTimer.current && clearTimeout(sparkTimer.current)), []);

  const sparkle = (id: string) => {
    setSpark(id);
    if (sparkTimer.current) clearTimeout(sparkTimer.current);
    sparkTimer.current = setTimeout(() => setSpark(null), SPARKLE_MS);
  };

  const tapHero = async (h: Hero) => {
    if (busy.current) return;
    const state = stateOf(kid, h);
    void speak(`${h.name}!`);
    if (state === 'owned') {
      busy.current = true;
      try {
        if (await onGame({ equip: h.id })) {
          chime();
          sparkle(h.id);
        }
      } finally {
        busy.current = false;
      }
    } else if (state === 'locked') {
      setConfirming(h);
    }
  };

  // The one confirm. The ref closes before the first await, so a double tap reaches the repo once.
  const confirm = async () => {
    if (busy.current || !confirming) return;
    busy.current = true;
    const h = confirming;
    try {
      const ok = await onGame({ purchase: h.id });
      setConfirming(null);
      if (ok) {
        chime();
        sparkle(h.id);
        void speak(`You got the ${h.name}!`);
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

  return (
    <div className="screen center pshop" aria-label="Hero shop">
      <div className="pshop-top">
        <button type="button" className="pshop-btn pshop-home" aria-label="Home" onClick={onClose}><UiIcon name="house" size={64} /></button>
        <div className="pshop-purse" role="img" aria-label={`${kid.game.gems} gems`}>
          <UiIcon name="gem" size={56} /><span className="tally-num">{kid.game.gems}</span>
        </div>
      </div>
      <div className="pshop-grid">
        {HEROES.map((h) => {
          const state = stateOf(kid, h);
          return (
            <button
              key={h.id}
              type="button"
              className={`pshop-card is-${state}`}
              data-hero={h.id}
              data-state={state}
              aria-label={h.name}
              onClick={() => void tapHero(h)}
            >
              <Sprite name={h.id} size={104} className={state === 'active' ? 'bob' : undefined} />
              <span className="pshop-tag">
                {state === 'active' || state === 'owned' ? (
                  <UiIcon name="check" size={44} />
                ) : (
                  <>
                    <UiIcon name="gem" size={40} />
                    <span className="tally-num">{h.cost}</span>
                  </>
                )}
              </span>
              {spark === h.id ? <span className="pshop-sparkle" aria-hidden="true"><UiIcon name="sparkle" size={48} /><UiIcon name="sparkle" size={32} /><UiIcon name="sparkle" size={40} /></span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
