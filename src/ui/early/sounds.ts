/** Sounds made with WebAudio. No asset files. Every call is a no-op where WebAudio is missing. */

type AudioCtor = new () => AudioContext;

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const C = w.AudioContext ?? w.webkitAudioContext;
    if (!C) return null;
    ctx ??= new C();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a tap handler. iOS keeps audio locked until a tap resumes the context. */
export function unlockSounds(): void {
  try {
    void audio()?.resume?.();
  } catch {
    // Audio stays locked; the run still works without sound.
  }
}

function tone(freq: number, at: number, dur: number, type: OscillatorType, gain: number): void {
  const c = audio();
  if (!c) return;
  try {
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch {
    // Ignore: a failed beep must never break a question.
  }
}

/** Three rising notes: right answer. */
export function chime(): void {
  tone(523.25, 0, 0.18, 'sine', 0.2);
  tone(659.25, 0.1, 0.18, 'sine', 0.2);
  tone(783.99, 0.2, 0.3, 'sine', 0.2);
}

/** One low, soft note: not quite. */
export function softTone(): void {
  tone(246.94, 0, 0.4, 'triangle', 0.14);
}

/** A short tick for each icon the count-up reaches. */
export function tick(): void {
  tone(880, 0, 0.08, 'sine', 0.1);
}
