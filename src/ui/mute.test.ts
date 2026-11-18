import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { soundsOf, voiceOf } from '../engine/models';
import { audioPolicy } from './audioPolicy';

describe('parent voice and sounds settings', () => {
  it('a missing voice reads as kid (the kid\'s mute button works), a missing sounds reads as on', () => {
    expect(voiceOf({})).toBe('kid');
    expect(voiceOf(undefined)).toBe('kid');
    expect(voiceOf(null)).toBe('kid');
    expect(soundsOf({})).toBe('on');
    expect(soundsOf(null)).toBe('on');
  });
  it("voice 'kid' reads as kid", () => {
    expect(voiceOf({ voice: 'kid' })).toBe('kid');
  });
  it("voice 'on' reads as on (the parent pins the voice)", () => {
    expect(voiceOf({ voice: 'on' })).toBe('on');
  });
  it("voice 'off' reads as off", () => {
    expect(voiceOf({ voice: 'off' })).toBe('off');
  });
  it('the old parent lock reads as voice off, and keeps the chimes off, without a migration', () => {
    expect(voiceOf({ sound: false })).toBe('off');
    expect(soundsOf({ sound: false })).toBe('off');
    expect(voiceOf({ sound: true })).toBe('kid');
  });
  it('an explicit value wins over the old lock', () => {
    expect(voiceOf({ sound: false, voice: 'kid' })).toBe('kid');
    expect(voiceOf({ sound: false, voice: 'on' })).toBe('on');
    expect(soundsOf({ sound: false, sounds: 'on' })).toBe('on');
    expect(soundsOf({ sounds: 'off' })).toBe('off');
  });
  it('an unknown value reads as the default', () => {
    expect(voiceOf({ voice: 'loud' })).toBe('kid');
    expect(soundsOf({ sounds: 'maybe' })).toBe('on');
  });
});

describe('audioPolicy: what each voice value does', () => {
  it("missing voice reads as 'kid': the kid's mute silences the voice and the chimes", () => {
    expect(audioPolicy({}, false)).toMatchObject({ voiceMuted: false, soundsMuted: false, locked: false, chimesOnly: false });
    expect(audioPolicy({}, true)).toMatchObject({ voiceMuted: true, voiceLocked: false, soundsMuted: true, locked: false, chimesOnly: false });
  });
  it("'kid' is the same as missing", () => {
    expect(audioPolicy({ voice: 'kid' }, true)).toEqual(audioPolicy({}, true));
  });
  it("'on' pins the voice: the kid's mute silences the chimes only, and the button shows the chime-off state", () => {
    expect(audioPolicy({ voice: 'on' }, true)).toMatchObject({ voiceMuted: false, voiceLocked: false, soundsMuted: true, locked: false, chimesOnly: true });
    expect(audioPolicy({ voice: 'on' }, false)).toMatchObject({ voiceMuted: false, soundsMuted: false });
    expect(audioPolicy({ voice: 'on', sounds: 'off' }, false)).toMatchObject({ voiceMuted: false, soundsMuted: true, locked: true });
  });
  it("'off' is silent whatever the kid does: no voice, no Hear it, the button only touches the chimes", () => {
    expect(audioPolicy({ voice: 'off' }, false)).toMatchObject({ voiceMuted: true, voiceLocked: true, soundsMuted: false, locked: false, chimesOnly: true });
    expect(audioPolicy({ voice: 'off' }, true)).toMatchObject({ voiceMuted: true, voiceLocked: true, soundsMuted: true });
    expect(audioPolicy({ voice: 'off', sounds: 'off' }, false)).toMatchObject({ locked: true });
  });
  it('the old sound:false lock is voice off and chimes off, and the button is hidden', () => {
    expect(audioPolicy({ sound: false }, false)).toMatchObject({ voiceMuted: true, voiceLocked: true, soundsMuted: true, locked: true });
  });
  it("sounds 'off' with voice 'kid' silences the chimes but not the voice", () => {
    expect(audioPolicy({ sounds: 'off' }, false)).toMatchObject({ voiceMuted: false, soundsMuted: true, locked: false });
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
