import { useEffect, useRef } from 'react';
import { learnerOf, type Kid } from '../../engine/models';
import { HeroFigure } from '../HeroFigure';
import { MuteButton, useMute } from '../MuteButton';
import { speak } from '../early/useSpeech';
import { UiIcon } from '../sprites';

export const PAUSE_VOICE = 'Time for a break! See you soon.';

/** A ring that empties as a timed pause runs out. No numbers: a pre-reader reads the ring, not the clock. */
export function PauseRing({ fraction, size }: { fraction: number; size: number }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const f = Math.min(1, Math.max(0, fraction));
  return (
    <svg className="pause-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Time left" data-testid="pause-ring" data-fraction={f.toFixed(3)}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={10} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={10} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - f)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

function minutesText(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${h} hour${h === 1 ? '' : 's'}${rest ? ` ${rest} min` : ''}`;
}

interface Props {
  kid: Kid;
  /** Ms left on a timed pause; null when it lasts until a grown-up resumes (or no clock estimate yet). */
  left: number | null;
  /** The length the ring started from. */
  total: number | null;
  /** True on a timed pause. */
  timed: boolean;
  /** The Grown-ups button: PIN-gated resume. */
  onGrownUps: () => void;
  /** Back to the player list, when other players share this device. */
  onSwitch?: () => void;
}

/** The break screen: a sleeping hero by a campfire. Home, the shop, the vault and every mode are behind it. */
export function PauseScreen({ kid, left, total, timed, onGrownUps, onSwitch }: Props) {
  const picture = learnerOf(kid.settings) === 'prereader';
  const mute = useMute(kid);
  // The voice line, once, through speak(): it obeys the kid's mute and a parent's voice off.
  const said = useRef(false);
  useEffect(() => {
    if (!picture || said.current) return;
    said.current = true;
    void speak(PAUSE_VOICE);
  }, [picture]);
  const fraction = timed && left !== null && total ? left / total : 1;
  return (
    <div className={`screen center pause-screen ${picture ? 'is-prereader' : ''}`} data-testid="pause-screen">
      {picture ? (
        <div className="run-top"><span /><MuteButton muted={mute.muted} locked={mute.locked} onToggle={mute.toggle} big chimesOnly={mute.chimesOnly} /></div>
      ) : null}
      <div className="pause-scene" aria-hidden="true">
        <span className="pause-hero"><HeroFigure game={kid.game} size={picture ? 160 : 120} /></span>
        <span className="pause-fire"><UiIcon name="flame" size={picture ? 120 : 80} /></span>
        <span className="pause-zzz pixel">z z z</span>
      </div>
      {picture ? null : <h1 className="pixel">Time for a break!</h1>}
      {timed ? (
        <div className="pause-timer">
          <PauseRing fraction={fraction} size={picture ? 160 : 120} />
          {picture ? null : <p data-testid="pause-left">{left === null ? 'Waiting to check the time…' : `Back in about ${minutesText(left)}.`}</p>}
        </div>
      ) : picture ? null : (
        <p>A grown-up will wake you up.</p>
      )}
      <div className="pause-actions">
        <button type="button" className={`btn btn-ghost ${picture ? 'btn-prereader' : ''}`} style={picture ? { minWidth: 120, minHeight: 120 } : undefined} onClick={onGrownUps} aria-label="Grown-ups">
          {picture ? <UiIcon name="lock" size={64} /> : 'Grown-ups'}
        </button>
        {onSwitch ? (
          <button type="button" className={`btn btn-ghost ${picture ? 'btn-prereader' : ''}`} style={picture ? { minWidth: 120, minHeight: 120 } : undefined} onClick={onSwitch} aria-label="Other players">
            {picture ? <UiIcon name="house" size={64} /> : 'Other players'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
