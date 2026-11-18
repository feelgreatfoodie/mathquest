import { soundsOf, voiceOf, type KidSettings } from '../engine/models';

/**
 * What a kid hears, from the parent's settings and the kid's own mute (kept on the device).
 * Voice 'kid' (the default): the kid's mute silences the voice and the chimes. Voice 'on': the parent pins the voice, so
 * the kid's mute silences the chimes only. Voice 'off': silent, and the kid cannot override it. Sounds 'off' silences the
 * chimes whatever the kid does.
 */
export function audioPolicy(settings: Pick<KidSettings, 'voice' | 'sounds' | 'sound'> | undefined | null, kidMuted: boolean) {
  const voice = voiceOf(settings);
  const soundsOff = soundsOf(settings) === 'off';
  return {
    voiceMuted: voice === 'off' || (voice === 'kid' && kidMuted),
    voiceLocked: voice === 'off',
    soundsMuted: soundsOff || kidMuted,
    // The button has nothing to do when the voice is not the kid's to switch and the chimes are already off.
    locked: voice !== 'kid' && soundsOff,
    // The button mutes the chimes alone, and shows a chime-off icon.
    chimesOnly: voice !== 'kid',
  };
}
