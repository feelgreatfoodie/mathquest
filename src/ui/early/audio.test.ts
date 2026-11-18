import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The voice and WebAudio are stubbed. No audio asset files exist; every sound is a WebAudio oscillator. */
type Stub = { spoken: { text: string; lang: string; rate: number }[]; oscillators: number; ctxs: number };

function install(): Stub {
  const st: Stub = { spoken: [], oscillators: 0, ctxs: 0 };
  class Utter {
    lang = '';
    rate = 1;
    volume = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.SpeechSynthesisUtterance = Utter;
  g.speechSynthesis = {
    speak: (u: Utter) => { st.spoken.push({ text: u.text, lang: u.lang, rate: u.rate }); setTimeout(() => u.onend?.(), 1); },
    cancel: () => undefined,
    getVoices: () => [],
  };
  g.AudioContext = class {
    currentTime = 0;
    destination = {};
    constructor() { st.ctxs++; }
    resume() { return Promise.resolve(); }
    createOscillator() { st.oscillators++; return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  };
  return st;
}

function uninstall() {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['window', 'SpeechSynthesisUtterance', 'speechSynthesis', 'AudioContext']) delete g[k];
}

describe('voice', () => {
  let st: Stub;
  beforeEach(() => { vi.resetModules(); st = install(); });
  afterEach(uninstall);

  it('speaks en-US at rate 0.85 and resolves when the voice ends', async () => {
    const { speak, speechAvailable } = await import('./useSpeech');
    expect(speechAvailable()).toBe(true);
    await speak('three plus two');
    expect(st.spoken).toEqual([{ text: 'three plus two', lang: 'en-US', rate: 0.85 }]);
  });

  it('unlocks with a silent utterance inside a tap', async () => {
    const { unlockSpeech } = await import('./useSpeech');
    unlockSpeech();
    expect(st.spoken).toHaveLength(1);
    expect(st.spoken[0]!.text.trim()).toBe('');
  });

  it('does nothing, and never throws, where speechSynthesis is missing', async () => {
    uninstall();
    const { speak, speechAvailable, unlockSpeech, stopSpeaking } = await import('./useSpeech');
    expect(speechAvailable()).toBe(false);
    await expect(speak('hello')).resolves.toBeUndefined();
    expect(() => { unlockSpeech(); stopSpeaking(); }).not.toThrow();
  });
});

describe('sounds', () => {
  let st: Stub;
  beforeEach(() => { vi.resetModules(); st = install(); });
  afterEach(uninstall);

  it('plays a chime, a soft tone and a tick with oscillators', async () => {
    const s = await import('./sounds');
    s.unlockSounds();
    s.chime();
    expect(st.oscillators).toBe(3);
    s.softTone();
    s.tick();
    expect(st.oscillators).toBe(5);
    expect(st.ctxs).toBe(1); // one shared context
  });

  it('is silent, and never throws, where WebAudio is missing', async () => {
    uninstall();
    const s = await import('./sounds');
    expect(() => { s.unlockSounds(); s.chime(); s.softTone(); s.tick(); }).not.toThrow();
  });
});
