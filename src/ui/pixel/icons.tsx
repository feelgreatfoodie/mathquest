import { PixelArt, type ArtDef } from './PixelArt';

/** One original pixel icon set on the 12 by 12 sprite grid. No icon pack, no emoji. */
const K = '#111827';

export const PIXEL_ICONS = {
  house: {
    palette: { r: '#ef4444', w: '#fcd9a8', d: '#92400e' },
    rows: ['.....rr.....', '....rrrr....', '...rrrrrr...', '..rrrrrrrr..', '.rrrrrrrrrr.', 'rrrrrrrrrrrr', '.wwwwwwwwww.', '.wwwwddwwww.', '.wwwwddwwww.', '.wwwwddwwww.', '.wwwwddwwww.', '.wwwwddwwww.'],
  },
  speaker: {
    palette: { s: '#e2e8f0', c: '#fbbf24' },
    rows: ['............', '.....s......', '....ss...c..', '..ssss....c.', 'sssss...c.c.', 'sssss...c.c.', 'sssss...c.c.', 'sssss...c.c.', '..ssss....c.', '....ss...c..', '.....s......', '............'],
  },
  gem: {
    palette: { b: '#38bdf8', B: '#0369a1', w: '#ffffff' },
    rows: ['............', '...BBBBBB...', '..BbbwbbbB..', '.BbbwbbbbbB.', 'BBBBBBBBBBBB', '.BbbbbbbbbB.', '..BbbbbbbB..', '...BbbbbB...', '....BbbB....', '.....BB.....', '............', '............'],
  },
  key: {
    palette: { y: '#fde047', o: '#ca8a04' },
    rows: ['............', '............', '..oooo......', '.oyyyyo.....', '.oy..yo.....', '.oy..yoooooo', '.oy..yyyyyyo', '.oyyyyoooyoo', '..oooo...yo.', '.........oo.', '............', '............'],
  },
  flame: {
    palette: { R: '#ef4444', o: '#fb923c', y: '#fde047' },
    rows: ['.....R......', '.....RR.....', '....RRR.....', '...RRoRR....', '...RooRRR...', '..RRoooRR...', '..RoooyoRR..', '..RooyyooR..', '..RooyyooR..', '..RRooyoRR..', '...RRooRR...', '....RRRR....'],
  },
  bolt: {
    palette: { y: '#facc15', o: '#a16207' },
    rows: ['......yyyy..', '.....yyyyo..', '....yyyyo...', '...yyyyo....', '..yyyyyyyy..', '..yyyyyyyo..', '......yyo...', '.....yyo....', '....yyo.....', '...yyo......', '..yo........', '.yo.........'],
  },
  star: {
    palette: { y: '#facc15', o: '#ca8a04' },
    rows: ['.....yy.....', '.....yy.....', '....yyyy....', 'yyyyyyyyyyyy', '.yyyyyyyyyy.', '..yyyyyyyy..', '...yyyyyy...', '..yyyyyyyy..', '..yyyoyyyy..', '.yyy....yyy.', '.yy......yy.', '............'],
  },
  chest: {
    palette: { k: K, b: '#b45309', y: '#fde047' },
    rows: ['............', '.kkkkkkkkkk.', 'kbbbbbbbbbbk', 'kbbbbbbbbbbk', 'kkkkkkkkkkkk', 'kbbbbyybbbbk', 'kbbbbykbbbbk', 'kbbbbbbbbbbk', 'kbbbbbbbbbbk', 'kkkkkkkkkkkk', '............', '............'],
  },
  vault: {
    palette: { k: K, s: '#94a3b8', S: '#64748b', y: '#fbbf24' },
    rows: ['kkkkkkkkkkkk', 'kssssssssssk', 'ksSSSSSSSSsk', 'ksSssssssSsk', 'ksSssyyssSsk', 'ksSsyyyysSsk', 'ksSsyyyysSsk', 'ksSssyyssSsk', 'ksSssssssSsk', 'ksSSSSSSSSsk', 'kssssssssssk', 'kkkkkkkkkkkk'],
  },
  torch: {
    palette: { y: '#fde047', o: '#fb923c', R: '#ef4444', k: K, n: '#92400e' },
    rows: ['.....y......', '....yoy.....', '...yooRy....', '...yoRRy....', '....RRR.....', '....kkk.....', '....nnn.....', '....nnn.....', '....nnn.....', '....nnn.....', '....nnn.....', '....kkk.....'],
  },
  tent: {
    palette: { k: K, t: '#f1e4c3', d: '#92400e', p: K, R: '#ef4444' },
    rows: ['.....pRR....', '.....pRRR...', '.....pRR....', '.....kk.....', '....kttk....', '...kttttk...', '..kttkkttk..', '.kttkddkttk.', 'kttkddddkttk', 'ktkddddddktk', 'kkkkkkkkkkkk', '............'],
  },
  flag: {
    palette: { p: '#92400e', R: '#ef4444', s: '#6b7280' },
    rows: ['...pRRRR....', '...pRRRRRR..', '...pRRRRRRR.', '...pRRRRRR..', '...pRRRR....', '...p........', '...p........', '...p........', '...p........', '..sssss.....', '.sssssss....', '............'],
  },
} as const satisfies Record<string, ArtDef>;

export type PixelIconName = keyof typeof PIXEL_ICONS;
export const PIXEL_ICON_NAMES = Object.keys(PIXEL_ICONS) as PixelIconName[];

export function PixelIcon({ name, size = 48, label, className }: { name: PixelIconName; size?: number; label?: string; className?: string }) {
  return <PixelArt def={PIXEL_ICONS[name]} size={size} className={className} {...(label ? { label } : {})} />;
}
