import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { soundsOf, voiceOf } from '../engine/models';

describe('parent voice and sounds settings', () => {
  it('a missing value reads as on', () => {
    expect(voiceOf({})).toBe('on');
    expect(soundsOf({})).toBe('on');
    expect(voiceOf(undefined)).toBe('on');
    expect(soundsOf(null)).toBe('on');
  });
  it('the old parent lock reads as voice off, and keeps the chimes off, without a migration', () => {
    expect(voiceOf({ sound: false })).toBe('off');
    expect(soundsOf({ sound: false })).toBe('off');
    expect(voiceOf({ sound: true })).toBe('on');
  });
  it('an explicit value wins over the old lock', () => {
    expect(voiceOf({ sound: false, voice: 'kid' })).toBe('kid');
    expect(soundsOf({ sound: false, sounds: 'on' })).toBe('on');
    expect(voiceOf({ voice: 'off' })).toBe('off');
    expect(soundsOf({ sounds: 'off' })).toBe('off');
  });
  it('an unknown value reads as the default', () => {
    expect(voiceOf({ voice: 'loud' })).toBe('on');
    expect(soundsOf({ sounds: 'maybe' })).toBe('on');
  });
});

describe('the voice policy', () => {
  const spoken: string[] = [];
  beforeEach(() => {
    spoken.length = 0;
    vi.resetModules();
    class Utter {
      lang = '';
      rate = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = globalThis;
    g.SpeechSynthesisUtterance = Utter;
    g.speechSynthesis = { speak: (u: Utter) => { spoken.push(u.text); setTimeout(() => u.onend?.(), 1); }, cancel: () => undefined, getVoices: () => [] };
  });
  afterEach(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    for (const k of ['window', 'SpeechSynthesisUtterance', 'speechSynthesis']) delete g[k];
  });

  it('muted: the voice stays quiet, and a "hear" tap speaks once', async () => {
    const { speak, setVoicePolicy, canHear } = await import('./early/useSpeech');
    setVoicePolicy({ muted: true, locked: false });
    await speak('auto question');
    expect(spoken).toEqual([]);
    expect(canHear()).toBe(true);
    await speak('three plus two', { hear: true });
    expect(spoken).toEqual(['three plus two']);
    await speak('auto again');
    expect(spoken).toEqual(['three plus two']);
  });
  it('parent off: nothing speaks, not even a hear tap, and Hear it is unavailable', async () => {
    const { speak, setVoicePolicy, canHear } = await import('./early/useSpeech');
    setVoicePolicy({ muted: true, locked: true });
    await speak('x', { hear: true });
    await speak('y');
    expect(spoken).toEqual([]);
    expect(canHear()).toBe(false);
  });
  it('not muted: every call speaks', async () => {
    const { speak, setVoicePolicy } = await import('./early/useSpeech');
    setVoicePolicy({ muted: false, locked: false });
    await speak('one');
    expect(spoken).toEqual(['one']);
  });
});

describe('setKidAudio', () => {
  it('the local repo changes only the named fields of settings', async () => {
    const store = new Map<string, string>();
    (globalThis as unknown as Record<string, unknown>).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const { LocalRepo } = await import('../data/localRepo');
    const repo = new LocalRepo();
    const kid = { id: 'kidaudio00000000001', name: 'Pip', createdAt: 1, settings: { sessionSize: 10, sound: false }, game: {} } as never;
    await repo.createKid(kid);
    await repo.setKidAudio('kidaudio00000000001', { voice: 'kid' });
    let got = (await repo.getKid('kidaudio00000000001'))!;
    expect(got.settings).toMatchObject({ sessionSize: 10, sound: false, voice: 'kid' });
    expect(got.settings.sounds).toBeUndefined();
    await repo.setKidAudio('kidaudio00000000001', { sounds: 'off' });
    got = (await repo.getKid('kidaudio00000000001'))!;
    expect(got.settings).toMatchObject({ voice: 'kid', sounds: 'off', sessionSize: 10 });
  });
});
