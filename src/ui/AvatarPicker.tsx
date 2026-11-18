import { AVATAR_COLORS, AVATAR_HEROES, type KidAvatar } from '../engine/models';
import { Sprite } from './sprites';

/** Picker color id to a swatch. Used by the parent chooser and the "Who is playing?" cards. */
export const AVATAR_SWATCH: Record<string, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  orange: '#f97316',
  pink: '#ec4899',
  purple: '#8b5cf6',
  teal: '#14b8a6',
};

const HERO_NAME: Record<string, string> = { knight: 'Knight', wizard: 'Wizard', ranger: 'Ranger', robot: 'Robot', dragon: 'Dragon Rider' };

/** The parent picks a hero and a color for a player, free. It changes the picker card only, never the shop hero. */
export function AvatarPicker({ value, onChange }: { value: KidAvatar; onChange: (a: KidAvatar) => void }) {
  return (
    <fieldset className="avatar-picker">
      <legend>Picture on the player screen</legend>
      <div className="avatar-heroes" role="radiogroup" aria-label="Hero">
        {AVATAR_HEROES.map((h) => (
          <button key={h} type="button" role="radio" aria-checked={value.hero === h} aria-label={HERO_NAME[h]} className={`avatar-opt ${value.hero === h ? 'is-on' : ''}`} onClick={() => onChange({ ...value, hero: h })}>
            <Sprite name={h} size={48} />
          </button>
        ))}
      </div>
      <div className="avatar-colors" role="radiogroup" aria-label="Color">
        {AVATAR_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={value.color === c} aria-label={c} className={`avatar-swatch ${value.color === c ? 'is-on' : ''}`} style={{ background: AVATAR_SWATCH[c] }} onClick={() => onChange({ ...value, color: c })} />
        ))}
      </div>
    </fieldset>
  );
}
