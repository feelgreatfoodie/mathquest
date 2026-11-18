import { useState } from 'react';
import { GoalJar, goalName } from '../GoalJar';
import { CampRow } from '../CampRow';
import { HeroFigure } from '../HeroFigure';
import type { Kid } from '../../engine/models';
import { HeroShop, type OnGame } from '../HeroShop';
import { UiIcon } from '../sprites';
import { HoldButton } from './HoldButton';
import { unlockSounds } from './sounds';
import { speak, unlockSpeech } from './useSpeech';

const MAX_FLAMES = 7;

/** Home for a pre-reader: the hero, a huge Play triangle, and streak flames. No reading needed. */
export function PrereaderHome({ kid, onStart, onBack, onGame }: { kid: Kid; onStart: () => void; onBack: () => void; onGame: OnGame }) {
  const [shop, setShop] = useState(false);
  if (shop) return <HeroShop kid={kid} learner="prereader" onGame={onGame} onClose={() => setShop(false)} />;
  const flames = Math.min(MAX_FLAMES, kid.game.streakDays);
  return (
    <div className="screen center early-home" aria-label={`${kid.name}'s home`}>
      <div className="early-home-top">
        <HoldButton onHold={onBack}><UiIcon name="house" size={44} /></HoldButton>
      </div>
      <HeroFigure game={kid.game} size={220} className="bob" />
      <CampRow game={kid.game} size={64} />
      <GoalJar game={kid.game} learner="prereader" onClick={() => void speak(`Saving for the ${goalName(kid.game.goal ?? '')}! You have ${kid.game.gems}.`)} />
      <div className="early-home-row">
        <button
          type="button"
          className="play-btn"
          aria-label="Play"
          onClick={() => {
            // Audio unlocks inside this tap, so the first question can be spoken.
            unlockSounds();
            unlockSpeech();
            onStart();
          }}
        >
          <UiIcon name="play" size={150} />
        </button>
        <button
          type="button"
          className="shop-btn"
          aria-label="Hero shop"
          onClick={() => {
            unlockSounds();
            unlockSpeech();
            setShop(true);
          }}
        >
          <UiIcon name="chest" size={96} />
          <span className="shop-btn-gems"><UiIcon name="gem" size={36} /><span className="tally-num">{kid.game.gems}</span></span>
        </button>
      </div>
      <div className="flames" role="img" aria-label={`${kid.game.streakDays} day streak`}>
        {Array.from({ length: flames }, (_, i) => <UiIcon key={i} name="flame" size={44} />)}
        {kid.game.streakDays > MAX_FLAMES ? <span className="flame-count">{kid.game.streakDays}</span> : null}
      </div>
    </div>
  );
}
