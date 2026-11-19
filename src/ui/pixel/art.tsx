import { PixelArt, type ArtDef } from './PixelArt';

/** Two more pieces on the 12 by 12 grid for the Picture Run screens, which need a play triangle and a map. They are art, not part of the 10-icon set. */
const PLAY: ArtDef = {
  palette: { k: '#052e16' },
  rows: ['............', '..kk........', '..kkkk......', '..kkkkkk....', '..kkkkkkkk..', '..kkkkkkkkk.', '..kkkkkkkkk.', '..kkkkkkkk..', '..kkkkkk....', '..kkkk......', '..kk........', '............'],
};

const MAP: ArtDef = {
  palette: { p: '#fde68a', d: '#92400e', g: '#15803d', r: '#ef4444' },
  rows: ['............', 'dddddddddddd', 'dpppdpppdppd', 'dpgpdpppdpgd', 'dpggdprpdgpd', 'dpgpdrrrdpgd', 'dpppdprpdppd', 'dppgdpppdppd', 'dpppdpppdgpd', 'dddddddddddd', '............', '............'],
};

export function PixelPlay({ size = 96 }: { size?: number }) {
  return <PixelArt def={PLAY} size={size} />;
}

export function PixelMap({ size = 96 }: { size?: number }) {
  return <PixelArt def={MAP} size={size} />;
}
