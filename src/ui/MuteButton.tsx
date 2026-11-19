import { useCallback, useEffect, useState } from 'react';
import type { Kid } from '../engine/models';
import { audioPolicy } from './audioPolicy';
import { setMuted } from './early/sounds';
import { canHear, setVoicePolicy, speak, unlockSpeech } from './early/useSpeech';
import { PixelIcon } from './pixel';

// One kid preference on this device (never in Firestore), shared by Picture Run, the pre-reader home and end screen,
// Dungeon and Adventure. A parent sets two things per kid: voice ('on', 'off' or 'kid') and sounds ('on' or 'off').
// Voice 'kid' (the default): the kid's mute silences the voice and the chimes. Voice 'on': the parent pins the voice, so the
// kid's button mutes the chimes only. Voice 'off': silent, and the kid cannot override it.
const key = (kidId: string) => `mathquest:v1:mute:${kidId}`;

function readLocal(kidId: string): boolean {
  try {
    return localStorage.getItem(key(kidId)) === '1';
  } catch {
    return false;
  }
}

/** Applies the kid's mute and the parent's settings to the voice and the sounds, and returns the state for the button. */
export function useMute(kid: Kid) {
  const [local, setLocal] = useState(() => readLocal(kid.id));
  // Another screen may have changed the kid's choice while this one was closed.
  useEffect(() => setLocal(readLocal(kid.id)), [kid.id]);
  const { voiceMuted, voiceLocked, soundsMuted, locked, chimesOnly } = audioPolicy(kid.settings, local);
  useEffect(() => {
    setMuted(soundsMuted);
    setVoicePolicy({ muted: voiceMuted, locked: voiceLocked });
    return () => {
      setMuted(false);
      setVoicePolicy({ muted: false, locked: false });
    };
  }, [soundsMuted, voiceMuted, voiceLocked]);
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
  return { muted: local, locked, chimesOnly, voiceOff: voiceLocked, voiceMuted, toggle };
}

/** The mute switch for a run's top bar. Hidden when a parent has turned sound off. */
export function MuteButton({ muted, locked, onToggle, big = false, chimesOnly = false }: { muted: boolean; locked: boolean; onToggle: () => void; big?: boolean; chimesOnly?: boolean }) {
  if (locked) return null;
  const size = big ? 72 : 40;
  return (
    <button
      type="button"
      className={`icon-btn mute-btn${big ? ' mute-big' : ''}${chimesOnly ? ' chimes-only' : ''}`}
      aria-label={chimesOnly ? (muted ? 'Chimes are off. Turn them on' : 'Chimes are on. Turn them off') : muted ? 'Sound is off. Turn it on' : 'Sound is on. Turn it off'}
      aria-pressed={muted}
      onClick={onToggle}
    >
      {chimesOnly ? (
        // A bell: the voice stays on, only the chimes change. Muted adds a slash.
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zm-2 15a2 2 0 0 0 4 0z" />
          {muted ? <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" /> : null}
        </svg>
      ) : (
        <span className={`px-speaker${muted ? ' is-muted' : ''}`} aria-hidden="true">
          <PixelIcon name="speaker" size={size} />
        </span>
      )}
    </button>
  );
}

/**
 * "Hear it": speaks `text` once per tap, even while muted, and never plays by itself. Hidden when a parent set voice
 * off. `big` makes it a 120 px target for pre-readers.
 */
export function HearButton({ text, muted, disabled = false, big = false, className = '' }: { text: string; muted: boolean; disabled?: boolean; big?: boolean; className?: string }) {
  if (!canHear()) return null;
  return (
    <button
      type="button"
      className={`icon-btn hear-btn${big ? ' hear-big' : ''} ${className}`}
      aria-label={muted ? 'Hear it' : 'Say it again'}
      disabled={disabled}
      onClick={() => {
        unlockSpeech();
        void speak(text, { hear: true });
      }}
    >
      <PixelIcon name="speaker" size={big ? 72 : 44} />
    </button>
  );
}
