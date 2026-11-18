import { ITEMS } from '../game/shop/catalog';
import { ownedItems } from '../game/shop/shopState';
import type { KidGame } from '../engine/models';
import { Sprite } from './sprites';

/** The camp decorations the kid owns, in a row on home. Decoration only: nothing here is a control. */
export function CampRow({ game, size = 56 }: { game: Pick<KidGame, 'items'>; size?: number }) {
  const owned = new Set(ownedItems(game));
  const decor = ITEMS.filter((i) => i.category === 'camp' && owned.has(i.id));
  if (!decor.length) return null;
  return (
    <div className="camp-row" aria-hidden="true">
      {decor.map((d) => <Sprite key={d.id} name={d.id} size={size} />)}
    </div>
  );
}
