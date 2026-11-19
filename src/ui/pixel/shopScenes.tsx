import { PixelArt, type ArtDef } from './PixelArt';
import { PixelIcon } from './icons';

/** The shop stall and the vault door: two small pixel scenes that sit above the shop and the vault. Decoration only (aria-hidden). */

/** A stall: striped awning, posts, a counter with things for sale on it. Pure rectangles, 4 px steps. */
export function ShopStall() {
  return (
    <div className="px-stall" aria-hidden="true" data-testid="shop-stall">
      <div className="px-awning" />
      <div className="px-stall-posts">
        <span className="px-post" />
        <div className="px-stall-goods">
          <PixelIcon name="gem" size={36} />
          <PixelIcon name="key" size={36} />
          <PixelIcon name="chest" size={44} />
          <PixelIcon name="star" size={36} />
          <PixelIcon name="flame" size={36} />
        </div>
        <span className="px-post" />
      </div>
      <div className="px-counter" />
    </div>
  );
}

/** A round steel door: bolts around the rim, a gold dial in the middle. 16 by 16 on the sprite grid. */
const DOOR: ArtDef = {
  palette: { k: '#111827', s: '#94a3b8', S: '#64748b', d: '#475569', y: '#fbbf24', Y: '#b45309', w: '#e2e8f0' },
  rows: [
    '....kkkkkkkk....',
    '..kkssssssssSk..',
    '.ksswssssssswSk.',
    '.kssSSSSSSSSssk.',
    'ksswSddddddSsSSk',
    'kssSdSSSSSSdsSSk',
    'kssSdSyyyySdsSSk',
    'kssSdSyYYySdsSSk',
    'kssSdSyYYySdsSSk',
    'kssSdSyyyySdsSSk',
    'kssSdSSSSSSdsSSk',
    'ksswSddddddSsSSk',
    '.kssSSSSSSSSssk.',
    '.ksswssssssswSk.',
    '..kkssssssssSk..',
    '....kkkkkkkk....',
  ],
};

export function VaultDoor() {
  return (
    <div className="px-vault-scene" aria-hidden="true" data-testid="vault-door">
      <span className="px-gem-pile is-left"><PixelIcon name="gem" size={32} /><PixelIcon name="gem" size={24} /></span>
      <PixelArt def={DOOR} size={96} className="px-vault-door" />
      <span className="px-gem-pile is-right"><PixelIcon name="gem" size={24} /><PixelIcon name="gem" size={32} /></span>
    </div>
  );
}
