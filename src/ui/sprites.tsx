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
};

export const MONSTERS = ['slime', 'bat', 'ghost', 'skeleton'] as const;

export function Sprite({ name, size = 96, className }: { name: string; size?: number; className?: string }) {
  const def = SPRITES[name] ?? SPRITES.knight!;
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
