import { useCallback, useEffect, useState } from 'react';
import { soundOf, type Kid } from '../engine/models';
import { setMuted } from './early/sounds';

// Sound is on by default. A parent can turn it off for a kid (settings.sound === false); the kid can also mute from the
// top bar, and that choice is kept on this device for this kid.
const key = (kidId: string) => `mathquest:v1:mute:${kidId}`;

function readLocal(kidId: string): boolean {
  try {
    return localStorage.getItem(key(kidId)) === '1';
  } catch {
    return false;
  }
}

/** Applies the kid's mute to the sound functions, and returns the state for the top bar button. */
export function useMute(kid: Kid) {
  const parentOff = !soundOf(kid.settings);
  const [local, setLocal] = useState(() => readLocal(kid.id));
  const muted = parentOff || local;
  useEffect(() => {
    setMuted(muted);
    return () => setMuted(false);
  }, [muted]);
  const toggle = useCallback(() => {
    setLocal((v) => {
      try {
        localStorage.setItem(key(kid.id), v ? '0' : '1');
      } catch {
        // The choice lasts until the screen closes.
      }
      return !v;
    });
  }, [kid.id]);
  return { muted, locked: parentOff, toggle };
}

/** The mute switch for a run's top bar. Hidden when a parent has turned sound off. */
export function MuteButton({ muted, locked, onToggle }: { muted: boolean; locked: boolean; onToggle: () => void }) {
  if (locked) return null;
  return (
    <button type="button" className="icon-btn mute-btn" aria-label={muted ? 'Sound is off. Turn it on' : 'Sound is on. Turn it off'} aria-pressed={muted} onClick={onToggle}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 9v6h4l5 4V5L7 9z" />
        {muted ? <path d="M15 9l6 6M21 9l-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" /> : <path d="M15 8.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />}
      </svg>
    </button>
  );
}
