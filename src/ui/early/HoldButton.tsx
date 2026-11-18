import { useEffect, useRef, useState } from 'react';
import { risingTone, unlockSounds } from './sounds';
import { speak, unlockSpeech } from './useSpeech';

export const HOLD_MS = 1200;
/** The finger may wander this far (px) from where it landed before the hold is cancelled. */
export const DRIFT_PX = 40;
/** A pointercancel this soon after the touch started is a real cancel. Later ones are the OS interrupting a long press. */
export const CANCEL_GRACE_MS = 300;
const HINT_MS = 2600;
const WIGGLE_MS = 600;
const HINT_SPEECH = 'Hold the house to go home.';

interface Props {
  onHold: () => void;
  label?: string;
  children: React.ReactNode;
}

/**
 * Acts only after a 1.2 s hold, so a small finger cannot leave by accident.
 * A release before that wiggles the button, shows a hand-and-clock bubble and says how to use it.
 */
export function HoldButton({ onHold, label = 'Hold to leave', children }: Props) {
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const [wiggle, setWiggle] = useState(false);
  const [peek, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wiggleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number; at: number } | null>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
    setHolding(false);
  };

  const showHint = () => {
    setHint(true);
    setWiggle(true);
    setPeek(false);
    // Next frame, so the quick partial ring fill restarts on every tap.
    requestAnimationFrame(() => setPeek(true));
    if (hintTimer.current) clearTimeout(hintTimer.current);
    if (wiggleTimer.current) clearTimeout(wiggleTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), HINT_MS);
    wiggleTimer.current = setTimeout(() => { setWiggle(false); setPeek(false); }, WIGGLE_MS);
    unlockSounds();
    unlockSpeech();
    void speak(HINT_SPEECH);
  };

  const start = (x: number, y: number) => {
    stop();
    origin.current = { x, y, at: performance.now() };
    setHolding(true);
    setHint(false);
    risingTone();
    timer.current = setTimeout(() => {
      stop();
      onHold();
    }, HOLD_MS);
  };

  /** The finger lifted, or a key was released, before the time was up. */
  const release = () => {
    const held = timer.current !== null;
    stop();
    if (held) showHint();
  };

  useEffect(
    () => () => {
      stop();
      if (hintTimer.current) clearTimeout(hintTimer.current);
      if (wiggleTimer.current) clearTimeout(wiggleTimer.current);
    },
    [],
  );

  return (
    <span className="hold-wrap">
      <button
        type="button"
        className={`hold-btn ${holding ? 'is-holding' : ''} ${wiggle ? 'is-wiggle' : ''} ${peek ? 'is-peek' : ''}`}
        aria-label={label}
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Capture is a help, not a need: the hold still works without it.
          }
          start(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          const o = origin.current;
          if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > DRIFT_PX) stop();
        }}
        onPointerUp={release}
        onPointerCancel={() => {
          const o = origin.current;
          if (o && performance.now() - o.at < CANCEL_GRACE_MS) stop();
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(0, 0);
        }}
        onKeyUp={release}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
        <span className="hold-ring" aria-hidden="true" />
      </button>
      {hint ? (
        <span className="hold-hint" role="status" aria-label="Hold to go home">
          <svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.8-2.4L3 14.5a1.6 1.6 0 0 1 2.5-2L8 15" />
          </svg>
          <svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </span>
      ) : null}
    </span>
  );
}
