import { PixelArt, type ArtDef } from './PixelArt';

/** A heart on the 12 by 12 grid, for the Adventure top bar. Art, not part of the 10-icon set. */
const HEART: ArtDef = {
  palette: { r: '#ef4444', R: '#b91c1c', w: '#fecaca' },
  rows: ['............', '.rrr....rrr.', 'rwrrr..rrrrR', 'rwrrrrrrrrrR', 'rrrrrrrrrrrR', 'rrrrrrrrrrrR', '.rrrrrrrrrR.', '..rrrrrrrR..', '...rrrrrR...', '....rrrR....', '.....rR.....', '............'],
};

export function PixelHeart({ size = 24 }: { size?: number }) {
  return <PixelArt def={HEART} size={size} />;
}
