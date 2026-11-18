import { useEffect } from 'react';
import type { Kid } from '../../engine/models';
import { word } from '../../engine/modules/early';
import type { RunSummary } from '../../engine/session';
import { Sprite, UiIcon } from '../sprites';
import { HoldButton } from './PrereaderRun';
import { chime, unlockSounds } from './sounds';
import { speak, unlockSpeech } from './useSpeech';

const MAX_FLAMES = 7;

/** Home for a pre-reader: the hero, a huge Play triangle, and streak flames. No reading needed. */
export function PrereaderHome({ kid, onStart, onBack }: { kid: Kid; onStart: () => void; onBack: () => void }) {
  const flames = Math.min(MAX_FLAMES, kid.game.streakDays);
  return (
    <div className="screen center early-home" aria-label={`${kid.name}'s home`}>
      <div className="early-home-top">
        <HoldButton onHold={onBack}><UiIcon name="house" size={44} /></HoldButton>
      </div>
      <Sprite name={kid.game.hero} size={220} className="bob" />
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
      <div className="flames" role="img" aria-label={`${kid.game.streakDays} day streak`}>
        {Array.from({ length: flames }, (_, i) => <UiIcon key={i} name="flame" size={44} />)}
        {kid.game.streakDays > MAX_FLAMES ? <span className="flame-count">{kid.game.streakDays}</span> : null}
      </div>
    </div>
  );
}

/** Stars and gems, and the voice says how many stars. */
export function PrereaderSummary({ kid, summary, onAgain, onHome }: { kid: Kid; summary: RunSummary; onAgain: () => void; onHome: () => void }) {
  const stars = summary.correct;
  const total = Math.max(summary.graded, stars);
  useEffect(() => {
    chime();
    const line = stars > 0 ? `Great job! You got ${word(stars)} ${stars === 1 ? 'star' : 'stars'}!` : "Nice try! Let's play again!";
    void speak(line);
  }, [stars]);
  return (
    <div className="screen center early-summary">
      <Sprite name={kid.game.hero} size={160} className="bob" />
      <div className="big-stars" role="img" aria-label={`${stars} of ${total} stars`}>
        {Array.from({ length: total }, (_, i) => (
          <svg key={i} width="64" height="64" viewBox="0 0 24 24" aria-hidden="true" className={i < stars ? 'star on' : 'star'}>
            <path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21.1l1.4-7L2 9.3l7-.8z" />
          </svg>
        ))}
      </div>
      <div className="early-tally">
        <span className="tally-num">{stars}</span>
        <span className="tally-gems"><UiIcon name="gem" size={56} /><span className="tally-num">{summary.gems}</span></span>
      </div>
      <div className="row">
        <button type="button" className="play-btn small" aria-label="Play again" onClick={() => { unlockSounds(); unlockSpeech(); onAgain(); }}>
          <UiIcon name="play" size={96} />
        </button>
        <button type="button" className="icon-btn" aria-label="Home" onClick={onHome}><UiIcon name="house" size={56} /></button>
      </div>
    </div>
  );
}
