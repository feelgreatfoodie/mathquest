import { useCallback, useEffect, useRef } from 'react';

/** The voice. `speechSynthesis`, en-US, rate 0.85. Every call is a no-op where it is missing. */

const RATE = 0.85;
const LANG = 'en-US';

function synth(): SpeechSynthesis | null {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  } catch {
    return null;
  }
}

export function speechAvailable(): boolean {
  return synth() !== null && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** How long to wait for an utterance that never reports `end` (muted, no voices, a stub). */
function fallbackMs(text: string): number {
  return Math.max(600, text.length * 75);
}

/**
 * Says `text`. By default it cuts off whatever is being said; `queue: true` waits its turn.
 * Resolves when the voice finishes, fails, or the fallback timer fires, so callers never hang.
 */
export function speak(text: string, opts: { queue?: boolean } = {}): Promise<void> {
  const s = synth();
  if (!s || typeof SpeechSynthesisUtterance === 'undefined' || !text) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, fallbackMs(text) + 1500);
    try {
      if (!opts.queue) s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = LANG;
      u.rate = RATE;
      const voice = s.getVoices?.().find((v) => v.lang === LANG);
      if (voice) u.voice = voice;
      u.onend = finish;
      u.onerror = finish;
      s.speak(u);
    } catch {
      finish();
    }
  });
}

export function stopSpeaking(): void {
  try {
    synth()?.cancel();
  } catch {
    // Nothing to stop.
  }
}

/** Call from a tap handler. iOS refuses speech until one utterance starts inside a tap. */
export function unlockSpeech(): void {
  const s = synth();
  if (!s || typeof SpeechSynthesisUtterance === 'undefined') return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.lang = LANG;
    s.speak(u);
  } catch {
    // Speech stays locked; the replay button still tries.
  }
}

/** A speak function that drops the answer if a newer call took over, and stops on unmount. */
export function useSpeech() {
  const turn = useRef(0);
  useEffect(() => () => stopSpeaking(), []);
  const say = useCallback(async (text: string, opts: { queue?: boolean } = {}): Promise<boolean> => {
    const mine = ++turn.current;
    await speak(text, opts);
    return mine === turn.current;
  }, []);
  return { say, cancel: useCallback(() => { turn.current++; stopSpeaking(); }, []) };
}
