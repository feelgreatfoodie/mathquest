import { useCallback, useEffect, useState } from 'react';
import { soundsOf, voiceOf, type Kid } from '../engine/models';
import { setMuted } from './early/sounds';
import { canHear, setVoicePolicy, speak, unlockSpeech } from './early/useSpeech';
import { UiIcon } from './sprites';

// One kid preference on this device (never in Firestore), shared by Picture Run, the pre-reader home and end screen,
// Dungeon and Adventure. A parent sets two things per kid: voice ('on', 'off' or 'kid') and sounds ('on' or 'off').
// The kid's own mute silences the voice and the sounds. A parent's 'off' is silent and the kid cannot override it.
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
  const voiceOff = voiceOf(kid.settings) === 'off';
  const soundsOff = soundsOf(kid.settings) === 'off';
  const [local, setLocal] = useState(() => readLocal(kid.id));
  // Another screen may have changed the kid's choice while this one was closed.
  useEffect(() => setLocal(readLocal(kid.id)), [kid.id]);
  const voiceMuted = voiceOff || local;
  const soundsMuted = soundsOff || local;
  useEffect(() => {
    setMuted(soundsMuted);
    setVoicePolicy({ muted: voiceMuted, locked: voiceOff });
    return () => {
      setMuted(false);
      setVoicePolicy({ muted: false, locked: false });
    };
  }, [soundsMuted, voiceMuted, voiceOff]);
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
  // `locked`: the parent has turned both off, so there is nothing for the kid to switch.
  return { muted: voiceMuted && soundsMuted, locked: voiceOff && soundsOff, voiceOff, voiceMuted, toggle };
}

/** The mute switch for a run's top bar. Hidden when a parent has turned sound off. */
export function MuteButton({ muted, locked, onToggle, big = false }: { muted: boolean; locked: boolean; onToggle: () => void; big?: boolean }) {
  if (locked) return null;
  return (
    <button type="button" className={`icon-btn mute-btn${big ? ' mute-big' : ''}`} aria-label={muted ? 'Sound is off. Turn it on' : 'Sound is on. Turn it off'} aria-pressed={muted} onClick={onToggle}>
      <svg width={big ? 72 : 40} height={big ? 72 : 40} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 9v6h4l5 4V5L7 9z" />
        {muted ? <path d="M15 9l6 6M21 9l-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" /> : <path d="M15 8.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />}
      </svg>
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
      <UiIcon name="speaker" size={big ? 72 : 44} />
    </button>
  );
}
