/** Sounds made with WebAudio. No asset files. Every call is a no-op where WebAudio is missing. */

type AudioCtor = new () => AudioContext;

let ctx: AudioContext | null = null;
let muted = false;

/** Sound is on by default. A parent can switch it off for a kid, and the kid can mute from the top bar. */
export function setMuted(value: boolean): void {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

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
  if (muted) return;
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

/** A soft rising tone when a hold starts. */
export function risingTone(): void {
  tone(392, 0, 0.3, 'sine', 0.08);
  tone(523.25, 0.3, 0.3, 'sine', 0.08);
  tone(659.25, 0.6, 0.4, 'sine', 0.08);
}

/** A short punch: the hero hits the monster. */
export function hit(): void {
  tone(196, 0, 0.09, 'square', 0.12);
  tone(392, 0.04, 0.12, 'triangle', 0.14);
}

/** The monster is defeated: a quick rising run. */
export function defeat(): void {
  tone(392, 0, 0.1, 'square', 0.1);
  tone(523.25, 0.08, 0.1, 'square', 0.1);
  tone(659.25, 0.16, 0.1, 'square', 0.1);
  tone(1046.5, 0.24, 0.25, 'triangle', 0.12);
}

/** A level up: a longer fanfare. */
export function levelUp(): void {
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.11, 0.22, 'triangle', 0.15));
}

/** A chest opens: two bright notes. */
export function chest(): void {
  tone(784, 0, 0.12, 'sine', 0.14);
  tone(1174.7, 0.1, 0.25, 'sine', 0.14);
}
