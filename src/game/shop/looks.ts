import type { KidGame } from '../../engine/models';
import { equippedOf, ownedItems } from './shopState';

// Item powers, weapons-and-looks PR. PDR rule 1: a look never touches a question, an answer, timing or grading. Nothing here reads
// the session. A look is a picture on the hero, a glow, a title line or a roar after a boss win. It works only while the item is
// owned, and a wearable only while it is equipped too. A title unlocks on owning the item (it is a thing the kid earned).

type Owned = Pick<KidGame, 'items' | 'equipped'>;

export interface WornLooks {
  weapon?: string;
  gear?: string;
}

/** What the hero wears: the equipped weapon and gear, and only the ones the kid owns. */
export function wornLooks(game: Owned): WornLooks {
  const own = ownedItems(game);
  const worn = equippedOf(game);
  return {
    ...(worn.weapon && own.includes(worn.weapon) ? { weapon: worn.weapon } : {}),
    ...(worn.gear && own.includes(worn.gear) ? { gear: worn.gear } : {}),
  };
}

export const LEGENDARY_ARMOR = 'g-goldarmor';
export const LEGENDARY_STAFF = 'w-crystalstaff';

/** The hero glows while a legendary item is worn: gold for the armor, cyan for the staff. The armor wins when both are worn. */
export function glowOf(game: Owned): 'gold' | 'cyan' | null {
  const w = wornLooks(game);
  if (w.gear === LEGENDARY_ARMOR) return 'gold';
  if (w.weapon === LEGENDARY_STAFF) return 'cyan';
  return null;
}

/**
 * The title the kid earned, from the kid's display name at runtime (never a fixed name). The worn legendary item picks it; with
 * none worn, the armor ("Sir") before the staff ("Archmage"). No legendary item owned means no title.
 */
export function titleFor(game: Owned, displayName: string): string | null {
  const name = displayName.trim();
  if (!name) return null;
  const own = ownedItems(game);
  const w = wornLooks(game);
  const armor = own.includes(LEGENDARY_ARMOR);
  const staff = own.includes(LEGENDARY_STAFF);
  if (w.gear === LEGENDARY_ARMOR) return `Sir ${name}`;
  if (w.weapon === LEGENDARY_STAFF) return `Archmage ${name}`;
  if (armor) return `Sir ${name}`;
  if (staff) return `Archmage ${name}`;
  return null;
}

/** The Dino Hood roars on a boss win, only while it is worn. */
export function roars(game: Owned): boolean {
  return wornLooks(game).gear === 'g-dinohood';
}

/**
 * Where an item sits on the hero, as fractions of the hero's tile (the same places as the `.fig-*` rules on Home): `x`, `y`
 * and `size` are fractions of the tile, and `behind` draws it before the hero. The canvas flips `x` when the hero faces left.
 */
export interface LookSpot {
  x: number;
  y: number;
  size: number;
  behind: boolean;
}

export function lookSpot(id: string): LookSpot {
  if (id === 'g-cape') return { x: -0.04, y: 0.14, size: 1.08, behind: true };
  if (id === 'g-goldarmor') return { x: 0.12, y: 0.22, size: 0.76, behind: false };
  if (id.startsWith('w-')) return { x: 0.72, y: 0.42, size: 0.54, behind: false };
  return { x: 0.22, y: -0.16, size: 0.56, behind: false };
}
