import type { KidGame } from '../engine/models';
import { equippedOf } from '../game/shop/shopState';
import { Sprite } from './sprites';

interface Props {
  game: Pick<KidGame, 'hero' | 'items' | 'equipped'>;
  size: number;
  className?: string;
  /** True while a correct answer lands: the weapon plays its strike. */
  strike?: boolean;
  /** True on a combo: the pet cheers. */
  cheer?: boolean;
}

/** Where a gear piece sits on the hero: a cape behind, armor over the body, anything else on the head. */
function gearClass(id: string): string {
  if (id === 'g-cape') return 'fig-cape';
  if (id === 'g-goldarmor') return 'fig-armor';
  return 'fig-hat';
}

/**
 * The hero with what the kid wears: gear on the sprite, the weapon in hand, the pet beside. A game with no items
 * renders the plain hero sprite, so a screen that has not been given a shop still looks the same.
 */
export function HeroFigure({ game, size, className, strike, cheer }: Props) {
  const worn = equippedOf(game);
  if (!worn.weapon && !worn.gear && !worn.pet) return <Sprite name={game.hero} size={size} className={className} />;
  return (
    <span className={`hero-fig ${className ?? ''}`} style={{ width: size, height: size }} data-weapon={worn.weapon ?? ''} data-gear={worn.gear ?? ''} data-pet={worn.pet ?? ''}>
      {worn.gear ? <Sprite name={worn.gear} size={size} className={`fig-part ${gearClass(worn.gear)}`} /> : null}
      <Sprite name={game.hero} size={size} className="fig-hero" />
      {worn.weapon ? <Sprite name={worn.weapon} size={size} className={`fig-part fig-weapon ${strike ? `strike strike-${worn.weapon}` : ''}`} /> : null}
      {worn.pet ? <Sprite name={worn.pet} size={size} className={`fig-part fig-pet ${cheer ? 'cheer' : ''}`} /> : null}
    </span>
  );
}
