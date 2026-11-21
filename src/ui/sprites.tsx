import { ITEM_SPRITES } from './itemSprites';

/** Original 12×12 pixel sprites, drawn as SVG rects (crisp at any size, no image files). */

type SpriteDef = { rows: string[]; palette: Record<string, string> };

const SKIN = '#fcd9a8';
const INK = '#111827';

export const SPRITES: Record<string, SpriteDef> = {
  slime: {
    palette: { g: '#4ade80', G: '#15803d', w: '#ffffff', k: INK },
    rows: [
      '............', '............', '....GGGG....', '...GggggG...', '..GggggggG..', '..GwkggwkG..',
      '.GgwkggwkgG.', '.GggggggggG.', 'GgggkkkkgggG', 'GggggggggggG', 'GGGGGGGGGGGG', '............',
    ],
  },
  bat: {
    palette: { P: '#7c3aed', r: '#f87171', w: '#ffffff' },
    rows: [
      '............', '............', 'P..........P', 'PP..P..P..PP', 'PPP.PPPP.PPP', 'PPPPrPPrPPPP',
      'PPPPPPPPPPPP', '.PP.PwwP.PP.', '.P...PP...P.', '............', '............', '............',
    ],
  },
  ghost: {
    palette: { w: '#e5e7eb', W: '#9ca3af', k: INK },
    rows: [
      '............', '....WWWW....', '...WwwwwW...', '..WwwwwwwW..', '..WwkwwkwW..', '..WwkwwkwW..',
      '..WwwwwwwW..', '..WwwkkwwW..', '..WwwwwwwW..', '..WwwwwwwW..', '..WwWwwWwW..', '..W.W..W.W..',
    ],
  },
  skeleton: {
    palette: { b: '#f3f4f6', B: '#9ca3af', k: INK },
    rows: [
      '....bbbb....', '...bbbbbb...', '...bkbbkb...', '...bbbbbb...', '....bkkb....', '.....bb.....',
      '..BbbbbbbB..', '..B.bBBb.B..', '....bbbb....', '....b..b....', '...bb..bb...', '............',
    ],
  },
  boss: {
    palette: { R: '#991b1b', r: '#ef4444', y: '#fde047', k: INK, w: '#ffffff', o: '#fb923c' },
    rows: [
      'R..........R', 'RR........RR', '.RRRRRRRRRR.', '.RrrrrrrrrR.', 'RrryrrrryrrR', 'RrrkrrrrkrrR',
      'RrrrrrrrrrrR', '.RrrwrrwrrR.', '.RrrrrrrrrR.', '..RRooooRR..', '...RRRRRR...', '..RR....RR..',
    ],
  },
  knight: {
    palette: { S: '#64748b', s: '#cbd5e1', f: SKIN, k: INK, b: '#2563eb', y: '#facc15' },
    rows: [
      '....SSSS....', '...SssssS...', '...SsSSsS...', '...SfkfkS...', '...SffffS...', '..bbbbbbbb..',
      '.fbbbybbbbf.', '.fbbbybbbbf.', '..bbbbbbbb..', '...SS..SS...', '...SS..SS...', '..SSS..SSS..',
    ],
  },
  wizard: {
    palette: { p: '#7c3aed', y: '#fde047', f: SKIN, k: INK, w: '#f3f4f6' },
    rows: [
      '.....pp.....', '....pppp....', '...ppyppp...', '..pppppppp..', '...fkffkf...', '...wwwwww...',
      '..pwwwwwwp..', '.pppwwwwppp.', '.pppppppppp.', '..pppppppp..', '..pppppppp..', '..pp....pp..',
    ],
  },
  ranger: {
    palette: { g: '#16a34a', G: '#166534', f: SKIN, k: INK, n: '#92400e' },
    rows: [
      '....gggg....', '...gggggg...', '..gggggggg..', '..ggfkfkgg..', '..ggffffgg..', '...GGGGGG...',
      '..nGGGGGGG..', '.n.GGGGGG...', '..nGGGGGG...', '...GG..GG...', '...GG..GG...', '..nnn..nnn..',
    ],
  },
  robot: {
    palette: { m: '#94a3b8', M: '#475569', c: '#22d3ee', r: '#ef4444' },
    rows: [
      '.....rr.....', '.....MM.....', '...MMMMMM...', '...McmmcM...', '...MmmmmM...', '...MMMMMM...',
      '.MMmmmmmmMM.', '.M.mmccmm.M.', '.M.mmmmmm.M.', '...mmmmmm...', '...MM..MM...', '..MMM..MMM..',
    ],
  },
  dragon: {
    palette: { d: '#22c55e', D: '#15803d', f: SKIN, b: '#2563eb', y: '#fde047', k: INK },
    rows: [
      '.....ff.....', '.....bb.....', 'D....bb....D', 'DD..dddd..DD', 'DDDddddddDDD', '.DdddkddddD.',
      '..dddddddd..', '..dyyyyyyd..', '...dddddd...', '...dd..dd...', '..ddd..ddd..', '............',
    ],
  },
  apple: {
    palette: { r: '#ef4444', n: '#92400e', g: '#22c55e', w: '#fecaca' },
    rows: [
      '.....n......', '....n..gg...', '..rrrrrrrr..', '.rrrrrrrrrr.', '.rwrrrrrrrr.', '.rwrrrrrrrr.',
      '.rrrrrrrrrr.', '.rrrrrrrrrr.', '..rrrrrrrr..', '..rrrrrrrr..', '...rr..rr...', '............',
    ],
  },
  star: {
    palette: { y: '#facc15', o: '#ca8a04' },
    rows: [
      '.....yy.....', '.....yy.....', '....yyyy....', 'yyyyyyyyyyyy', '.yyyyyyyyyy.', '..yyyyyyyy..',
      '...yyyyyy...', '..yyyyyyyy..', '..yyyoyyyy..', '.yyy....yyy.', '.yy......yy.', '............',
    ],
  },
  fish: {
    palette: { b: '#38bdf8', B: '#0369a1', w: '#ffffff', k: INK },
    rows: [
      '............', '............', '.....BBB....', '..bbbbbbb..B', '.bbbbbbbbbBB', 'bbwkbbbbbbBB',
      'bbbbbbbbbbbB', '.bbbbbbbbbBB', '..bbbbbbb..B', '.....BBB....', '............', '............',
    ],
  },
  bug: {
    palette: { r: '#ef4444', k: INK },
    rows: [
      '...k....k...', '....k..k....', '....kkkk....', '...rrkkrr...', '..rrrkkrrr..', '.rkrrkkrrkr.',
      '.rrrrkkrrrr.', '.rrkrkkrkrr.', '..rrrkkrrr..', '...rrkkrr...', '....rrrr....', '............',
    ],
  },
  dino: {
    palette: { g: '#4ade80', G: '#15803d', k: INK, w: '#ffffff' },
    rows: [
      '............', '.....gggg...', '....gkgggg..', '....ggggggg.', '....gggg....', 'G...gggg....',
      'GG.ggggggg..', 'GGgggggggg..', '.gggggggg...', '..gggggggg..', '..gg....gg..', '.ggg...ggg..',
    ],
  },
};

export const MONSTERS = ['slime', 'bat', 'ghost', 'skeleton'] as const;

export function Sprite({ name, size = 96, className }: { name: string; size?: number; className?: string }) {
  const def = SPRITES[name] ?? ITEM_SPRITES[name] ?? SPRITES.knight!;
  const rects: { x: number; y: number; w: number; c: string }[] = [];
  def.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      let run = 1;
      while (row[x + run] === ch) run++;
      const c = def.palette[ch];
      if (c) rects.push({ x, y, w: run, c });
      x += run;
    }
  });
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />
      ))}
    </svg>
  );
}

export type UiIconName = 'house' | 'speaker' | 'eye' | 'play' | 'flame' | 'arrow-down' | 'gem' | 'check' | 'chest' | 'sparkle' | 'refresh' | 'close' | 'lock' | 'bolt' | 'map' | 'gift';

/** Plain icons for the pre-reader screens. They carry no text: a shape and an aria-label. */
export function UiIcon({ name, size = 40, label }: { name: UiIconName; size?: number; label?: string }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', role: label ? 'img' : undefined, 'aria-label': label, 'aria-hidden': label ? undefined : true } as const;
  switch (name) {
    case 'house':
      return <svg {...common} fill="currentColor"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z" /></svg>;
    case 'speaker':
      return <svg {...common} fill="currentColor"><path d="M3 9v6h4l5 4V5L7 9zM15 8.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="currentColor" /></svg>;
    case 'eye':
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth="2"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7S18.5 19 12 19 1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3.2" fill="currentColor" /></svg>;
    case 'play':
      return <svg {...common} fill="currentColor"><path d="M7 3.5v17L21 12z" /></svg>;
    case 'flame':
      return <svg {...common} viewBox="0 0 24 24"><path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4 2-7 2 1 3 2 3 4 1-3 1-6 1-9z" fill="#fb923c" stroke="#9a3412" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
    case 'arrow-down':
      return <svg {...common} fill="currentColor"><path d="M10 3h4v10h5l-7 8-7-8h5z" /></svg>;
    case 'gem':
      return <svg {...common}><path d="M6 3h12l4 6-10 12L2 9z" fill="#38bdf8" stroke="#075985" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
    case 'chest':
      return <svg {...common}><path d="M3 10a9 5 0 0 1 18 0v2H3z" fill="#b45309" stroke="#451a03" strokeWidth="1.4" strokeLinejoin="round" /><rect x="3" y="12" width="18" height="8" rx="1" fill="#d97706" stroke="#451a03" strokeWidth="1.4" /><rect x="10" y="11" width="4" height="5" rx="1" fill="#facc15" stroke="#451a03" strokeWidth="1.2" /></svg>;
    case 'gift':
      return <svg {...common}><rect x="3" y="10" width="18" height="11" rx="1" fill="#ef4444" stroke="#7f1d1d" strokeWidth="1.4" /><rect x="2" y="7" width="20" height="4" rx="1" fill="#f87171" stroke="#7f1d1d" strokeWidth="1.4" /><rect x="10.5" y="7" width="3" height="14" fill="#facc15" stroke="#a16207" strokeWidth="1" /><path d="M12 7C9 7 6.5 5.5 7 4s3.5-.5 5 3c1.5-3.500 4-4.500 5-3s-2 3-5 3z" fill="#facc15" stroke="#a16207" strokeWidth="1.2" strokeLinejoin="round" /></svg>;
    case 'sparkle':
      return <svg {...common}><path d="M12 1l2.6 7.4L22 11l-7.4 2.6L12 21l-2.6-7.4L2 11l7.4-2.6z" fill="#facc15" stroke="#a16207" strokeWidth="1.2" strokeLinejoin="round" /></svg>;
    case 'check':
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13l5 5L20 6" /></svg>;
    case 'refresh':
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 3v6h-6" /></svg>;
    case 'lock':
      return <svg {...common}><rect x="5" y="11" width="14" height="10" rx="2" fill="#94a3b8" stroke="#334155" strokeWidth="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="#334155" strokeWidth="2.2" strokeLinecap="round" /></svg>;
    case 'bolt':
      return <svg {...common}><path d="M13 1 4 14h6l-1 9 9-13h-6z" fill="#facc15" stroke="#a16207" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
    case 'map':
      return <svg {...common}><path d="M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z" fill="#86efac" stroke="#166534" strokeWidth="1.5" strokeLinejoin="round" /><path d="M9 3v16M15 5v16" stroke="#166534" strokeWidth="1.3" /><path d="M5 13l3-3 2 2M17 9l2 2" fill="none" stroke="#a16207" strokeWidth="2" strokeLinecap="round" /><path d="M12 8l1.2 2.4L16 11l-2 1.8.5 2.7-2.5-1.4-2.5 1.4.5-2.7-2-1.8 2.8-.6z" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.8" /></svg>;
    case 'close':
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>;
  }
}
